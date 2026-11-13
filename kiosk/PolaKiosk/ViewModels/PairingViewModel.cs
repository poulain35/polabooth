using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PolaKiosk.Services;

namespace PolaKiosk.ViewModels;

/// <summary>Ce que montre l'écran d'association.</summary>
public enum PairingScreenState
{
    /// <summary>Vérification de la licence ou demande d'un code en cours.</summary>
    Loading,
    /// <summary>Code et QR code affichés, en attente de validation dans le SaaS.</summary>
    ShowingCode,
    /// <summary>Pas de réseau (ou serveur injoignable) : nouvel essai toutes les 15 secondes.</summary>
    Offline,
    /// <summary>Six codes affichés sans validation (une heure) : on attend qu'on touche l'écran.</summary>
    Exhausted,
    /// <summary>Association réussie : message pendant 3 secondes, puis saisie du code événement.</summary>
    Paired,
}

/// <summary>Horloge de l'écran d'association, remplacée dans les tests.</summary>
internal interface IPairingClock
{
    DateTimeOffset UtcNow { get; }
    Task Delay(TimeSpan delay, CancellationToken ct);
}

internal sealed class SystemPairingClock : IPairingClock
{
    public static readonly SystemPairingClock Instance = new();
    public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;
    public Task Delay(TimeSpan delay, CancellationToken ct) => Task.Delay(delay, ct);
}

/// <summary>
/// Écran d'association (LAB-244) : affiche un code court et son QR code, interroge le serveur jusqu'à
/// la validation dans le SaaS, renouvelle le code à son expiration, puis enregistre le secret reçu (DPAPI).
/// </summary>
public partial class PairingViewModel : ObservableObject, IReleasable
{
    internal const int MaxCodes = 6;                                         // 6 × 10 min = 1 h
    internal static readonly TimeSpan CodeValidity      = TimeSpan.FromMinutes(10);
    internal static readonly TimeSpan OfflineRetry      = TimeSpan.FromSeconds(15);
    internal static readonly TimeSpan RateLimitedRetry  = TimeSpan.FromMinutes(1);
    internal static readonly TimeSpan PairedMessageTime = TimeSpan.FromSeconds(3);
    private static readonly TimeSpan Tick = TimeSpan.FromSeconds(1);

    internal const string OfflineMessage    = "Pas de connexion internet. Branchez la borne au réseau pour l'associer.";
    internal const string LostMessage       = "L'association n'a pas abouti, nouveau code";
    internal const string ExhaustedMessage  = "Touchez l'écran pour afficher un nouveau code";
    internal const string RateLimitMessage  = "Trop de demandes d'association depuis ce réseau. Nouvel essai dans une minute.";
    internal const string ServerErrorMessage = "Le serveur ne répond pas. Nouvel essai dans quelques secondes.";

    private readonly IPairingService _pairing;
    private readonly ILicenseService _license;
    private readonly IKioskCredentials _credentials;
    private readonly IKioskStateService _kioskState;
    private readonly INavigationService _navigation;
    private readonly IKioskLogService _log;
    private readonly IPairingClock _clock;
    private readonly string _pairingUrl;
    private readonly TimeSpan _pollInterval;

    private readonly CancellationTokenSource _lifetime = new();
    private CancellationTokenSource? _skipWait;
    private Task? _run;

    [ObservableProperty, NotifyPropertyChangedFor(nameof(IsLoading), nameof(IsShowingCode), nameof(IsOffline),
        nameof(IsExhausted), nameof(IsPaired))]
    private PairingScreenState _state = PairingScreenState.Loading;

    /// <summary>Code affiché, « K7M-4PX ».</summary>
    [ObservableProperty] private string _displayCode = "";
    /// <summary>Lien du QR code : <c>{PairingUrl}?code=K7M4PX</c>.</summary>
    [ObservableProperty] private string _qrUrl = "";
    /// <summary>« Code valable encore 9:42 ».</summary>
    [ObservableProperty] private string _countdown = "";
    /// <summary>Message ponctuel (association perdue, serveur indisponible…), vide sinon.</summary>
    [ObservableProperty, NotifyPropertyChangedFor(nameof(HasNotice))] private string _notice = "";
    /// <summary>Le réseau a coupé pendant l'affichage du code (le code reste affiché).</summary>
    [ObservableProperty] private bool _isConnectionLost;
    /// <summary>« Cette borne a été retirée du compte … », vide si la borne n'a jamais été associée.</summary>
    [ObservableProperty, NotifyPropertyChangedFor(nameof(HasRetiredMessage))] private string _retiredMessage = "";
    /// <summary>« Borne associée à {compte} — {nom} ».</summary>
    [ObservableProperty] private string _pairedMessage = "";

    public bool IsLoading     => State == PairingScreenState.Loading;
    public bool IsShowingCode => State == PairingScreenState.ShowingCode;
    public bool IsOffline     => State == PairingScreenState.Offline;
    public bool IsExhausted   => State == PairingScreenState.Exhausted;
    public bool IsPaired      => State == PairingScreenState.Paired;
    public bool HasNotice         => Notice.Length > 0;
    public bool HasRetiredMessage => RetiredMessage.Length > 0;

    /// <summary>Adresse à taper à la main, sous le QR code.</summary>
    public string PairingAddress { get; }
    public string OfflineText    => OfflineMessage;
    public string ExhaustedText  => ExhaustedMessage;

    /// <summary>Nombre de codes affichés depuis le dernier toucher d'écran.</summary>
    internal int CodesShown { get; private set; }

    public PairingViewModel(IPairingService pairing, ILicenseService license, IKioskCredentials credentials,
        IKioskStateService state, INavigationService navigation, IKioskLogService log, AppSettings settings)
        : this(pairing, license, credentials, state, navigation, log, settings, SystemPairingClock.Instance) { }

    internal PairingViewModel(IPairingService pairing, ILicenseService license, IKioskCredentials credentials,
        IKioskStateService state, INavigationService navigation, IKioskLogService log, AppSettings settings,
        IPairingClock clock)
    {
        _pairing      = pairing;
        _license      = license;
        _credentials  = credentials;
        _kioskState   = state;
        _navigation   = navigation;
        _log          = log;
        _clock        = clock;
        _pairingUrl   = settings.Kiosk.ResolvePairingUrl();
        _pollInterval = TimeSpan.FromSeconds(Math.Max(1, settings.Kiosk.PairingPollSeconds));
        PairingAddress = PairingService.DisplayUrl(_pairingUrl);
    }

    /// <summary>Lance l'écran (appelé à l'affichage de la vue). Sans effet s'il tourne déjà.</summary>
    public void Start()
    {
        if (_run is { IsCompleted: false } || _lifetime.IsCancellationRequested) return;
        _run = RunAsync();
    }

    /// <summary>« Réessayer » (hors ligne) : nouvel essai tout de suite, sans attendre les 15 secondes.</summary>
    [RelayCommand]
    private void Retry() => _skipWait?.Cancel();

    /// <summary>Toucher l'écran après une heure sans validation : nouvelle série de codes.</summary>
    [RelayCommand]
    private void Restart()
    {
        if (State != PairingScreenState.Exhausted) return;
        Start();
    }

    public void Release()
    {
        _lifetime.Cancel();
        _skipWait?.Cancel();
        _pairing.Forget();
    }

    internal async Task RunAsync()
    {
        var ct = _lifetime.Token;
        try
        {
            State = PairingScreenState.Loading;
            Notice = "";
            CodesShown = 0;
            if (!await NeedsPairingAsync(ct)) return;

            while (true)
            {
                if (CodesShown >= MaxCodes)
                {
                    _pairing.Forget();
                    DisplayCode = ""; QrUrl = ""; Countdown = "";
                    State = PairingScreenState.Exhausted;
                    return;
                }

                var code = await RequestCodeAsync(ct);
                if (code == null) continue; // échec : attente faite, nouvel essai

                CodesShown++;
                if (Notice != LostMessage) Notice = ""; // « nouveau code » reste affiché avec ce code
                ShowCode(code);

                var result = await WaitForApprovalAsync(code, ct);
                if (result.Status == PairingStatus.Approved && result.Secret != null)
                {
                    await CompleteAsync(result, ct);
                    return;
                }

                // Secret remis mais pas reçu (réponse perdue) : on le dit, puis nouveau code.
                // Expiré, annulé, inconnu : nouveau code sans message.
                var lost = result.Status is PairingStatus.Delivered or PairingStatus.Approved;
                Notice = lost ? LostMessage : "";
                if (lost) await _log.LogWarningAsync("pairing", $"Association non reçue (statut {result.Status}) : nouveau code.");
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Écran quitté
        }
        catch (Exception ex)
        {
            await _log.LogErrorAsync("pairing", $"Erreur inattendue de l'écran d'association : {ex.Message}", ex.ToString());
            Notice = ServerErrorMessage;
            State = PairingScreenState.Exhausted; // toucher l'écran relance
        }
    }

    /// <summary>
    /// Borne déjà associée (secret présent) : la licence est revérifiée avant de proposer un code. Valide
    /// (le réseau est revenu) → saisie du code événement ; refusée → association, avec le compte d'origine
    /// s'il est connu ; injoignable → message hors ligne et nouvel essai.
    /// </summary>
    private async Task<bool> NeedsPairingAsync(CancellationToken ct)
    {
        if (string.IsNullOrEmpty(_credentials.Secret)) return true;

        while (true)
        {
            State = PairingScreenState.Loading;
            var status = await _license.CheckAsync();
            ct.ThrowIfCancellationRequested();

            switch (status)
            {
                case LicenseStatus.Valid:
                    _navigation.NavigateTo<Views.EventSetupView>();
                    return false;
                case LicenseStatus.Refused:
                    RetiredMessage = string.IsNullOrWhiteSpace(_kioskState.AccountName)
                        ? "" : $"Cette borne a été retirée du compte {_kioskState.AccountName}.";
                    await _log.LogWarningAsync("pairing", "Licence refusée par le serveur : écran d'association.");
                    return true;
                default:
                    State = PairingScreenState.Offline;
                    await WaitAsync(OfflineRetry, skippable: true, ct);
                    break;
            }
        }
    }

    private async Task<PairingCode?> RequestCodeAsync(CancellationToken ct)
    {
        // Pas de changement d'écran pendant la demande : le message hors ligne ou l'ancien code restent
        // affichés (pas de clignotement toutes les 15 secondes).
        try
        {
            return await _pairing.StartAsync(ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (PairingRateLimitedException)
        {
            await _log.LogWarningAsync("pairing", "Trop de demandes de code depuis cette adresse : nouvel essai dans une minute.");
            ShowWaiting(RateLimitMessage);
            await WaitAsync(RateLimitedRetry, skippable: false, ct);
        }
        catch (Exception ex) when (SyncService.IsNetworkUnavailable(ex, ct))
        {
            State = PairingScreenState.Offline;
            await WaitAsync(OfflineRetry, skippable: true, ct);
        }
        catch (Exception ex)
        {
            await _log.LogWarningAsync("pairing", $"Demande de code d'association échouée : {ex.Message}");
            ShowWaiting(ServerErrorMessage);
            await WaitAsync(OfflineRetry, skippable: false, ct);
        }
        return null;
    }

    private void ShowWaiting(string notice)
    {
        Notice = notice;
        DisplayCode = ""; QrUrl = ""; Countdown = "";
        State = PairingScreenState.Loading;
    }

    private void ShowCode(PairingCode code)
    {
        DisplayCode = PairingService.FormatCode(code.Code);
        QrUrl = PairingService.BuildPairingUrl(_pairingUrl, code.Code);
        IsConnectionLost = false;
        State = PairingScreenState.ShowingCode;
    }

    /// <summary>
    /// Interroge le serveur toutes les <c>PairingPollSeconds</c> jusqu'à une réponse définitive ou
    /// l'expiration. Une coupure réseau garde le code : on reprend tant qu'il est valable.
    /// </summary>
    private async Task<PairingPollResult> WaitForApprovalAsync(PairingCode code, CancellationToken ct)
    {
        // Échéance comptée sur l'horloge locale : une horloge de PC décalée ne doit pas faire expirer
        // (ou durer) un code à tort. Validité annoncée par le serveur, bornée à 10 minutes.
        var now = _clock.UtcNow;
        var validity = code.ExpiresAt - now;
        if (validity <= TimeSpan.Zero || validity > CodeValidity) validity = CodeValidity;
        var deadline = now + validity;
        var nextPoll = now + _pollInterval;

        while (true)
        {
            now = _clock.UtcNow;
            if (now >= deadline) return new PairingPollResult(PairingStatus.Expired);
            Countdown = FormatCountdown(deadline - now);

            if (now >= nextPoll)
            {
                nextPoll = now + _pollInterval;
                try
                {
                    var result = await _pairing.PollAsync(ct);
                    IsConnectionLost = false;
                    if (result.Status is not (PairingStatus.Pending or PairingStatus.Unknown)) return result;
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
                catch (Exception ex) when (SyncService.IsNetworkUnavailable(ex, ct))
                {
                    IsConnectionLost = true;
                }
                catch (Exception ex)
                {
                    await _log.LogWarningAsync("pairing", $"Suivi de l'association échoué : {ex.Message}");
                }
            }

            await _clock.Delay(Tick, ct);
        }
    }

    private async Task CompleteAsync(PairingPollResult result, CancellationToken ct)
    {
        _credentials.SetSecret(result.Secret!);
        _pairing.Forget();

        // Nouveau compte possible : l'événement actif et le compte connus ne valent plus.
        await _kioskState.ClearActiveEventAsync();
        await _kioskState.SetPairedAccountAsync(result.OrgName, result.OrgId);
        await _log.LogInfoAsync("pairing", $"Borne associée (licence {result.LicenseId}).");

        PairedMessage = BuildPairedMessage(result.OrgName, result.Label);
        Notice = ""; RetiredMessage = "";
        State = PairingScreenState.Paired;

        // Heartbeat, PIN admin et cache de licence, pendant le message.
        _ = _license.CheckAsync();
        await _clock.Delay(PairedMessageTime, ct);
        _navigation.NavigateTo<Views.EventSetupView>();
    }

    internal static string BuildPairedMessage(string? orgName, string? label)
    {
        var org = string.IsNullOrWhiteSpace(orgName) ? null : orgName.Trim();
        var name = string.IsNullOrWhiteSpace(label) ? null : label.Trim();
        return (org, name) switch
        {
            (not null, not null) => $"Borne associée à {org} — {name}",
            (not null, null)     => $"Borne associée à {org}",
            _                    => "Borne associée",
        };
    }

    internal static string FormatCountdown(TimeSpan left)
    {
        var seconds = (int)Math.Ceiling(Math.Max(0, left.TotalSeconds));
        return $"Code valable encore {seconds / 60}:{seconds % 60:00}";
    }

    /// <summary>Attente bornée ; « Réessayer » l'écourte si <paramref name="skippable"/>.</summary>
    private async Task WaitAsync(TimeSpan delay, bool skippable, CancellationToken ct)
    {
        if (!skippable)
        {
            await _clock.Delay(delay, ct);
            return;
        }

        using var skip = CancellationTokenSource.CreateLinkedTokenSource(ct);
        _skipWait = skip;
        try { await _clock.Delay(delay, skip.Token); }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested) { /* « Réessayer » */ }
        finally { _skipWait = null; }
    }
}
