using Microsoft.EntityFrameworkCore;

namespace PolaKiosk.Models.LocalDb;

/// <summary>
/// Colonnes ajoutées après la création de la base SQLite de la borne. EnsureCreated ne touche pas
/// une base existante et SQLite n'a pas de « ADD COLUMN IF NOT EXISTS » : chaque colonne absente
/// (vérifiée dans pragma_table_info) est ajoutée par ALTER TABLE, sans perte de données.
/// </summary>
public static class LocalDbColumns
{
    // (table, colonne, type SQLite) — même forme que celle créée par EF Core pour une base neuve.
    internal static readonly IReadOnlyList<(string Table, string Column, string Type)> Added =
    [
        ("Events", "StartDate", "TEXT"), // LAB-251 : dates de l'événement affichées sur l'accueil
        ("Events", "EndDate",   "TEXT"),
    ];

    public static async Task EnsureAsync(DbContext db)
    {
        // Noms fixes du code ci-dessus, jamais une saisie : pas de paramètre SQL possible pour un nom de table.
        foreach (var (table, column, type) in Added)
        {
            string countSql = "SELECT COUNT(*) AS \"Value\" FROM pragma_table_info('" + table + "') WHERE name = '" + column + "'";
            var exists = await db.Database.SqlQueryRaw<int>(countSql).SingleAsync();
            if (exists > 0) continue;

            string alterSql = "ALTER TABLE \"" + table + "\" ADD COLUMN \"" + column + "\" " + type + " NULL";
            await db.Database.ExecuteSqlRawAsync(alterSql);
        }
    }
}
