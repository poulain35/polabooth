namespace PolaKiosk.Services;

/// <summary>
/// Le serveur refuse la licence de la borne (erreur 42501 de kiosk_get_event : borne retirée, désactivée
/// ou secret inconnu). L'écran courant renvoie à l'association.
/// </summary>
public sealed class KioskLicenseRefusedException : Exception
{
    public KioskLicenseRefusedException() : base("Licence de la borne refusée par le serveur.") { }
}
