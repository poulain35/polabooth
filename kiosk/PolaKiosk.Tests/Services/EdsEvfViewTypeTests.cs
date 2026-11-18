using FluentAssertions;
using PolaKiosk.EDSDK;

namespace PolaKiosk.Tests.Services;

/// <summary>Simulation d'exposition du live view (LAB-388) : valeurs de la doc EDSDK 13.20 (§ 5.2.104, § 6.22.3).</summary>
public class EdsEvfViewTypeTests
{
    [Fact]
    public void Evf_ViewType_values_match_the_EDSDK_reference()
    {
        EdsPropID.Evf_ViewType.Should().Be(0x01000513u);
        EdsEvfViewType.Enable.Should().Be(1u);
        EdsEvfViewType.Disable.Should().Be(3u);
    }

    [Fact]
    public void Unlock_values_match_the_EDSDK_reference()
    {
        EdsEvfViewType.UnlockTarget.Should().Be(0x01000000u);
        EdsEvfViewType.UnlockKey.Should().Be(0x7CBD2BB7);
    }
}
