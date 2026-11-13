namespace PolaKiosk.Models.Supabase;

/// <summary>
/// Fiche contact du loueur (RPC get_org_contact_by_event, ou bloc « contact » d'un fichier .pola),
/// lue par <c>SupabaseService.ParseOrgContact</c>.
/// </summary>
/// <param name="Company">Nom de la société (contact_company, sinon le nom de l'organisation). Peut être vide.</param>
/// <param name="Phone">Téléphone affiché sur l'écran de saisie du code, ou null.</param>
/// <param name="LogoUrl">
/// LAB-257 : URL publique du logo de la société (organizations.logo_url), ou null si la société n'en a pas.
/// Affiché sur l'accueil à la place de l'icône et du nom.
/// </param>
/// <param name="Email">
/// Email de contact de la société (contact_email), ou null. Contact par défaut du questionnaire (open core L7).
/// </param>
public sealed record OrgContact(string Company, string? Phone, string? LogoUrl, string? Email = null);
