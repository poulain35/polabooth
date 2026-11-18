using System.IO;

namespace PolaKiosk.Services;

/// <summary>Fichier refusé parce qu'il dépasse la taille permise (téléchargement ou décompression).</summary>
public sealed class FileTooLargeException(string message) : IOException(message);

/// <summary>
/// Flux en lecture seule qui lève <see cref="FileTooLargeException"/> dès qu'on y a lu plus de
/// <c>maxBytes</c> octets : borne un téléchargement ou une décompression GZip sans tout lire en mémoire.
/// </summary>
internal sealed class BoundedReadStream(Stream inner, long maxBytes, string tooLargeMessage) : Stream
{
    private long _read;

    public override bool CanRead => true;
    public override bool CanSeek => false;
    public override bool CanWrite => false;
    public override long Length => throw new NotSupportedException();
    public override long Position
    {
        get => _read;
        set => throw new NotSupportedException();
    }

    public override int Read(byte[] buffer, int offset, int count) => Count(inner.Read(buffer, offset, count));

    public override int Read(Span<byte> buffer) => Count(inner.Read(buffer));

    public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        => Count(await inner.ReadAsync(buffer, cancellationToken));

    public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken)
        => ReadAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();

    private int Count(int read)
    {
        _read += read;
        if (_read > maxBytes) throw new FileTooLargeException(tooLargeMessage);
        return read;
    }

    public override void Flush() { }
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

    protected override void Dispose(bool disposing)
    {
        if (disposing) inner.Dispose();
        base.Dispose(disposing);
    }

    public override async ValueTask DisposeAsync()
    {
        await inner.DisposeAsync();
        await base.DisposeAsync();
    }
}
