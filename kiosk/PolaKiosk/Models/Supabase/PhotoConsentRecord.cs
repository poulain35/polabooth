namespace PolaKiosk.Models.Supabase;

/// <summary>Arguments de la RPC kiosk_record_photo_consent, hors identité du poste.</summary>
public sealed record PhotoConsentRecord(
    Guid Id,
    Guid EventId,
    string AccessCode,
    Guid SessionId,
    DateTime ConsentedAtUtc,
    string ConsentText);

/// <summary>Résultat de la RPC : accepté, ou refusé avec un code (jamais le message du serveur).</summary>
public sealed record PhotoConsentSendResult(bool Accepted, string? ErrorCode)
{
    /// <summary>Données refusées par le serveur : erreur définitive.</summary>
    public const string InvalidDataCode = "22023";

    public static readonly PhotoConsentSendResult Ok = new(true, null);

    public static PhotoConsentSendResult Rejected(string code) => new(false, code);
}
