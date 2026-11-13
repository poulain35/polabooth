namespace PolaKiosk.Services;

public interface IKioskLogService
{
    Task LogErrorAsync(string context, string message, string? stackTrace = null);
    Task LogWarningAsync(string context, string message);
    Task LogInfoAsync(string context, string message);

    /// <summary>Envoie les logs non synchronisés vers Supabase.</summary>
    Task UploadPendingAsync();
}
