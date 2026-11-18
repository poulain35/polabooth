using System.Net;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Moq;
using PolaKiosk.Services;

namespace PolaKiosk.Tests.Services;

// LAB-394 : téléchargement des fichiers (fonds, logo, images et polices des écrans, cadres).
public sealed class AssetDownloadTests : IDisposable
{
    private const string SupabaseUrl = "https://projet.supabase.co";
    private const string AnonKey = "anon-key";

    private readonly TempDir _dir = new();
    private readonly StubHandler _handler = new();

    public void Dispose() => _dir.Dispose();

    private SupabaseService NewService()
    {
        var settings = new AppSettings { Supabase = new SupabaseSettings { Url = SupabaseUrl + "/", AnonKey = AnonKey } };
        var scopes = new ServiceCollection().BuildServiceProvider().GetRequiredService<IServiceScopeFactory>();
        return new SupabaseService(settings, Mock.Of<IKioskCredentials>(), scopes, _handler);
    }

    private static Task Download(SupabaseService service, string url, string path)
        => service.DownloadAssetAsync(url, path, TestContext.Current.CancellationToken);

    [Fact]
    public async Task A_file_from_supabase_is_requested_with_the_supabase_headers()
    {
        _handler.Respond = _ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent([1, 2, 3]) };

        await Download(NewService(), SupabaseUrl + "/storage/v1/object/public/kiosk-backgrounds/fond.jpg", _dir.File("fond.img"));

        _handler.Requests.Should().ContainSingle();
        _handler.Requests[0].ApiKey.Should().Be(AnonKey);
        _handler.Requests[0].Authorization.Should().Be("Bearer " + AnonKey);
        File.ReadAllBytes(_dir.File("fond.img")).Should().Equal(1, 2, 3);
    }

    [Theory]
    [InlineData("https://cdn.exemple.fr/logo.png")]
    [InlineData("https://projet.supabase.co.exemple.fr/logo.png")]
    [InlineData("http://projet.supabase.co/logo.png")]
    [InlineData("https://projet.supabase.co:8443/logo.png")]
    public async Task A_file_hosted_elsewhere_never_receives_the_supabase_key(string url)
    {
        _handler.Respond = _ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent([7]) };

        await Download(NewService(), url, _dir.File("logo.img"));

        _handler.Requests.Should().ContainSingle();
        _handler.Requests[0].ApiKey.Should().BeNull();
        _handler.Requests[0].Authorization.Should().BeNull();
        File.ReadAllBytes(_dir.File("logo.img")).Should().Equal(7);
    }

    [Fact]
    public async Task A_file_announced_over_50_mb_is_refused_without_writing_anything()
    {
        File.WriteAllBytes(_dir.File("logo.img"), [9]);
        _handler.Respond = _ =>
        {
            var content = new ByteArrayContent([1]);
            content.Headers.ContentLength = SupabaseService.MaxAssetBytes + 1;
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = content };
        };

        var act = () => Download(NewService(), "https://cdn.exemple.fr/logo.png", _dir.File("logo.img"));

        (await act.Should().ThrowAsync<FileTooLargeException>()).WithMessage(SupabaseService.AssetTooLargeMessage);
        File.ReadAllBytes(_dir.File("logo.img")).Should().Equal(9);
        Directory.EnumerateFiles(_dir.Path).Should().ContainSingle("aucun fichier temporaire ne reste");
    }

    [Fact]
    public async Task A_file_streamed_beyond_50_mb_is_refused_without_writing_anything()
    {
        File.WriteAllBytes(_dir.File("fond.img"), [9]);
        _handler.Respond = _ => new HttpResponseMessage(HttpStatusCode.OK)
            { Content = new UnsizedContent(SupabaseService.MaxAssetBytes + 1) };

        var act = () => Download(NewService(), "https://cdn.exemple.fr/fond.jpg", _dir.File("fond.img"));

        (await act.Should().ThrowAsync<FileTooLargeException>()).WithMessage(SupabaseService.AssetTooLargeMessage);
        File.ReadAllBytes(_dir.File("fond.img")).Should().Equal(9);
        Directory.EnumerateFiles(_dir.Path).Should().ContainSingle("aucun fichier temporaire ne reste");
    }

    [Fact]
    public async Task A_file_of_exactly_50_mb_is_accepted()
    {
        _handler.Respond = _ => new HttpResponseMessage(HttpStatusCode.OK)
            { Content = new UnsizedContent(SupabaseService.MaxAssetBytes) };

        await Download(NewService(), "https://cdn.exemple.fr/police.ttf", _dir.File("police.ttf"));

        new FileInfo(_dir.File("police.ttf")).Length.Should().Be(SupabaseService.MaxAssetBytes);
    }

    [Fact]
    public async Task A_failed_download_keeps_the_previous_file()
    {
        File.WriteAllBytes(_dir.File("fond.img"), [9]);
        _handler.Respond = _ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new FailingContent() };

        var act = () => Download(NewService(), "https://cdn.exemple.fr/fond.jpg", _dir.File("fond.img"));

        await act.Should().ThrowAsync<IOException>();
        File.ReadAllBytes(_dir.File("fond.img")).Should().Equal(9);
        Directory.EnumerateFiles(_dir.Path).Should().ContainSingle("aucun fichier temporaire ne reste");
    }

    [Fact]
    public async Task An_error_response_writes_nothing()
    {
        _handler.Respond = _ => new HttpResponseMessage(HttpStatusCode.NotFound);

        var act = () => Download(NewService(), "https://cdn.exemple.fr/fond.jpg", _dir.File("fond.img"));

        await act.Should().ThrowAsync<HttpRequestException>();
        Directory.EnumerateFiles(_dir.Path).Should().BeEmpty();
    }

    private sealed record Request(string Url, string? ApiKey, string? Authorization);

    private sealed class StubHandler : HttpMessageHandler
    {
        public Func<HttpRequestMessage, HttpResponseMessage> Respond { get; set; } =
            _ => new HttpResponseMessage(HttpStatusCode.OK);

        public List<Request> Requests { get; } = new();

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests.Add(new Request(request.RequestUri!.ToString(),
                request.Headers.TryGetValues("apikey", out var keys) ? keys.Single() : null,
                request.Headers.Authorization?.ToString()));
            return Task.FromResult(Respond(request));
        }
    }

    /// <summary>Contenu envoyé en flux sans taille annoncée (pas d'en-tête Content-Length).</summary>
    private sealed class UnsizedContent(long length) : HttpContent
    {
        protected override async Task SerializeToStreamAsync(Stream stream, TransportContext? context)
        {
            var chunk = new byte[81920];
            for (var left = length; left > 0; left -= chunk.Length)
                await stream.WriteAsync(chunk.AsMemory(0, (int)Math.Min(chunk.Length, left)));
        }

        protected override bool TryComputeLength(out long length)
        {
            length = 0;
            return false;
        }
    }

    /// <summary>Connexion coupée en plein téléchargement.</summary>
    private sealed class FailingContent : HttpContent
    {
        protected override Task<Stream> CreateContentReadStreamAsync() => Task.FromResult<Stream>(new FailingStream());

        protected override Task SerializeToStreamAsync(Stream stream, TransportContext? context)
            => throw new IOException("Connexion coupée");

        protected override bool TryComputeLength(out long length)
        {
            length = 0;
            return false;
        }
    }

    private sealed class FailingStream : Stream
    {
        private bool _sent;
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => 0; set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count)
        {
            if (_sent) throw new IOException("Connexion coupée");
            _sent = true;
            buffer[offset] = 1;
            return 1;
        }
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }
}
