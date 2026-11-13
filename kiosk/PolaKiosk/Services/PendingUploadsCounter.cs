using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PolaKiosk.Models.LocalDb;

namespace PolaKiosk.Services;

/// <summary>
/// Nombre d'envois encore en attente sur la borne, transmis par le battement de cœur
/// (<c>p_pending_uploads</c>, LAB-231) : le bilan d'un événement n'est envoyé qu'une fois la borne vide.
/// </summary>
public interface IPendingUploadsCounter
{
    /// <summary>Total des files locales, ou <c>null</c> si la base est illisible (inconnu, jamais 0).</summary>
    Task<int?> CountAsync();
}

public sealed class PendingUploadsCounter : IPendingUploadsCounter
{
    private readonly IServiceScopeFactory _scopes;

    public PendingUploadsCounter(IServiceScopeFactory scopes) => _scopes = scopes;

    public async Task<int?> CountAsync()
    {
        try
        {
            using var scope = _scopes.CreateScope();
            return await CountAsync(scope.ServiceProvider.GetRequiredService<AppDbContext>());
        }
        catch { return null; }
    }

    /// <summary>
    /// Séances à envoyer (montage présent sur le disque), impressions non envoyées, réponses au
    /// questionnaire et consentements photo en file (lignes supprimées une fois reçues).
    /// </summary>
    internal static async Task<int> CountAsync(AppDbContext db)
    {
        var sessions  = (await SessionService.LoadPendingIdsAsync(db)).Count;
        var prints    = await db.PrintLogs.CountAsync(l => !l.Synced);
        var responses = await db.GuestResponses.CountAsync();
        var consents  = await db.PhotoConsents.CountAsync();
        return sessions + prints + responses + consents;
    }
}
