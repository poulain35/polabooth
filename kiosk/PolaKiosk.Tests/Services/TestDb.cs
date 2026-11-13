using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using PolaKiosk.Models.LocalDb;

namespace PolaKiosk.Tests.Services;

/// <summary>Base SQLite en mémoire, créée comme sur la borne (EnsureCreated), vivante tant que l'instance l'est.</summary>
internal sealed class TestDb : IDisposable
{
    private readonly SqliteConnection _connection;

    public TestDb()
    {
        _connection = new SqliteConnection("DataSource=:memory:");
        _connection.Open();
        using var db = NewContext();
        db.Database.EnsureCreated();
    }

    public AppDbContext NewContext()
        => new(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(_connection).Options);

    public void Dispose() => _connection.Dispose();
}
