using FluentAssertions;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>Dossier de l'animation d'une séance (LAB-237), retrouvé sans la base.</summary>
public class SessionAnimationTests
{
    private static readonly Guid SessionId = Guid.Parse("7a8b9c0d-1111-4222-8333-944455556666");

    [Fact]
    public void The_animation_lives_next_to_the_composites_folder()
    {
        var composites = Path.Combine("C:\\data", "events", "mariage", "composites");
        SessionAnimation.DirectoryFor(composites, SessionId)
            .Should().Be(Path.Combine("C:\\data", "events", "mariage", "animations", SessionId.ToString("D")));
        SessionAnimation.DirectoryFor(composites + Path.DirectorySeparatorChar, SessionId)
            .Should().Be(Path.Combine("C:\\data", "events", "mariage", "animations", SessionId.ToString("D")));
    }

    [Fact]
    public void Find_needs_both_the_clip_and_the_poster()
    {
        using var dir = new TempDir();
        var composites = Path.Combine(dir.Path, "composites");
        Directory.CreateDirectory(composites);
        var composite = Path.Combine(composites, "composite.jpg");
        File.WriteAllText(composite, "jpg");
        var animDir = SessionAnimation.DirectoryFor(composites, SessionId);
        Directory.CreateDirectory(animDir);

        File.WriteAllText(Path.Combine(animDir, AnimationService.VideoFileName), "mp4");
        SessionAnimation.Find(composite, SessionId).Should().BeNull("l'affiche manque");

        File.WriteAllText(Path.Combine(animDir, AnimationService.PosterFileName), "jpg");
        var clip = SessionAnimation.Find(composite, SessionId);
        clip.Should().NotBeNull();
        clip!.VideoPath.Should().Be(Path.Combine(animDir, AnimationService.VideoFileName));
        clip.PosterPath.Should().Be(Path.Combine(animDir, AnimationService.PosterFileName));

        SessionAnimation.Find(composite, Guid.Empty).Should().BeNull();
        SessionAnimation.Find(composite, Guid.NewGuid()).Should().BeNull("autre séance");
    }

    [Fact]
    public void FindForComposite_reads_the_session_from_the_share_file()
    {
        using var dir = new TempDir();
        var composites = Path.Combine(dir.Path, "composites");
        Directory.CreateDirectory(composites);
        var composite = Path.Combine(composites, "composite.jpg");
        File.WriteAllText(composite, "jpg");
        var animDir = SessionAnimation.DirectoryFor(composites, SessionId);
        Directory.CreateDirectory(animDir);
        File.WriteAllText(Path.Combine(animDir, AnimationService.VideoFileName), "mp4");
        File.WriteAllText(Path.Combine(animDir, AnimationService.PosterFileName), "jpg");

        SessionAnimation.FindForComposite(composite).Should().BeNull("sans fichier de partage, montage seul");

        ShareInfoFile.Write(composite, new ShareInfo(SessionId, null, Guid.Empty));
        SessionAnimation.FindForComposite(composite)!.VideoPath
            .Should().Be(Path.Combine(animDir, AnimationService.VideoFileName));

        File.WriteAllText(ShareInfoFile.PathFor(composite), "{illisible");
        SessionAnimation.FindForComposite(composite).Should().BeNull();
    }
}
