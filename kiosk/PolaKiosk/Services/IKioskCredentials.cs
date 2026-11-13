namespace PolaKiosk.Services;

/// <summary>Identité du poste auprès de Supabase : identifiant machine + secret de licence.</summary>
public interface IKioskCredentials
{
    string MachineId { get; }

    /// <summary>
    /// Secret reçu à l'association de la borne (LAB-244), sinon le secret de développement
    /// (<c>Kiosk.LicenseSecret</c>, build Debug en Development seulement). Vide si aucun.
    /// </summary>
    string Secret { get; }

    /// <summary>Enregistre le secret reçu à l'association, protégé par DPAPI (activation.bin). Jamais journalisé.</summary>
    void SetSecret(string secret);
}
