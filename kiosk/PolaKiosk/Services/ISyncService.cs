namespace PolaKiosk.Services;

public interface ISyncService
{
    /// <summary>Télécharge l'événement + son design approuvé depuis Supabase et les stocke en SQLite.</summary>
    Task<bool> SyncAsync(Guid eventId, CancellationToken ct = default);

    /// <summary>
    /// Importe un fichier .pola (JSON GZip, format 2) comme la synchro en ligne, puis le garde dans
    /// DataDirectory\pola pour la saisie du code sans réseau, et dans l'historique de l'Admin
    /// (<see cref="IPolaHistory"/>, LAB-321). Un fichier sans design approuvé, d'un
    /// ancien format ou illisible lève <see cref="System.IO.InvalidDataException"/> (message affichable)
    /// sans rien enregistrer. Rend l'événement enregistré.
    /// </summary>
    Task<Models.LocalDb.EventEntity> ImportPolaFileAsync(string polaFilePath);

    /// <summary>Retourne l'événement actuellement chargé (depuis SQLite).</summary>
    Task<Models.LocalDb.EventEntity?> GetCurrentEventAsync(Guid eventId);

    /// <summary>
    /// Cadres validés de l'événement (depuis SQLite), dans l'ordre : design principal, puis les
    /// autres cadres proposés à l'invité (LAB-315). Vide sans design approuvé.
    /// </summary>
    Task<List<Models.LocalDb.TemplateEntity>> GetTemplatesAsync(Guid eventId);

    /// <summary>
    /// Chemin local du fond d'accueil de l'événement (home.background_url), rempli pendant la
    /// synchronisation ou l'import .pola. Le fichier peut ne pas exister.
    /// </summary>
    string GetHomeBackgroundPath(Guid eventId, string backgroundUrl);

    /// <summary>
    /// LAB-257 : chemin local du logo de la société (organizations.logo_url), rempli pendant la
    /// synchronisation ou l'import .pola et gardé hors ligne. Null si la société n'a pas de logo
    /// ou s'il n'a jamais pu être téléchargé.
    /// </summary>
    string? GetOrgLogoPath();

    /// <summary>
    /// LAB-291 : chemin local de l'écran d'accueil créé par le client et validé (PNG 1920×1080), rempli
    /// pendant la synchronisation ou l'import .pola et gardé hors ligne. Null s'il n'y en a pas, si
    /// l'option est coupée ou s'il n'a jamais pu être téléchargé.
    /// </summary>
    string? GetHomeDesignPath();

    /// <summary>
    /// LAB-297 : écran composé par l'admin en cache (<see cref="ScreenLayout.KindHome"/> ou
    /// <see cref="ScreenLayout.KindResult"/>), rempli pendant la synchronisation ou l'import .pola.
    /// Null si rien n'est publié, ou si le cache est absent, incomplet ou illisible : écran standard.
    /// </summary>
    CachedScreen? GetScreen(string kind);

    /// <summary>Télécharge la config de l'écran de saisie depuis Supabase Storage.</summary>
    Task SyncSetupConfigAsync(CancellationToken ct = default);

    /// <summary>Chemin local du fichier JSON de config de l'écran de saisie.</summary>
    string GetSetupConfigPath();

    /// <summary>
    /// Image de fond de l'écran de saisie en cache (téléchargée par <see cref="SyncSetupConfigAsync"/>),
    /// ou null si la config n'en demande pas ou si elle n'est pas encore téléchargée.
    /// </summary>
    string? GetSetupBackgroundPath();

    /// <summary>
    /// Cherche et charge un event par son code d'accès.
    /// Essaie Supabase en premier, puis les fichiers .pola locaux si le réseau ne répond pas.
    /// Une réponse 4xx/5xx de Supabase lève une exception (pas de repli .pola).
    /// Retourne l'event chargé ou null si introuvable.
    /// </summary>
    Task<Models.LocalDb.EventEntity?> SyncByCodeAsync(string accessCode, CancellationToken ct = default);

    /// <summary>
    /// LAB-245 : enregistre un événement envoyé depuis le SaaS (lu par kiosk_get_event_request) comme
    /// <see cref="SyncByCodeAsync"/> : événement, compte, fond d'accueil, design approuvé, contact.
    /// Sans repli .pola : une erreur réseau ou serveur lève une exception.
    /// </summary>
    Task<Models.LocalDb.EventEntity?> SyncPushedEventAsync(Models.Supabase.EventDto dto, CancellationToken ct = default);
}
