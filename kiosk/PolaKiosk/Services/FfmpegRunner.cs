using System.Diagnostics;
using System.IO;
using System.Text;

namespace PolaKiosk.Services;

/// <summary>Fin d'un ffmpeg : code retour, sortie standard et fin de la sortie d'erreur.</summary>
public sealed record FfmpegExit(int ExitCode, string Output, string Error);

/// <summary>Un ffmpeg lancé : entrée standard ouverte (images brutes), attente de la fin, arrêt forcé.</summary>
public interface IFfmpegProcess : IDisposable
{
    Stream Input { get; }
    Task<FfmpegExit> WaitForExitAsync(CancellationToken ct);
    void Kill();
}

/// <summary>Lance ffmpeg.exe (remplacé par un faux dans les tests).</summary>
public interface IFfmpegRunner
{
    string ExecutablePath { get; }
    bool IsAvailable { get; }
    IFfmpegProcess Start(IReadOnlyList<string> arguments);
}

/// <summary>ffmpeg.exe livré à côté de PolaKiosk.exe (build LGPL, LAB-234), sans fenêtre.</summary>
public sealed class FfmpegRunner : IFfmpegRunner
{
    public FfmpegRunner(string? executablePath = null)
        => ExecutablePath = executablePath ?? Path.Combine(AppContext.BaseDirectory, "ffmpeg.exe");

    public string ExecutablePath { get; }

    public bool IsAvailable => File.Exists(ExecutablePath);

    public IFfmpegProcess Start(IReadOnlyList<string> arguments)
    {
        var info = new ProcessStartInfo(ExecutablePath)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
            WorkingDirectory = Path.GetTempPath(),
        };
        foreach (var arg in arguments) info.ArgumentList.Add(arg);
        var process = Process.Start(info) ?? throw new InvalidOperationException("ffmpeg n'a pas démarré.");
        return new FfmpegProcess(process);
    }

    private sealed class FfmpegProcess : IFfmpegProcess
    {
        private const int ErrorTailChars = 4000;
        private readonly Process _process;
        private readonly Task<string> _output;
        private readonly Task<string> _error;

        public FfmpegProcess(Process process)
        {
            _process = process;
            // Lues dès le départ : un tampon plein bloquerait ffmpeg.
            _output = process.StandardOutput.ReadToEndAsync();
            _error = process.StandardError.ReadToEndAsync();
        }

        public Stream Input => _process.StandardInput.BaseStream;

        public async Task<FfmpegExit> WaitForExitAsync(CancellationToken ct)
        {
            await _process.WaitForExitAsync(ct).ConfigureAwait(false);
            var output = await _output.ConfigureAwait(false);
            var error = await _error.ConfigureAwait(false);
            if (error.Length > ErrorTailChars) error = error[^ErrorTailChars..];
            return new FfmpegExit(_process.ExitCode, output, error);
        }

        public void Kill()
        {
            try
            {
                if (!_process.HasExited) _process.Kill(entireProcessTree: true);
            }
            catch (InvalidOperationException) { }
            catch (System.ComponentModel.Win32Exception) { }
        }

        public void Dispose()
        {
            Kill();
            _process.Dispose();
        }
    }
}
