using System.IO;
using System.Windows;
using System.Windows.Media.Imaging;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PolaKiosk.Models;
using PolaKiosk.Services;

namespace PolaKiosk.ViewModels;

// Admin › Appareil photo (LAB-427, spec docs/specs/reglages-appareil-photo.md) : vitesse, ouverture,
// ISO, balance des blancs du Canon, réglées sur la borne sans réseau. Chaque changement est envoyé
// tout de suite puis relu ; gardé dans machine-settings.json (par borne).
public partial class AdminViewModel
{
    public const string ExposureUnsupportedMessage = "Réglages disponibles avec un appareil Canon.";

    // Relecture après un événement de l'appareil : la molette ou le zoom en envoient plusieurs d'affilée.
    internal static TimeSpan ExposureRefreshDelay { get; set; } = TimeSpan.FromMilliseconds(300);

    private readonly Dictionary<string, int> _pendingExposure = new();
    private bool _applyingExposure;
    private bool _refreshAfterApply;
    private CancellationTokenSource? _exposureRefreshCts;
    private bool _exposureSubscribed;

    [ObservableProperty] private bool   _isExposureOpen;
    [ObservableProperty] private bool   _isExposureSupported;
    [ObservableProperty] private bool   _isExposureBusy;
    [ObservableProperty] private bool   _needsManualMode;
    [ObservableProperty] private string _exposureMode = "";
    [ObservableProperty] private string _exposureModel = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasExposureMsg))]
    private string _exposureMsg = "";

    public bool HasExposureMsg => ExposureMsg.Length > 0;

    // Photo de test affichée en grand ; jamais gardée ni envoyée (fichier temporaire supprimé).
    [ObservableProperty] private BitmapSource? _exposureTestPhoto;
    [ObservableProperty] private bool _hasExposureTestPhoto;

    private IReadOnlyList<ExposureSettingViewModel>? _exposureSettings;

    /// <summary>Lignes de l'écran, dans l'ordre affiché.</summary>
    public IReadOnlyList<ExposureSettingViewModel> ExposureSettings => _exposureSettings ??=
    [
        new(CameraExposureKeys.Tv, "Vitesse", RequestExposureChange),
        new(CameraExposureKeys.Av, "Ouverture", RequestExposureChange),
        new(CameraExposureKeys.Iso, "ISO", RequestExposureChange),
        new(CameraExposureKeys.Wb, "Balance des blancs", RequestExposureChange),
        new(CameraExposureKeys.Kelvin, "Température de couleur", RequestExposureChange),
    ];

    public ExposureSettingViewModel ExposureSetting(string key) => ExposureSettings.First(s => s.Key == key);

    /// <summary>« Appareil photo » : ouvre l'écran, lit les réglages et lance l'aperçu.</summary>
    [RelayCommand]
    private async Task OpenExposureAsync()
    {
        if (IsExposureOpen) return;
        IsExposureOpen       = true;
        HasExposureTestPhoto = false;
        ExposureTestPhoto    = null;

        if (_camera is not { SupportsExposureSettings: true })
        {
            IsExposureSupported = false;
            NeedsManualMode     = false;
            ExposureMsg         = ExposureUnsupportedMessage;
            return;
        }

        IsExposureSupported = true;
        IsExposureBusy      = true;
        ExposureMsg         = "Ouverture de l'appareil…";
        try
        {
            await StopPreviewAsync(); // aperçu de « Tester la caméra » éventuel
            await _camera.InitializeAsync();
            if (!_exposureSubscribed)
            {
                _camera.ExposureOptionsChanged += OnExposureOptionsChanged;
                _exposureSubscribed = true;
            }

            var state = await _camera.ReadExposureAsync();
            if (state == null)
            {
                ExposureMsg = "Appareil photo non connecté.";
                return;
            }
            ShowExposureState(state);
            ExposureMsg = "";
            await StartExposurePreviewAsync();
        }
        catch (Exception ex)
        {
            ExposureMsg = $"Appareil photo introuvable : {ex.Message}";
        }
        finally { IsExposureBusy = false; }
    }

    [RelayCommand]
    private async Task CloseExposureAsync()
    {
        UnsubscribeExposure();
        await StopPreviewAsync();
        IsExposureOpen       = false;
        HasExposureTestPhoto = false;
        ExposureTestPhoto    = null;
        ExposureMsg          = "";
    }

    /// <summary>Photo au flash avec les réglages actuels, affichée en grand puis fichier supprimé.</summary>
    [RelayCommand]
    private async Task TakeExposureTestPhotoAsync()
    {
        if (_camera == null || !IsExposureSupported || IsExposureBusy) return;
        IsExposureBusy = true;
        ExposureMsg    = "Photo de test en cours…";
        var dir = Path.Combine(Path.GetTempPath(), "PolaKiosk", "camera-test");
        try
        {
            await StopPreviewAsync();
            Directory.CreateDirectory(dir);
            var path = await _camera.CaptureAsync(dir);
            try
            {
                ExposureTestPhoto = ImageLoader.LoadForScreen(path, fill: false); // chargée en mémoire (OnLoad)
            }
            finally
            {
                try { File.Delete(path); } catch { /* dossier temporaire de Windows */ }
            }
            HasExposureTestPhoto = ExposureTestPhoto != null;
            ExposureMsg = HasExposureTestPhoto ? "" : "La photo de test est illisible.";
            if (!HasExposureTestPhoto) await StartExposurePreviewAsync();
        }
        catch (Exception ex)
        {
            ExposureMsg = $"La photo de test a échoué : {ex.Message}";
            await StartExposurePreviewAsync();
        }
        finally { IsExposureBusy = false; }
    }

    [RelayCommand]
    private async Task BackToExposurePreviewAsync()
    {
        HasExposureTestPhoto = false;
        ExposureTestPhoto    = null;
        await StartExposurePreviewAsync();
    }

    private async Task StartExposurePreviewAsync()
    {
        if (_camera == null || !IsExposureOpen || _previewRunning) return;
        try
        {
            await _camera.StartLiveViewAsync(OnTestFrame);
            _previewRunning = true;
        }
        catch (Exception ex)
        {
            ExposureMsg = $"Aperçu indisponible : {ex.Message}";
        }
    }

    // ── Envoi des changements ─────────────────────────────────────────────────

    /// <summary>
    /// Changement demandé par une ligne (− / + / curseur) : envoyé tout de suite. Pendant un envoi, les
    /// demandes suivantes sont regroupées (seule la dernière valeur de chaque réglage part).
    /// </summary>
    private void RequestExposureChange(string key, int code)
    {
        _pendingExposure[key] = code;
        if (!_applyingExposure) _ = ApplyPendingExposureAsync();
    }

    /// <summary>Envois en attente, un à la fois ; la tâche rendue se termine quand tout est parti.</summary>
    internal async Task ApplyPendingExposureAsync()
    {
        if (_camera == null || _applyingExposure) return;
        _applyingExposure = true;
        try
        {
            while (_pendingExposure.Count > 0)
            {
                var values = ToValues(_pendingExposure);
                _pendingExposure.Clear();
                try
                {
                    var state = await _camera.ApplyExposureAsync(values);
                    if (state == null) { ExposureMsg = "Appareil photo non connecté."; continue; }
                    Remember(state);
                    ShowExposureState(state);
                    ExposureMsg = "";
                }
                catch (CameraExposureException ex)
                {
                    ExposureMsg = ex.Message;
                    if (ex.State != null)
                    {
                        Remember(ex.State); // valeurs acceptées avant le refus
                        ShowExposureState(ex.State);
                    }
                }
                catch (Exception ex)
                {
                    ExposureMsg = $"Réglage impossible : {ex.Message}";
                }
            }
        }
        finally { _applyingExposure = false; }

        if (_refreshAfterApply)
        {
            _refreshAfterApply = false;
            await RefreshExposureAsync();
        }
    }

    internal static CameraExposureValues ToValues(IReadOnlyDictionary<string, int> changes) => new()
    {
        Tv     = changes.TryGetValue(CameraExposureKeys.Tv, out var tv) ? tv : null,
        Av     = changes.TryGetValue(CameraExposureKeys.Av, out var av) ? av : null,
        Iso    = changes.TryGetValue(CameraExposureKeys.Iso, out var iso) ? iso : null,
        Wb     = changes.TryGetValue(CameraExposureKeys.Wb, out var wb) ? wb : null,
        Kelvin = changes.TryGetValue(CameraExposureKeys.Kelvin, out var k) ? k : null,
    };

    /// <summary>Réglages obtenus gardés sur la borne (réappliqués à chaque ouverture de session).</summary>
    private void Remember(CameraExposureState state)
    {
        if (!state.Settable) return;
        _machine.SetCameraExposure(state.Values, _clock.GetUtcNow());
    }

    // ── Relecture ─────────────────────────────────────────────────────────────

    private void OnExposureOptionsChanged(object? sender, EventArgs e)
    {
        var cts = new CancellationTokenSource();
        Interlocked.Exchange(ref _exposureRefreshCts, cts)?.Cancel();
        _ = DelayedRefreshAsync(cts.Token);
    }

    private async Task DelayedRefreshAsync(CancellationToken token)
    {
        try { await Task.Delay(ExposureRefreshDelay, token); }
        catch (OperationCanceledException) { return; }

        var dispatcher = Application.Current?.Dispatcher;
        if (dispatcher == null) await RefreshExposureAsync(); // tests : pas de fil d'affichage
        else await dispatcher.InvokeAsync(RefreshExposureAsync).Task.Unwrap();
    }

    /// <summary>Relit mode, valeurs et listes permises (molette, zoom, objectif changés).</summary>
    internal async Task RefreshExposureAsync()
    {
        if (_camera == null || !IsExposureOpen || !IsExposureSupported) return;
        if (_applyingExposure) { _refreshAfterApply = true; return; }
        try
        {
            var state = await _camera.ReadExposureAsync();
            if (state != null) ShowExposureState(state);
        }
        catch { /* appareil occupé (prise de vue) : la prochaine relecture rattrapera */ }
    }

    /// <summary>État lu → écran : bandeau du mode, lignes, avertissement D8, kelvin si balance en °K.</summary>
    internal void ShowExposureState(CameraExposureState state)
    {
        ExposureModel   = state.Model;
        ExposureMode    = state.Mode;
        NeedsManualMode = !state.Settable;

        var values = state.Values;
        foreach (var row in ExposureSettings)
        {
            var code = row.Key switch
            {
                CameraExposureKeys.Tv     => values.Tv,
                CameraExposureKeys.Av     => values.Av,
                CameraExposureKeys.Iso    => values.Iso,
                CameraExposureKeys.Wb     => values.Wb,
                CameraExposureKeys.Kelvin => values.Kelvin,
                _                         => null,
            };
            row.Update(state.OptionsFor(row.Key), code, state.Settable);
        }

        ExposureSetting(CameraExposureKeys.Kelvin).IsVisible = values.Wb == CanonExposure.WbColorTemperature;
        ExposureSetting(CameraExposureKeys.Tv).Warning =
            CanonExposure.IsFasterThanFlashSync(values.Tv) ? CanonExposure.FlashSyncWarning : "";
    }

    private void UnsubscribeExposure()
    {
        Interlocked.Exchange(ref _exposureRefreshCts, null)?.Cancel();
        if (_exposureSubscribed && _camera != null)
        {
            _camera.ExposureOptionsChanged -= OnExposureOptionsChanged;
            _exposureSubscribed = false;
        }
    }
}
