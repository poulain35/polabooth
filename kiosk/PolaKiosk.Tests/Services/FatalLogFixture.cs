using PolaKiosk.Services;

[assembly: AssemblyFixture(typeof(PolaKiosk.Tests.Services.FatalLogFixture))]

namespace PolaKiosk.Tests.Services;

/// <summary>Les tests n'écrivent jamais dans le vrai fatal.log du poste.</summary>
public sealed class FatalLogFixture : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "polakiosk-fatal-" + Guid.NewGuid().ToString("N"));

    public FatalLogFixture() => FatalLog.FilePath = Path.Combine(_dir, "fatal.log");

    public void Dispose()
    {
        try { Directory.Delete(_dir, recursive: true); } catch { }
    }
}
