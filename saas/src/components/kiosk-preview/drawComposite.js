import { compositePlacements, hasTransparentArea } from '../../lib/kioskComposite';
import { loadPreviewImage } from './previewImages';

// Montage du tirage comme CompositeService de la borne : fond blanc, photos en cover centré tournées
// autour du centre de leur zone, dernière photo répétée, PNG troué posé par-dessus à la taille du
// tirage. Sans zone photo, un décor sans partie transparente n'est pas posé. Partagé avec
// l'écran de partage de l'aperçu (LAB-309), qui montre ce même tirage dans son emplacement.
export async function drawComposite(target, { formatId, zones, pngUrl, photos }) {
  const { print, fullFrame, placements } = compositePlacements({
    format: formatId,
    zones,
    photos: photos.map((p) => ({ width: p.naturalWidth || p.width, height: p.naturalHeight || p.height })),
  });
  const template = await loadPreviewImage(pngUrl);

  target.width = print.w;
  target.height = print.h;
  const ctx = target.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, print.w, print.h);

  for (const p of placements) {
    const { source, dest, pivot } = p;
    ctx.save();
    ctx.translate(pivot.x, pivot.y);
    ctx.rotate((p.angle * Math.PI) / 180);
    ctx.translate(-pivot.x, -pivot.y);
    ctx.drawImage(
      photos[p.photoIndex],
      source.left, source.top, source.right - source.left, source.bottom - source.top,
      dest.left, dest.top, dest.width, dest.height,
    );
    ctx.restore();
  }

  if (fullFrame) {
    const scratch = document.createElement('canvas');
    scratch.width = print.w;
    scratch.height = print.h;
    const sctx = scratch.getContext('2d');
    sctx.drawImage(template, 0, 0, print.w, print.h);
    // PNG final d'un autre domaine (fiche de l'événement) : pixels illisibles, le décor reste posé.
    let pixels = null;
    try { pixels = sctx.getImageData(0, 0, print.w, print.h); } catch { /* canvas protégé */ }
    if (pixels && !hasTransparentArea(pixels)) return { fullFrame, decorDropped: true };
    ctx.drawImage(scratch, 0, 0);
    return { fullFrame, decorDropped: false };
  }
  ctx.drawImage(template, 0, 0, print.w, print.h);
  return { fullFrame, decorDropped: false };
}
