namespace PolaKiosk.Models;

// Réglages d'exposition de l'appareil (spec docs/specs/reglages-appareil-photo.md, LAB-427).
// Contrat : CameraReport (LAB-428) envoie CameraExposureState au serveur sous la forme
// {model, mode, settable, values:{tv,av,iso,wb,kelvin}, options:{tv:[{code,label}],…}, at}.
// Ne pas renommer ces types, ces propriétés ni les clés de CameraExposureKeys.

/// <summary>Codes Canon des réglages ; null = pas de valeur (lecture) ou pas de changement (écriture).</summary>
public sealed record CameraExposureValues
{
    public int? Tv { get; init; }
    public int? Av { get; init; }
    public int? Iso { get; init; }
    public int? Wb { get; init; }

    /// <summary>Température en kelvins, utile seulement si <see cref="Wb"/> vaut « Température de couleur ».</summary>
    public int? Kelvin { get; init; }
}

/// <summary>Valeur proposée à l'admin : code Canon et libellé à la Canon (« 1/125 », « 5,6 »).</summary>
public sealed record CameraOption(int Code, string Label);

/// <summary>Clés des listes de <see cref="CameraExposureState.Options"/>.</summary>
public static class CameraExposureKeys
{
    public const string Tv = "tv";
    public const string Av = "av";
    public const string Iso = "iso";
    public const string Wb = "wb";
    public const string Kelvin = "kelvin";

    public static readonly IReadOnlyList<string> All = [Tv, Av, Iso, Wb, Kelvin];
}

/// <summary>État lu sur l'appareil : mode, valeurs actuelles et valeurs permises à cet instant.</summary>
public sealed class CameraExposureState
{
    public string Model { get; init; } = "";

    /// <summary>Libellé court Canon du mode de la molette (« M », « Av », « Auto »…).</summary>
    public string Mode { get; init; } = "";

    /// <summary>Réglages modifiables : seulement en mode M (la molette ne se tourne pas à distance).</summary>
    public bool Settable { get; init; }

    public CameraExposureValues Values { get; init; } = new();

    public Dictionary<string, List<CameraOption>> Options { get; init; } = new();

    public DateTimeOffset At { get; init; }

    public IReadOnlyList<CameraOption> OptionsFor(string key)
        => Options.TryGetValue(key, out var list) ? list : [];
}

/// <summary>Réglages gardés sur la borne (machine-settings.json), réappliqués à chaque ouverture de session.</summary>
public sealed record SavedCameraExposure
{
    public CameraExposureValues Values { get; init; } = new();

    /// <summary>Heure du dernier changement : « le dernier gagne » avec une demande du SaaS (lot K2).</summary>
    public DateTimeOffset ChangedAt { get; init; }
}

/// <summary>
/// Réglage refusé (molette pas sur M, valeur hors liste, refus de l'appareil) : message en français et
/// état relu après coup (valeurs précédentes gardées par l'appareil), null si la relecture a échoué.
/// </summary>
public sealed class CameraExposureException(string message, CameraExposureState? state) : Exception(message)
{
    public CameraExposureState? State { get; } = state;
}
