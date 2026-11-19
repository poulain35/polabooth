using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>
/// Faux ffmpeg : rien n'est lancé. Chaque appel est classé (liste des encodeurs, essai d'un encodeur,
/// encodage) et reçoit le comportement réglé par le test.
/// </summary>
public sealed class FakeFfmpegRunner : IFfmpegRunner
{
    public const string Banner =
        "ffmpeg version n9.0.2-test Copyright (c) 2000-2026 the FFmpeg developers\n"
        + "  configuration: --enable-version3 --enable-libopenh264 --disable-libx264\n";

    public static string EncoderList(params string[] names) =>
        "Encoders:\n V..... = Video\n A..... = Audio\n ------\n"
        + string.Concat(names.Select(n => $" V....D {n,-20} {n} encoder (codec h264)\n"))
        + " A....D aac                  AAC (Advanced Audio Coding)\n";

    public bool IsAvailable { get; set; } = true;
    public string ExecutablePath => @"C:\fake\ffmpeg.exe";

    public string ListOutput { get; set; } = EncoderList("libopenh264", "h264_mf");
    public string ListBanner { get; set; } = Banner;
    /// <summary>Encodeurs dont l'essai échoue (listés mais inutilisables).</summary>
    public HashSet<string> BrokenProbes { get; } = [];
    /// <summary>Comportement d'un encodage, par encodeur (défaut : succès, fichier écrit).</summary>
    public Dictionary<string, Func<FakeFfmpegProcess>> Encodes { get; } = [];
    public Exception? StartError { get; set; }

    public List<IReadOnlyList<string>> Calls { get; } = [];
    public List<FakeFfmpegProcess> Processes { get; } = [];

    public int ListCalls => Calls.Count(c => c.Contains("-encoders"));
    public IEnumerable<IReadOnlyList<string>> EncodeCalls => Calls.Where(c => c.Contains("rawvideo"));

    public IFfmpegProcess Start(IReadOnlyList<string> arguments)
    {
        Calls.Add(arguments);
        if (StartError != null) throw StartError;
        FakeFfmpegProcess process;
        if (arguments.Contains("-encoders"))
            process = new FakeFfmpegProcess { Output = ListOutput, Error = ListBanner };
        else
        {
            var encoder = arguments[arguments.ToList().IndexOf("-c:v") + 1];
            if (arguments.Contains("lavfi"))
                process = BrokenProbes.Contains(encoder)
                    ? new FakeFfmpegProcess { ExitCode = 1, Error = $"Error while opening encoder {encoder}\n" }
                    : new FakeFfmpegProcess();
            else
            {
                process = Encodes.TryGetValue(encoder, out var make) ? make() : new FakeFfmpegProcess();
                process.OutputPath = arguments[^1];
            }
        }
        Processes.Add(process);
        return process;
    }
}

public sealed class FakeFfmpegProcess : IFfmpegProcess
{
    private readonly RecordingStream _input = new();

    public int ExitCode { get; init; }
    public string Output { get; init; } = "";
    public string Error { get; init; } = "";
    /// <summary>Ne finit jamais d'elle-même (délai dépassé, annulation).</summary>
    public bool Hang { get; init; }
    /// <summary>Entrée fermée par ffmpeg : l'écriture échoue (tube cassé).</summary>
    public bool BrokenInput { get; init; }
    /// <summary>Le fichier de sortie est écrit à la fin (succès).</summary>
    public bool WritesOutput { get; init; } = true;

    public string? OutputPath { get; set; }
    public bool Killed { get; private set; }
    public long BytesWritten => _input.Written;

    public Stream Input
    {
        get
        {
            _input.Broken = BrokenInput;
            return _input;
        }
    }

    public async Task<FfmpegExit> WaitForExitAsync(CancellationToken ct)
    {
        if (Hang) await Task.Delay(Timeout.Infinite, ct);
        if (ExitCode == 0 && WritesOutput && OutputPath != null) File.WriteAllBytes(OutputPath, [0, 0, 0, 24]);
        return new FfmpegExit(ExitCode, Output, Error);
    }

    public void Kill() => Killed = true;

    public void Dispose() { }

    private sealed class RecordingStream : Stream
    {
        public long Written;
        public bool Broken;

        public override void Write(byte[] buffer, int offset, int count)
        {
            if (Broken) throw new IOException("Le canal de communication est sur le point d'être fermé.");
            Written += count;
        }

        public override bool CanRead => false;
        public override bool CanSeek => false;
        public override bool CanWrite => true;
        public override long Length => Written;
        public override long Position { get => Written; set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
    }
}
