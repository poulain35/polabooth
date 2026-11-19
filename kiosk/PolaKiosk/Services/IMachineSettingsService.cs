using System.Text.Json.Serialization;
using PolaKiosk.Models;

namespace PolaKiosk.Services;

/// <summary>
/// Réglages propres à la machine (imprimante choisie…), persistés dans le DataDirectory,
/// indépendamment des appsettings du build. Configurés depuis l'écran admin et conservés
/// entre les mises à jour.
/// </summary>
public interface IMachineSettingsService
{
    MachineSettings Current { get; }

    /// <summary>Nom de l'imprimante à utiliser, ou null/"" pour suivre l'imprimante par défaut de Windows.</summary>
    void SetPrinterName(string? printerName);

    /// <summary>Caméra forcée : "canon" | "webcam" | "mock", ou null/"auto" pour la détection automatique.</summary>
    void SetCamera(string? mode, int? webcamIndex);

    /// <summary>Taille des photos du Canon : <see cref="CanonPhotoSize"/> (valeur inconnue = moyenne).</summary>
    void SetCanonPhotoSize(string size);

    /// <summary>Jours de conservation d'un événement terminé sur le PC (voir <see cref="EventCleanupService"/>).</summary>
    void SetEventRetentionDays(int days);

    /// <summary>
    /// Adresse saisie sur la borne (open core K2) : origine du SaaS et contenu de son kiosk-config.json.
    /// Prise en compte au prochain démarrage (lue seulement si appsettings ne fournit pas d'adresse).
    /// </summary>
    void SetSaasAddress(string saasUrl, string supabaseUrl, string supabaseAnonKey);

    /// <summary>« Changer de SaaS » : efface l'adresse saisie (les autres réglages restent).</summary>
    void ClearSaasAddress();

    /// <summary>
    /// Enregistre un réglage du pilote (LAB-334) : remplace celui de même imprimante et de même sorte,
    /// garde les autres.
    /// </summary>
    void SetPrinterDriverSetting(PrinterDriverSetting setting);

    /// <summary>
    /// Réglages d'exposition de l'appareil (LAB-427), gardés par borne et réappliqués à chaque ouverture
    /// de session. <paramref name="changedAt"/> sert à « le dernier gagne » avec le SaaS.
    /// </summary>
    void SetCameraExposure(CameraExposureValues values, DateTimeOffset changedAt);
}

public record MachineSettings
{
    public string? PrinterName { get; init; }

    /// <summary>null = détection automatique ; sinon "canon" | "webcam" | "mock".</summary>
    public string? CameraMode { get; init; }

    public int? WebcamIndex { get; init; }

    /// <summary>"small" | "medium" | "full" ; null = <see cref="CanonPhotoSize.Default"/>.</summary>
    public string? CanonPhotoSize { get; init; }

    /// <summary>null = <see cref="EventCleanupService.DefaultRetentionDays"/>.</summary>
    public int? EventRetentionDays { get; init; }

    /// <summary>
    /// Résolution demandée à la webcam (LAB-263), modifiable à la main dans machine-settings.json
    /// (« webcamWidth » / « webcamHeight »). null ou invalide = 1920×1080.
    /// </summary>
    public int? WebcamWidth { get; init; }

    public int? WebcamHeight { get; init; }

    /// <summary>Adresse du SaaS saisie sur la borne (origine https, open core K2) : QR codes et association.</summary>
    public string? SaasUrl { get; init; }

    /// <summary>Lus seulement si appsettings ne fournit pas d'adresse Supabase (voir <see cref="SaasEndpoint"/>).</summary>
    public string? SupabaseUrl { get; init; }

    public string? SupabaseAnonKey { get; init; }

    /// <summary>Réglages du pilote enregistrés depuis l'Admin, par imprimante et par sorte (LAB-334).</summary>
    public IReadOnlyList<PrinterDriverSetting>? PrinterDriverSettings { get; init; }

    /// <summary>Vitesse, ouverture, ISO, balance des blancs choisies dans Admin › Appareil photo (LAB-427).</summary>
    public SavedCameraExposure? CameraExposure { get; init; }

    [JsonIgnore] public int WebcamWidthOrDefault  => WebcamWidth  is > 0 ? WebcamWidth.Value  : WebcamCameraService.DefaultWidth;
    [JsonIgnore] public int WebcamHeightOrDefault => WebcamHeight is > 0 ? WebcamHeight.Value : WebcamCameraService.DefaultHeight;
}
