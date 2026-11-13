using System.Reflection;

namespace PolaKiosk.Services;

/// <summary>Version courante de l'app, lue depuis l'assembly (définie par &lt;Version&gt; dans le .csproj).</summary>
public static class AppVersion
{
    public static string Current { get; } = Resolve();

    private static string Resolve()
    {
        var v = Assembly.GetEntryAssembly()?.GetName().Version
             ?? Assembly.GetExecutingAssembly().GetName().Version;
        // Format Major.Minor.Build (on ignore la révision) → "1.0.0"
        return v == null ? "0.0.0" : $"{v.Major}.{v.Minor}.{v.Build}";
    }
}
