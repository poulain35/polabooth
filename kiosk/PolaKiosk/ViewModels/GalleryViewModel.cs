using System.Collections.ObjectModel;
using System.IO;
using System.Linq;
using System.Windows.Media.Imaging;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PolaKiosk.Models.Supabase;
using PolaKiosk.Services;

namespace PolaKiosk.ViewModels;

/// <summary>
/// Une vignette de la galerie accueil (montage de l'événement). L'image n'est chargée que tant
/// qu'une carte l'affiche : la liste virtualisée garde en mémoire les seules vignettes visibles.
/// Appels sur le fil d'affichage.
/// </summary>
public partial class GalleryPhoto : ObservableObject
{
    private readonly Func<string, BitmapSource?> _load;
    private int _viewers;
    private int _generation;

    public string Path { get; }
    [ObservableProperty] private BitmapSource? _thumb;

    /// <summary>
    /// Hauteur de la carte sans image : celle de la dernière vignette chargée, pour que la grille ne
    /// saute pas au défilement. Au départ, un montage 4x6 portrait (2:3).
    /// </summary>
    [ObservableProperty] private double _imageHeight = GalleryViewModel.DisplayWidth * 1.5;

    /// <summary>Animation de la séance (GIF, LAB-237) : vignette = son affiche, badge lecture.</summary>
    public AnimationClip? Animation { get; }

    public bool HasAnimation => Animation != null;

    public GalleryPhoto(string path, Func<string, BitmapSource?> load, AnimationClip? animation = null)
    {
        Path  = path;
        _load = load;
        Animation = animation;
    }

    public async Task AddViewerAsync()
    {
        if (_viewers++ > 0) return;

        // Une carte sortie puis revenue pendant le décodage ne doit pas recevoir l'ancien résultat.
        var generation = ++_generation;
        BitmapSource? thumb;
        var source = Animation?.PosterPath ?? Path;
        try { thumb = await Task.Run(() => _load(source)); }
        catch { thumb = null; }
        if (generation != _generation) return;
        Thumb = thumb;
        if (thumb is { PixelWidth: > 0 })
            ImageHeight = GalleryViewModel.DisplayWidth * (double)thumb.PixelHeight / thumb.PixelWidth;
    }

    public void RemoveViewer()
    {
        if (_viewers == 0 || --_viewers > 0) return;
        _generation++;
        Thumb = null;
    }
}

/// <summary>Une ligne de la grille : la virtualisation WPF opère ligne par ligne.</summary>
public record GalleryRow(IReadOnlyList<GalleryPhoto> Photos);

/// <summary>
/// Galerie des photos prises pendant l'événement (composites sur disque).
/// Un clic sur une photo rouvre l'écran de partage (re-QR, impression…).
/// </summary>
public partial class GalleryViewModel : ObservableObject, IReleasable
{
    private readonly INavigationService _navigation;
    private readonly IKioskStateService _kioskState;
    private readonly ISyncService _sync;
    private readonly AppSettings _settings;
    private readonly SessionPathService _sessionPaths;
    private readonly ISessionService _sessions;
    private readonly IKioskLogService? _kioskLog;

    public const int DisplayWidth = 240;
    private const int DefaultColumns = 6;

    [ObservableProperty] private ObservableCollection<GalleryRow> _rows = new();
    [ObservableProperty] private bool _isEmpty;

    private IReadOnlyList<GalleryPhoto> _photos = [];
    private int _columns = DefaultColumns;

    private Guid _eventId;
    private string _eventName = "Événement";
    private KioskConfig? _kioskCfg;

    public GalleryViewModel(INavigationService navigation, IKioskStateService kioskState,
        ISyncService sync, AppSettings settings, SessionPathService sessionPaths, ISessionService sessions,
        IKioskLogService? kioskLog = null)
    {
        _navigation   = navigation;
        _kioskState   = kioskState;
        _sync         = sync;
        _settings     = settings;
        _sessionPaths = sessionPaths;
        _sessions     = sessions;
        _kioskLog     = kioskLog;
    }

    public async Task InitializeAsync()
    {
        var eventId = _eventId = _kioskState.ActiveEventId ?? Guid.Empty;

        var ev = await _sync.GetCurrentEventAsync(eventId);
        _eventName = ev?.Name ?? "Événement";
        _kioskCfg = KioskConfig.FromFormConfig(ev?.FormConfigJson);

        // Liste des fichiers seulement : les vignettes se chargent à l'affichage de chaque carte.
        var eventName = _eventName;
        // Animation de chaque montage (GIF) retrouvée par son .share.json, hors du fil d'affichage.
        var files = await Task.Run(() => _sessionPaths.GetCompositeFiles(eventName, eventId)
            .Select(file => (File: file, Animation: SessionAnimation.FindForComposite(file))).ToList());

        _photos = files.Select(f => f.Animation == null
                ? new GalleryPhoto(f.File, LoadThumb)
                : new GalleryPhoto(f.File, LoadPoster, f.Animation)).ToList();
        Rows    = new ObservableCollection<GalleryRow>(ToRows(_photos, _columns));
        IsEmpty = _photos.Count == 0;
    }

    /// <summary>Nombre de vignettes par ligne, selon la largeur de l'écran.</summary>
    public void SetColumns(int columns)
    {
        columns = Math.Max(1, columns);
        if (columns == _columns) return;
        _columns = columns;
        Rows = new ObservableCollection<GalleryRow>(ToRows(_photos, _columns));
    }

    internal static IReadOnlyList<GalleryRow> ToRows(IReadOnlyList<GalleryPhoto> photos, int columns)
        => photos.Chunk(Math.Max(1, columns)).Select(chunk => new GalleryRow(chunk)).ToList();

    /// <summary>Vignette de <c>composites\thumbs\</c> (créée si elle manque), sinon le montage lui-même.</summary>
    internal static BitmapImage? LoadThumb(string compositePath)
        => ImageLoader.LoadThumbnail(CompositeThumbnail.Ensure(compositePath) ?? compositePath, DisplayWidth);

    /// <summary>Affiche d'une animation (JPEG de 1080 px au plus), décodée à la taille de la vignette.</summary>
    internal static BitmapImage? LoadPoster(string posterPath)
        => ImageLoader.LoadThumbnail(posterPath, DisplayWidth);

    public void Release()
    {
        _photos = [];
        Rows    = new ObservableCollection<GalleryRow>();
    }

    [RelayCommand]
    private void Back() => _navigation.NavigateTo<Views.HomeView>();

    [RelayCommand]
    private async Task OpenPhotoAsync(GalleryPhoto? photo)
    {
        if (photo == null) return;

        var resultCfg  = _kioskCfg?.Result;
        var emailCfg   = _kioskCfg?.Email;
        var accessCode = _kioskState.LastAccessCode ?? "";

        // Même séance qu'au premier affichage : le plafond par photo ne se contourne pas en rouvrant.
        Guid sessionId;
        try { sessionId = await _sessions.ResolveSessionIdAsync(photo.Path); }
        catch (Exception ex)
        {
            sessionId = Guid.NewGuid();
            _ = _kioskLog?.LogWarningAsync("gallery", $"Séance de la photo introuvable ({ex.Message}) : nouvelle séance.");
        }

        // Papier du cadre de la photo (LAB-315) ; cadre inconnu : premier cadre de l'événement (défaut 4x6).
        string paperFormat = "4x6";
        try
        {
            var templateId = await _sessions.GetSessionTemplateIdAsync(sessionId);
            var tpl = FrameChoice.Pick(await _sync.GetTemplatesAsync(_eventId), templateId);
            if (tpl != null) paperFormat = PrintService.PaperFormatFromTemplateFormat(tpl.Format);
        }
        catch (Exception ex)
        {
            _ = _kioskLog?.LogWarningAsync("gallery", $"Cadre de la photo illisible ({ex.Message}) : papier 4x6.");
        }

        _navigation.NavigateTo<Views.ResultView>(new ResultParameters(
            SessionId:         sessionId,
            EventId:           _eventId,
            EventName:         _eventName,
            CompositePath:     photo.Path,
            AccessCode:        accessCode,
            MaxPrintsPerEvent: resultCfg?.MaxPrintsPerEvent,
            MaxPrintsPerPhoto: resultCfg?.MaxPrintsPerPhoto,
            PrinterName:       _settings.Kiosk.PrinterName,
            PaperFormat:       paperFormat,
            EmailConfig:       emailCfg,
            ResultCfg:         resultCfg,
            FromGallery:       true,
            VideoPath:         (photo.Animation ?? SessionAnimation.Find(photo.Path, sessionId))?.VideoPath
        ));
    }
}
