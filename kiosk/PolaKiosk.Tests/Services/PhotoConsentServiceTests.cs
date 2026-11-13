using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Moq;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Models.Supabase;
using PolaKiosk.Services;
using PolaKiosk.ViewModels;

namespace PolaKiosk.Tests.Services;

/// <summary>LAB-223 : file locale des consentements photo (lien à la séance, envoi, purge, journaux).</summary>
public sealed class PhotoConsentServiceTests : IDisposable
{
    private static readonly Guid EventId = Guid.Parse("6f1d2c3b-1111-4222-8333-944455556666");
    private const string EventName = "Mariage";
    private const string AccessCode = "TUQNA5";
    private const string ConsentText = "J'accepte que ma photo soit prise par Camille & Hugo.";

    private readonly TestDb _db = new();
    private readonly TempDir _dir = new();
    private readonly Mock<ISupabaseService> _supabase = new();
    private readonly Mock<IKioskLogService> _log = new();
    private readonly List<string> _logged = [];
    private readonly List<PhotoConsentRecord> _sent = [];
    private readonly Guid _sessionId = Guid.NewGuid();

    public PhotoConsentServiceTests()
    {
        _log.Setup(l => l.LogInfoAsync(It.IsAny<string>(), It.IsAny<string>()))
            .Callback<string, string>((c, m) => _logged.Add($"{c} {m}")).Returns(Task.CompletedTask);
        _log.Setup(l => l.LogWarningAsync(It.IsAny<string>(), It.IsAny<string>()))
            .Callback<string, string>((c, m) => _logged.Add($"{c} {m}")).Returns(Task.CompletedTask);
        _log.Setup(l => l.LogErrorAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>()))
            .Callback<string, string, string?>((c, m, s) => _logged.Add($"{c} {m} {s}")).Returns(Task.CompletedTask);
        RespondWith(PhotoConsentSendResult.Ok);
    }

    public void Dispose()
    {
        _db.Dispose();
        _dir.Dispose();
    }

    private PhotoConsentService NewService() => new(_db.NewContext(), _supabase.Object, _log.Object);

    private void RespondWith(PhotoConsentSendResult result)
        => _supabase.Setup(s => s.RecordPhotoConsentAsync(It.IsAny<PhotoConsentRecord>(), It.IsAny<CancellationToken>()))
                    .Callback<PhotoConsentRecord, CancellationToken>((r, _) => _sent.Add(r))
                    .ReturnsAsync(result);

    private static PhotoConsent Consent(DateTime? at = null) => new(ConsentText, at ?? DateTime.UtcNow);

    private async Task<List<PhotoConsentEntity>> RowsAsync()
    {
        using var ctx = _db.NewContext();
        return await ctx.PhotoConsents.AsNoTracking().ToListAsync(TestContext.Current.CancellationToken);
    }

    private async Task<Guid> QueueAsync(DateTime? at = null, Guid? sessionId = null)
    {
        using var ctx = _db.NewContext();
        var entity = PhotoConsentService.CreateEntity(Consent(at), sessionId ?? _sessionId, EventId, AccessCode);
        ctx.PhotoConsents.Add(entity);
        await ctx.SaveChangesAsync(TestContext.Current.CancellationToken);
        return entity.Id;
    }

    private void LogsShouldHoldNoConsentData()
    {
        foreach (var line in _logged)
            line.Should().NotContain(AccessCode).And.NotContain("Camille").And.NotContain(_sessionId.ToString());
    }

    private SessionService NewSessions(SessionPathService? paths = null)
    {
        var settings = new AppSettings();
        settings.Kiosk.DataDirectory = _dir.Path;
        return new SessionService(_db.NewContext(), _supabase.Object, _log.Object, paths ?? new SessionPathService(settings));
    }

    // ── Lien à la séance ─────────────────────────────────────────────

    [Fact]
    public async Task Consent_is_written_with_the_session_in_the_same_transaction()
    {
        var at = new DateTime(2026, 11, 4, 18, 30, 5, DateTimeKind.Utc);
        var composite = Path.Combine(_dir.Path, "composite.jpg");

        await NewSessions().RecordSessionAsync(_sessionId, EventId, DateTime.UtcNow, "photo.jpg", composite,
            LiveViewModel.StagePhotoConsent(Consent(at), _sessionId, EventId, AccessCode));

        using var ctx = _db.NewContext();
        (await ctx.Sessions.CountAsync(s => s.Id == _sessionId, TestContext.Current.CancellationToken)).Should().Be(1);
        var row = (await RowsAsync()).Should().ContainSingle().Subject;
        row.SessionId.Should().Be(_sessionId);
        row.EventId.Should().Be(EventId);
        row.AccessCode.Should().Be(AccessCode);
        row.ConsentText.Should().Be(ConsentText);
        row.ConsentedAt.Should().Be(at);
        row.Id.Should().NotBe(_sessionId).And.NotBe(Guid.Empty);
        row.Attempts.Should().Be(0);
        row.LastError.Should().BeNull();
    }

    [Fact]
    public void No_consent_means_nothing_to_stage()
        => LiveViewModel.StagePhotoConsent(null, _sessionId, EventId, AccessCode).Should().BeNull();

    [Fact]
    public void Each_session_gets_its_own_consent_row()
    {
        var consent = Consent();

        var first  = PhotoConsentService.CreateEntity(consent, Guid.NewGuid(), EventId, AccessCode);
        var second = PhotoConsentService.CreateEntity(consent, Guid.NewGuid(), EventId, AccessCode);

        first.Id.Should().NotBe(second.Id);
        first.ConsentedAt.Should().Be(second.ConsentedAt);
        first.ConsentedAt.Kind.Should().Be(DateTimeKind.Utc);
    }

    [Fact]
    public async Task Failed_session_write_leaves_no_consent_behind()
    {
        using (var ctx = _db.NewContext())
        {
            ctx.Sessions.Add(new SessionEntity { Id = _sessionId, EventId = EventId, PhotoPath = "x.jpg" });
            await ctx.SaveChangesAsync(TestContext.Current.CancellationToken);
        }

        var write = () => NewSessions().RecordSessionAsync(_sessionId, EventId, DateTime.UtcNow, "photo.jpg", "composite.jpg",
            LiveViewModel.StagePhotoConsent(Consent(), _sessionId, EventId, AccessCode));

        await write.Should().ThrowAsync<DbUpdateException>();
        (await RowsAsync()).Should().BeEmpty();
    }

    private (string Photo, string Composite, SessionPathService Paths) NewPendingCapture()
    {
        var settings = new AppSettings();
        settings.Kiosk.DataDirectory = _dir.Path;
        var paths = new SessionPathService(settings);
        paths.EnsurePendingDirectoriesExist(_sessionId);
        var photo = Path.Combine(paths.GetPendingOriginalsDirectory(_sessionId), "IMG_0001.jpg");
        var composite = Path.Combine(paths.GetPendingCompositesDirectory(_sessionId), "composite_1.jpg");
        File.WriteAllBytes(photo, [0xFF, 0xD8, 0xFF, 0xD9]);
        File.WriteAllBytes(composite, [0xFF, 0xD8, 0xFF, 0xD9]);
        return (photo, composite, paths);
    }

    [Fact]
    public async Task Validated_questionnaire_writes_the_session_and_its_consent_together()
    {
        var (photo, composite, paths) = NewPendingCapture();

        await NewSessions(paths).CommitPendingSessionAsync(_sessionId, EventId, EventName, DateTime.UtcNow, photo, composite,
            LiveViewModel.StagePhotoConsent(Consent(), _sessionId, EventId, AccessCode));

        (await RowsAsync()).Should().ContainSingle().Which.SessionId.Should().Be(_sessionId);
    }

    [Fact]
    public async Task Power_cut_during_the_questionnaire_leaves_no_consent()
    {
        var (_, _, paths) = NewPendingCapture();

        var cleanup = await NewSessions(paths).CleanupPendingAsync();

        cleanup.Discarded.Should().Be(1);
        (await RowsAsync()).Should().BeEmpty();
    }

    // ── Envoi ────────────────────────────────────────────────────────

    [Fact]
    public async Task Sent_consent_is_deleted_from_the_kiosk()
    {
        var at = new DateTime(2026, 11, 4, 18, 30, 5, DateTimeKind.Utc);
        var id = await QueueAsync(at);

        var summary = await NewService().SendPendingAsync();

        summary.Should().Be(new PhotoConsentSendSummary(Sent: 1, Rejected: 0, Failed: 0));
        (await RowsAsync()).Should().BeEmpty();
        var record = _sent.Should().ContainSingle().Subject;
        record.Should().Be(new PhotoConsentRecord(id, EventId, AccessCode, _sessionId, at, ConsentText));
        record.ConsentedAtUtc.Kind.Should().Be(DateTimeKind.Utc);
        _logged.Should().ContainSingle(l => l.Contains("1 consentement(s) photo envoyé(s)"));
        LogsShouldHoldNoConsentData();
    }

    [Fact]
    public async Task Invalid_data_is_a_definitive_error_and_is_deleted()
    {
        await QueueAsync();
        RespondWith(PhotoConsentSendResult.Rejected("22023"));

        var summary = await NewService().SendPendingAsync();

        summary.Rejected.Should().Be(1);
        (await RowsAsync()).Should().BeEmpty();
        _logged.Should().ContainSingle(l => l.Contains("22023"));
        LogsShouldHoldNoConsentData();
    }

    [Fact]
    public async Task Licence_or_event_refusal_is_retried_with_the_code_only()
    {
        await QueueAsync();
        RespondWith(PhotoConsentSendResult.Rejected("P0001"));

        await NewService().SendPendingAsync();
        var summary = await NewService().SendPendingAsync();

        summary.Failed.Should().Be(1);
        var row = (await RowsAsync()).Should().ContainSingle().Subject;
        row.Attempts.Should().Be(2);
        row.LastError.Should().Be("P0001");
        _logged.Should().Contain(l => l.Contains("code : P0001"));
        LogsShouldHoldNoConsentData();
    }

    [Fact]
    public async Task Offline_keeps_every_consent_for_the_next_cycle()
    {
        await QueueAsync(DateTime.UtcNow.AddMinutes(-2));
        await QueueAsync(DateTime.UtcNow.AddMinutes(-1), Guid.NewGuid());
        _supabase.Setup(s => s.RecordPhotoConsentAsync(It.IsAny<PhotoConsentRecord>(), It.IsAny<CancellationToken>()))
                 .ThrowsAsync(new HttpRequestException($"Hôte injoignable ({AccessCode})"));

        var summary = await NewService().SendPendingAsync();

        summary.Failed.Should().Be(1); // le premier échoue : inutile d'essayer le suivant
        var rows = await RowsAsync();
        rows.Should().HaveCount(2);
        rows.Sum(r => r.Attempts).Should().Be(1);
        rows.Single(r => r.Attempts == 1).LastError.Should().Be(nameof(HttpRequestException));
        LogsShouldHoldNoConsentData();

        RespondWith(PhotoConsentSendResult.Ok); // retour du réseau
        (await NewService().SendPendingAsync()).Sent.Should().Be(2);
        (await RowsAsync()).Should().BeEmpty();
    }

    // ── Purge locale ─────────────────────────────────────────────────

    [Fact]
    public async Task Consents_older_than_90_days_are_purged_even_offline()
    {
        await QueueAsync(DateTime.UtcNow.AddDays(-91));
        var recent = await QueueAsync(DateTime.UtcNow.AddDays(-89));

        (await NewService().PurgeExpiredAsync()).Should().Be(1);

        (await RowsAsync()).Should().ContainSingle().Which.Id.Should().Be(recent);
        _logged.Should().ContainSingle(l => l.Contains("1 consentement(s)") && l.Contains("90 jours"));
        LogsShouldHoldNoConsentData();
    }

    [Fact]
    public async Task Sending_purges_expired_consents_first()
    {
        await QueueAsync(DateTime.UtcNow.AddDays(-91));

        (await NewService().SendPendingAsync()).Sent.Should().Be(0);

        (await RowsAsync()).Should().BeEmpty();
        _sent.Should().BeEmpty();
    }
}
