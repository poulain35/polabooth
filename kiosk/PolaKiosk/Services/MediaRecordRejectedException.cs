namespace PolaKiosk.Services;

/// <summary>
/// Refus définitif de kiosk_record_photo (code 22023 : chemin, affiche, durée ou dimensions invalides) :
/// un renvoi recevrait le même refus. La séance sort de la file d'envoi et ses fichiers restent sur la
/// borne (même règle que les impressions, LAB-230). Licence ou événement refusés : autre erreur, renvoi.
/// </summary>
public sealed class MediaRecordRejectedException : Exception
{
    /// <summary>Code PostgREST des données refusées.</summary>
    public const string InvalidDataCode = "22023";

    public MediaRecordRejectedException(string code)
        : base($"Envoi refusé par le serveur (code {code}) : la séance ne sera pas renvoyée.") => Code = code;

    public string Code { get; }
}
