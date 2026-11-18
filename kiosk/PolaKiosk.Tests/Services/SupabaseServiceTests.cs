using FluentAssertions;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

public class SupabaseServiceTests
{
    [Theory]
    [InlineData("null")]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("[]")]
    public void ParseEventRpcResponse_returns_null_when_code_is_unknown(string body)
    {
        SupabaseRpcResponses.ParseEventRpcResponse(body).Should().BeNull();
    }

    [Fact]
    public void ParseEventRpcResponse_maps_kiosk_get_event_payload()
    {
        const string body = """
        {
          "id": "6f1d2c3b-1111-4222-8333-944455556666",
          "org_id": "0a0b0c0d-1111-4222-8333-944455556666",
          "name": "Mariage Julie & Thomas",
          "access_code": "TUQNA5",
          "form_config": { "kiosk": { "locale": "en", "capture": {}, "theme": {} } }
        }
        """;

        var dto = SupabaseRpcResponses.ParseEventRpcResponse(body);

        dto.Should().NotBeNull();
        dto!.Id.Should().Be(Guid.Parse("6f1d2c3b-1111-4222-8333-944455556666"));
        dto.OrgId.Should().Be(Guid.Parse("0a0b0c0d-1111-4222-8333-944455556666"));
        dto.Name.Should().Be("Mariage Julie & Thomas");
        dto.AccessCode.Should().Be("TUQNA5");
        dto.FormConfig!.Kiosk!.Locale.Should().Be("en");
    }

    [Fact]
    public void BuildRecordPhotoBody_uses_kiosk_record_photo_argument_names()
    {
        var eventId = Guid.Parse("6f1d2c3b-1111-4222-8333-944455556666");
        const string path = "photos/mariage-6f1d2c3b/0a0b0c0d-1111-4222-8333-944455556666/c.jpg";
        const string url = "https://photos.example.com/" + path;

        var body = Newtonsoft.Json.JsonConvert.DeserializeObject<Newtonsoft.Json.Linq.JObject>(
            SupabaseRpcBodies.BuildRecordPhotoBody("TUQNA5", eventId, path, url,
                new DateTime(2026, 11, 4, 21, 10, 5, 123, DateTimeKind.Utc), "MACHINE-1", "s3cret"),
            new Newtonsoft.Json.JsonSerializerSettings { DateParseHandling = Newtonsoft.Json.DateParseHandling.None })!;

        body.Properties().Select(p => p.Name).Should().BeEquivalentTo(
            "p_code", "p_event_id", "p_storage_path", "p_photo_url", "p_machine_id", "p_secret", "p_captured_at");
        body["p_code"]!.ToString().Should().Be("TUQNA5");
        body["p_event_id"]!.ToString().Should().Be("6f1d2c3b-1111-4222-8333-944455556666");
        body["p_storage_path"]!.ToString().Should().Be(path);
        body["p_photo_url"]!.ToString().Should().Be(url);
        body["p_machine_id"]!.ToString().Should().Be("MACHINE-1");
        body["p_secret"]!.ToString().Should().Be("s3cret");
        body["p_captured_at"]!.ToString().Should().Be("2026-11-04T21:10:05.123Z");
    }

    [Fact]
    public void ToUtcIso_treats_a_time_read_back_from_sqlite_as_utc()
    {
        // SQLite rend les dates sans Kind : elles sont stockées en UTC, on ne les convertit pas.
        var fromDb = new DateTime(2026, 11, 4, 21, 10, 5, 123, DateTimeKind.Unspecified);

        SupabaseRpcBodies.ToUtcIso(fromDb).Should().Be("2026-11-04T21:10:05.123Z");
    }

    [Fact]
    public void ParseUploadTarget_maps_get_kiosk_upload_url_response()
    {
        const string body = """{"presigned_url":"https://r2.example/put?sig=1","storage_path":"photos/a-6f1d2c3b/s/c.jpg","public_url":"https://photos.example.com/photos/a-6f1d2c3b/s/c.jpg","content_type":"image/jpeg"}""";

        SupabaseRpcResponses.ParseUploadTarget(body).Should().Be(new SupabaseRpcResponses.UploadTarget(
            "https://r2.example/put?sig=1", "photos/a-6f1d2c3b/s/c.jpg",
            "https://photos.example.com/photos/a-6f1d2c3b/s/c.jpg", "image/jpeg"));
    }

    [Theory]
    [InlineData("""{"storage_path":"p","public_url":"u","content_type":"image/jpeg"}""")]
    [InlineData("""{"presigned_url":"x","storage_path":"","public_url":"u","content_type":"image/jpeg"}""")]
    [InlineData("""{"presigned_url":"x","storage_path":"p","public_url":null,"content_type":"image/jpeg"}""")]
    [InlineData("""{"presigned_url":"x","storage_path":"p","public_url":"u","content_type":3}""")]
    public void ParseUploadTarget_rejects_incomplete_response(string body)
    {
        var act = () => SupabaseRpcResponses.ParseUploadTarget(body);
        act.Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public void ParsePhotoIdRpcResponse_reads_uuid_scalar()
    {
        SupabaseRpcResponses.ParsePhotoIdRpcResponse("\"0a0b0c0d-1111-4222-8333-944455556666\"")
            .Should().Be(Guid.Parse("0a0b0c0d-1111-4222-8333-944455556666"));
    }

    [Theory]
    [InlineData("")]
    [InlineData("null")]
    [InlineData("\"pas-un-uuid\"")]
    [InlineData("[]")]
    public void ParsePhotoIdRpcResponse_returns_empty_on_unexpected_body(string body)
    {
        SupabaseRpcResponses.ParsePhotoIdRpcResponse(body).Should().Be(Guid.Empty);
    }

    [Fact]
    public void ParseEventRpcResponse_accepts_event_without_kiosk_config()
    {
        const string body = """{ "id": "6f1d2c3b-1111-4222-8333-944455556666", "name": "", "access_code": "ABC123", "form_config": { "kiosk": null } }""";

        var dto = SupabaseRpcResponses.ParseEventRpcResponse(body);

        dto.Should().NotBeNull();
        dto!.FormConfig!.Kiosk.Should().BeNull();
        dto.StartDate.Should().BeNull("sans date, l'accueil n'en affiche aucune");
        dto.EndDate.Should().BeNull();
    }

    // LAB-251 : dates de l'événement et réglages de l'accueil personnalisé (LAB-250)
    [Fact]
    public void ParseEventRpcResponse_reads_the_event_dates_and_the_personalized_home()
    {
        const string body = """
        {
          "id": "6f1d2c3b-1111-4222-8333-944455556666", "name": "Mariage", "access_code": "ABC123",
          "start_date": "2026-06-14T16:00:00+02:00", "end_date": "2026-06-15T02:00:00+00:00",
          "form_config": { "kiosk": { "home": {
            "personalized": true, "display_name": "Camille & Thomas",
            "buttons": { "photo": { "enabled": true, "label": "Photo" }, "gif": { "enabled": true, "label": "Mon GIF" } }
          } } }
        }
        """;

        var dto = SupabaseRpcResponses.ParseEventRpcResponse(body);

        dto!.StartDate.Should().Be(new DateTimeOffset(2026, 6, 14, 14, 0, 0, TimeSpan.Zero));
        dto.StartDate!.Value.Offset.Should().Be(TimeSpan.FromHours(2), "le fuseau envoyé est gardé tel quel");
        dto.EndDate.Should().Be(new DateTimeOffset(2026, 6, 15, 2, 0, 0, TimeSpan.Zero));
        var home = dto.FormConfig!.Kiosk!.Home;
        home.Personalized.Should().BeTrue();
        home.DisplayName.Should().Be("Camille & Thomas");
        home.Buttons.Gif.Enabled.Should().BeTrue();
        home.Buttons.Gif.Label.Should().Be("Mon GIF");
        home.Buttons.Boomerang.Enabled.Should().BeFalse("absent de la config : désactivé par défaut");
    }

    [Theory]
    [InlineData("\"pas une date\"")]
    [InlineData("12")]
    [InlineData("{}")]
    public void ParseEventRpcResponse_ignores_an_unreadable_date(string value)
    {
        var body = $$"""{ "id": "6f1d2c3b-1111-4222-8333-944455556666", "name": "", "access_code": "ABC123", "start_date": {{value}}, "form_config": {} }""";

        var dto = SupabaseRpcResponses.ParseEventRpcResponse(body);

        dto.Should().NotBeNull("une date illisible ne bloque pas le chargement de l'événement");
        dto!.StartDate.Should().BeNull();
    }

    // LAB-197 : réponse de kiosk_get_admin_pin
    [Theory]
    [InlineData("[]")]
    [InlineData("")]
    [InlineData("""[{"pin_hash":null,"pin_set_at":null}]""")]
    public void ParseAdminPinResponse_returns_null_when_no_pin_was_sent(string body)
    {
        SupabaseRpcResponses.ParseAdminPinResponse(body).Should().BeNull();
    }

    [Fact]
    public void ParseAdminPinResponse_maps_the_hash_and_the_date()
    {
        const string body = """[{"pin_hash":"pbkdf2$210000$AAECAwQFBgcICQoLDA0ODw==$986qxnMbMmzuHyS3MK9F7gz4EXIuhMjAubUlwLFpHTo=","pin_set_at":"2026-11-03T09:15:00.123456+00:00"}]""";

        var pin = SupabaseRpcResponses.ParseAdminPinResponse(body);

        pin.Should().NotBeNull();
        pin!.Hash.Should().StartWith("pbkdf2$210000$");
        pin.SetAt.Should().NotBeNull();
        pin.SetAt!.Value.ToUniversalTime().Should().Be(new DateTime(2026, 11, 3, 9, 15, 0, 123, DateTimeKind.Utc).AddTicks(4560));
    }

    // ── LAB-200 : mise à jour demandée depuis le SaaS ─────────────────────

    [Theory]
    [InlineData("[]")]
    [InlineData("")]
    [InlineData("null")]
    [InlineData("""[{ "version": null, "exe_url": "https://x.test/a.exe", "sha256": "ab", "requested_at": "2026-11-03T10:00:00+00:00" }]""")]
    [InlineData("""[{ "version": "1.0.16", "exe_url": "https://x.test/a.exe", "sha256": "ab", "requested_at": null }]""")]
    public void ParseUpdateRequestResponse_returns_null_without_a_pending_request(string body)
    {
        SupabaseRpcResponses.ParseUpdateRequestResponse(body).Should().BeNull();
    }

    [Fact]
    public void ParseUpdateRequestResponse_keeps_requested_at_exactly_as_sent()
    {
        const string body = """
        [{ "version": " 1.0.16 ", "exe_url": "https://x.test/setup-1.0.16.exe",
           "sha256": "ABCDEF", "requested_at": "2026-11-03T10:00:00.123456+00:00" }]
        """;

        var request = SupabaseRpcResponses.ParseUpdateRequestResponse(body);

        request.Should().Be(new UpdateRequest("1.0.16", "https://x.test/setup-1.0.16.exe", "abcdef",
            "2026-11-03T10:00:00.123456+00:00"));
    }

    [Fact]
    public void BuildUpdateFailureBody_uses_kiosk_report_update_failure_argument_names()
    {
        var json = SupabaseRpcBodies.BuildUpdateFailureBody("MACHINE-1", "s3cret", "1.0.16",
            "2026-11-03T10:00:00.123456+00:00", new string('x', 800));

        using var reader = new Newtonsoft.Json.JsonTextReader(new StringReader(json))
            { DateParseHandling = Newtonsoft.Json.DateParseHandling.None };
        var body = Newtonsoft.Json.Linq.JObject.Load(reader);

        body.Properties().Select(p => p.Name).Should().BeEquivalentTo(
            "p_machine_id", "p_secret", "p_version", "p_error", "p_requested_at");
        body["p_machine_id"]!.ToString().Should().Be("MACHINE-1");
        body["p_secret"]!.ToString().Should().Be("s3cret");
        body["p_version"]!.ToString().Should().Be("1.0.16");
        body["p_requested_at"]!.ToString().Should().Be("2026-11-03T10:00:00.123456+00:00");
        body["p_error"]!.ToString().Should().HaveLength(SupabaseRpcBodies.MaxUpdateErrorLength);
    }

    // ── LAB-245 : événement envoyé sur la borne depuis le SaaS ─────────────

    [Theory]
    [InlineData("")]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("""{ "requested_at": null, "event": { "id": "6f1d2c3b-1111-4222-8333-944455556666" } }""")]
    [InlineData("""{ "requested_at": "2026-11-05T10:00:00+00:00", "event": null }""")]
    [InlineData("""{ "requested_at": "2026-11-05T10:00:00+00:00", "event": { "id": "00000000-0000-0000-0000-000000000000" } }""")]
    public void ParseEventPushResponse_returns_null_without_a_pending_push(string body)
    {
        SupabaseRpcResponses.ParseEventPushResponse(body).Should().BeNull();
    }

    [Fact]
    public void ParseEventPushResponse_reads_the_event_and_keeps_requested_at_exactly_as_sent()
    {
        const string body = """
        { "requested_at": "2026-11-05T10:00:00.123456+00:00",
          "event": { "id": "6f1d2c3b-1111-4222-8333-944455556666", "org_id": "7a1d2c3b-1111-4222-8333-944455556666",
                     "name": "Mariage Léa & Tom", "access_code": "ABC123",
                     "form_config": { "kiosk": { "theme": { "primary": "#123456" } } } } }
        """;

        var push = SupabaseRpcResponses.ParseEventPushResponse(body);

        push.Should().NotBeNull();
        push!.RequestedAt.Should().Be("2026-11-05T10:00:00.123456+00:00");
        push.Event.Id.Should().Be(Guid.Parse("6f1d2c3b-1111-4222-8333-944455556666"));
        push.Event.OrgId.Should().Be(Guid.Parse("7a1d2c3b-1111-4222-8333-944455556666"));
        push.Event.Name.Should().Be("Mariage Léa & Tom");
        push.Event.AccessCode.Should().Be("ABC123");
        push.Event.FormConfig.Should().NotBeNull();
    }

    [Fact]
    public void BuildEventPushAckBody_uses_kiosk_ack_event_request_argument_names()
    {
        var eventId = Guid.Parse("6f1d2c3b-1111-4222-8333-944455556666");
        var json = SupabaseRpcBodies.BuildEventPushAckBody("MACHINE-1", "s3cret", eventId,
            "2026-11-05T10:00:00.123456+00:00", new string('x', 800));

        using var reader = new Newtonsoft.Json.JsonTextReader(new StringReader(json))
            { DateParseHandling = Newtonsoft.Json.DateParseHandling.None };
        var body = Newtonsoft.Json.Linq.JObject.Load(reader);

        body.Properties().Select(p => p.Name).Should().BeEquivalentTo(
            "p_machine_id", "p_secret", "p_event_id", "p_error", "p_requested_at");
        body["p_machine_id"]!.ToString().Should().Be("MACHINE-1");
        body["p_secret"]!.ToString().Should().Be("s3cret");
        body["p_event_id"]!.ToString().Should().Be(eventId.ToString());
        body["p_requested_at"]!.ToString().Should().Be("2026-11-05T10:00:00.123456+00:00");
        body["p_error"]!.ToString().Should().HaveLength(SupabaseRpcBodies.MaxUpdateErrorLength);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void BuildEventPushAckBody_sends_no_error_when_the_event_is_displayed(string? error)
    {
        var json = SupabaseRpcBodies.BuildEventPushAckBody("MACHINE-1", "s3cret", Guid.NewGuid(),
            "2026-11-05T10:00:00+00:00", error);

        Newtonsoft.Json.Linq.JObject.Parse(json)["p_error"]!.Type.Should().Be(Newtonsoft.Json.Linq.JTokenType.Null);
    }

    // ── Fiche contact et logo de la société (LAB-257) ─────────────────────────

    [Fact]
    public void ParseOrgContact_reads_the_company_the_phone_the_logo_and_the_email()
    {
        var contact = SupabaseRpcResponses.ParseOrgContact(
            """{"contact_company":"Studio Lumière","contact_phone":"06 11 22 33 44","contact_email":"a@b.fr","logo_url":"https://cdn/org/o1/logo.png?v=1"}""");

        contact.Should().Be(new PolaKiosk.Models.Supabase.OrgContact("Studio Lumière", "06 11 22 33 44", "https://cdn/org/o1/logo.png?v=1", "a@b.fr"));
    }

    [Theory]
    [InlineData("""{"contact_company":"Studio","contact_phone":"","logo_url":null}""")]
    [InlineData("""{"contact_company":"Studio","logo_url":""}""")]
    [InlineData("""{"contact_company":"Studio"}""")] // RPC d'avant la migration
    public void ParseOrgContact_without_logo_gives_a_null_url(string json)
    {
        var contact = SupabaseRpcResponses.ParseOrgContact(json)!;

        contact.Company.Should().Be("Studio");
        contact.Phone.Should().BeNull();
        contact.LogoUrl.Should().BeNull();
    }

    [Fact]
    public void ParseOrgContact_returns_null_for_an_unknown_event()
    {
        SupabaseRpcResponses.ParseOrgContact("null").Should().BeNull("la borne garde alors son contact et son logo");
    }
}
