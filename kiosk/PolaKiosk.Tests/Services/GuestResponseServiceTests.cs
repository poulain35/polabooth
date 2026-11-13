using System.Text;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Moq;
using Newtonsoft.Json.Linq;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Models.Supabase;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>LAB-225 : stockage chiffré des réponses au questionnaire, envoi, purge, journaux sans donnée perso.</summary>
public sealed class GuestResponseServiceTests : IDisposable
{
    private static readonly Guid EventId = Guid.Parse("6f1d2c3b-1111-4222-8333-944455556666");
    private const string EventName = "Mariage";
    private const string Email = "jean.dupont@gmail.com";
    private const string Phone = "+33612345678";
    private const string Company = "Boulangerie Martin";

    private readonly TestDb _db = new();
    private readonly TempDir _dir = new();
    private readonly Mock<ISupabaseService> _supabase = new();
    private readonly Mock<IKioskLogService> _log = new();
    private readonly List<string> _logged = [];
    private readonly List<GuestResponseRecord> _sent = [];
    private readonly Guid _sessionId = Guid.NewGuid();

    public GuestResponseServiceTests()
    {
        _log.Setup(l => l.LogInfoAsync(It.IsAny<string>(), It.IsAny<string>()))
            .Callback<string, string>((c, m) => _logged.Add($"{c} {m}")).Returns(Task.CompletedTask);
        _log.Setup(l => l.LogWarningAsync(It.IsAny<string>(), It.IsAny<string>()))
            .Callback<string, string>((c, m) => _logged.Add($"{c} {m}")).Returns(Task.CompletedTask);
        _log.Setup(l => l.LogErrorAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>()))
            .Callback<string, string, string?>((c, m, s) => _logged.Add($"{c} {m} {s}")).Returns(Task.CompletedTask);
        RespondWith(GuestResponseSendResult.Ok);
    }

    public void Dispose()
    {
        _db.Dispose();
        _dir.Dispose();
    }

    private GuestResponseService NewService() => new(_db.NewContext(), _supabase.Object, _log.Object);

    private void RespondWith(GuestResponseSendResult result)
        => _supabase.Setup(s => s.RecordGuestResponseAsync(It.IsAny<GuestResponseRecord>(), It.IsAny<CancellationToken>()))
                    .Callback<GuestResponseRecord, CancellationToken>((r, _) => _sent.Add(r))
                    .ReturnsAsync(result);

    private GuestSubmission Submission(DateTime? answeredAt = null, bool marketing = false) => new(
        EventId:              EventId,
        SessionId:            _sessionId,
        AnsweredAt:           answeredAt ?? DateTime.UtcNow,
        Questions:
        [
            new QuestionConfig { Id = "email", Label = "Votre e-mail", Type = QuestionTypes.Email },
            new QuestionConfig { Id = "tel", Label = "Téléphone", Type = QuestionTypes.Tel },
            new QuestionConfig { Id = "societe", Label = "Société", Type = QuestionTypes.Text },
            new QuestionConfig { Id = "date", Label = "Date du mariage", Type = QuestionTypes.Text },
            new QuestionConfig { Id = "gouts", Label = "Vos goûts", Type = QuestionTypes.Multi, Options = ["Rock", "Jazz"] },
            new QuestionConfig { Id = "newsletter", Label = "Newsletter", Type = QuestionTypes.Checkbox },
            new QuestionConfig { Id = "vide", Label = "Remarque", Type = QuestionTypes.Text },
        ],
        Answers: new Dictionary<string, object?>
        {
            ["email"]      = Email,
            ["tel"]        = Phone,
            ["societe"]    = Company,
            ["date"]       = "2026-11-04",
            ["gouts"]      = new List<string> { "Rock", "Jazz" },
            ["newsletter"] = true,
            ["vide"]       = null,
        },
        MarketingConsent:     marketing,
        MarketingConsentText: "J'accepte d'être recontacté par Camille & Hugo.",
        Notice:               "Vos réponses sont transmises à Camille & Hugo.",
        AccessCode:           "TUQNA5");

    private async Task<List<GuestResponseEntity>> RowsAsync()
    {
        using var ctx = _db.NewContext();
        return await ctx.GuestResponses.AsNoTracking().ToListAsync(TestContext.Current.CancellationToken);
    }

    private async Task<Guid> SaveAsync(GuestSubmission? submission = null)
    {
        await NewService().SaveAsync(submission ?? Submission());
        return (await RowsAsync()).Last().Id;
    }

    private void LogsShouldHoldNoPersonalData()
    {
        foreach (var line in _logged)
        {
            line.Should().NotContain(Email).And.NotContain("jean").And.NotContain(Phone).And.NotContain("0612")
                .And.NotContain(Company).And.NotContain("Rock").And.NotContain("TUQNA5");
        }
    }

    // ── Enregistrement ───────────────────────────────────────────────

    [Fact]
    public async Task Saved_response_is_encrypted_and_linked_to_the_session()
    {
        await NewService().SaveAsync(Submission());

        var row = (await RowsAsync()).Should().ContainSingle().Subject;
        row.EventId.Should().Be(EventId);
        row.SessionIds.Should().Be($"[\"{_sessionId}\"]");
        row.MarketingConsent.Should().BeFalse();
        row.Attempts.Should().Be(0);
        row.LastError.Should().BeNull();

        var stored = Encoding.UTF8.GetString(row.PayloadProtected);
        foreach (var secret in new[] { Email, Phone, Company, "TUQNA5", "Rock" })
        {
            stored.Should().NotContain(secret);
            Encoding.Unicode.GetString(row.PayloadProtected).Should().NotContain(secret);
        }

        var record = GuestResponseService.TryRead(row)!;
        record.AccessCode.Should().Be("TUQNA5");
        record.SessionIds.Should().Equal(_sessionId);
        record.Answers["email"]!.Value<string>().Should().Be(Email);
    }

    [Fact]
    public void Answers_keep_their_type_and_skip_empty_questions()
    {
        var record = GuestResponseService.TryRead(GuestResponseService.CreateEntity(Submission()))!;

        record.Answers.Properties().Select(p => p.Name).Should().BeEquivalentTo("email", "tel", "societe", "date", "gouts", "newsletter");
        record.Answers["date"]!.Type.Should().Be(JTokenType.String);
        record.Answers["date"]!.Value<string>().Should().Be("2026-11-04");
        record.Answers["gouts"]!.ToObject<string[]>().Should().Equal("Rock", "Jazz");
        record.Answers["newsletter"]!.Value<bool>().Should().BeTrue();
        record.Questions.Should().HaveCount(7);
        JToken.DeepEquals(record.Questions[0], JObject.Parse("""{"id":"email","label":"Votre e-mail","type":"email"}""")).Should().BeTrue();
        record.ConsentText.Should().Be("J'accepte d'être recontacté par Camille & Hugo.");
        record.NoticeHash.Should().MatchRegex("^[0-9a-f]{64}$")
            .And.Be(GuestResponseService.HashNotice("Vos réponses sont transmises à Camille & Hugo."));
        record.AnsweredAtUtc.Kind.Should().Be(DateTimeKind.Utc);
    }

    [Fact]
    public void Notice_hash_is_absent_without_notice()
        => GuestResponseService.HashNotice("").Should().BeNull();

    // ── Mode obligatoire : même transaction que la séance ────────────

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
    public async Task Validated_journey_writes_the_session_and_its_response_together()
    {
        var (photo, composite, paths) = NewPendingCapture();
        var sessions = new SessionService(_db.NewContext(), _supabase.Object, _log.Object, paths);

        await sessions.CommitPendingSessionAsync(_sessionId, EventId, EventName, DateTime.UtcNow, photo, composite,
            db => NewService().Stage(db, Submission()));

        using var ctx = _db.NewContext();
        (await ctx.Sessions.CountAsync(s => s.Id == _sessionId, TestContext.Current.CancellationToken)).Should().Be(1);
        var row = (await RowsAsync()).Should().ContainSingle().Subject;
        GuestResponseService.TryRead(row)!.SessionIds.Should().Equal(_sessionId);
    }

    [Fact]
    public async Task Failed_session_write_leaves_no_response_behind()
    {
        var (photo, composite, paths) = NewPendingCapture();
        // Séance déjà présente : le SaveChanges de la validation échoue (clé en double).
        using (var ctx = _db.NewContext())
        {
            ctx.Sessions.Add(new SessionEntity { Id = _sessionId, EventId = EventId, PhotoPath = "x.jpg" });
            await ctx.SaveChangesAsync(TestContext.Current.CancellationToken);
        }
        var sessions = new SessionService(_db.NewContext(), _supabase.Object, _log.Object, paths);

        await sessions.CommitPendingSessionAsync(_sessionId, EventId, EventName, DateTime.UtcNow, photo, composite,
            db => NewService().Stage(db, Submission()));

        (await RowsAsync()).Should().BeEmpty();
        LogsShouldHoldNoPersonalData();
    }

    [Fact]
    public async Task Crash_between_the_transaction_and_the_move_keeps_the_response()
    {
        var (_, _, paths) = NewPendingCapture();
        var eventDir = paths.GetEventDirectory(EventName, EventId);
        // Coupure juste après le SaveChanges : séance et réponse en base, fichiers encore en attente.
        using (var ctx = _db.NewContext())
        {
            ctx.Sessions.Add(new SessionEntity
            {
                Id = _sessionId, EventId = EventId, CapturedAt = DateTime.UtcNow,
                PhotoPath = Path.Combine(eventDir, "originals", "IMG_0001.jpg"),
                CompositePath = Path.Combine(eventDir, "composites", "composite_1.jpg"),
            });
            NewService().Stage(ctx, Submission());
            await ctx.SaveChangesAsync(TestContext.Current.CancellationToken);
        }

        var cleanup = await new SessionService(_db.NewContext(), _supabase.Object, _log.Object, paths).CleanupPendingAsync();

        cleanup.Completed.Should().Be(1);
        File.Exists(Path.Combine(eventDir, "composites", "composite_1.jpg")).Should().BeTrue();
        (await RowsAsync()).Should().ContainSingle();

        (await NewService().SendPendingAsync()).Sent.Should().Be(1);
        _sent.Single().SessionIds.Should().Equal(_sessionId);
    }

    [Fact]
    public async Task Power_cut_during_the_questionnaire_leaves_no_response()
    {
        var (_, _, paths) = NewPendingCapture();

        var cleanup = await new SessionService(_db.NewContext(), _supabase.Object, _log.Object, paths).CleanupPendingAsync();

        cleanup.Discarded.Should().Be(1);
        (await RowsAsync()).Should().BeEmpty();
    }

    // ── Envoi ────────────────────────────────────────────────────────

    [Fact]
    public async Task Sent_response_is_deleted_from_the_kiosk()
    {
        var id = await SaveAsync(Submission(marketing: true));

        var summary = await NewService().SendPendingAsync();

        summary.Should().Be(new GuestResponseSendSummary(Sent: 1, Rejected: 0, Unreadable: 0, Failed: 0));
        (await RowsAsync()).Should().BeEmpty();
        var record = _sent.Should().ContainSingle().Subject;
        record.Id.Should().Be(id);
        record.EventId.Should().Be(EventId);
        record.AccessCode.Should().Be("TUQNA5");
        record.MarketingConsent.Should().BeTrue();
        record.Answers["tel"]!.Value<string>().Should().Be(Phone);
        LogsShouldHoldNoPersonalData();
    }

    [Fact]
    public async Task Invalid_data_is_a_definitive_error_and_is_deleted()
    {
        await SaveAsync();
        RespondWith(GuestResponseSendResult.Rejected("22023"));

        var summary = await NewService().SendPendingAsync();

        summary.Rejected.Should().Be(1);
        (await RowsAsync()).Should().BeEmpty();
        _logged.Should().ContainSingle(l => l.Contains("22023"));
        LogsShouldHoldNoPersonalData();
    }

    [Fact]
    public async Task Licence_or_event_refusal_is_retried_with_the_code_only()
    {
        await SaveAsync();
        RespondWith(GuestResponseSendResult.Rejected("P0001"));

        await NewService().SendPendingAsync();
        var summary = await NewService().SendPendingAsync();

        summary.Failed.Should().Be(1);
        var row = (await RowsAsync()).Should().ContainSingle().Subject;
        row.Attempts.Should().Be(2);
        row.LastError.Should().Be("P0001");
        LogsShouldHoldNoPersonalData();
    }

    [Fact]
    public async Task Offline_keeps_every_response_for_the_next_cycle()
    {
        await SaveAsync();
        await SaveAsync();
        _supabase.Setup(s => s.RecordGuestResponseAsync(It.IsAny<GuestResponseRecord>(), It.IsAny<CancellationToken>()))
                 .ThrowsAsync(new HttpRequestException($"Hôte injoignable ({Email})"));

        var summary = await NewService().SendPendingAsync();

        summary.Failed.Should().Be(1); // la première échoue : inutile d'essayer la suivante
        var rows = await RowsAsync();
        rows.Should().HaveCount(2);
        rows.Sum(r => r.Attempts).Should().Be(1);
        rows.Single(r => r.Attempts == 1).LastError.Should().Be(nameof(HttpRequestException));
        LogsShouldHoldNoPersonalData();

        RespondWith(GuestResponseSendResult.Ok); // retour du réseau
        (await NewService().SendPendingAsync()).Sent.Should().Be(2);
        (await RowsAsync()).Should().BeEmpty();
    }

    [Fact]
    public async Task Unreadable_row_is_deleted_without_retry()
    {
        using (var ctx = _db.NewContext())
        {
            ctx.GuestResponses.Add(new GuestResponseEntity
            {
                Id = Guid.NewGuid(), EventId = EventId, AnsweredAt = DateTime.UtcNow,
                PayloadProtected = [1, 2, 3, 4], SessionIds = "[]",
            });
            await ctx.SaveChangesAsync(TestContext.Current.CancellationToken);
        }

        var summary = await NewService().SendPendingAsync();

        summary.Unreadable.Should().Be(1);
        (await RowsAsync()).Should().BeEmpty();
        _supabase.Verify(s => s.RecordGuestResponseAsync(It.IsAny<GuestResponseRecord>(), It.IsAny<CancellationToken>()), Times.Never);
        _logged.Should().ContainSingle(l => l.Contains("1 réponse(s)") && l.Contains("illisible"));
    }

    // ── Purge locale ─────────────────────────────────────────────────

    [Fact]
    public async Task Responses_older_than_30_days_are_purged_even_offline()
    {
        await SaveAsync(Submission(answeredAt: DateTime.UtcNow.AddDays(-31)));
        var recent = await SaveAsync(Submission(answeredAt: DateTime.UtcNow.AddDays(-29)));

        (await NewService().PurgeExpiredAsync()).Should().Be(1);

        (await RowsAsync()).Should().ContainSingle().Which.Id.Should().Be(recent);
        _logged.Should().ContainSingle(l => l.Contains("1 réponse(s)"));
        LogsShouldHoldNoPersonalData();
    }

    [Fact]
    public async Task Sending_purges_expired_responses_first()
    {
        await SaveAsync(Submission(answeredAt: DateTime.UtcNow.AddDays(-31)));

        (await NewService().SendPendingAsync()).Sent.Should().Be(0);

        (await RowsAsync()).Should().BeEmpty();
        _sent.Should().BeEmpty();
    }
}
