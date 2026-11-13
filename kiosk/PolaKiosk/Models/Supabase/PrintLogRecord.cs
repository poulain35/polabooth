namespace PolaKiosk.Models.Supabase;

/// <summary>Arguments de la RPC kiosk_record_print, hors identité du poste.</summary>
public sealed record PrintLogRecord(
    Guid Id,
    Guid EventId,
    string AccessCode,
    Guid SessionId,
    int Copies,
    DateTime PrintedAtUtc);

/// <summary>Résultat de la RPC : accepté (<c>true</c>, y compris un doublon), ou refusé avec un code.</summary>
public sealed record PrintLogSendResult(bool Accepted, string? ErrorCode)
{
    /// <summary>Réponse 2xx dont le corps n'est pas <c>true</c>.</summary>
    public const string UnexpectedBodyCode = "non-true";

    /// <summary>
    /// Refus définitif de la RPC (impression invalide, événement inexistant, id déjà pris par un autre
    /// événement) : un nouvel essai échouerait de même, la ligne sort de la file.
    /// </summary>
    public const string InvalidDataCode = "22023";

    public static readonly PrintLogSendResult Ok = new(true, null);

    public static PrintLogSendResult Rejected(string code) => new(false, code);
}
