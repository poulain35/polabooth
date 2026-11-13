using Moq;
using PolaKiosk.Models.Supabase;
using PolaKiosk.Services;
using PolaKiosk.ViewModels;
using PolaKiosk.Views;

namespace PolaKiosk.Tests.ViewModels;

/// <summary>Écran résultat avec ses services simulés : aucun réseau, aucune imprimante, aucun e-mail réel.</summary>
internal sealed class ResultViewModelHarness
{
    internal sealed class FakeTimer : IIdleTimer
    {
        public TimeSpan Interval { get; set; }
        public bool IsEnabled { get; private set; }
        public event EventHandler? Tick;
        public void Start() => IsEnabled = true;
        public void Stop()  => IsEnabled = false;
        public void Fire(int times = 1)
        {
            for (var i = 0; i < times; i++) Tick?.Invoke(this, EventArgs.Empty);
        }
    }

    public const string PublicUrl = "https://photos.example/composite.jpg";
    public static readonly Guid PhotoId = Guid.NewGuid();
    public static readonly Guid EventId = Guid.NewGuid();

    public Mock<IPrintService> Print { get; } = new();
    public Mock<ISupabaseService> Supabase { get; } = new();
    public Mock<INavigationService> Navigation { get; } = new();
    public Mock<INetworkMonitorService> Network { get; } = new();
    public Mock<ISessionService> Sessions { get; } = new();
    public Mock<IKioskLogService> Log { get; } = new();
    public GuestJourneyService Journey { get; }
    public FakeTimer Timer { get; } = new();
    public Type? Current { get; private set; } = typeof(ResultView);

    public ResultViewModelHarness()
    {
        Navigation.SetupGet(n => n.CurrentViewType).Returns(() => Current);
        Navigation.Setup(n => n.NavigateTo<HomeView>()).Callback(NavigateTo<HomeView>);
        Navigation.Setup(n => n.NavigateTo<LiveView>()).Callback(NavigateTo<LiveView>);
        Journey = new GuestJourneyService(Navigation.Object);

        // Par défaut : en ligne, l'envoi de la photo réussit, impression sans plafond.
        Network.SetupGet(n => n.IsOnline).Returns(true);
        Sessions.Setup(s => s.UploadSessionAsync(It.IsAny<Guid>())).ReturnsAsync((PublicUrl, PhotoId));
        Print.Setup(p => p.GetRemainingPrintsAsync(It.IsAny<Guid>(), It.IsAny<int?>(), It.IsAny<Guid>(), It.IsAny<int?>()))
             .ReturnsAsync((int?)null);
    }

    public void NavigateTo<T>()
    {
        Current = typeof(T);
        Navigation.Raise(n => n.Navigated += null, EventArgs.Empty);
    }

    public ResultViewModel Create() => new(
        Print.Object, Supabase.Object, Navigation.Object, Network.Object, new AppSettings { Kiosk = { SaasUrl = "https://photobooth.exemple.fr" } }, Log.Object,
        Sessions.Object, Journey, () => Timer);

    public static ResultParameters Parameters(
        ResultButtonsConfig? buttons = null, bool emailEnabled = true, int autoReturnSeconds = 30,
        bool fromGallery = false, string paperFormat = "4x6") => new(
        SessionId:     Guid.NewGuid(),
        EventId:       EventId,
        EventName:     "Mariage de Léa et Hugo",
        CompositePath: Path.Combine(Path.GetTempPath(), $"absent-{Guid.NewGuid():N}.jpg"),
        AccessCode:    "ABC123",
        PaperFormat:   paperFormat,
        EmailConfig:   new EmailShareConfig { Enabled = emailEnabled },
        ResultCfg:     new ResultConfig { AutoReturnSeconds = autoReturnSeconds, Buttons = buttons ?? new() },
        FromGallery:   fromGallery);

    public async Task<ResultViewModel> OpenAsync(ResultParameters? parameters = null)
    {
        var vm = Create();
        await vm.InitializeAsync(parameters ?? Parameters());
        return vm;
    }
}
