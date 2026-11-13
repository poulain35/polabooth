using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Models.Supabase;

namespace PolaKiosk.Services;

public sealed class GuestResponseService : IGuestResponseService
{
    internal const string Purpose    = "PolaKiosk.GuestResponse";
    internal const string LogContext = "guest_responses";
    internal static readonly TimeSpan Retention = TimeSpan.FromDays(30);

    // Une réponse qui ressemble à une date (« 2026-11-04 ») doit rester une chaîne.
    private static readonly JsonSerializerSettings JsonSettings = new() { DateParseHandling = DateParseHandling.None };

    // Boucle de 2 minutes et retour du réseau peuvent se croiser : une ligne n'est envoyée et
    // supprimée que par un seul passage (le service est transitoire, d'où le verrou statique).
    private static readonly SemaphoreSlim SendGate = new(1, 1);

    private readonly AppDbContext _db;
    private readonly ISupabaseService _supabase;
    private readonly IKioskLogService _log;

    public GuestResponseService(AppDbContext db, ISupabaseService supabase, IKioskLogService log)
    {
        _db       = db;
        _supabase = supabase;
        _log      = log;
    }

    public void Stage(AppDbContext db, GuestSubmission submission) => db.GuestResponses.Add(CreateEntity(submission));

    public async Task SaveAsync(GuestSubmission submission)
    {
        _db.GuestResponses.Add(CreateEntity(submission));
        await _db.SaveChangesAsync();
    }

    public async Task<int> PurgeExpiredAsync()
    {
        var cutoff = DateTime.UtcNow - Retention;
        var purged = await _db.GuestResponses.Where(r => r.AnsweredAt < cutoff).ExecuteDeleteAsync();
        if (purged > 0)
            await _log.LogInfoAsync(LogContext,
                $"{purged} réponse(s) au questionnaire non envoyée(s) en 30 jours supprimée(s) de la borne.");
        return purged;
    }

    public async Task<GuestResponseSendSummary> SendPendingAsync()
    {
        if (!await SendGate.WaitAsync(0)) return new GuestResponseSendSummary(0, 0, 0, 0);
        try
        {
            await PurgeExpiredAsync();

            int sent = 0, rejected = 0, unreadable = 0, failed = 0;
            var codes = new SortedSet<string>(StringComparer.Ordinal);
            var rows = await _db.GuestResponses.OrderBy(r => r.AnsweredAt).ToListAsync();
            foreach (var row in rows)
            {
                var record = TryRead(row);
                if (record == null)
                {
                    // DPAPI échoue (autre compte Windows, ligne abîmée) : aucun nouvel essai possible.
                    _db.GuestResponses.Remove(row);
                    await _db.SaveChangesAsync();
                    unreadable++;
                    continue;
                }

                GuestResponseSendResult result;
                try { result = await _supabase.RecordGuestResponseAsync(record); }
                catch (Exception ex)
                {
                    // Réseau coupé ou trop lent : les suivantes échoueraient de même.
                    row.Attempts++;
                    row.LastError = ex.GetType().Name;
                    await _db.SaveChangesAsync();
                    codes.Add(row.LastError);
                    failed++;
                    break;
                }

                if (result.Accepted)
                {
                    _db.GuestResponses.Remove(row);
                    sent++;
                }
                else if (result.ErrorCode == GuestResponseSendResult.InvalidDataCode)
                {
                    _db.GuestResponses.Remove(row);
                    rejected++;
                }
                else
                {
                    // Licence ou événement refusés, erreur serveur : nouvel essai au cycle suivant.
                    row.Attempts++;
                    row.LastError = result.ErrorCode;
                    codes.Add(result.ErrorCode ?? "inconnu");
                    failed++;
                }
                await _db.SaveChangesAsync();
            }

            // Des nombres et des codes seulement : jamais d'e-mail, de téléphone ni de réponse.
            if (sent > 0)
                await _log.LogInfoAsync(LogContext, $"{sent} réponse(s) au questionnaire envoyée(s).");
            if (rejected > 0)
                await _log.LogWarningAsync(LogContext,
                    $"{rejected} réponse(s) au questionnaire refusée(s) par le serveur (code {GuestResponseSendResult.InvalidDataCode}) : supprimée(s) de la borne.");
            if (unreadable > 0)
                await _log.LogWarningAsync(LogContext,
                    $"{unreadable} réponse(s) au questionnaire illisible(s) sur ce poste : supprimée(s) de la borne.");
            if (failed > 0)
                await _log.LogWarningAsync(LogContext,
                    $"{failed} réponse(s) au questionnaire non envoyée(s) (code : {string.Join(", ", codes)}) : nouvel essai au prochain cycle.");

            return new GuestResponseSendSummary(sent, rejected, unreadable, failed);
        }
        finally { SendGate.Release(); }
    }

    internal static GuestResponseEntity CreateEntity(GuestSubmission s)
    {
        var payload = new GuestResponsePayload
        {
            AccessCode  = s.AccessCode,
            Answers     = BuildAnswers(s.Answers),
            Questions   = BuildQuestions(s.Questions),
            ConsentText = s.MarketingConsentText,
            NoticeHash  = HashNotice(s.Notice),
        };
        var json = JsonConvert.SerializeObject(payload, JsonSettings);
        return new GuestResponseEntity
        {
            Id               = Guid.NewGuid(),
            EventId          = s.EventId,
            PayloadProtected = Dpapi.Protect(Encoding.UTF8.GetBytes(json), Purpose),
            MarketingConsent = s.MarketingConsent,
            AnsweredAt       = s.AnsweredAt.ToUniversalTime(),
            SessionIds       = JsonConvert.SerializeObject(new[] { s.SessionId }),
        };
    }

    /// <summary>Contenu déchiffré prêt pour la RPC, ou null si la ligne est illisible.</summary>
    internal static GuestResponseRecord? TryRead(GuestResponseEntity row)
    {
        try
        {
            var json    = Encoding.UTF8.GetString(Dpapi.Unprotect(row.PayloadProtected, Purpose));
            var payload = JsonConvert.DeserializeObject<GuestResponsePayload>(json, JsonSettings);
            var ids     = JsonConvert.DeserializeObject<List<Guid>>(row.SessionIds, JsonSettings);
            if (payload == null || ids == null || string.IsNullOrWhiteSpace(payload.AccessCode)) return null;

            return new GuestResponseRecord(
                Id:               row.Id,
                EventId:          row.EventId,
                AccessCode:       payload.AccessCode,
                AnsweredAtUtc:    DateTime.SpecifyKind(row.AnsweredAt, DateTimeKind.Utc),
                Answers:          payload.Answers ?? new JObject(),
                Questions:        payload.Questions ?? new JArray(),
                MarketingConsent: row.MarketingConsent,
                ConsentText:      payload.ConsentText,
                NoticeHash:       payload.NoticeHash,
                SessionIds:       ids);
        }
        catch (Exception ex) when (ex is CryptographicException or JsonException or ArgumentException or FormatException)
        {
            return null;
        }
    }

    /// <summary>Réponses données seulement : une question laissée vide n'est pas envoyée.</summary>
    internal static JObject BuildAnswers(IReadOnlyDictionary<string, object?> answers)
    {
        var result = new JObject();
        foreach (var (id, value) in answers)
            if (value != null) result[id] = JToken.FromObject(value);
        return result;
    }

    /// <summary>Questions telles qu'affichées (questions_snapshot) : id, libellé, type.</summary>
    internal static JArray BuildQuestions(IEnumerable<QuestionConfig> questions)
        => new(questions.Select(q => new JObject { ["id"] = q.Id, ["label"] = q.Label, ["type"] = q.Type }));

    /// <summary>SHA-256 (hex) de la mention d'information affichée : preuve de ce que l'invité a lu.</summary>
    internal static string? HashNotice(string? notice)
        => string.IsNullOrEmpty(notice) ? null : Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(notice)));

    private sealed class GuestResponsePayload
    {
        [JsonProperty("access_code")]        public string AccessCode { get; set; } = "";
        [JsonProperty("answers")]            public JObject? Answers { get; set; }
        [JsonProperty("questions_snapshot")] public JArray? Questions { get; set; }
        [JsonProperty("consent_text")]       public string? ConsentText { get; set; }
        [JsonProperty("notice_hash")]        public string? NoticeHash { get; set; }
    }
}
