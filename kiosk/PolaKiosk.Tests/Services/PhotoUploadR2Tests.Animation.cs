using System.Net;
using FluentAssertions;
using Moq;
using Newtonsoft.Json.Linq;
using PolaKiosk.Models.LocalDb;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

/// <summary>
/// LAB-237 : envoi d'une séance GIF (affiche puis clip MP4 sur R2, une ligne photos de type gif),
/// refus définitif 22023, reprise hors ligne. SupabaseService réel, réponses HTTP simulées.
/// </summary>
public partial class PhotoUploadR2Tests
{
    private const string PresignedPosterUrl = "https://compte.r2.cloudflarestorage.com/photos/poster?X-Amz-Signature=p";
    private const string PresignedVideoUrl  = "https://compte.r2.cloudflarestorage.com/photos/clip?X-Amz-Signature=v";
    private const string RecordPhotoUri     = SupabaseUrl + "/rest/v1/rpc/kiosk_record_photo";
    private const string UploadUrlUri       = SupabaseUrl + "/functions/v1/get-kiosk-upload-url";

    private static readonly byte[] ClipBytes   = [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70];
    private static readonly byte[] PosterBytes = [0xFF, 0xD8, 0xFF, 0xE0, 0xFF, 0xD9];

    private static string SessionFolder(Guid sessionId) => $"photos/mariage-6f1d2c3b/{sessionId}";

    private AnimationClip NewClip()
    {
        var folder = _dir.File("animation");
        Directory.CreateDirectory(folder);
        var video  = Path.Combine(folder, "clip.mp4");
        var poster = Path.Combine(folder, "poster.jpg");
        File.WriteAllBytes(video, ClipBytes);
        File.WriteAllBytes(poster, PosterBytes);
        return new AnimationClip(video, poster, 6000, 720, 1080);
    }

    /// <summary>
    /// Réponse de get-kiosk-upload-url selon <c>kind</c>, comme la fonction : affiche toujours
    /// <c>{séance}/poster.jpg</c>, clip au nom demandé, photo sans kind.
    /// </summary>
    private static HttpResponseMessage AnimationUploadUrlResponse(HttpRequestMessage request, string body)
    {
        var ask = JObject.Parse(body);
        var folder = SessionFolder(Guid.Parse(ask["session_id"]!.ToString()));
        var (presigned, path, type) = ask["kind"]?.ToString() switch
        {
            "poster" => (PresignedPosterUrl, folder + "/poster.jpg", "image/jpeg"),
            "media"  => (PresignedVideoUrl, folder + "/" + ask["filename"], "video/mp4"),
            _        => (PresignedUrl, folder + "/composite_20261025_213000.jpg", "image/jpeg"),
        };
        return Json(new JObject
        {
            ["presigned_url"] = presigned,
            ["storage_path"]  = path,
            ["public_url"]    = "https://photos.example.com/" + path,
            ["content_type"]  = type,
        }.ToString());
    }

    private void RespondToAnimations(Func<HttpResponseMessage>? record = null)
    {
        _http.Respond = (request, body) => request.RequestUri!.AbsoluteUri switch
        {
            UploadUrlUri => AnimationUploadUrlResponse(request, body),
            PresignedUrl or PresignedPosterUrl or PresignedVideoUrl => new HttpResponseMessage(HttpStatusCode.OK),
            RecordPhotoUri => record?.Invoke() ?? Json($"\"{PhotoId}\""),
            var other => throw new InvalidOperationException($"Appel inattendu : {other}"),
        };
    }

    private static HttpResponseMessage Refused(string code)
        => Json($$"""{"code":"{{code}}","message":"refus","details":null,"hint":null}""", HttpStatusCode.BadRequest);

    private async Task<(Guid SessionId, string Composite, AnimationClip Clip)> RecordGifSessionAsync(
        SessionService sessions, DateTime? takenAt = null)
    {
        var composite = NewComposite();
        var clip = NewClip();
        var id = await sessions.RecordSessionAsync(Guid.NewGuid(), EventId, takenAt ?? DateTime.UtcNow, composite, composite,
            animation: clip);
        return (id, composite, clip);
    }

    [Fact]
    public async Task UploadAnimationAsync_sends_the_poster_then_the_clip_then_records_one_gif_row()
    {
        RespondToAnimations();
        var sessionId = Guid.NewGuid();

        var (url, photoId) = await NewSupabase().UploadAnimationAsync(sessionId, EventId, NewClip(), DateTime.UtcNow);

        var clipPath = SessionFolder(sessionId) + "/clip.mp4";
        url.Should().Be("https://photos.example.com/" + clipPath, "le QR mène au clip");
        photoId.Should().Be(PhotoId);
        _http.Calls.Select(c => (c.Method, c.Uri)).Should().Equal(
            (HttpMethod.Post, UploadUrlUri),
            (HttpMethod.Put, PresignedPosterUrl),
            (HttpMethod.Post, UploadUrlUri),
            (HttpMethod.Put, PresignedVideoUrl),
            (HttpMethod.Post, RecordPhotoUri));

        var posterAsk = JObject.Parse(_http.Calls[0].Body);
        posterAsk["kind"]!.ToString().Should().Be("poster");
        posterAsk["filename"]!.ToString().Should().Be("poster.jpg");
        posterAsk["content_length"]!.Value<long>().Should().Be(PosterBytes.Length);
        posterAsk["session_id"]!.ToString().Should().Be(sessionId.ToString());
        var videoAsk = JObject.Parse(_http.Calls[2].Body);
        videoAsk["kind"]!.ToString().Should().Be("media");
        videoAsk["filename"]!.ToString().Should().Be("clip.mp4");
        videoAsk["content_length"]!.Value<long>().Should().Be(ClipBytes.Length);

        _http.Calls[1].Bytes.Should().Equal(PosterBytes);
        _http.Calls[1].ContentType.Should().Be("image/jpeg");
        _http.Calls[3].Bytes.Should().Equal(ClipBytes);
        _http.Calls[3].ContentType.Should().Be("video/mp4");
        _http.Calls[3].Authorization.Should().BeNull();
        _http.Calls[3].HasApiKey.Should().BeFalse();

        var record = JObject.Parse(_http.Calls[4].Body);
        record["p_media_type"]!.ToString().Should().Be("gif");
        record["p_storage_path"]!.ToString().Should().Be(clipPath);
        record["p_photo_url"]!.ToString().Should().Be(url);
        record["p_thumbnail_path"]!.ToString().Should().Be(SessionFolder(sessionId) + "/poster.jpg");
        record["p_duration_ms"]!.Value<int>().Should().Be(6000);
        record["p_width"]!.Value<int>().Should().Be(720);
        record["p_height"]!.Value<int>().Should().Be(1080);
        record["p_code"]!.ToString().Should().Be("TUQNA5");
    }

    [Fact]
    public async Task A_photo_is_sent_exactly_as_before_without_kind_nor_media_parameters()
    {
        RespondToAnimations();

        await NewSupabase().UploadPhotoAsync(Guid.NewGuid(), EventId, NewComposite(), DateTime.UtcNow);

        JObject.Parse(_http.Calls[0].Body).ContainsKey("kind").Should().BeFalse();
        var record = JObject.Parse(_http.Calls[2].Body);
        record.Properties().Select(p => p.Name).Should().BeEquivalentTo(
            "p_code", "p_event_id", "p_storage_path", "p_photo_url", "p_machine_id", "p_secret", "p_captured_at");
    }

    [Fact]
    public async Task Unknown_size_or_duration_is_sent_as_null()
    {
        RespondToAnimations();
        var clip = NewClip() with { DurationMs = 0, Width = 720, Height = 0 };

        await NewSupabase().UploadAnimationAsync(Guid.NewGuid(), EventId, clip, DateTime.UtcNow);

        var record = JObject.Parse(_http.Calls.Single(c => c.Uri == RecordPhotoUri).Body);
        record["p_duration_ms"]!.Type.Should().Be(JTokenType.Null);
        record["p_width"]!.Type.Should().Be(JTokenType.Null, "largeur et hauteur : les deux ou aucune");
        record["p_height"]!.Type.Should().Be(JTokenType.Null);
    }

    [Fact]
    public async Task A_22023_refusal_stops_the_resends_keeps_the_files_and_is_logged()
    {
        var log = new Mock<IKioskLogService>();
        SessionService Sessions() => new(_db.NewContext(), NewSupabase(), log.Object, NewPaths());
        var (sessionId, composite, clip) = await RecordGifSessionAsync(Sessions());
        RespondToAnimations(() => Refused("22023"));

        (await Sessions().UploadPendingSessionsAsync()).Should().Be(0);

        using (var ctx = _db.NewContext())
        {
            var session = ctx.Sessions.Single();
            session.UploadRejected.Should().BeTrue();
            session.Uploaded.Should().BeFalse();
        }
        File.Exists(clip.VideoPath).Should().BeTrue();
        File.Exists(clip.PosterPath).Should().BeTrue();
        File.Exists(composite).Should().BeTrue();
        ShareInfoFile.Read(composite)!.IsShared.Should().BeFalse();
        log.Verify(l => l.LogWarningAsync("photo_upload", It.Is<string>(m => m.Contains("22023") && m.Contains("gif"))),
            Times.Once);
        using (var ctx = _db.NewContext())
            (await SessionService.LoadPendingIdsAsync(ctx)).Should().BeEmpty("plus annoncée en attente");

        // Cycle suivant et réouverture : plus aucun appel.
        _http.Calls.Clear();
        (await Sessions().UploadPendingSessionsAsync()).Should().Be(0);
        var reopen = () => Sessions().UploadSessionAsync(sessionId);
        await reopen.Should().ThrowAsync<MediaRecordRejectedException>();
        _http.Calls.Should().BeEmpty();
        log.Verify(l => l.LogWarningAsync(It.IsAny<string>(), It.IsAny<string>()), Times.Once);
    }

    [Theory]
    [InlineData("P0001", HttpStatusCode.BadRequest)]
    [InlineData("57014", HttpStatusCode.InternalServerError)]
    public async Task Any_other_refusal_keeps_the_session_pending(string code, HttpStatusCode status)
    {
        await RecordGifSessionAsync(NewSessions(NewSupabase()));
        RespondToAnimations(() => Json($$"""{"code":"{{code}}","message":"refus"}""", status));

        (await NewSessions(NewSupabase()).UploadPendingSessionsAsync()).Should().Be(0);

        using var ctx = _db.NewContext();
        var session = ctx.Sessions.Single();
        session.UploadRejected.Should().BeFalse();
        session.Uploaded.Should().BeFalse();
    }

    [Fact]
    public async Task A_gif_taken_offline_is_sent_once_when_the_network_returns()
    {
        var (sessionId, composite, _) = await RecordGifSessionAsync(NewSessions(NewSupabase()));

        _http.Respond = (_, _) => throw new HttpRequestException("réseau coupé");
        (await NewSessions(NewSupabase()).UploadPendingSessionsAsync()).Should().Be(0);

        _http.Calls.Clear();
        RespondToAnimations();
        (await NewSessions(NewSupabase()).UploadPendingSessionsAsync()).Should().Be(1);

        var clipPath = SessionFolder(sessionId) + "/clip.mp4";
        _http.Calls.Count(c => c.Uri == RecordPhotoUri).Should().Be(1);
        JObject.Parse(_http.Calls.Single(c => c.Uri == RecordPhotoUri).Body)["p_storage_path"]!.ToString()
            .Should().Be(clipPath, "même chemin à chaque renvoi : même ligne photos");
        ShareInfoFile.Read(composite).Should().Be(new ShareInfo(sessionId, "https://photos.example.com/" + clipPath, PhotoId));
        using (var ctx = _db.NewContext())
            ctx.Sessions.Single().Uploaded.Should().BeTrue();

        _http.Calls.Clear();
        (await NewSessions(NewSupabase()).UploadPendingSessionsAsync()).Should().Be(0);
        _http.Calls.Should().BeEmpty("déjà envoyée : pas de doublon");
    }

    [Fact]
    public async Task A_gif_whose_clip_is_gone_sends_its_photo_montage()
    {
        var (sessionId, _, clip) = await RecordGifSessionAsync(NewSessions(NewSupabase()));
        File.Delete(clip.VideoPath);
        RespondToAnimations();

        (await NewSessions(NewSupabase()).UploadPendingSessionsAsync()).Should().Be(1);

        _http.Calls.Should().NotContain(c => c.Uri == PresignedVideoUrl || c.Uri == PresignedPosterUrl);
        JObject.Parse(_http.Calls.Single(c => c.Uri == RecordPhotoUri).Body)["p_storage_path"]!.ToString()
            .Should().Be(StoragePath(sessionId));
    }

    [Theory]
    [InlineData(0, false, 100)]
    [InlineData(5 * 1024 * 1024, false, 160)]       // 5 Mo à 32 Ko/s
    [InlineData(120 * 1024, true, 600)]             // clip habituel : 10 min
    [InlineData(60L * 1024 * 1024, true, 1920)]     // clip au plafond du serveur (60 Mo)
    [InlineData(500L * 1024 * 1024, true, 3600)]    // une heure au plus
    public void Upload_timeout_depends_on_the_size(long bytes, bool video, int expectedSeconds)
        => SupabaseService.UploadTimeout(bytes, video).Should().Be(TimeSpan.FromSeconds(expectedSeconds));
}
