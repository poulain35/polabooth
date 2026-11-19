namespace PolaKiosk.Models.LocalDb;

public class SessionEntity
{
    public Guid Id { get; set; }
    public Guid EventId { get; set; }
    public DateTime CapturedAt { get; set; }
    public string PhotoPath { get; set; } = "";
    public string? CompositePath { get; set; }
    public bool Uploaded { get; set; } = false;

    /// <summary>Cadre du montage (LAB-315) : la réimpression depuis la galerie reprend son papier.</summary>
    public Guid? TemplateId { get; set; }

    // ── Formats animés (LAB-237) ─────────────────────────────────────────────
    // Une séance animée envoie son clip (VideoPath) et son affiche (PosterPath) ; le montage des photos
    // (CompositePath) reste celui de l'impression, il n'est pas envoyé.

    /// <summary><c>photo</c> (défaut) ou <c>gif</c> ; mêmes valeurs que <c>photos.media_type</c>.</summary>
    public string MediaType { get; set; } = SessionMediaType.Photo;

    /// <summary>Clip MP4 d'une séance animée, null pour une photo.</summary>
    public string? VideoPath { get; set; }

    /// <summary>Affiche JPEG du clip (image du milieu), null pour une photo.</summary>
    public string? PosterPath { get; set; }

    /// <summary>Durée du clip en millisecondes, null pour une photo.</summary>
    public int? DurationMs { get; set; }

    public int? Width { get; set; }
    public int? Height { get; set; }

    /// <summary>
    /// Refus définitif du serveur (code 22023 de kiosk_record_photo) : plus de renvoi, fichiers gardés
    /// sur la borne (même règle que les impressions, LAB-230).
    /// </summary>
    public bool UploadRejected { get; set; }
}

/// <summary>Types de séance (colonne <see cref="SessionEntity.MediaType"/>).</summary>
public static class SessionMediaType
{
    public const string Photo = "photo";
    public const string Gif   = "gif";
}
