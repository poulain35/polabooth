using Microsoft.EntityFrameworkCore;

namespace PolaKiosk.Models.LocalDb;

/// <summary>
/// Mise à niveau d'une base existante (bornes en service) après <c>EnsureCreated</c>, qui ne crée que
/// les tables absentes : chaque colonne ajoutée au modèle depuis est ajoutée ici, si elle manque.
/// Sans effet sur une base neuve ou déjà à niveau.
/// </summary>
public static class LocalDbSchema
{
    /// <summary>Colonnes ajoutées après la mise en service des bornes : (table, colonne, définition SQLite).</summary>
    internal static readonly (string Table, string Column, string Definition)[] AddedColumns =
    [
        // Formats animés (LAB-237).
        ("Sessions", nameof(SessionEntity.MediaType),      "TEXT NOT NULL DEFAULT 'photo'"),
        ("Sessions", nameof(SessionEntity.VideoPath),      "TEXT NULL"),
        ("Sessions", nameof(SessionEntity.PosterPath),     "TEXT NULL"),
        ("Sessions", nameof(SessionEntity.DurationMs),     "INTEGER NULL"),
        ("Sessions", nameof(SessionEntity.Width),          "INTEGER NULL"),
        ("Sessions", nameof(SessionEntity.Height),         "INTEGER NULL"),
        ("Sessions", nameof(SessionEntity.UploadRejected), "INTEGER NOT NULL DEFAULT 0"),
    ];

    /// <summary>Ajoute les colonnes manquantes. Retourne le nombre de colonnes ajoutées.</summary>
    public static async Task<int> UpgradeAsync(AppDbContext db)
    {
        var added = 0;
        foreach (var group in AddedColumns.GroupBy(c => c.Table))
        {
            var table = group.Key;
            var existing = await db.Database
                .SqlQuery<string>($"SELECT name AS \"Value\" FROM pragma_table_info({table})")
                .ToListAsync();
            if (existing.Count == 0) continue; // table absente : EnsureCreated l'a créée complète ou elle n'existe pas

            foreach (var (_, column, definition) in group)
            {
                if (existing.Contains(column, StringComparer.OrdinalIgnoreCase)) continue;
                // Noms fixes de ce fichier, jamais une donnée : pas d'injection possible.
#pragma warning disable EF1002
                await db.Database.ExecuteSqlRawAsync($"ALTER TABLE \"{table}\" ADD COLUMN \"{column}\" {definition};");
#pragma warning restore EF1002
                added++;
            }
        }
        return added;
    }
}
