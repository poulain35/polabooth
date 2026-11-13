using Newtonsoft.Json.Linq;

namespace PolaKiosk.Models.Supabase;

/// <summary>Arguments de la RPC kiosk_record_guest_response, hors identité du poste.</summary>
public sealed record GuestResponseRecord(
    Guid Id,
    Guid EventId,
    string AccessCode,
    DateTime AnsweredAtUtc,
    JObject Answers,
    JArray Questions,
    bool MarketingConsent,
    string? ConsentText,
    string? NoticeHash,
    IReadOnlyList<Guid> SessionIds);

/// <summary>Résultat de la RPC : acceptée, ou refusée avec un code (jamais le message du serveur).</summary>
public sealed record GuestResponseSendResult(bool Accepted, string? ErrorCode)
{
    /// <summary>Données refusées par le serveur : erreur définitive.</summary>
    public const string InvalidDataCode = "22023";

    public static readonly GuestResponseSendResult Ok = new(true, null);

    public static GuestResponseSendResult Rejected(string code) => new(false, code);
}
