using System.Collections.ObjectModel;
using System.IO;
using System.Linq;
using System.Windows.Media.Imaging;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Newtonsoft.Json.Linq;
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

    public GalleryPhoto(string path, Func<string, BitmapSource?> load)
    {
        Path  = path;
        _load = load;
    }

    public async Task AddViewerAsync()
    {
        if (_viewers++ > 0) return;

        // Une carte sortie puis revenue pendant le décodage ne doit pas recevoir l'ancien résultat.
        var generation = ++_generation;
        BitmapSource? thumb;
        try { thumb = await Task.Run(() => _load(Path)); }
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
        ISyncService sync, AppSettings settings, SessionPathService sessionPaths, ISessionService sessions)
    {
        _navigation   = navigation;
        _kioskState   = kioskState;
        _sync         = sync;
        _settings     = settings;
        _sessionPaths = sessionPaths;
        _sessions     = sessions;
    }

    public async Task InitializeAsync()
    {
        var eventId = _eventId = _kioskState.ActiveEventId ?? Guid.Empty;

        var ev = await _sync.GetCurrentEventAsync(eventId);
        _eventName = ev?.Name ?? "Événement";
        if (ev != null)
        {
            try { _kioskCfg = JObject.Parse(ev.FormConfigJson)["kiosk"]?.ToObject<KioskConfig>(); }
            catch { }
        }

        // Liste des fichiers seulement : les vignettes se chargent à l'affichage de chaque carte.
        var eventName = _eventName;
        var files = await Task.Run(() => _sessionPaths.GetCompositeFiles(eventName, eventId));

        _photos = files.Select(file => new GalleryPhoto(file, LoadThumb)).ToList();
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

        // Format papier depuis le template actif (défaut 4x6)
        string paperFormat = "4x6";
        try
        {
            var tpl = (await _sync.GetTemplatesAsync(_eventId)).FirstOrDefault();
            if (tpl != null) paperFormat = PrintService.PaperFormatFromTemplateFormat(tpl.Format);
        }
        catch { }

        // Même séance qu'au premier affichage : le plafond par photo ne se contourne pas en rouvrant.
        Guid sessionId;
        try { sessionId = await _sessions.ResolveSessionIdAsync(photo.Path); }
        catch { sessionId = SessionService.LegacySessionId(photo.Path); }

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
            FromGallery:       true
        ));
    }
}
