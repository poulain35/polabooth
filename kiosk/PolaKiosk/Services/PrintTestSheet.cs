using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.IO;

namespace PolaKiosk.Services;

/// <summary>
/// Feuille de test du décalage de l'impression (LAB-433) : 10x15 en portrait à 300 dpi. Un trait tous les
/// millimètres depuis chaque bord (1 à 6 mm, noir et rouge en alternance) montre ce que l'imprimante rogne de
/// chaque côté : une impression centrée garde autant de traits à gauche qu'à droite, et en haut qu'en bas.
/// </summary>
public static class PrintTestSheet
{
    public const int Width  = 1200; // 4 pouces à 300 dpi
    public const int Height = 1800; // 6 pouces
    public const string PaperFormat = "4x6";
    public const int MaxMarkMm = 6;

    private const double PxPerMm = 300 / 25.4;

    /// <summary>Position en pixels du cadre à <paramref name="mm"/> millimètres du bord.</summary>
    public static int MarkInset(int mm) => (int)Math.Round(mm * PxPerMm);

    public static void Render(string path, PrintAdjustment? adjustment)
    {
        using var bitmap = new Bitmap(Width, Height, PixelFormat.Format24bppRgb);
        bitmap.SetResolution(300, 300);
        using (var g = Graphics.FromImage(bitmap))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            g.Clear(Color.White);

            // Fond gris jusqu'au bord : ce qui dépasse de la feuille se voit tout de suite.
            using (var edge = new SolidBrush(Color.FromArgb(200, 200, 200)))
            {
                g.FillRectangle(edge, 0, 0, Width, MarkInset(1));
                g.FillRectangle(edge, 0, Height - MarkInset(1), Width, MarkInset(1));
                g.FillRectangle(edge, 0, 0, MarkInset(1), Height);
                g.FillRectangle(edge, Width - MarkInset(1), 0, MarkInset(1), Height);
            }

            // Traits trop proches (1 mm) pour être numérotés : on les compte, noir et rouge en alternance.
            for (var mm = 1; mm <= MaxMarkMm; mm++)
            {
                var inset = MarkInset(mm);
                var color = mm % 2 == 0 ? Color.FromArgb(200, 30, 60) : Color.FromArgb(20, 20, 20);
                using var pen = new Pen(color, 3);
                g.DrawRectangle(pen, inset, inset, Width - 2 * inset, Height - 2 * inset);
            }

            // Croix du centre
            using (var cross = new Pen(Color.FromArgb(20, 20, 20), 3))
            {
                g.DrawLine(cross, Width / 2 - 60, Height / 2, Width / 2 + 60, Height / 2);
                g.DrawLine(cross, Width / 2, Height / 2 - 60, Width / 2, Height / 2 + 60);
            }

            using var title = new Font("Arial", 14, FontStyle.Bold, GraphicsUnit.Point);
            using var body  = new Font("Arial", 9, FontStyle.Regular, GraphicsUnit.Point);
            using var ink   = new SolidBrush(Color.FromArgb(20, 20, 20));
            var center = new StringFormat { Alignment = StringAlignment.Center };

            g.DrawString("▲ HAUT", title, ink, new RectangleF(0, 260, Width, 120), center);
            g.DrawString("Feuille de test de l'impression", title, ink, new RectangleF(0, 560, Width, 120), center);

            var lines = new[]
            {
                PrintAdjust.Summary(adjustment),
                "",
                "Un trait tous les millimètres depuis chaque bord.",
                "Comptez les traits entiers de chaque côté.",
                "",
                "Moins de traits à gauche qu'à droite :",
                "décalez vers la droite (et inversement).",
                "Moins de traits en haut qu'en bas :",
                "décalez vers le bas (et inversement).",
                "",
                "Un bord blanc après un décalage : agrandissez un peu.",
            };
            g.DrawString(string.Join("\n", lines), body, ink, new RectangleF(120, 1080, Width - 240, 600), center);
        }

        var temp = path + ".tmp";
        bitmap.Save(temp, ImageFormat.Png);
        File.Move(temp, path, overwrite: true);
    }
}
