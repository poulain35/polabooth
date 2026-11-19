using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text.RegularExpressions;
using SkiaSharp;

namespace PolaKiosk.Services;

/// <summary>
/// Encodage des animations par ffmpeg.exe (LAB-234, spec LAB-207 § 5). Les images habillées sont mises
/// à la taille du clip (côtés pairs), envoyées en BGRA brut sur l'entrée standard, et ffmpeg écrit un
/// MP4 H.264 yuv420p « faststart » à 25 i/s. Encodeurs essayés dans l'ordre : h264_mf (Windows Media
/// Foundation), puis libopenh264. Aucune exception ne sort : l'appelant reçoit un <see cref="AnimationResult"/>.
/// </summary>
public sealed partial class AnimationService : IAnimationService
{
    internal const string LogContext = "animation_encode";
    internal const string VideoFileName = "clip.mp4";
    internal const string PosterFileName = "poster.jpg";
    internal const int OutputFps = 25;
    internal const string VideoBitrate = "4M";
    internal const int PosterJpegQuality = 85;
    internal static readonly IReadOnlyList<string> PreferredEncoders = ["h264_mf", "libopenh264"];

    private static readonly SKSamplingOptions HighQuality = new(SKCubicResampler.CatmullRom);
    private static readonly TimeSpan DefaultProbeTimeout = TimeSpan.FromSeconds(15);

    private readonly IFfmpegRunner _runner;
    private readonly IKioskLogService _log;
    private readonly TimeSpan _probeTimeout;
    private readonly SemaphoreSlim _probeLock = new(1, 1);
    private AnimationEncoderStatus? _status;

    public AnimationService(IFfmpegRunner runner, IKioskLogService log)
        : this(runner, log, DefaultProbeTimeout) { }

    internal AnimationService(IFfmpegRunner runner, IKioskLogService log, TimeSpan probeTimeout)
    {
        _runner = runner;
        _log = log;
        _probeTimeout = probeTimeout;
    }

    public async Task<AnimationEncoderStatus> GetEncoderStatusAsync(bool refresh = false, CancellationToken ct = default)
    {
        if (!refresh && _status is { } cached) return cached;
        try
        {
            await _probeLock.WaitAsync(ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return new AnimationEncoderStatus(AnimationEncoderState.ProbeFailed, [], null, "contrôle annulé");
        }
        try
        {
            if (!refresh && _status is { } again) return again;
            AnimationEncoderStatus status;
            try
            {
                status = await ProbeAsync(ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                return new AnimationEncoderStatus(AnimationEncoderState.ProbeFailed, [], null, "contrôle annulé");
            }
            catch (Exception ex)
            {
                status = new AnimationEncoderStatus(AnimationEncoderState.ProbeFailed, [], null, ex.Message);
            }
            _status = status;
            await LogStatusAsync(status).ConfigureAwait(false);
            return status;
        }
        finally
        {
            _probeLock.Release();
        }
    }

    public async Task<AnimationResult> EncodeAsync(AnimationRequest request, CancellationToken ct = default)
    {
        var watch = Stopwatch.StartNew();
        var videoPath = Path.Combine(request.OutputDirectory, VideoFileName);
        var posterPath = Path.Combine(request.OutputDirectory, PosterFileName);
        try
        {
            if (request.Frames is not { Count: > 0 } frames)
                return await FailAsync(AnimationFailure.Failed, "aucune image à encoder", watch).ConfigureAwait(false);
            if (request.FrameDuration <= TimeSpan.Zero || request.Timeout <= TimeSpan.Zero || request.MaxLongSide < 2)
                return await FailAsync(AnimationFailure.Failed, "réglages d'animation invalides", watch).ConfigureAwait(false);

            var status = await GetEncoderStatusAsync(false, ct).ConfigureAwait(false);
            ct.ThrowIfCancellationRequested();
            if (!status.IsReady)
            {
                var detail = status.Detail is { Length: > 0 } d ? $"{status.Label} ({d})" : status.Label;
                return await FailAsync(AnimationFailure.EncoderMissing, detail, watch).ConfigureAwait(false);
            }

            var (width, height) = ClipSize(frames[0].Width, frames[0].Height, request.MaxLongSide);
            var frameMs = (int)Math.Round(request.FrameDuration.TotalMilliseconds);
            var repeats = Repeats(frames.Count, request.FrameDuration, request.TargetDuration);
            var durationMs = frames.Count * repeats * frameMs;

            Directory.CreateDirectory(request.OutputDirectory);
            var posterIndex = request.PosterFrameIndex >= 0 && request.PosterFrameIndex < frames.Count ? request.PosterFrameIndex : 0;
            var raw = new List<byte[]>(frames.Count);
            foreach (var frame in frames)
            {
                using var fitted = Fit(frame, width, height);
                if (raw.Count == posterIndex) WritePoster(fitted, posterPath);
                raw.Add(fitted.Bytes);
            }

            var errors = new List<string>();
            foreach (var encoder in status.Encoders)
            {
                var attempt = await EncodeWithAsync(encoder, raw, repeats, width, height, frameMs, videoPath,
                    request.Timeout, ct).ConfigureAwait(false);
                if (attempt.Failure == AnimationFailure.None)
                {
                    watch.Stop();
                    var size = new FileInfo(videoPath).Length;
                    if (errors.Count > 0)
                        await SafeLogAsync(() => _log.LogWarningAsync(LogContext,
                            $"Encodage repris avec {encoder} : {string.Join(" | ", errors)}")).ConfigureAwait(false);
                    await SafeLogAsync(() => _log.LogInfoAsync(LogContext, string.Format(CultureInfo.InvariantCulture,
                        "Animation encodée en {0} ms ({1}, {2}×{3}, {4} images × {5}, {6} ms, {7:0.00} Mo)",
                        watch.ElapsedMilliseconds, encoder, width, height, frames.Count, repeats, durationMs,
                        size / 1024d / 1024d))).ConfigureAwait(false);
                    return new AnimationResult(AnimationFailure.None, videoPath, posterPath, durationMs, width, height,
                        encoder, watch.Elapsed);
                }
                if (attempt.Failure is AnimationFailure.Timeout or AnimationFailure.Canceled)
                {
                    Cleanup(videoPath, posterPath);
                    return await FailAsync(attempt.Failure, $"{encoder} : {attempt.Error}", watch).ConfigureAwait(false);
                }
                errors.Add($"{encoder} : {attempt.Error}");
            }
            Cleanup(videoPath, posterPath);
            return await FailAsync(AnimationFailure.Failed, string.Join(" | ", errors), watch).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            Cleanup(videoPath, posterPath);
            return await FailAsync(AnimationFailure.Canceled, "encodage annulé", watch).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            Cleanup(videoPath, posterPath);
            return await FailAsync(AnimationFailure.Failed, ex.Message, watch, ex.ToString()).ConfigureAwait(false);
        }
    }

    // ── Encodage ──────────────────────────────────────────────────────────────────────────────

    private sealed record Attempt(AnimationFailure Failure, string? Error = null);

    private async Task<Attempt> EncodeWithAsync(string encoder, IReadOnlyList<byte[]> frames, int repeats,
        int width, int height, int frameMs, string videoPath, TimeSpan timeout, CancellationToken ct)
    {
        var part = videoPath + ".part";
        TryDelete(part);
        using var timeoutCts = new CancellationTokenSource(timeout);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, timeoutCts.Token);
        using var process = _runner.Start(EncodeArguments(encoder, width, height, frameMs, part));
        // Écriture à part : si ffmpeg ne lit plus, l'arrêt du processus la débloque (tube cassé).
        var writing = Task.Run(() => WriteFrames(process.Input, frames, repeats, linked.Token), CancellationToken.None);
        try
        {
            try
            {
                await writing.WaitAsync(linked.Token).ConfigureAwait(false);
            }
            catch (IOException)
            {
                // ffmpeg a fermé son entrée : son code retour et son erreur disent pourquoi.
            }
            var exit = await process.WaitForExitAsync(linked.Token).ConfigureAwait(false);
            if (exit.ExitCode != 0)
            {
                TryDelete(part);
                return new Attempt(AnimationFailure.Failed, $"code {exit.ExitCode} : {LastLines(exit.Error)}");
            }
            if (!File.Exists(part) || new FileInfo(part).Length == 0)
                return new Attempt(AnimationFailure.Failed, "aucune vidéo produite");
            File.Move(part, videoPath, overwrite: true);
            return new Attempt(AnimationFailure.None);
        }
        catch (OperationCanceledException)
        {
            process.Kill();
            await Task.WhenAny(writing, Task.Delay(TimeSpan.FromSeconds(2), CancellationToken.None)).ConfigureAwait(false);
            TryDelete(part);
            return ct.IsCancellationRequested
                ? new Attempt(AnimationFailure.Canceled, "encodage annulé")
                : new Attempt(AnimationFailure.Timeout, $"délai de {timeout.TotalSeconds:0} s dépassé");
        }
        finally
        {
            _ = writing.ContinueWith(t => _ = t.Exception, TaskScheduler.Default);
        }
    }

    private static void WriteFrames(Stream input, IReadOnlyList<byte[]> frames, int repeats, CancellationToken ct)
    {
        try
        {
            for (var r = 0; r < repeats; r++)
                foreach (var frame in frames)
                {
                    ct.ThrowIfCancellationRequested();
                    input.Write(frame, 0, frame.Length);
                }
            input.Flush();
        }
        finally
        {
            try { input.Dispose(); } catch (IOException) { }
        }
    }

    internal static IReadOnlyList<string> EncodeArguments(string encoder, int width, int height, int frameMs, string output) =>
    [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", "bgra",
        "-video_size", $"{width}x{height}",
        "-framerate", $"1000/{frameMs}",
        "-i", "pipe:0",
        "-an",
        "-vf", $"fps={OutputFps}",
        "-c:v", encoder,
        "-b:v", VideoBitrate,
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-f", "mp4", output,
    ];

    /// <summary>Taille du clip : grand côté ≤ <paramref name="maxLongSide"/>, jamais agrandi, côtés pairs (H.264 4:2:0).</summary>
    internal static (int Width, int Height) ClipSize(int width, int height, int maxLongSide)
    {
        var scale = Math.Min(1d, maxLongSide / (double)Math.Max(width, height));
        static int Even(double v) => Math.Max(2, (int)Math.Round(v) & ~1);
        return (Even(width * scale), Even(height * scale));
    }

    /// <summary>Nombre de passages des images dans le fichier pour approcher la durée visée (au moins 1).</summary>
    internal static int Repeats(int frameCount, TimeSpan frameDuration, TimeSpan targetDuration)
    {
        var loop = frameCount * frameDuration.TotalMilliseconds;
        return Math.Max(1, (int)Math.Round(targetDuration.TotalMilliseconds / loop));
    }

    /// <summary>Image à la taille du clip, centrée sans déformation sur fond blanc, en BGRA.</summary>
    private static SKBitmap Fit(SKBitmap source, int width, int height)
    {
        var bitmap = new SKBitmap(new SKImageInfo(width, height, SKColorType.Bgra8888, SKAlphaType.Premul));
        using var canvas = new SKCanvas(bitmap);
        canvas.Clear(SKColors.White);
        using var image = SKImage.FromBitmap(source);
        var scale = Math.Min(width / (float)source.Width, height / (float)source.Height);
        float w = source.Width * scale, h = source.Height * scale;
        var dest = SKRect.Create((width - w) / 2f, (height - h) / 2f, w, h);
        canvas.DrawImage(image, dest, HighQuality);
        canvas.Flush();
        return bitmap;
    }

    private static void WritePoster(SKBitmap frame, string posterPath)
    {
        using var data = KioskJpeg.Encode(frame, PosterJpegQuality)
            ?? throw new InvalidOperationException("affiche JPEG impossible à encoder");
        AtomicFile.Write(posterPath, data.SaveTo);
    }

    // ── Contrôle de ffmpeg ────────────────────────────────────────────────────────────────────

    private async Task<AnimationEncoderStatus> ProbeAsync(CancellationToken ct)
    {
        if (!_runner.IsAvailable)
            return new AnimationEncoderStatus(AnimationEncoderState.FfmpegMissing, [], null, _runner.ExecutablePath);

        // Sans -hide_banner : la bannière (version, configuration) arrive sur l'erreur standard.
        var list = await RunProbeAsync(["-encoders"], ct).ConfigureAwait(false);
        if (list is null)
            return new AnimationEncoderStatus(AnimationEncoderState.ProbeFailed, [], null, "ffmpeg -encoders ne répond pas");
        var version = ParseVersion(list.Error);
        if (list.ExitCode != 0)
            return new AnimationEncoderStatus(AnimationEncoderState.ProbeFailed, [], version,
                $"ffmpeg -encoders : code {list.ExitCode}");
        if (IsRefusedLicense(list.Error))
            return new AnimationEncoderStatus(AnimationEncoderState.LicenseRefused, [], version,
                "construit avec --enable-gpl ou --enable-nonfree");

        var available = ParseEncoders(list.Output);
        var working = new List<string>();
        var failures = new List<string>();
        foreach (var encoder in PreferredEncoders)
        {
            if (!available.Contains(encoder)) continue;
            var test = await RunProbeAsync(ProbeArguments(encoder), ct).ConfigureAwait(false);
            if (test is { ExitCode: 0 }) working.Add(encoder);
            else failures.Add(test is null ? $"{encoder} : délai dépassé" : $"{encoder} : {LastLines(test.Error)}");
        }
        if (working.Count > 0)
            return new AnimationEncoderStatus(AnimationEncoderState.Ready, working, version,
                failures.Count > 0 ? string.Join(" | ", failures) : null);
        return new AnimationEncoderStatus(AnimationEncoderState.NoEncoder, [], version,
            failures.Count > 0 ? string.Join(" | ", failures) : "ni h264_mf ni libopenh264 dans ffmpeg");
    }

    /// <summary>Essai réel d'un encodeur : h264_mf peut être listé sans encodeur Windows (éditions « N »).</summary>
    internal static IReadOnlyList<string> ProbeArguments(string encoder) =>
    [
        "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "color=c=black:s=128x128:r=25:d=0.2",
        "-c:v", encoder, "-pix_fmt", "yuv420p",
        "-f", "null", "-",
    ];

    /// <summary>Commande de contrôle, entrée fermée tout de suite. Null si le délai est dépassé.</summary>
    private async Task<FfmpegExit?> RunProbeAsync(IReadOnlyList<string> arguments, CancellationToken ct)
    {
        using var timeoutCts = new CancellationTokenSource(_probeTimeout);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, timeoutCts.Token);
        using var process = _runner.Start(arguments);
        try { process.Input.Dispose(); } catch (IOException) { }
        try
        {
            return await process.WaitForExitAsync(linked.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            process.Kill();
            return null;
        }
    }

    internal static HashSet<string> ParseEncoders(string output)
    {
        var names = new HashSet<string>(StringComparer.Ordinal);
        var started = false;
        foreach (var line in output.Split('\n'))
        {
            if (!started)
            {
                started = line.Trim().StartsWith("---", StringComparison.Ordinal);
                continue;
            }
            var m = EncoderLine().Match(line);
            if (m.Success) names.Add(m.Groups[1].Value);
        }
        return names;
    }

    internal static string? ParseVersion(string banner)
    {
        var m = VersionLine().Match(banner);
        return m.Success ? m.Groups[1].Value : null;
    }

    internal static bool IsRefusedLicense(string banner)
        => banner.Contains("--enable-gpl", StringComparison.Ordinal)
        || banner.Contains("--enable-nonfree", StringComparison.Ordinal);

    [GeneratedRegex(@"^\s*V[A-Z.]{5}\s+([A-Za-z0-9_]+)\s")]
    private static partial Regex EncoderLine();

    [GeneratedRegex(@"ffmpeg version (\S+)")]
    private static partial Regex VersionLine();

    // ── Divers ────────────────────────────────────────────────────────────────────────────────

    private async Task<AnimationResult> FailAsync(AnimationFailure failure, string error, Stopwatch watch,
        string? stackTrace = null)
    {
        watch.Stop();
        var message = $"Animation non encodée ({failure}) : {error}";
        await SafeLogAsync(() => failure == AnimationFailure.EncoderMissing
            ? _log.LogWarningOncePerDayAsync(LogContext, message)
            : failure == AnimationFailure.Canceled
                ? _log.LogInfoAsync(LogContext, message)
                : _log.LogErrorAsync(LogContext, message, stackTrace)).ConfigureAwait(false);
        return new AnimationResult(failure, Elapsed: watch.Elapsed, Error: error);
    }

    private Task LogStatusAsync(AnimationEncoderStatus status)
    {
        var text = $"{status.Label} — ffmpeg {status.FfmpegVersion ?? "?"}"
            + (status.Detail is { Length: > 0 } d ? $" ({d})" : "");
        return SafeLogAsync(() => status.IsReady
            ? _log.LogInfoAsync(LogContext, text)
            : _log.LogWarningOncePerDayAsync(LogContext, text));
    }

    private static async Task SafeLogAsync(Func<Task> log)
    {
        try { await log().ConfigureAwait(false); }
        catch { /* le journal ne doit jamais faire échouer l'encodage */ }
    }

    private static string LastLines(string error)
    {
        var lines = error.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return lines.Length == 0 ? "(sans message)" : string.Join(" / ", lines[^Math.Min(3, lines.Length)..]);
    }

    private static void Cleanup(string videoPath, string posterPath)
    {
        TryDelete(videoPath + ".part");
        TryDelete(videoPath);
        TryDelete(posterPath);
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }
}
