using FluentAssertions;
using PolaKiosk.Services;
using PolaKiosk.ViewModels;

namespace PolaKiosk.Tests.ViewModels;

/// <summary>Écran Live : rognage au ratio de la zone et gain de l'aperçu (extraits de LiveViewModel, LAB-405).</summary>
public class LiveFrameTests
{
    [Fact]
    public void Zone_plus_haute_que_la_camera_rogne_gauche_et_droite()
        => LiveFrameCrop.CenterCrop(1920, 1080, 0.75).Should().Be(new LiveFrameCrop(555, 0, 810, 1080));

    [Fact]
    public void Zone_plus_large_que_la_camera_rogne_haut_et_bas()
        => LiveFrameCrop.CenterCrop(1920, 1080, 3.0).Should().Be(new LiveFrameCrop(0, 220, 1920, 640));

    [Fact]
    public void Zone_au_ratio_de_la_camera_garde_toute_l_image()
        => LiveFrameCrop.CenterCrop(1920, 1080, 1920.0 / 1080).Should().Be(new LiveFrameCrop(0, 0, 1920, 1080));

    [Fact]
    public void Scene_bien_exposee_garde_un_gain_de_1()
        => LiveViewBrightener.NextGain(1.0, 200).Should().Be(1.0);

    [Fact]
    public void Gain_lisse_vers_la_cible()
        // Cible 150 / 50 = 3 : 15 % du chemin à chaque image.
        => LiveViewBrightener.NextGain(1.0, 50).Should().BeApproximately(1.3, 1e-9);

    [Fact]
    public void Scene_noire_vise_le_gain_maximal()
        => LiveViewBrightener.NextGain(12.0, 0).Should().Be(12.0);
}
