using SkiaSharp;

namespace PolaKiosk.Services;

public enum AnimationEncoderState
{
    Ready,
    FfmpegMissing,
    NoEncoder,
    LicenseRefused,
    ProbeFailed,
}

/// <summary>
/// État de l'encodage des animations, contrôlé une fois puis gardé (<see cref="IAnimationService.GetEncoderStatusAsync"/>).
/// <see cref="Encoders"/> : encodeurs H.264 qui ont réussi un essai, dans l'ordre de préférence.
/// </summary>
public sealed record AnimationEncoderStatus(
    AnimationEncoderState State,
    IReadOnlyList<string> Encoders,
    string? FfmpegVersion,
    string? Detail = null)
{
    public bool IsReady => State == AnimationEncoderState.Ready && Encoders.Count > 0;

    public string? Encoder => Encoders.Count > 0 ? Encoders[0] : null;

    /// <summary>Ligne affichée dans l'admin de la borne.</summary>
    public string Label => State switch
    {
        AnimationEncoderState.Ready => $"Animations : prêtes ({Encoder})",
        AnimationEncoderState.FfmpegMissing => "Animations : ffmpeg absent",
        AnimationEncoderState.NoEncoder => "Animations : encodeur H.264 absent",
        AnimationEncoderState.LicenseRefused => "Animations : ffmpeg refusé (licence GPL ou nonfree)",
        _ => "Animations : contrôle de ffmpeg impossible",
    };
}

public enum AnimationFailure
{
    None,
    /// <summary>ffmpeg ou un encodeur H.264 manque : inutile de réessayer avant le redémarrage.</summary>
    EncoderMissing,
    Failed,
    Timeout,
    Canceled,
}

/// <summary>
/// Animation à encoder : images déjà habillées (montages SkiaSharp, gardées et libérées par l'appelant),
/// jouées chacune <see cref="FrameDuration"/> et répétées dans le fichier jusqu'à ~<see cref="TargetDuration"/>.
/// Écrit <c>clip.mp4</c> et <c>poster.jpg</c> (image <see cref="PosterFrameIndex"/>, la première par
/// défaut) dans <see cref="OutputDirectory"/>.
/// </summary>
public sealed record AnimationRequest(IReadOnlyList<SKBitmap> Frames, string OutputDirectory)
{
    public TimeSpan FrameDuration { get; init; } = TimeSpan.FromMilliseconds(500);
    public TimeSpan TargetDuration { get; init; } = TimeSpan.FromSeconds(6);
    /// <summary>Grand côté du clip au plus (720×1080 pour un portrait), jamais agrandi.</summary>
    public int MaxLongSide { get; init; } = 1080;
    public TimeSpan Timeout { get; init; } = TimeSpan.FromSeconds(30);
    /// <summary>Image de l'affiche (LAB-237 : celle du milieu) ; hors bornes : la première.</summary>
    public int PosterFrameIndex { get; init; }
}

/// <summary>
/// Résultat d'un encodage, jamais d'exception : en échec, l'appelant garde son montage photo
/// (<see cref="Failure"/> dit pourquoi, <see cref="Error"/> donne le détail journalisé).
/// </summary>
public sealed record AnimationResult(
    AnimationFailure Failure,
    string? VideoPath = null,
    string? PosterPath = null,
    int DurationMs = 0,
    int Width = 0,
    int Height = 0,
    string? Encoder = null,
    TimeSpan Elapsed = default,
    string? Error = null)
{
    public bool Success => Failure == AnimationFailure.None;
}

/// <summary>
/// Encodage des animations (LAB-234) : images envoyées à ffmpeg.exe (LGPL) en rawvideo sur l'entrée
/// standard, MP4 H.264 (h264_mf, sinon libopenh264) bouclable, plus une affiche JPEG.
/// </summary>
public interface IAnimationService
{
    /// <summary>Contrôle ffmpeg et ses encodeurs (essai réel), une fois ; <paramref name="refresh"/> refait le contrôle.</summary>
    Task<AnimationEncoderStatus> GetEncoderStatusAsync(bool refresh = false, CancellationToken ct = default);

    Task<AnimationResult> EncodeAsync(AnimationRequest request, CancellationToken ct = default);
}
