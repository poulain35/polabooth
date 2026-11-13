using FluentAssertions;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

public class AtomicFileTests
{
    [Fact]
    public void WriteAllText_replaces_a_longer_file_without_leftover_bytes()
    {
        using var dir = new TempDir();
        var path = dir.File("state.json");
        AtomicFile.WriteAllText(path, """{"activeEventId":"une-valeur-bien-plus-longue"}""");

        AtomicFile.WriteAllText(path, "{}");

        File.ReadAllText(path).Should().Be("{}");
    }

    [Fact]
    public void WriteAllText_writes_utf8_without_bom()
    {
        using var dir = new TempDir();
        var path = dir.File("state.json");

        AtomicFile.WriteAllText(path, "é");

        File.ReadAllBytes(path).Should().Equal(0xC3, 0xA9);
    }

    [Fact]
    public void WriteAllBytes_creates_the_folder_and_leaves_no_temporary_file()
    {
        using var dir = new TempDir();
        var path = Path.Combine(dir.Path, "sous", "dossier", "data.bin");

        AtomicFile.WriteAllBytes(path, [1, 2, 3]);

        File.ReadAllBytes(path).Should().Equal(1, 2, 3);
        Directory.GetFiles(Path.GetDirectoryName(path)!).Should().ContainSingle();
    }

    [Fact]
    public void Write_failure_keeps_the_previous_file_intact()
    {
        using var dir = new TempDir();
        var path = dir.File("machine-settings.json");
        AtomicFile.WriteAllText(path, "ancien");

        var act = () => AtomicFile.Write(path, stream =>
        {
            stream.Write("nouveau-partiel"u8);
            throw new IOException("disque plein");
        });

        act.Should().Throw<IOException>();
        File.ReadAllText(path).Should().Be("ancien");
        Directory.GetFiles(dir.Path).Should().ContainSingle();
    }
}
