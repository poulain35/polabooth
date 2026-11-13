using FluentAssertions;
using Moq;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>Envoi à l'imprimante : comptage à l'envoi, pas de double impression après le délai.</summary>
public class PrintServiceSendTests
{
    private static readonly Guid EventId = Guid.Parse("6f1d2c3b-1111-4222-8333-944455556666");
    private static readonly TimeSpan ShortTimeout = TimeSpan.FromMilliseconds(150);

    private readonly Mock<IPrintLogSyncService> _printLogs = new();

    [Fact]
    public async Task Print_after_timeout_is_counted_once_and_retry_is_refused_until_the_job_ends()
    {
        using var dir = new TempDir();
        using var db = new TestDb();
        var composite = CreateComposite(dir);
        var session = Guid.NewGuid();
        var gate = new PrintGate();
        var slowJob = new FakeJob(blocking: true);
        var prepared = 0;
        var print = new PrintService(db.NewContext(), _printLogs.Object, _ => { prepared++; return slowJob; }, ShortTimeout, gate);

        // 1er envoi : l'imprimante ne répond pas dans le délai, mais l'impression est comptée
        await FluentActions.Awaiting(() => print.PrintAsync(composite, "Imprimante", "portrait", session, EventId))
            .Should().ThrowAsync<TimeoutException>();
        (await print.GetSessionPrintCountAsync(session)).Should().Be(1);
        _printLogs.Verify(p => p.SendSoon(), Times.Once); // envoi tenté dès l'impression comptée

        // Nouvel essai pendant que le travail précédent est encore en cours : refusé, rien n'est envoyé
        await FluentActions.Awaiting(() => print.PrintAsync(composite, "Imprimante", "portrait", session, EventId))
            .Should().ThrowAsync<PrintBusyException>();
        prepared.Should().Be(1);
        slowJob.SendCount.Should().Be(1);
        _printLogs.Verify(p => p.SendSoon(), Times.Once);
        (await print.GetSessionPrintCountAsync(session)).Should().Be(1);

        // Le travail finit par sortir : la garde se libère, l'impression suivante passe
        slowJob.Release();
        await WaitUntilAsync(() => !gate.IsBusy);
        slowJob.Disposed.Should().BeTrue();

        var fastJob = new FakeJob(blocking: false);
        var next = new PrintService(db.NewContext(), _printLogs.Object, _ => fastJob, ShortTimeout, gate);
        await next.PrintAsync(composite, "Imprimante", "portrait", session, EventId);

        fastJob.SendCount.Should().Be(1);
        (await next.GetSessionPrintCountAsync(session)).Should().Be(2);
        _printLogs.Verify(p => p.SendSoon(), Times.Exactly(2));
        gate.IsBusy.Should().BeFalse();
    }

    [Fact]
    public async Task Invalid_printer_is_not_counted_and_frees_the_gate()
    {
        using var dir = new TempDir();
        using var db = new TestDb();
        var composite = CreateComposite(dir);
        var session = Guid.NewGuid();
        var gate = new PrintGate();
        var print = new PrintService(db.NewContext(), _printLogs.Object,
            _ => throw new InvalidOperationException("Imprimante introuvable"), ShortTimeout, gate);

        await FluentActions.Awaiting(() => print.PrintAsync(composite, "Absente", "portrait", session, EventId))
            .Should().ThrowAsync<InvalidOperationException>().WithMessage("Imprimante introuvable");

        (await print.GetSessionPrintCountAsync(session)).Should().Be(0);
        _printLogs.Verify(p => p.SendSoon(), Times.Never);
        gate.IsBusy.Should().BeFalse();
    }

    [Fact]
    public async Task Driver_error_is_reported_and_frees_the_gate()
    {
        using var dir = new TempDir();
        using var db = new TestDb();
        var composite = CreateComposite(dir);
        var gate = new PrintGate();
        var job = new FakeJob(blocking: false) { Failure = new InvalidOperationException("Erreur pilote") };
        var print = new PrintService(db.NewContext(), _printLogs.Object, _ => job, ShortTimeout, gate);

        await FluentActions.Awaiting(() => print.PrintAsync(composite, "Imprimante", "portrait", Guid.NewGuid(), EventId))
            .Should().ThrowAsync<InvalidOperationException>().WithMessage("Erreur pilote");

        await WaitUntilAsync(() => !gate.IsBusy);
        job.Disposed.Should().BeTrue();
    }

    [Fact]
    public async Task Missing_composite_is_refused_before_anything_is_sent()
    {
        using var db = new TestDb();
        var gate = new PrintGate();
        var job = new FakeJob(blocking: false);
        var print = new PrintService(db.NewContext(), _printLogs.Object, _ => job, ShortTimeout, gate);

        await FluentActions.Awaiting(() => print.PrintAsync("absent.jpg", "Imprimante", "portrait", Guid.NewGuid(), EventId))
            .Should().ThrowAsync<FileNotFoundException>();

        job.SendCount.Should().Be(0);
        _printLogs.Verify(p => p.SendSoon(), Times.Never);
        gate.IsBusy.Should().BeFalse();
    }

    private static string CreateComposite(TempDir dir)
    {
        var path = dir.File("composite.jpg");
        File.WriteAllBytes(path, [0xFF, 0xD8, 0xFF]);
        return path;
    }

    private static async Task WaitUntilAsync(Func<bool> condition)
    {
        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (!condition() && DateTime.UtcNow < deadline)
            await Task.Delay(10, TestContext.Current.CancellationToken);
        condition().Should().BeTrue();
    }

    private sealed class FakeJob(bool blocking) : IPrintJob
    {
        private readonly ManualResetEventSlim _released = new(!blocking);
        private int _sendCount;

        public Exception? Failure { get; init; }
        public int SendCount => Volatile.Read(ref _sendCount);
        public bool Disposed { get; private set; }

        public void Send()
        {
            Interlocked.Increment(ref _sendCount);
            _released.Wait(TimeSpan.FromSeconds(10));
            if (Failure != null) throw Failure;
        }

        public void Release() => _released.Set();

        public void Dispose() => Disposed = true;
    }
}
