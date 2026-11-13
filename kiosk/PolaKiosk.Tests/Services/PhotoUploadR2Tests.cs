using System.Net;
using System.Text;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Moq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>
/// LAB-213 : envoi du montage sur R2 (URL présignée de get-kiosk-upload-url) puis enregistrement par
/// kiosk_record_photo. SupabaseService réel, réponses HTTP simulées.
/// </summary>
public class PhotoUploadR2Tests : IDisposable
{
    private const string SupabaseUrl = "https://projet.supabase.co";
    private const string AnonKey = "anon-key";
    private const string PresignedUrl = "https://compte.r2.cloudflarestorage.com/photos/x?X-Amz-Signature=abc";
    private static readonly Guid EventId = Guid.Parse("6f1d2c3b-1111-4222-8333-944455556666");
    private static readonly Guid PhotoId = Guid.Parse("0a0b0c0d-1111-4222-8333-944455556666");

    private readonly TestDb _db = new();
    private readonly TempDir _dir = new();
    private readonly RecordingHandler _http = new();
    private readonly ServiceProvider _services;

    public PhotoUploadR2Tests()
    {
        using (var ctx = _db.NewContext())
        {
            ctx.Events.Add(new EventEntity { Id = EventId, Name = "Mariage", AccessCode = "TUQNA5" });
            ctx.SaveChanges();
        }
        _services = new ServiceCollection().AddScoped(_ => _db.NewContext()).BuildServiceProvider();
    }

    public void Dispose()
    {
        _services.Dispose();
        _db.Dispose();
        _dir.Dispose();
    }

    private SupabaseService NewSupabase()
    {
        var credentials = new Mock<IKioskCredentials>();
        credentials.SetupGet(c => c.MachineId).Returns("MACHINE-1");
        credentials.SetupGet(c => c.Secret).Returns("s3cret");
        var settings = new AppSettings { Supabase = new SupabaseSettings { Url = SupabaseUrl + "/", AnonKey = AnonKey } };
        return new SupabaseService(settings, credentials.Object, _services.GetRequiredService<IServiceScopeFactory>(), _http);
    }

    private SessionService NewSessions(SupabaseService supabase)
        => new(_db.NewContext(), supabase, new Mock<IKioskLogService>().Object, NewPaths());

    private SessionPathService NewPaths()
    {
        var settings = new AppSettings();
        settings.Kiosk.DataDirectory = _dir.File("data");
        return new SessionPathService(settings);
    }

    private string NewComposite(string name = "composite_20261025_213000.jpg")
    {
        var path = _dir.File(name);
        File.WriteAllBytes(path, [0xFF, 0xD8, 0xFF, 0xD9]);
        return path;
    }

    private static string StoragePath(Guid sessionId) => $"photos/mariage-6f1d2c3b/{sessionId}/composite_20261025_213000.jpg";

    /// <summary>Réponse de get-kiosk-upload-url : le chemin ne dépend que de la séance (comme la fonction).</summary>
    private static HttpResponseMessage UploadUrlResponse(HttpRequestMessage request, string body)
    {
        var sessionId = JObject.Parse(body)["session_id"]!.ToString();
        var path = $"photos/mariage-6f1d2c3b/{sessionId}/composite_20261025_213000.jpg";
        return Json(new JObject
        {
            ["presigned_url"] = PresignedUrl,
            ["storage_path"] = path,
            ["public_url"] = "https://photos.example.com/" + path,
            ["content_type"] = "image/jpeg",
        }.ToString());
    }

    private static HttpResponseMessage Json(string body, HttpStatusCode status = HttpStatusCode.OK)
        => new(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    private void RespondNormally(HttpStatusCode putStatus = HttpStatusCode.OK)
    {
        _http.Respond = (request, body) => request.RequestUri!.AbsoluteUri switch
        {
            SupabaseUrl + "/functions/v1/get-kiosk-upload-url" => UploadUrlResponse(request, body),
            PresignedUrl => new HttpResponseMessage(putStatus),
            SupabaseUrl + "/rest/v1/rpc/kiosk_record_photo" => Json($"\"{PhotoId}\""),
            var other => throw new InvalidOperationException($"Appel inattendu : {other}"),
        };
    }

    [Fact]
    public async Task UploadPhotoAsync_requests_the_url_then_puts_to_r2_then_records_the_storage_path()
    {
        RespondNormally();
        var sessionId = Guid.NewGuid();
        var composite = NewComposite();

        var (url, photoId) = await NewSupabase().UploadPhotoAsync(sessionId, EventId, composite, DateTime.UtcNow);

        url.Should().Be("https://photos.example.com/" + StoragePath(sessionId));
        photoId.Should().Be(PhotoId);
        _http.Calls.Select(c => (c.Method, c.Uri)).Should().Equal(
            (HttpMethod.Post, SupabaseUrl + "/functions/v1/get-kiosk-upload-url"),
            (HttpMethod.Put, PresignedUrl),
            (HttpMethod.Post, SupabaseUrl + "/rest/v1/rpc/kiosk_record_photo"));

        var ask = JObject.Parse(_http.Calls[0].Body);
        ask["access_code"]!.ToString().Should().Be("TUQNA5");
        ask["event_id"]!.ToString().Should().Be(EventId.ToString());
        ask["machine_id"]!.ToString().Should().Be("MACHINE-1");
        ask["secret"]!.ToString().Should().Be("s3cret");
        ask["session_id"]!.ToString().Should().Be(sessionId.ToString());
        ask["filename"]!.ToString().Should().Be("composite_20261025_213000.jpg");
        ask["content_length"]!.Value<long>().Should().Be(4);
        _http.Calls[0].Authorization.Should().Be("Bearer " + AnonKey);

        var record = JObject.Parse(_http.Calls[2].Body);
        record["p_storage_path"]!.ToString().Should().Be(StoragePath(sessionId));
        record["p_photo_url"]!.ToString().Should().Be(url);
        record["p_code"]!.ToString().Should().Be("TUQNA5");
    }

    [Fact]
    public async Task UploadPhotoAsync_puts_raw_bytes_to_r2_without_supabase_headers()
    {
        RespondNormally();

        await NewSupabase().UploadPhotoAsync(Guid.NewGuid(), EventId, NewComposite(), DateTime.UtcNow);

        var put = _http.Calls[1];
        put.ContentType.Should().Be("image/jpeg");
        put.Bytes.Should().Equal(0xFF, 0xD8, 0xFF, 0xD9);
        put.Authorization.Should().BeNull();
        put.HasApiKey.Should().BeFalse();
    }

    [Fact]
    public async Task UploadPhotoAsync_does_not_record_the_photo_when_the_r2_put_fails()
    {
        RespondNormally(putStatus: HttpStatusCode.Forbidden);

        var act = () => NewSupabase().UploadPhotoAsync(Guid.NewGuid(), EventId, NewComposite(), DateTime.UtcNow);

        (await act.Should().ThrowAsync<HttpRequestException>()).WithMessage("Envoi R2 photo : 403*");
        _http.Calls.Should().NotContain(c => c.Uri.EndsWith("/rpc/kiosk_record_photo"));
    }

    [Fact]
    public async Task UploadPhotoAsync_sends_nothing_to_r2_when_the_upload_url_is_refused()
    {
        _http.Respond = (_, _) => Json("""{"error":"Licence kiosk invalide ou inactive"}""", HttpStatusCode.Forbidden);

        var act = () => NewSupabase().UploadPhotoAsync(Guid.NewGuid(), EventId, NewComposite(), DateTime.UtcNow);

        (await act.Should().ThrowAsync<HttpRequestException>()).WithMessage("URL d'envoi photo : 403*Licence*");
        _http.Calls.Should().ContainSingle();
    }

    [Fact]
    public async Task Failed_r2_put_leaves_the_session_pending_and_the_retry_reuses_the_same_path()
    {
        var composite = NewComposite();
        var sessionId = await NewSessions(NewSupabase()).RecordSessionAsync(Guid.NewGuid(), EventId, DateTime.UtcNow, composite, composite);

        // 1er essai : R2 injoignable → séance en attente, aucun enregistrement.
        RespondNormally(putStatus: HttpStatusCode.ServiceUnavailable);
        (await NewSessions(NewSupabase()).UploadPendingSessionsAsync()).Should().Be(0);
        using (var ctx = _db.NewContext())
            ctx.Sessions.Single().Uploaded.Should().BeFalse();
        ShareInfoFile.Read(composite)!.IsShared.Should().BeFalse();
        _http.Calls.Should().NotContain(c => c.Uri.EndsWith("/rpc/kiosk_record_photo"));
        var firstAsk = JObject.Parse(_http.Calls[0].Body);

        // Renvoi : même séance, même fichier, chemin R2 renvoyé par la fonction passé à la RPC.
        _http.Calls.Clear();
        RespondNormally();
        (await NewSessions(NewSupabase()).UploadPendingSessionsAsync()).Should().Be(1);

        var retryAsk = JObject.Parse(_http.Calls[0].Body);
        retryAsk["session_id"]!.ToString().Should().Be(firstAsk["session_id"]!.ToString()).And.Be(sessionId.ToString());
        retryAsk["filename"]!.ToString().Should().Be(firstAsk["filename"]!.ToString());
        JObject.Parse(_http.Calls[2].Body)["p_storage_path"]!.ToString().Should().Be(StoragePath(sessionId));
        using (var ctx = _db.NewContext())
            ctx.Sessions.Single().Uploaded.Should().BeTrue();
        ShareInfoFile.Read(composite).Should().Be(
            new ShareInfo(sessionId, "https://photos.example.com/" + StoragePath(sessionId), PhotoId));

        // Déjà envoyée : plus aucun appel.
        _http.Calls.Clear();
        (await NewSessions(NewSupabase()).UploadPendingSessionsAsync()).Should().Be(0);
        _http.Calls.Should().BeEmpty();
    }

    [Fact]
    public async Task Failed_record_after_r2_put_keeps_the_session_pending_for_a_retry()
    {
        var composite = NewComposite();
        await NewSessions(NewSupabase()).RecordSessionAsync(Guid.NewGuid(), EventId, DateTime.UtcNow, composite, composite);
        _http.Respond = (request, body) => request.RequestUri!.AbsoluteUri.EndsWith("/rpc/kiosk_record_photo")
            ? Json("""{"message":"timeout"}""", HttpStatusCode.InternalServerError)
            : request.Method == HttpMethod.Put ? new HttpResponseMessage(HttpStatusCode.OK) : UploadUrlResponse(request, body);

        (await NewSessions(NewSupabase()).UploadPendingSessionsAsync()).Should().Be(0);

        using var ctx = _db.NewContext();
        ctx.Sessions.Single().Uploaded.Should().BeFalse();
    }

    [Fact]
    public async Task Session_taken_offline_keeps_its_capture_time_once_sent()
    {
        // LAB-231 : séance prise à 21:10:05.123 UTC, borne hors ligne, envoi le lendemain.
        var takenAt = new DateTime(2026, 11, 4, 21, 10, 5, 123, DateTimeKind.Utc);
        var composite = NewComposite();
        var sessionId = await NewSessions(NewSupabase()).RecordSessionAsync(Guid.NewGuid(), EventId, takenAt, composite, composite);

        _http.Respond = (_, _) => throw new HttpRequestException("réseau coupé");
        (await NewSessions(NewSupabase()).UploadPendingSessionsAsync()).Should().Be(0);

        _http.Calls.Clear();
        RespondNormally();
        (await NewSessions(NewSupabase()).UploadPendingSessionsAsync()).Should().Be(1);

        // Relue depuis SQLite (Kind non précisé), l'heure part bien en UTC avec « Z ».
        var record = JsonConvert.DeserializeObject<JObject>(
            _http.Calls.Single(c => c.Uri.EndsWith("/rpc/kiosk_record_photo")).Body,
            new JsonSerializerSettings { DateParseHandling = DateParseHandling.None })!;
        record["p_captured_at"]!.ToString().Should().Be("2026-11-04T21:10:05.123Z");
        record["p_storage_path"]!.ToString().Should().Be(StoragePath(sessionId));
    }

    private sealed record Call(HttpMethod Method, string Uri, string Body, byte[] Bytes, string? ContentType,
        string? Authorization, bool HasApiKey);

    private sealed class RecordingHandler : HttpMessageHandler
    {
        public List<Call> Calls { get; } = [];
        public Func<HttpRequestMessage, string, HttpResponseMessage> Respond { get; set; }
            = (_, _) => new HttpResponseMessage(HttpStatusCode.OK);

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var bytes = request.Content == null ? [] : await request.Content.ReadAsByteArrayAsync(ct);
            var body = Encoding.UTF8.GetString(bytes);
            Calls.Add(new Call(request.Method, request.RequestUri!.AbsoluteUri, body, bytes,
                request.Content?.Headers.ContentType?.MediaType,
                request.Headers.Authorization?.ToString(),
                request.Headers.Contains("apikey")));
            return Respond(request, body);
        }
    }
}
