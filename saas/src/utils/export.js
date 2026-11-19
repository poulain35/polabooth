import { findPhotoZones, flattenObjects, photoZoneRect } from '../lib/photoZones.js';

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

  // Drawn objects in paint order, group children included (groups themselves are not drawn).
  const objects = flattenObjects(fabricCanvas.getObjects());
  const photoZones = findPhotoZones(fabricCanvas.getObjects());
  const visibleBefore = objects.map((o) => o.visible);
  const origBgColor = fabricCanvas.backgroundColor;
  const origBgImage = fabricCanvas.backgroundImage;

  // Objects painted above the first photo zone are foreground overlays that must
  // survive the punch-out (otherwise an image dropped on a zone gets cut).
  const firstZoneIndex = objects.findIndex((o) => o.isPhotoZone);
  const foregroundObjects =
    firstZoneIndex >= 0
      ? objects.filter((o, i) => i > firstZoneIndex && !o.isPhotoZone)
      : [];

  let baseURL;
  let foregroundURL = null;
  // finally : même en cas d'échec (canvas « tainted » par une image distante), le design est rendu
  // tel quel à l'éditeur (aperçu sur la borne, LAB-307).
  try {
    if (needsReset) {
      fabricCanvas._exportMode = true;
      fabricCanvas.setDimensions({ width: canvasWidth, height: canvasHeight });
      fabricCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
      fabricCanvas.renderAll();
    }

    // --- Base render: full canvas with photo zones hidden ---
    photoZones.forEach((o) => setVisible(o, false));
    fabricCanvas.renderAll();
    baseURL = fabricCanvas.toDataURL({
      format: 'png',
      multiplier: scale,
      enableRetinaScaling: false,
    });
    photoZones.forEach((o) => setVisible(o, true));

    // --- Foreground render: only the overlay objects, on a transparent background ---
    if (punchZones && foregroundObjects.length) {
      objects.forEach((o) => {
        if (!foregroundObjects.includes(o) && o.visible) setVisible(o, false);
      });
      fabricCanvas.backgroundColor = null;
      fabricCanvas.backgroundImage = null;
      fabricCanvas.renderAll();
      foregroundURL = fabricCanvas.toDataURL({
        format: 'png',
        multiplier: scale,
        enableRetinaScaling: false,
      });
    }
  } finally {
    objects.forEach((o, i) => {
      if (o.visible !== visibleBefore[i]) setVisible(o, visibleBefore[i]);
    });
    fabricCanvas.backgroundColor = origBgColor;
    fabricCanvas.backgroundImage = origBgImage;
    // Restore expanded canvas state
    if (needsReset) {
      fabricCanvas.setDimensions({ width: origW, height: origH });
      fabricCanvas.setViewportTransform(origVT);
      fabricCanvas._exportMode = false;
    }
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

/**
 * Écrans de la borne (LAB-298) : exporte les images d'un plan de buildScreenLayout, à partir des
 * `parts` calculées sur les objets de premier niveau du canvas (même ordre que serializeState).
 * - fond : seuls les objets de `parts.background.objectIndices` (le décor), sans bouton, texte
 *   vivant ni emplacement ; le fond du canvas reste transparent s'il l'est ;
 * - fond neutre (accueil) : idem sans les objets « Seulement si l'accueil est personnalisé » ;
 * - un PNG transparent par bouton, recadré sur sa boîte d'export (`box`, px d'export).
 * Retourne `[{ name, dataUrl }]`. Le canvas est rendu à W×H puis remis dans son état d'origine.
 */
export function exportScreenParts(fabricCanvas, format, parts) {
  const { exportWidth, canvasWidth, canvasHeight } = format;
  const scale = exportWidth / canvasWidth;
  const objects = fabricCanvas.getObjects();
  const visibleBefore = objects.map((o) => o.visible);
  const origW = fabricCanvas.width;
  const origH = fabricCanvas.height;
  const origVT = fabricCanvas.viewportTransform.slice();
  const origExportMode = fabricCanvas._exportMode;
  const origBgColor = fabricCanvas.backgroundColor;
  const origBgImage = fabricCanvas.backgroundImage;

  // Seuls les objets de `indices` sont visibles (un objet masqué dans l'éditeur le reste).
  const showOnly = (indices) => {
    const keep = new Set(indices);
    objects.forEach((o, i) => setVisible(o, keep.has(i) && visibleBefore[i] !== false));
  };
  const render = (crop = null) => {
    fabricCanvas.renderAll();
    return fabricCanvas.toDataURL({
      format: 'png',
      multiplier: scale,
      enableRetinaScaling: false,
      ...(crop ?? {}),
    });
  };

  const out = [];
  try {
    fabricCanvas._exportMode = true;
    fabricCanvas.setDimensions({ width: canvasWidth, height: canvasHeight });
    fabricCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);

    if (parts.background?.name) {
      showOnly(parts.background.objectIndices);
      out.push({ name: parts.background.name, dataUrl: render() });
    }
    if (parts.backgroundNeutral?.name) {
      showOnly(parts.backgroundNeutral.objectIndices);
      out.push({ name: parts.backgroundNeutral.name, dataUrl: render() });
    }
    if (parts.buttons?.length) {
      fabricCanvas.backgroundColor = null;
      fabricCanvas.backgroundImage = null;
      for (const button of parts.buttons) {
        showOnly([button.objectIndex]);
        const { x, y, w, h } = button.box;
        out.push({
          name: button.name,
          dataUrl: render({ left: x / scale, top: y / scale, width: w / scale, height: h / scale }),
        });
      }
    }
  } finally {
    objects.forEach((o, i) => setVisible(o, visibleBefore[i]));
    fabricCanvas.backgroundColor = origBgColor;
    fabricCanvas.backgroundImage = origBgImage;
    fabricCanvas.setDimensions({ width: origW, height: origH });
    fabricCanvas.setViewportTransform(origVT);
    fabricCanvas._exportMode = origExportMode;
    fabricCanvas.renderAll();
  }
  return out;
}

/**
 * Aperçu d'un écran de la borne (LAB-298) pour les cartes de l'admin : PNG à la moitié du canvas
 * (480×270), tous les objets visibles, sans damier ni repères. null si le canvas est « tainted ».
 */
export function exportScreenPreview(fabricCanvas, format) {
  const origW = fabricCanvas.width;
  const origH = fabricCanvas.height;
  const origVT = fabricCanvas.viewportTransform.slice();
  const origExportMode = fabricCanvas._exportMode;
  try {
    fabricCanvas._exportMode = true;
    fabricCanvas.setDimensions({ width: format.canvasWidth, height: format.canvasHeight });
    fabricCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    fabricCanvas.renderAll();
    return fabricCanvas.toDataURL({ format: 'png', multiplier: 0.5, enableRetinaScaling: false });
  } catch (err) {
    console.warn('Aperçu de l’écran impossible :', err?.message ?? err);
    return null;
  } finally {
    fabricCanvas.setDimensions({ width: origW, height: origH });
    fabricCanvas.setViewportTransform(origVT);
    fabricCanvas._exportMode = origExportMode;
    fabricCanvas.renderAll();
  }
}
