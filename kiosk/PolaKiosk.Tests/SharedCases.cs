using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace PolaKiosk.Tests;

/// <summary>
/// Cas de test communs au SaaS et à la borne (docs/specs/fixtures/*.json, liés par le csproj et lus
/// à leur place). Les dates restent des chaînes : Newtonsoft les convertirait sinon en heure locale.
/// </summary>
internal static class SharedCases
{
    public static JObject Load(string fileName)
    {
        using var reader = new JsonTextReader(new StringReader(
            File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", fileName))))
        {
            DateParseHandling = DateParseHandling.None,
            FloatParseHandling = FloatParseHandling.Double,
        };
        return JObject.Load(reader);
    }
}
