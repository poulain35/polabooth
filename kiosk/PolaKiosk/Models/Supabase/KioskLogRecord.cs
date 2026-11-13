namespace PolaKiosk.Models.Supabase;

/// <summary>Un élément de <c>p_logs</c> de la RPC kiosk_record_logs (le poste est donné à part).</summary>
public sealed record KioskLogRecord(
    Guid Id,
    string Level,
    string? Context,
    string Message,
    string? StackTrace,
    string? AppVersion,
    DateTime OccurredAtUtc);

/// <summary>Résultat de la RPC : lot accepté (2xx, doublons compris), ou refusé avec un code.</summary>
public sealed record KioskLogSendResult(bool Accepted, string? ErrorCode)
{
    /// <summary>Licence refusée (secret faux, licence inactive ou retirée).</summary>
    public const string LicenseRefusedCode = "42501";

    /// <summary>Limite de débit dépassée (600 lignes / 15 min par borne).</summary>
    public const string RateLimitedCode = "PT429";

    public static readonly KioskLogSendResult Ok = new(true, null);

    public static KioskLogSendResult Rejected(string code) => new(false, code);
}
