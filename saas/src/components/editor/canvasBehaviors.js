// Comportements posés sur le canvas Fabric à sa création (effet d'initialisation de useFabricCanvas).
import { Point, StaticCanvas, util } from '../../lib/fabric.js';
import { buttonTextFields, isKioskButton, textIndexAt } from '../../lib/kioskButton';
import { CANVAS_OVERFLOW_PAD, CANVAS_WORKSPACE } from './canvasStyle';

// Canvas agrandi de P de chaque côté (CANVAS_OVERFLOW_PAD) : rendu du fond, de la marge et de l'aperçu neutre.
export function installCanvasRendering(canvas, fmt, neutralPreviewRef) {
  const P = CANVAS_OVERFLOW_PAD;

  // Limiter le fond (backgroundColor) à la zone template uniquement,
  // laissant la zone de padding transparente (la couleur grise du parent div passe au travers).
  canvas._renderBackground = function(ctx) {
    if (!this.backgroundColor) return;
    if (this._exportMode) {
      // En mode export le canvas est redimensionné à W×H → rendu normal
      StaticCanvas.prototype._renderBackground.call(this, ctx);
      return;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(P, P, fmt.canvasWidth, fmt.canvasHeight);
    ctx.clip();
    ctx.translate(P, P);
    StaticCanvas.prototype._renderBackground.call(this, ctx);
    ctx.restore();
  };

  // Masque gris sur le padding : les objets qui dépassent du template
  // sont couverts par le gris, mais les poignées restent visibles par-dessus.
  // drawControls est appelé après ctx.restore() du viewport → contexte en scale(dpr,dpr).
  const origDrawControls = canvas.drawControls.bind(canvas);
  canvas.drawControls = function(ctx) {
    if (!this._exportMode) {
      ctx.save();
      ctx.fillStyle = CANVAS_WORKSPACE;
      const W = fmt.canvasWidth, H = fmt.canvasHeight;
      ctx.fillRect(0,     0,     W + P * 2, P);         // bande haute
      ctx.fillRect(0,     P + H, W + P * 2, P);         // bande basse
      ctx.fillRect(0,     P,     P,          H);          // bande gauche
      ctx.fillRect(P + W, P,     P,          H);          // bande droite
      ctx.restore();
    }
    origDrawControls(ctx);
  };

  // Aperçu neutre de l'accueil (LAB-296) : objets personnalisés ni dessinés ni sélectionnables,
  // sauf à l'export et à l'enregistrement (_exportMode), qui gardent tout.
  canvas._kioskNeutral = fmt.screenKind === 'home' && neutralPreviewRef.current;
  // Un bouton ou un emplacement reste toujours affiché sur la borne : la marque ne compte pas pour eux.
  const hiddenInPreview = (o) => canvas._kioskNeutral && !canvas._exportMode && o.personalizedOnly === true
    && !o.kioskAction && !o.kioskSlot;
  const origRenderObjects = canvas._renderObjects;
  canvas._renderObjects = function(ctx, objects) {
    return origRenderObjects.call(this, ctx, this._kioskNeutral ? objects.filter((o) => !hiddenInPreview(o)) : objects);
  };
  const origSearchTargets = canvas._searchPossibleTargets;
  canvas._searchPossibleTargets = function(objects, pointer, subTargets) {
    return origSearchTargets.call(this, this._kioskNeutral ? objects.filter((o) => !hiddenInPreview(o)) : objects, pointer, subTargets);
  };
  // Sélection au lasso : sans ce filtre, elle attrape aussi les objets masqués par l'aperçu neutre.
  const origCollectObjects = canvas.collectObjects;
  canvas.collectObjects = function(bbox, options) {
    const found = origCollectObjects.call(this, bbox, options);
    return this._kioskNeutral ? found.filter((o) => !hiddenInPreview(o)) : found;
  };
}

  // Écrans de la borne : le plan d'écran ne sait pas rendre un biais, on l'interdit
  // (objets ajoutés ou rechargés, et sélection multiple). Les verrous ne sont pas sérialisés.
export function attachKioskEditing(canvas, { setButtonTextFocus, setShowPropertiesSheet }) {
  const lockSkew = (o) => { if (o) { o.lockSkewingX = true; o.lockSkewingY = true; } };
  canvas.on('object:added', (e) => lockSkew(e.target));
  canvas.on('selection:created', () => lockSkew(canvas.getActiveObject()));
  canvas.on('selection:updated', () => lockSkew(canvas.getActiveObject()));
  // Fabric n'édite pas un texte dans un groupe, et dégrouper ferait perdre l'action :
  // le double-clic amène sur le champ du panneau qui correspond au texte touché (LAB-324).
  canvas.on('mouse:dblclick', (e) => {
    const target = e.target;
    if (!isKioskButton(target)) return;
    const fields = buttonTextFields(target);
    if (!fields.length) return;
    const local = util.transformPoint(e.scenePoint, util.invertTransform(target.calcTransformMatrix()));
    const index = textIndexAt(target, local) ?? fields[0].index;
    setButtonTextFocus({ target, index });
    if (window.innerWidth < 768) setShowPropertiesSheet(true);
  });
}

// Magnétisme : grille de 20 px, ou repères sur le centre, les bords et les autres objets.
export function attachSnapping(canvas, fmt, snapGridRef, setSnapGuides) {
  canvas.on('object:moving', (e) => {
    const obj = e.target;
    if (!obj) return;

    if (snapGridRef.current) {
      const G = 20;
      obj.set({ left: Math.round(obj.left / G) * G, top: Math.round(obj.top / G) * G });
      setSnapGuides([]);
      return;
    }

    const SNAP = 8;
    const cw = fmt.canvasWidth, ch = fmt.canvasHeight;
    const cp = obj.getCenterPoint();
    const br = obj.getBoundingRect();
    const halfW = br.width / 2;
    const halfH = br.height / 2;

    const guides = [];
    let ncx = cp.x, ncy = cp.y;
    let snappedX = false, snappedY = false;

    // ── Snap to canvas center ──
    if (Math.abs(cp.x - cw / 2) < SNAP) { ncx = cw / 2; snappedX = true; guides.push({ type: 'v', pos: cw / 2 }); }
    if (Math.abs(cp.y - ch / 2) < SNAP) { ncy = ch / 2; snappedY = true; guides.push({ type: 'h', pos: ch / 2 }); }

    // ── Snap to canvas edges ──
    if (!snappedX) {
      if (Math.abs(cp.x - halfW) < SNAP)        { ncx = halfW;       snappedX = true; guides.push({ type: 'v', pos: 0  }); }
      else if (Math.abs(cp.x + halfW - cw) < SNAP) { ncx = cw - halfW; snappedX = true; guides.push({ type: 'v', pos: cw }); }
    }
    if (!snappedY) {
      if (Math.abs(cp.y - halfH) < SNAP)        { ncy = halfH;       snappedY = true; guides.push({ type: 'h', pos: 0  }); }
      else if (Math.abs(cp.y + halfH - ch) < SNAP) { ncy = ch - halfH; snappedY = true; guides.push({ type: 'h', pos: ch }); }
    }

    // ── Snap to other objects ──
    if (!snappedX || !snappedY) {
      const others = canvas.getObjects().filter((o) => o !== obj && (obj.isPhotoZone || !o.isPhotoZone));
      for (const other of others) {
        const ocp = other.getCenterPoint();
        const obr = other.getBoundingRect();
        const oHalfW = obr.width / 2;
        const oHalfH = obr.height / 2;

        if (!snappedX) {
          if      (Math.abs(cp.x - ocp.x) < SNAP)                         { ncx = ocp.x;                  snappedX = true; guides.push({ type: 'v', pos: ocp.x }); }
          else if (Math.abs((cp.x - halfW) - (ocp.x - oHalfW)) < SNAP)   { ncx = ocp.x - oHalfW + halfW; snappedX = true; guides.push({ type: 'v', pos: ocp.x - oHalfW }); }
          else if (Math.abs((cp.x + halfW) - (ocp.x + oHalfW)) < SNAP)   { ncx = ocp.x + oHalfW - halfW; snappedX = true; guides.push({ type: 'v', pos: ocp.x + oHalfW }); }
          else if (Math.abs((cp.x - halfW) - (ocp.x + oHalfW)) < SNAP)   { ncx = ocp.x + oHalfW + halfW; snappedX = true; guides.push({ type: 'v', pos: ocp.x + oHalfW }); }
          else if (Math.abs((cp.x + halfW) - (ocp.x - oHalfW)) < SNAP)   { ncx = ocp.x - oHalfW - halfW; snappedX = true; guides.push({ type: 'v', pos: ocp.x - oHalfW }); }
        }
        if (!snappedY) {
          if      (Math.abs(cp.y - ocp.y) < SNAP)                         { ncy = ocp.y;                  snappedY = true; guides.push({ type: 'h', pos: ocp.y }); }
          else if (Math.abs((cp.y - halfH) - (ocp.y - oHalfH)) < SNAP)   { ncy = ocp.y - oHalfH + halfH; snappedY = true; guides.push({ type: 'h', pos: ocp.y - oHalfH }); }
          else if (Math.abs((cp.y + halfH) - (ocp.y + oHalfH)) < SNAP)   { ncy = ocp.y + oHalfH - halfH; snappedY = true; guides.push({ type: 'h', pos: ocp.y + oHalfH }); }
          else if (Math.abs((cp.y - halfH) - (ocp.y + oHalfH)) < SNAP)   { ncy = ocp.y + oHalfH + halfH; snappedY = true; guides.push({ type: 'h', pos: ocp.y + oHalfH }); }
          else if (Math.abs((cp.y + halfH) - (ocp.y - oHalfH)) < SNAP)   { ncy = ocp.y - oHalfH - halfH; snappedY = true; guides.push({ type: 'h', pos: ocp.y - oHalfH }); }
        }
        if (snappedX && snappedY) break;
      }
    }

    if (snappedX || snappedY) obj.setPositionByOrigin(new Point(ncx, ncy), 'center', 'center');
    setSnapGuides(guides);
  });
  canvas.on('mouse:up', () => setSnapGuides([]));
}

// Suppr / Retour arrière : supprime l'objet sélectionné ; flèches : le déplace (Maj : 10 px).
export function createCanvasKeyHandler(canvas, { setSelectedObject, setObjectVersion, saveHistorySnapshot }) {
  return (e) => {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      const active = canvas.getActiveObject();
      if (active && !((active.type === 'i-text' || active.type === 'textbox') && active.isEditing)) {
        // Fabric 7 ne retire pas une sélection multiple en bloc : on retire chacun de ses objets.
        const removed = canvas.getActiveObjects();
        canvas.discardActiveObject();
        canvas.remove(...removed);
        setSelectedObject(null);
        canvas.renderAll();
        saveHistorySnapshot(canvas);
      }
      return;
    }

    const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    if (arrows.includes(e.key)) {
      const active = canvas.getActiveObject();
      if (!active || ((active.type === 'i-text' || active.type === 'textbox') && active.isEditing)) return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowLeft')  active.set('left', active.left - step);
      if (e.key === 'ArrowRight') active.set('left', active.left + step);
      if (e.key === 'ArrowUp')    active.set('top',  active.top  - step);
      if (e.key === 'ArrowDown')  active.set('top',  active.top  + step);
      active.setCoords();
      canvas.renderAll();
      setObjectVersion((v) => v + 1);
      saveHistorySnapshot(canvas);
    }
  };
}
