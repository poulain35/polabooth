using System.Drawing;
using System.Drawing.Printing;
using System.IO;
using System.Printing;
using Microsoft.EntityFrameworkCore;
using PolaKiosk.Models.LocalDb;

namespace PolaKiosk.Services;

public class PrintService : IPrintService
{
    internal static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(45);

    // PrintService est transient : la garde vaut pour tout le processus.
    private static readonly PrintGate SharedGate = new();

    private readonly AppDbContext _db;
    private readonly Func<PrintRequest, IPrintJob> _prepare;
    private readonly TimeSpan _timeout;
    private readonly PrintGate _gate;
    private readonly IPrintLogSyncService _printLogs;

    public PrintService(AppDbContext db, IPrintLogSyncService printLogs)
        : this(db, printLogs, PrepareSystemPrint, DefaultTimeout, SharedGate) { }

    internal PrintService(AppDbContext db, IPrintLogSyncService printLogs, Func<PrintRequest, IPrintJob> prepare,
        TimeSpan timeout, PrintGate gate)
    {
        _db = db;
        _printLogs = printLogs;
        _prepare = prepare;
        _timeout = timeout;
        _gate = gate;
    }

    public async Task PrintAsync(
        string compositePath,
        string printerName,
        string paperFormat,
        Guid sessionId,
        Guid eventId,
        int copies = 1,
        string? compositeUrl = null,
        string? machineId = null)
    {
        // Vérification de l'image avant d'envoyer à l'imprimante
        if (!File.Exists(compositePath))
            throw new FileNotFoundException("Fichier composite introuvable.", compositePath);

        // Un travail précédent jugé perdu après le délai peut encore sortir : pas de nouvel envoi
        // tant qu'il n'est pas terminé, sinon la photo serait imprimée deux fois.
        if (!_gate.TryEnter())
            throw new PrintBusyException();

        Task job;
        try
        {
            // Imprimante invalide ou format introuvable : erreur levée ici, rien n'est compté.
            var prepared = await Task.Run(() => _prepare(new PrintRequest(compositePath, printerName, paperFormat, copies)));
            try
            {
                // Compté à l'envoi, avant d'attendre l'imprimante : une impression qui sort après
                // le délai est bien décomptée.
                await RecordPrintAsync(sessionId, eventId, copies, compositeUrl, machineId);
            }
            catch
            {
                prepared.Dispose();
                throw;
            }

            // Envoi à Supabase sans attendre la boucle de 2 minutes, en arrière-plan (ne lève pas).
            _printLogs.SendSoon();

            // La garde se libère à la fin réelle du travail, avant que l'appelant n'en soit informé.
            job = Task.Run(() =>
            {
                try
                {
                    using (prepared) prepared.Send();
                }
                finally { _gate.Exit(); }
            });
        }
        catch
        {
            _gate.Exit();
            throw;
        }

        // Filet de sécurité : une imprimante bloquée (bourrage, hors ligne) ne doit pas figer le
        // kiosk. Au-delà du délai, on rend la main ; la garde reste fermée jusqu'à la fin du travail.
        var completed = await Task.WhenAny(job, Task.Delay(_timeout));
        if (completed != job)
            throw new TimeoutException(
                "L'imprimante ne répond pas. Vérifiez le papier et la connexion.");

        await job; // propage les erreurs du pilote
    }

    public async Task<int> GetSessionPrintCountAsync(Guid sessionId)
    {
        var entry = await _db.PrintCounts.FindAsync(sessionId);
        return entry?.Count ?? 0;
    }

    // Le journal d'impressions porte l'EventId de chaque impression : il compte aussi les photos
    // rouvertes depuis la galerie, quelle que soit leur séance.
    public async Task<int> GetEventPrintCountAsync(Guid eventId)
        => await _db.PrintLogs
            .Where(l => l.EventId == eventId)
            .SumAsync(l => l.Copies);

    public async Task<int?> GetRemainingPrintsAsync(
        Guid eventId,
        int? maxPrintsPerEvent,
        Guid sessionId,
        int? maxPrintsPerPhoto)
    {
        int? remaining = null;

        if (maxPrintsPerEvent.HasValue)
            remaining = maxPrintsPerEvent.Value - await GetEventPrintCountAsync(eventId);

        if (maxPrintsPerPhoto.HasValue)
        {
            var photoRemaining = maxPrintsPerPhoto.Value - await GetSessionPrintCountAsync(sessionId);
            remaining = remaining.HasValue ? Math.Min(remaining.Value, photoRemaining) : photoRemaining;
        }

        return remaining.HasValue ? Math.Max(0, remaining.Value) : null;
    }

    public async Task<bool> CanPrintAsync(
        Guid eventId,
        int? maxPrintsPerEvent,
        Guid sessionId,
        int? maxPrintsPerPhoto)
        => await GetRemainingPrintsAsync(eventId, maxPrintsPerEvent, sessionId, maxPrintsPerPhoto) is not 0;

    public List<string> GetAvailablePrinters()
    {
        var printers = new List<string>();
        foreach (string printer in PrinterSettings.InstalledPrinters)
            printers.Add(printer);
        return printers;
    }

    public string GetDefaultPrinterName()
    {
        try { return new PrinterSettings().PrinterName ?? ""; }
        catch { return ""; }
    }

    public string GetPrinterStatus(string? printerName) => ReadPrinterStatus(printerName);

    /// <summary>
    /// Lit l'état matériel de l'imprimante (sans lancer d'impression), pour le heartbeat
    /// et le monitoring SaaS. Valeurs : ready | offline | paper_out | paper_jam | error
    /// | not_found | unknown. Ne lève jamais — toute erreur devient un statut.
    /// </summary>
    public static string ReadPrinterStatus(string? printerName)
    {
        try
        {
            using var server = new LocalPrintServer();
            using var queue  = string.IsNullOrWhiteSpace(printerName)
                ? server.DefaultPrintQueue
                : server.GetPrintQueue(printerName);

            if (queue == null) return "not_found";
            queue.Refresh();

            return ClassifyPrinterStatus(
                queue.IsOffline, queue.IsNotAvailable, queue.IsPaperJammed, queue.IsOutOfPaper, queue.IsInError);
        }
        catch (PrintQueueException)
        {
            // Imprimante introuvable / nom invalide
            return "not_found";
        }
        catch
        {
            return "unknown";
        }
    }

    /// <summary>Mappe les drapeaux d'état d'une file d'impression vers un statut normalisé (logique pure, testable).</summary>
    internal static string ClassifyPrinterStatus(bool offline, bool notAvailable, bool jam, bool outOfPaper, bool error)
    {
        if (offline || notAvailable) return "offline";
        if (jam)                     return "paper_jam";
        if (outOfPaper)              return "paper_out";
        if (error)                   return "error";
        return "ready";
    }

    /// <summary>Compteur par séance + journal d'impression (porte l'EventId), écrits ensemble.</summary>
    internal async Task RecordPrintAsync(
        Guid sessionId, Guid eventId, int copies, string? compositeUrl = null, string? machineId = null)
    {
        var entry = await _db.PrintCounts.FindAsync(sessionId);
        if (entry == null)
            _db.PrintCounts.Add(new PrintCountEntity { SessionId = sessionId, Count = copies });
        else
            entry.Count += copies;

        _db.PrintLogs.Add(new PrintLogEntity
        {
            EventId      = eventId,
            SessionId    = sessionId,
            CompositeUrl = compositeUrl,
            Copies       = copies,
            MachineId    = machineId,
            PrintedAt    = DateTime.UtcNow,
            Synced       = false,
        });

        await _db.SaveChangesAsync();
    }

    /// <summary>Déduit le format papier (4x6 ou 2x6) depuis le format du template.</summary>
    public static string PaperFormatFromTemplateFormat(string templateFormat) => templateFormat switch
    {
        "stripV" or "stripH" => "2x6",
        _                    => "4x6",  // portrait, landscape
    };

    private static IPrintJob PrepareSystemPrint(PrintRequest request)
    {
        var pd = new PrintDocument();
        try
        {
            // Si aucune imprimante configurée, utiliser celle par défaut du système
            if (!string.IsNullOrWhiteSpace(request.PrinterName))
                pd.PrinterSettings.PrinterName = request.PrinterName;

            if (!pd.PrinterSettings.IsValid)
                throw new InvalidOperationException(
                    $"Imprimante \"{pd.PrinterSettings.PrinterName}\" introuvable ou non disponible. " +
                    "Vérifiez qu'une imprimante est branchée et configurée dans les paramètres.");

            // Sélection du format papier selon la config
            var paperSize = GetPaperSize(pd, request.PaperFormat);
            if (paperSize != null)
                pd.DefaultPageSettings.PaperSize = paperSize;

            // Marges à zéro pour impression bord à bord
            pd.DefaultPageSettings.Margins = new Margins(0, 0, 0, 0);

            if (request.Copies > 1)
                pd.PrinterSettings.Copies = (short)Math.Min(request.Copies, 99);

            pd.PrintPage += (_, e) =>
            {
                if (e.Graphics == null) return;
                using var image = Image.FromFile(request.CompositePath);

                // Remplissage « cover » : on préserve le ratio de l'image (plus d'étirement),
                // on remplit la page et on rogne/centre le débordement. Pour un composite au
                // format du papier (cas normal avec template) → ajustement exact, aucun rognage.
                var pb = e.PageBounds;
                double scale = Math.Max((double)pb.Width / image.Width, (double)pb.Height / image.Height);
                int w = (int)Math.Round(image.Width  * scale);
                int h = (int)Math.Round(image.Height * scale);
                int x = pb.X + (pb.Width  - w) / 2;
                int y = pb.Y + (pb.Height - h) / 2;

                e.Graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                e.Graphics.SetClip(pb);
                e.Graphics.DrawImage(image, new Rectangle(x, y, w, h));
            };

            return new SystemPrintJob(pd);
        }
        catch
        {
            pd.Dispose();
            throw;
        }
    }

    private sealed class SystemPrintJob(PrintDocument document) : IPrintJob
    {
        public void Send() => document.Print();
        public void Dispose() => document.Dispose();
    }

    private static PaperSize? GetPaperSize(PrintDocument pd, string format)
    {
        // Noms courants dans les drivers DNP DS620 / RX1-HS
        var targetNames = format switch
        {
            "4x6"  => new[] { "4 x 6", "4x6", "10x15", "4\" x 6\"" },
            "2x6"  => new[] { "2 x 6", "2x6", "2\" x 6\"", "5x15" },
            _      => new[] { format }
        };

        foreach (PaperSize ps in pd.PrinterSettings.PaperSizes)
        {
            foreach (var name in targetNames)
            {
                if (ps.PaperName.Contains(name, StringComparison.OrdinalIgnoreCase))
                    return ps;
            }
        }

        // Fallback : taille personnalisée en centièmes de pouce
        // 4x6" = 400x600 ; 2x6" = 200x600
        return format switch
        {
            "4x6" => new PaperSize("4x6", 400, 600),
            "2x6" => new PaperSize("2x6", 200, 600),
            _     => null
        };
    }
}

internal record PrintRequest(string CompositePath, string PrinterName, string PaperFormat, int Copies);

/// <summary>Travail d'impression prêt à partir (imprimante et papier déjà vérifiés).</summary>
internal interface IPrintJob : IDisposable
{
    void Send();
}

/// <summary>Un seul travail d'impression à la fois, jusqu'à sa fin réelle (même après le délai d'attente).</summary>
internal sealed class PrintGate
{
    private int _busy;

    public bool IsBusy => Volatile.Read(ref _busy) == 1;
    public bool TryEnter() => Interlocked.CompareExchange(ref _busy, 1, 0) == 0;
    public void Exit() => Volatile.Write(ref _busy, 0);
}

/// <summary>Impression refusée : le travail précédent n'est pas encore terminé.</summary>
public class PrintBusyException()
    : InvalidOperationException("Une impression est encore en cours. Patientez quelques instants.");
