using System.Globalization;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using PolaKiosk.Models;

namespace PolaKiosk.Services;

/// <summary>
/// Rapport de l'appareil photo envoyé au SaaS dans le battement de cœur (LAB-428, p_camera_report) :
/// <c>{model, mode, settable, values:{tv,av,iso,wb,kelvin}, options:{tv:[{code,label}],…}, at}</c>, ou
/// <c>{supported:false, model, at}</c> pour une webcam ou la caméra simulée. Sans appel réseau (testé).
/// </summary>
public static class CameraReport
{
    /// <summary>Taille maximale acceptée par le serveur (kiosk_heartbeat ignore un rapport plus gros).</summary>
    internal const int MaxBytes = 32000;

    public static JObject FromState(CameraExposureState state)
    {
        var report = new JObject
        {
            ["model"]    = state.Model,
            ["mode"]     = state.Mode,
            ["settable"] = state.Settable,
            ["values"]   = Values(state.Values),
            ["options"]  = new JObject(CameraExposureKeys.All.Select(key => new JProperty(key,
                new JArray(state.OptionsFor(key).Select(o => new JObject { ["code"] = o.Code, ["label"] = o.Label }))))),
            ["at"]       = Iso(state.At),
        };
        // Listes anormalement longues : le rapport reste lisible (mode et valeurs), sans les choix.
        if (System.Text.Encoding.UTF8.GetByteCount(report.ToString(Formatting.None)) > MaxBytes)
            report["options"] = new JObject();
        return report;
    }

    public static JObject Unsupported(string model, DateTimeOffset at)
        => new() { ["supported"] = false, ["model"] = model, ["at"] = Iso(at) };

    /// <summary>Valeurs non nulles seulement, clés en minuscules (tv, av, iso, wb, kelvin).</summary>
    public static JObject Values(CameraExposureValues values)
    {
        var obj = new JObject();
        if (values.Tv is int tv)         obj[CameraExposureKeys.Tv] = tv;
        if (values.Av is int av)         obj[CameraExposureKeys.Av] = av;
        if (values.Iso is int iso)       obj[CameraExposureKeys.Iso] = iso;
        if (values.Wb is int wb)         obj[CameraExposureKeys.Wb] = wb;
        if (values.Kelvin is int kelvin) obj[CameraExposureKeys.Kelvin] = kelvin;
        return obj;
    }

    /// <summary>Contenu du rapport sans son heure : deux rapports identiques n'ont pas à être renvoyés.</summary>
    public static string Fingerprint(JObject report)
    {
        var copy = (JObject)report.DeepClone();
        copy.Remove("at");
        return copy.ToString(Formatting.None);
    }

    private static string Iso(DateTimeOffset at)
        => at.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);
}
