using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PolaKiosk.Services;

namespace PolaKiosk.ViewModels;

/// <summary>
/// Paramètres de l'écran de choix du cadre : les cartes (miniatures déjà décodées par l'accueil) et
/// l'écran de consentement à ouvrir ensuite (null si le consentement est coupé).
/// </summary>
public sealed record FrameSelectParameters(IReadOnlyList<FrameTile> Tiles, RgpdParameters? Rgpd);

/// <summary>
/// Écran « Choisissez votre cadre » (LAB-315), entre l'accueil et le consentement ou la prise de vue.
/// Toucher une carte retient le cadre pour le parcours ; « Retour » revient à l'accueil sans choix.
/// </summary>
public partial class FrameSelectViewModel : ObservableObject, IParameterReceiver, IReleasable
{
    private readonly INavigationService _navigation;
    private readonly IFrameSelection _selection;
    private readonly IKioskStateService _state;
    private readonly ICameraHealthService? _cameraHealth;
    private RgpdParameters? _rgpd;

    [ObservableProperty] private IReadOnlyList<FrameTile> _tiles = [];

    /// <summary>Appareil photo absent : « Problème technique », comme sur l'accueil (LAB-263).</summary>
    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(ChooseCommand))]
    private bool _isCameraMissing;

    [ObservableProperty] private string _technicalProblemText = TechnicalProblem.Text(null, null);

    public AdminPinPadViewModel PinPad { get; }

    public FrameSelectViewModel(INavigationService navigation, IFrameSelection selection,
        IKioskStateService state, AdminPinPadViewModel pinPad, ICameraHealthService? cameraHealth = null)
    {
        _navigation   = navigation;
        _selection    = selection;
        _state        = state;
        _cameraHealth = cameraHealth;
        PinPad        = pinPad;
    }

    public void ReceiveParameter(object parameter)
    {
        if (parameter is not FrameSelectParameters p) return;
        Tiles = p.Tiles;
        _rgpd = p.Rgpd;
    }

    /// <summary>État de l'appareil connu tout de suite, puis vérifié une fois à l'affichage.</summary>
    public async Task InitializeAsync()
    {
        TechnicalProblemText = TechnicalProblem.Text(_state.ContactCompany, _state.ContactPhone);
        if (_cameraHealth == null) return;
        IsCameraMissing = _cameraHealth.Status == CameraHealth.Absent;
        try { IsCameraMissing = await _cameraHealth.CheckNowAsync() == CameraHealth.Absent; }
        catch { /* vérification en erreur : l'état affiché reste le dernier connu */ }
    }

    public void Release() => Tiles = [];

    [RelayCommand(CanExecute = nameof(CanChoose))]
    private void Choose(FrameTile? tile)
    {
        if (tile == null || PinPad.ShowPinEntry || IsCameraMissing) return;
        _selection.SelectedTemplateId = tile.TemplateId;
        ContinueToCapture(_navigation, _rgpd);
    }

    private bool CanChoose(FrameTile? tile) => !IsCameraMissing;

    [RelayCommand]
    private void Back()
    {
        if (PinPad.ShowPinEntry) return;
        _selection.Clear();
        _navigation.NavigateTo<Views.HomeView>();
    }

    /// <summary>Suite commune à l'accueil et au choix du cadre : consentement s'il est actif, sinon prise de vue.</summary>
    internal static void ContinueToCapture(INavigationService navigation, RgpdParameters? rgpd)
    {
        if (rgpd != null) navigation.NavigateTo<Views.RgpdView>(rgpd);
        else navigation.NavigateTo<Views.LiveView>();
    }
}
