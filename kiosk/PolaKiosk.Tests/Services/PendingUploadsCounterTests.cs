using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>LAB-231 : envois en attente annoncés par le battement de cœur (p_pending_uploads).</summary>
public sealed class PendingUploadsCounterTests : IDisposable
{
    private static readonly Guid EventId = Guid.NewGuid();
    private readonly TestDb _db = new();
    private readonly TempDir _dir = new();

    public void Dispose()
    {
        _db.Dispose();
        _dir.Dispose();
    }

    private string NewComposite()
    {
        var path = _dir.File(Guid.NewGuid() + ".jpg");
        File.WriteAllBytes(path, [0xFF, 0xD8, 0xFF, 0xD9]);
        return path;
    }

    private static SessionEntity Session(string? composite, bool uploaded = false) => new()
    {
        Id = Guid.NewGuid(), EventId = EventId, CapturedAt = DateTime.UtcNow,
        PhotoPath = "photo.jpg", CompositePath = composite, Uploaded = uploaded,
    };

    [Fact]
    public async Task Empty_kiosk_reports_zero()
    {
        using var ctx = _db.NewContext();

        (await PendingUploadsCounter.CountAsync(ctx)).Should().Be(0);
    }

    [Fact]
    public async Task Counts_unsent_sessions_prints_responses_and_consents()
    {
        using (var ctx = _db.NewContext())
        {
            ctx.Sessions.AddRange(
                Session(NewComposite()),                 // à envoyer
                Session(NewComposite()),                 // à envoyer
                Session(NewComposite(), uploaded: true), // déjà envoyée
                Session(_dir.File("disparu.jpg")),       // montage effacé : jamais envoyable
                Session(null));                          // montage pas encore fait
            ctx.PrintLogs.AddRange(
                new PrintLogEntity { EventId = EventId, SessionId = Guid.NewGuid() },
                new PrintLogEntity { EventId = EventId, SessionId = Guid.NewGuid(), Synced = true });
            ctx.GuestResponses.Add(new GuestResponseEntity { Id = Guid.NewGuid(), EventId = EventId });
            ctx.PhotoConsents.AddRange(
                new PhotoConsentEntity { Id = Guid.NewGuid(), EventId = EventId, SessionId = Guid.NewGuid() },
                new PhotoConsentEntity { Id = Guid.NewGuid(), EventId = EventId, SessionId = Guid.NewGuid() });
            await ctx.SaveChangesAsync(TestContext.Current.CancellationToken);
        }

        using var read = _db.NewContext();
        (await PendingUploadsCounter.CountAsync(read)).Should().Be(2 + 1 + 1 + 2);
    }

    [Fact]
    public async Task Readable_database_is_counted_through_a_scope()
    {
        using (var ctx = _db.NewContext())
        {
            ctx.Sessions.Add(Session(NewComposite()));
            await ctx.SaveChangesAsync(TestContext.Current.CancellationToken);
        }
        using var services = new ServiceCollection().AddScoped(_ => _db.NewContext()).BuildServiceProvider();

        (await new PendingUploadsCounter(services.GetRequiredService<IServiceScopeFactory>()).CountAsync())
            .Should().Be(1);
    }

    [Fact]
    public async Task Unreadable_database_reports_unknown_not_zero()
    {
        _db.Dispose(); // connexion fermée : base illisible
        using var services = new ServiceCollection().AddScoped(_ => _db.NewContext()).BuildServiceProvider();

        (await new PendingUploadsCounter(services.GetRequiredService<IServiceScopeFactory>()).CountAsync())
            .Should().BeNull();
    }
}
