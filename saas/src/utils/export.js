import { findPhotoZones, flattenObjects, photoZoneRect } from '../lib/photoZones';

// Masque/affiche un objet, même rangé dans des groupes imbriqués : Fabric ne marque « dirty »
// que le groupe direct, un groupe parent mis en cache garderait sinon l'ancien rendu.
function setVisible(obj, visible) {
  obj.set('visible', visible);
  for (let g = obj.group; g; g = g.group) g.dirty = true;
}

// Trace le rectangle (tourné) d'une zone dans le contexte d'export.
function traceZone(ctx, zone, scale, draw) {
  const { cx, cy, width, height, angle } = photoZoneRect(zone);
  ctx.save();
  ctx.translate(cx * scale, cy * scale);
  ctx.rotate((angle * Math.PI) / 180);
  draw(-(width * scale) / 2, -(height * scale) / 2, width * scale, height * scale);
  ctx.restore();
}

/**
 * Exports the Fabric.js canvas as a high-resolution PNG.
 *
 * With `punchZones` true (default), photo zones are punched out (made transparent)
 * using destination-out compositing so the kiosk can slot the live photo behind them.
 * Foreground objects stacked above the photo zones (e.g. a decoration or an image
 * the client placed on top of a zone) are re-drawn inside the punched holes so they
 * are not cut: the zone hole stays transparent only where nothing covers it.
 *
 * With `punchZones` false, no hole is cut: the template background shows through the
 * zone areas (zones are simply hidden). Useful for compositing the photos on top of
 * the template afterwards in another tool.
 *
 * Photo zones may sit inside groups (LAB-214): they are found recursively and punched
 * with their full transform (group position, scale and rotation included).
 *
 * Supports Option A layout: canvas may be larger than the template (W+2P × H+2P)
 * with a viewport transform offset. The canvas is temporarily reset to W×H for export.
 */
export async function exportAsHighResPNG(fabricCanvas, format, options = {}) {
  const { punchZones = true } = options;
  const { exportWidth, canvasWidth, canvasHeight } = format;
  const scale = exportWidth / canvasWidth;

  // If the canvas is expanded (Option A), temporarily reset to template dimensions.
  const origW = fabricCanvas.width;
  const origH = fabricCanvas.height;
  const origVT = fabricCanvas.viewportTransform.slice();
  const needsReset = origW !== canvasWidth || origH !== canvasHeight;

  if (needsReset) {
    fabricCanvas._exportMode = true;
    fabricCanvas.setWidth(canvasWidth);
    fabricCanvas.setHeight(canvasHeight);
    fabricCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    fabricCanvas.renderAll();
  }

  // Drawn objects in paint order, group children included (groups themselves are not drawn).
  const objects = flattenObjects(fabricCanvas.getObjects());
  const photoZones = findPhotoZones(fabricCanvas.getObjects());

  // Objects painted above the first photo zone are foreground overlays that must
  // survive the punch-out (otherwise an image dropped on a zone gets cut).
  const firstZoneIndex = objects.findIndex((o) => o.isPhotoZone);
  const foregroundObjects =
    firstZoneIndex >= 0
      ? objects.filter((o, i) => i > firstZoneIndex && !o.isPhotoZone)
      : [];

  // --- Base render: full canvas with photo zones hidden ---
  photoZones.forEach((o) => setVisible(o, false));
  fabricCanvas.renderAll();
  const baseURL = fabricCanvas.toDataURL({
    format: 'png',
    multiplier: scale,
    enableRetinaScaling: false,
  });
  photoZones.forEach((o) => setVisible(o, true));

  // --- Foreground render: only the overlay objects, on a transparent background ---
  let foregroundURL = null;
  if (punchZones && foregroundObjects.length) {
    const origBgColor = fabricCanvas.backgroundColor;
    const origBgImage = fabricCanvas.backgroundImage;
    const hidden = [];
    objects.forEach((o) => {
      if (!foregroundObjects.includes(o) && o.visible) {
        hidden.push(o);
        setVisible(o, false);
      }
    });
    fabricCanvas.backgroundColor = null;
    fabricCanvas.backgroundImage = null;
    fabricCanvas.renderAll();
    foregroundURL = fabricCanvas.toDataURL({
      format: 'png',
      multiplier: scale,
      enableRetinaScaling: false,
    });
    hidden.forEach((o) => setVisible(o, true));
    fabricCanvas.backgroundColor = origBgColor;
    fabricCanvas.backgroundImage = origBgImage;
  }

  // Restore expanded canvas state
  if (needsReset) {
    fabricCanvas.setWidth(origW);
    fabricCanvas.setHeight(origH);
    fabricCanvas.setViewportTransform(origVT);
    fabricCanvas._exportMode = false;
    fabricCanvas.renderAll();
  }

  // Fond plein: no hole cut, the template background shows through the zone areas.
  if (!punchZones) return baseURL;

  const loadImage = (src) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });

  const baseImg = await loadImage(baseURL);
  const foregroundImg = foregroundURL ? await loadImage(foregroundURL) : null;

  const offscreen = document.createElement('canvas');
  offscreen.width = baseImg.width;
  offscreen.height = baseImg.height;
  const ctx = offscreen.getContext('2d');

  // Draw the full canvas content
  ctx.drawImage(baseImg, 0, 0);

  // Punch out photo zone areas
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0,0,0,1)';
  photoZones.forEach((zone) => traceZone(ctx, zone, scale, (x, y, w, h) => ctx.fillRect(x, y, w, h)));
  ctx.globalCompositeOperation = 'source-over';

  // Re-draw foreground overlays, but only inside the punched holes so the rest of
  // the export is untouched (avoids double-compositing semi-transparent edges).
  if (foregroundImg) {
    ctx.save();
    ctx.beginPath();
    // Path points are fixed when added: each zone's rotation is undone before clip().
    photoZones.forEach((zone) => traceZone(ctx, zone, scale, (x, y, w, h) => ctx.rect(x, y, w, h)));
    ctx.clip();
    ctx.drawImage(foregroundImg, 0, 0);
    ctx.restore();
  }

  return offscreen.toDataURL('image/png');
}

export function downloadPNG(dataURL, filename = 'template-photobooth.png') {
  const link = document.createElement('a');
  link.download = filename;
  link.href = dataURL;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
