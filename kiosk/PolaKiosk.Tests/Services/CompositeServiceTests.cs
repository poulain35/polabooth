using FluentAssertions;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

public class CompositeServiceTests
{
    // ── Taille d'impression (mm → px à un DPI donné, troncature entière) ──
    [Theory]
    [InlineData("portrait",  300, 1181, 1771)] // 100×150 mm
    [InlineData("landscape", 300, 1771, 1181)] // 150×100 mm
    [InlineData("stripV",    300,  590, 1771)] //  50×150 mm
    [InlineData("stripH",    300, 1771,  590)] // 150×50 mm
    public void PrintPixelSize_converts_mm_to_pixels(string format, int dpi, int expectedW, int expectedH)
    {
        var (w, h) = CompositeService.PrintPixelSize(format, dpi);
        w.Should().Be(expectedW);
        h.Should().Be(expectedH);
    }

    [Fact]
    public void PrintPixelSize_scales_linearly_with_dpi()
    {
        var (w300, h300) = CompositeService.PrintPixelSize("portrait", 300);
        var (w150, h150) = CompositeService.PrintPixelSize("portrait", 150);
        w150.Should().BeCloseTo(w300 / 2, 1);
        h150.Should().BeCloseTo(h300 / 2, 1);
    }

    [Fact]
    public void CanvasToPrintScale_is_printWidth_over_canvasWidth()
    {
        // portrait : canvas 400 px de large → 1181 px impression
        CompositeService.CanvasToPrintScale("portrait", 300).Should().BeApproximately(1181f / 400f, 0.0001f);
        // stripV : canvas 200 px de large → 590 px impression
        CompositeService.CanvasToPrintScale("stripV", 300).Should().BeApproximately(590f / 200f, 0.0001f);
    }

    [Fact]
    public void PrintPixelSize_throws_on_unknown_format()
    {
        var act = () => CompositeService.PrintPixelSize("hexagon", 300);
        act.Should().Throw<ArgumentException>();
    }

    // ── Recadrage "cover" (remplir sans déformer, centré) ──
    [Fact]
    public void CoverSourceRect_square_into_square_uses_full_source()
    {
        var (l, t, r, b) = CompositeService.CoverSourceRect(100, 100, 50, 50);
        l.Should().Be(0); t.Should().Be(0); r.Should().Be(100); b.Should().Be(100);
    }

    [Fact]
    public void CoverSourceRect_wide_source_crops_horizontally_centered()
    {
        // source 200×100 dans une zone carrée → on garde la bande centrale en largeur
        var (l, t, r, b) = CompositeService.CoverSourceRect(200, 100, 100, 100);
        l.Should().BeApproximately(50, 0.001f);
        r.Should().BeApproximately(150, 0.001f);
        t.Should().Be(0); b.Should().Be(100);
    }

    [Fact]
    public void CoverSourceRect_tall_source_crops_vertically_centered()
    {
        var (l, t, r, b) = CompositeService.CoverSourceRect(100, 200, 100, 100);
        t.Should().BeApproximately(50, 0.001f);
        b.Should().BeApproximately(150, 0.001f);
        l.Should().Be(0); r.Should().Be(100);
    }

    // ── Parsing des photoZones depuis le canvas_json Fabric.js ──
    [Fact]
    public void ParsePhotoZones_applies_fabric_scale_to_dimensions()
    {
        const string json = """
        {"objects":[{"isPhotoZone":true,"left":10,"top":20,"width":100,"height":200,"scaleX":2,"scaleY":1.5}]}
        """;
        var zones = CompositeService.ParsePhotoZones(json);
        zones.Should().HaveCount(1);
        zones[0].Left.Should().Be(10);
        zones[0].Top.Should().Be(20);
        zones[0].Width.Should().Be(200);   // 100 × 2
        zones[0].Height.Should().Be(300);  // 200 × 1.5
    }

    [Fact]
    public void ParsePhotoZones_defaults_scale_to_one_when_absent()
    {
        const string json = """{"objects":[{"isPhotoZone":true,"left":0,"top":0,"width":150,"height":150}]}""";
        var zones = CompositeService.ParsePhotoZones(json);
        zones[0].Width.Should().Be(150);
        zones[0].Height.Should().Be(150);
    }

    [Fact]
    public void ParsePhotoZones_ignores_non_photozone_objects()
    {
        const string json = """{"objects":[{"isPhotoZone":false,"width":100,"height":100},{"type":"text"}]}""";
        CompositeService.ParsePhotoZones(json).Should().BeEmpty();
    }

    [Fact]
    public void ParsePhotoZones_returns_empty_on_malformed_json()
    {
        CompositeService.ParsePhotoZones("not json at all").Should().BeEmpty();
    }

    // ── Zones rangées dans un groupe (LAB-214) ──
    // Valeurs attendues calculées par Fabric.js 5.3.0 lui-même (calcTransformMatrix des zones), vecteur
    // commun avec saas/src/lib/photoZones.test.js. Dans un groupe, left/top des enfants sont relatifs
    // au centre du groupe (groupe 281 × 121 : centre en left + 140.5, top + 60.5).
    private const string ZoneInGroup =
        """{"type":"rect","left":-140.5,"top":-60.5,"width":160,"height":120,"strokeWidth":0,"isPhotoZone":true}""";
    private const string DecoInGroup =
        """{"type":"rect","left":39.5,"top":9.5,"width":100,"height":50,"strokeWidth":1}""";

    private static string GroupCanvas(string groupProps) =>
        $$"""{"objects":[{"type":"group","width":281,"height":121,"strokeWidth":0,{{groupProps}},"objects":[{{ZoneInGroup}},{{DecoInGroup}}]}]}""";

    private static void ShouldBeZone(PhotoZone zone, float left, float top, float width, float height, float angle)
    {
        zone.Left.Should().BeApproximately(left, 0.001f);
        zone.Top.Should().BeApproximately(top, 0.001f);
        zone.Width.Should().BeApproximately(width, 0.001f);
        zone.Height.Should().BeApproximately(height, 0.001f);
        zone.Angle.Should().BeApproximately(angle, 0.001f);
    }

    [Fact]
    public void ParsePhotoZones_keeps_top_level_zone_unchanged()
    {
        const string json = """
        {"objects":[{"type":"rect","originX":"left","originY":"top","left":18,"top":20,"width":360,"height":418.5,"strokeWidth":0,"scaleX":1,"scaleY":1,"angle":0,"flipX":false,"flipY":false,"isPhotoZone":true}]}
        """;
        var zones = CompositeService.ParsePhotoZones(json);
        zones.Should().ContainSingle().Which.Should().Be(new PhotoZone(18, 20, 360, 418.5f));
    }

    [Fact]
    public void ParsePhotoZones_finds_zone_in_simple_group_relative_to_group_center()
    {
        var zones = CompositeService.ParsePhotoZones(GroupCanvas("\"left\":20,\"top\":30"));
        zones.Should().ContainSingle();
        ShouldBeZone(zones[0], 20, 30, 160, 120, 0);
    }

    [Fact]
    public void ParsePhotoZones_applies_group_scale()
    {
        var zones = CompositeService.ParsePhotoZones(GroupCanvas("\"left\":10,\"top\":40,\"scaleX\":1.5,\"scaleY\":0.5"));
        ShouldBeZone(zones.Single(), 10, 40, 240, 60, 0);
    }

    [Fact]
    public void ParsePhotoZones_applies_group_rotation_around_centered_origin()
    {
        var zones = CompositeService.ParsePhotoZones(
            GroupCanvas("\"originX\":\"center\",\"originY\":\"center\",\"left\":200,\"top\":300,\"angle\":90"));
        ShouldBeZone(zones.Single(), 120.5f, 179.5f, 160, 120, 90);
    }

    [Fact]
    public void ParsePhotoZones_applies_group_rotation_and_scale_around_top_left_origin()
    {
        var zones = CompositeService.ParsePhotoZones(
            GroupCanvas("\"left\":120,\"top\":80,\"angle\":30,\"scaleX\":1.2,\"scaleY\":1.2"));
        ShouldBeZone(zones.Single(), 71.1384f, 118.3538f, 192, 144, 30);
    }

    [Fact]
    public void ParsePhotoZones_mirrors_position_but_never_the_photo()
    {
        // Miroir horizontal : la zone passe de l'autre côté du groupe, photo à l'endroit.
        ShouldBeZone(CompositeService.ParsePhotoZones(GroupCanvas("\"left\":20,\"top\":30,\"flipX\":true")).Single(),
            141, 30, 160, 120, 0);
        // Miroir vertical d'un groupe tourné de 30° : orientation la plus proche de l'endroit (30°, pas -150°).
        ShouldBeZone(CompositeService.ParsePhotoZones(GroupCanvas("\"left\":20,\"top\":30,\"flipY\":true,\"angle\":30")).Single(),
            -21.218f, 62.8275f, 160, 120, 30);
    }

    [Fact]
    public void ParsePhotoZones_finds_zone_in_nested_groups_from_real_editor_json()
    {
        // Sortie brute de Fabric 5.3.0 (toObject) : zone mise à l'échelle dans un groupe réduit de moitié,
        // lui-même dans un groupe agrandi et tourné de -20°.
        const string json = """
        {"objects":[{"type":"group","version":"5.3.0","originX":"left","originY":"top","left":60,"top":100,"width":301,"height":301,"fill":"rgb(0,0,0)","stroke":null,"strokeWidth":0,"strokeDashArray":null,"strokeLineCap":"butt","strokeDashOffset":0,"strokeLineJoin":"miter","strokeUniform":false,"strokeMiterLimit":4,"scaleX":1.25,"scaleY":1.25,"angle":-20,"flipX":false,"flipY":false,"opacity":1,"shadow":null,"visible":true,"backgroundColor":"","fillRule":"nonzero","paintFirst":"fill","globalCompositeOperation":"source-over","skewX":0,"skewY":0,"objects":[{"type":"group","version":"5.3.0","originX":"left","originY":"top","left":-130.5,"top":-150.5,"width":161,"height":80,"fill":"rgb(0,0,0)","stroke":null,"strokeWidth":0,"strokeDashArray":null,"strokeLineCap":"butt","strokeDashOffset":0,"strokeLineJoin":"miter","strokeUniform":false,"strokeMiterLimit":4,"scaleX":0.5,"scaleY":0.5,"angle":0,"flipX":false,"flipY":false,"opacity":1,"shadow":null,"visible":true,"backgroundColor":"","fillRule":"nonzero","paintFirst":"fill","globalCompositeOperation":"source-over","skewX":0,"skewY":0,"objects":[{"type":"rect","version":"5.3.0","originX":"left","originY":"top","left":-80.5,"top":-40,"width":100,"height":80,"fill":"transparent","stroke":null,"strokeWidth":0,"strokeDashArray":null,"strokeLineCap":"butt","strokeDashOffset":0,"strokeLineJoin":"miter","strokeUniform":false,"strokeMiterLimit":4,"scaleX":1.5,"scaleY":1,"angle":0,"flipX":false,"flipY":false,"opacity":1,"shadow":null,"visible":true,"backgroundColor":"","fillRule":"nonzero","paintFirst":"fill","globalCompositeOperation":"source-over","skewX":0,"skewY":0,"rx":0,"ry":0,"isPhotoZone":true},{"type":"rect","version":"5.3.0","originX":"left","originY":"top","left":39.5,"top":-40,"width":40,"height":40,"fill":"red","stroke":null,"strokeWidth":1,"strokeDashArray":null,"strokeLineCap":"butt","strokeDashOffset":0,"strokeLineJoin":"miter","strokeUniform":false,"strokeMiterLimit":4,"scaleX":1,"scaleY":1,"angle":0,"flipX":false,"flipY":false,"opacity":1,"shadow":null,"visible":true,"backgroundColor":"","fillRule":"nonzero","paintFirst":"fill","globalCompositeOperation":"source-over","skewX":0,"skewY":0,"rx":0,"ry":0}]},{"type":"rect","version":"5.3.0","originX":"left","originY":"top","left":-150.5,"top":89.5,"width":300,"height":60,"fill":"red","stroke":null,"strokeWidth":1,"strokeDashArray":null,"strokeLineCap":"butt","strokeDashOffset":0,"strokeLineJoin":"miter","strokeUniform":false,"strokeMiterLimit":4,"scaleX":1,"scaleY":1,"angle":0,"flipX":false,"flipY":false,"opacity":1,"shadow":null,"visible":true,"backgroundColor":"","fillRule":"nonzero","paintFirst":"fill","globalCompositeOperation":"source-over","skewX":0,"skewY":0,"rx":0,"ry":0}]}]}
        """;
        var zones = CompositeService.ParsePhotoZones(json);
        zones.Should().ContainSingle();
        ShouldBeZone(zones[0], 89.2159f, 73.9096f, 93.75f, 50, -20);
    }

    [Fact]
    public void ParsePhotoZones_keeps_stacking_order_across_groups_and_ignores_decorative_groups()
    {
        var json = $$"""
        {"objects":[
          {"type":"group","left":0,"top":0,"width":10,"height":10,"objects":[{"type":"rect","width":10,"height":10}]},
          {"type":"group","left":20,"top":30,"width":281,"height":121,"objects":[{{ZoneInGroup}},{{DecoInGroup}}]},
          {"type":"rect","left":10,"top":400,"width":180,"height":150,"isPhotoZone":true}
        ]}
        """;
        var zones = CompositeService.ParsePhotoZones(json);
        zones.Should().HaveCount(2);
        ShouldBeZone(zones[0], 20, 30, 160, 120, 0);
        ShouldBeZone(zones[1], 10, 400, 180, 150, 0);
    }

    // ── Cache des zones : une seule analyse par modèle ──
    [Fact]
    public async Task GetPhotoZonesAsync_reuses_parsed_zones_for_same_template()
    {
        const string json = """{"objects":[{"isPhotoZone":true,"left":0,"top":0,"width":150,"height":150}]}""";
        var svc = new CompositeService();
        var id  = Guid.NewGuid();

        var first  = await svc.GetPhotoZonesAsync(id, json);
        var second = await svc.GetPhotoZonesAsync(id, json);

        first.Should().HaveCount(1);
        second.Should().BeSameAs(first);
    }

    [Fact]
    public async Task GetPhotoZonesAsync_reparses_when_canvas_changes()
    {
        const string one = """{"objects":[{"isPhotoZone":true,"width":100,"height":100}]}""";
        const string two = """{"objects":[{"isPhotoZone":true,"width":100,"height":100},{"isPhotoZone":true,"width":50,"height":50}]}""";
        var svc = new CompositeService();
        var id  = Guid.NewGuid();

        (await svc.GetPhotoZonesAsync(id, one)).Should().HaveCount(1);
        (await svc.GetPhotoZonesAsync(id, two)).Should().HaveCount(2);
        (await svc.GetPhotoZonesAsync(Guid.NewGuid(), one)).Should().HaveCount(1);
    }
}
