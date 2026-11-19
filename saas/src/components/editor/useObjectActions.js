import { ActiveSelection, Circle, FabricImage, FabricText, Group, IText, Line, Point, Rect, Textbox } from '../../lib/fabric.js';
import { ACTION_LABELS, ACTION_BUTTON_TEXTS, VARIABLE_LABELS, VARIABLE_SAMPLES } from '../../lib/kioskScreenLayout';
import { KIOSK_COLORS, KIOSK_FONT_TITLE, KIOSK_FONT_TEXT } from '../../lib/kioskScreenTemplates';
import { ensureKioskFonts } from '../../utils/kioskFonts';
import { findPhotoZones } from '../../lib/photoZones';
import { importedImagePlacement, maxImagePx } from '../../lib/designImages';
import { isCompactViewport } from '../../lib/editorMobile';
import { createPhotoZoneRect } from './canvasStyle';
import { preparePhoto } from './imageTools';

  // ── Copy / Paste / Duplicate ─────────────────────────────────────────────────
const CLONE_PROPS = ['fontFamily', 'fontWeight', 'fontStyle', 'underline', 'charSpacing', 'textAlign', 'originX', 'originY', 'isPhotoZone', 'locked',
  'textTransform', 'kioskAction', 'kioskVariable', 'kioskSlot', 'personalizedOnly'];

// Les zones photo sont structurelles (définies par le format) : jamais dupliquées,
// sinon elles s'empilent en doublons invisibles (designs vus avec 20+ zones fantômes).
const involvesPhotoZone = (obj) => !!obj && findPhotoZones([obj]).length > 0;

// Objets sélectionnés dans l'ordre d'empilement du canvas (une sélection multiple les range autrement).
function selectedInStackOrder(canvas) {
  const all = canvas.getObjects();
  return canvas.getActiveObjects().filter((o) => all.includes(o)).sort((a, b) => all.indexOf(a) - all.indexOf(b));
}

// Plans. Fabric 7 ne déplace qu'un objet du canvas (une sélection multiple passée telle quelle serait
// ajoutée au canvas) : on déplace chaque objet sélectionné, comme le faisait Fabric 5.
function restack(canvas, direction) {
  const objs = selectedInStackOrder(canvas);
  if (!objs.length) return;
  const count = canvas.getObjects().length;
  if (direction === 'front') objs.forEach((o) => canvas.bringObjectToFront(o));
  if (direction === 'back') [...objs].reverse().forEach((o) => canvas.sendObjectToBack(o));
  // D'un cran : le plus haut d'abord (ou le plus bas), sans passer par-dessus un autre objet sélectionné.
  if (direction === 'forward') {
    [...objs].reverse().forEach((o, moved) => {
      const idx = canvas.getObjects().indexOf(o);
      if (idx < count - 1 - moved) canvas.moveObjectTo(o, idx + 1);
    });
  }
  if (direction === 'backward') {
    objs.forEach((o, moved) => {
      const idx = canvas.getObjects().indexOf(o);
      if (idx > moved) canvas.moveObjectTo(o, idx - 1);
    });
  }
}

// Ajoute une copie décalée au canvas et la sélectionne. Copie d'une sélection multiple : ses objets
// sont ajoutés un par un et restent sélectionnés ensemble (Fabric 7).
function addCopy(canvas, copy) {
  copy.set({ left: (copy.left ?? 0) + 15, top: (copy.top ?? 0) + 15, evented: true });
  canvas.discardActiveObject();
  if (copy instanceof ActiveSelection) {
    copy.canvas = canvas;
    copy.forEachObject((o) => canvas.add(o));
    copy.setCoords();
  } else {
    canvas.add(copy);
  }
  canvas.setActiveObject(copy);
  canvas.renderAll();
}

// Actions sur les objets du canvas : ajout (formes, texte, image, éléments de la borne, zone photo),
// suppression, plans, alignement, copier / coller, groupe, verrou, grille, menu contextuel.
// Fonctions recréées à chaque rendu, comme lorsqu'elles étaient écrites dans l'éditeur.
export function useObjectActions({
  currentFormat, homeMode, kioskMode, storesImages, kioskAllowed, setActivePanel, fabricRef, isSavingRef,
  clipboardRef, setSelectedObject, setObjectVersion, setContextMenu, setSnapGrid, snapGridRef,
  saveHistorySnapshot,
}) {
  // ── Add elements ─────────────────────────────────────────────────────────────
  // isSavingRef=true during canvas mutations to block any spurious object:modified
  // events fired internally by Fabric, then one explicit snapshot is saved.

  function addObjectToCanvas(obj) {
    const canvas = fabricRef.current;
    isSavingRef.current = true;
    canvas.add(obj);
    canvas.setActiveObject(obj);
    canvas.renderAll();
    isSavingRef.current = false;
    setSelectedObject(obj);
    saveHistorySnapshot(canvas);
    // Téléphone (LAB-353) : le panneau plein écran se referme pour montrer l'objet ajouté, sélectionné.
    if (isCompactViewport(window.innerWidth)) setActivePanel(null);

    // Re-sync bounding box after the browser has rendered with the real font
    if (obj.type === 'i-text' || obj.type === 'text' || obj.type === 'textbox') {
      requestAnimationFrame(() => {
        if (!fabricRef.current) return;
        obj.initDimensions?.();
        obj.setCoords();
        fabricRef.current.renderAll();
      });
    }
  }

  async function addText() {
    const W = currentFormat.canvasWidth;
    const fontSize = W < 300 ? 12 : 20;
    const fontFamily = 'Montserrat';
    // Wait for the font to be loaded before creating the object
    // so Fabric calculates dimensions with the real font metrics
    try { await document.fonts.load(`${fontSize}px "${fontFamily}"`); } catch (_) { /* ignore */ }
    addObjectToCanvas(new IText('Votre texte', {
      left: W / 2,
      top: currentFormat.canvasHeight / 2,
      fontFamily,
      fontSize,
      fill: '#1e293b',
      textAlign: 'center',
      originX: 'center',
      originY: 'center',
    }));
  }

  function addRect() {
    addObjectToCanvas(new Rect({
      left: 50, top: 50,
      width: Math.min(120, currentFormat.canvasWidth * 0.3),
      height: Math.min(80, currentFormat.canvasHeight * 0.15),
      fill: '#e2e8f0', stroke: '#94a3b8', strokeWidth: 1,
    }));
  }

  function addCircle() {
    addObjectToCanvas(new Circle({
      left: 50, top: 50,
      radius: Math.min(50, currentFormat.canvasWidth * 0.12),
      fill: '#e2e8f0', stroke: '#94a3b8', strokeWidth: 1,
    }));
  }

  function addLine() {
    const W = currentFormat.canvasWidth;
    const H = currentFormat.canvasHeight;
    addObjectToCanvas(new Line([W * 0.1, H * 0.5, W * 0.9, H * 0.5], {
      stroke: '#334155', strokeWidth: 1.5,
    }));
  }

  // Image aux proportions de la page : pleine page (importedImagePlacement), sinon réduite à 60 %.
  function placeImportedImage(imgEl) {
    const fabricImg = new FabricImage(imgEl);
    const { left, top, scale } = importedImagePlacement(fabricImg.width, fabricImg.height, currentFormat);
    fabricImg.set({ left, top, scaleX: scale, scaleY: scale });
    fabricImg.setCoords();
    return fabricImg;
  }

  function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (storesImages) {
      // LAB-348 : photo réduite à la résolution d'export avant l'ajout (puis l'envoi au stockage).
      e.target.value = '';
      preparePhoto(file, maxImagePx(currentFormat)).then((imgEl) => {
        addObjectToCanvas(placeImportedImage(imgEl));
      }).catch((err) => console.error('Import de photo impossible :', err));
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const imgEl = new Image();
      imgEl.onload = () => {
        addObjectToCanvas(placeImportedImage(imgEl));
      };
      imgEl.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  // ── Écrans de la borne (LAB-296) : bouton, texte vivant, emplacement ─────────
  // Tailles en px canvas (export ×2). Un bouton fait au moins 50 px canvas = 100 px à l'écran.
  async function addKioskButton(action) {
    if (!kioskAllowed?.actions.includes(action)) return;
    await ensureKioskFonts();
    const W = currentFormat.canvasWidth;
    const H = currentFormat.canvasHeight;
    const label = ACTION_BUTTON_TEXTS[action] ?? ACTION_LABELS[action] ?? action;
    const fontSize = 14;
    const caption = new FabricText(label, {
      fontFamily: KIOSK_FONT_TEXT, fontWeight: '600', fontSize,
      fill: KIOSK_COLORS.cream, originX: 'center', originY: 'center', left: 0, top: 0,
    });
    const w = Math.max(110, Math.ceil(caption.width) + 48);
    const h = 52;
    const shape = new Rect({
      width: w, height: h, rx: h / 2, ry: h / 2, fill: KIOSK_COLORS.forest, strokeWidth: 0,
      originX: 'center', originY: 'center', left: 0, top: 0,
    });
    const button = new Group([shape, caption], {
      left: W / 2, top: H / 2, originX: 'center', originY: 'center',
    });
    button.kioskAction = action;
    addObjectToCanvas(button);
  }

  async function addKioskVariable(variable) {
    if (!kioskAllowed?.variables.includes(variable)) return;
    await ensureKioskFonts();
    const W = currentFormat.canvasWidth;
    const H = currentFormat.canvasHeight;
    const isTitle = variable === 'event_name';
    const width = isTitle ? 420 : 260;
    const box = new Textbox(VARIABLE_SAMPLES[variable] ?? VARIABLE_LABELS[variable] ?? variable, {
      left: (W - width) / 2, top: H / 2 - 20, width,
      fontFamily: isTitle ? KIOSK_FONT_TITLE : KIOSK_FONT_TEXT,
      fontWeight: isTitle ? '600' : '500',
      fontSize: isTitle ? 32 : 16,
      fill: KIOSK_COLORS.dark, textAlign: 'center', strokeWidth: 0,
    });
    box.kioskVariable = variable;
    addObjectToCanvas(box);
  }

  function addKioskSlot(slot) {
    if (!kioskAllowed?.slots.includes(slot)) return;
    const W = currentFormat.canvasWidth;
    const H = currentFormat.canvasHeight;
    const w = 240, h = 160;
    const rect = new Rect({
      left: (W - w) / 2, top: (H - h) / 2, width: w, height: h,
      fill: KIOSK_COLORS.mint, strokeWidth: 0,
    });
    rect.kioskSlot = slot;
    addObjectToCanvas(rect);
  }

  function addPhotoZone() {
    if (homeMode || kioskMode) return;
    const canvas = fabricRef.current;
    const W = currentFormat.canvasWidth;
    const H = currentFormat.canvasHeight;
    const w = Math.round(W * 0.6);
    const h = Math.round(H * 0.6);
    const rect = createPhotoZoneRect({
      x: Math.round((W - w) / 2),
      y: Math.round((H - h) / 2),
      w, h,
    });
    isSavingRef.current = true;
    canvas.add(rect);
    canvas.sendObjectToBack(rect);
    canvas.setActiveObject(rect);
    canvas.renderAll();
    isSavingRef.current = false;
    setSelectedObject(rect);
    saveHistorySnapshot(canvas);
  }

  function deleteSelected() {
    const canvas = fabricRef.current;
    const active = canvas.getActiveObjects();
    if (!active.length) return;
    // Fabric 7 : la sélection est défaite d'abord, pour que chaque objet retrouve sa place sur le canvas.
    canvas.discardActiveObject();
    canvas.remove(...active);
    setSelectedObject(null);
    canvas.renderAll();
    saveHistorySnapshot(canvas);
  }

  function bringForward() {
    const canvas = fabricRef.current;
    if (!canvas?.getActiveObject()) return;
    restack(canvas, 'forward');
    canvas.renderAll();
  }

  function sendBackward() {
    const canvas = fabricRef.current;
    if (!canvas?.getActiveObject()) return;
    restack(canvas, 'backward');
    canvas.renderAll();
  }

  function bringToFront() {
    const canvas = fabricRef.current;
    if (!canvas?.getActiveObject()) return;
    restack(canvas, 'front');
    canvas.renderAll();
  }

  function sendToBack() {
    const canvas = fabricRef.current;
    if (!canvas?.getActiveObject()) return;
    restack(canvas, 'back');
    canvas.renderAll();
  }

  // ── Alignment helpers ─────────────────────────────────────────────────────────
  function alignObj(getNewCenter) {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (!obj) return;
    const br = obj.getBoundingRect();
    const cp = obj.getCenterPoint();
    const { x, y } = getNewCenter(br, cp, currentFormat.canvasWidth, currentFormat.canvasHeight);
    obj.setPositionByOrigin(new Point(x, y), 'center', 'center');
    canvas.renderAll();
    saveHistorySnapshot(canvas);
    setObjectVersion((v) => v + 1);
  }

  function alignLeft()    { alignObj((br, cp)       => ({ x: cp.x - br.left,                           y: cp.y })); }
  function alignRight()   { alignObj((br, cp, cw)   => ({ x: cp.x + (cw - br.left - br.width),        y: cp.y })); }
  function alignTop()     { alignObj((br, cp)       => ({ x: cp.x,                                    y: cp.y - br.top })); }
  function alignBottom()  { alignObj((br, cp, cw, ch) => ({ x: cp.x,                                  y: cp.y + (ch - br.top - br.height) })); }

  function centerH() {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (!obj) return;
    const cp = obj.getCenterPoint();
    obj.setPositionByOrigin(new Point(currentFormat.canvasWidth / 2, cp.y), 'center', 'center');
    canvas.renderAll();
    saveHistorySnapshot(canvas);
    setObjectVersion((v) => v + 1);
  }

  function centerV() {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (!obj) return;
    const cp = obj.getCenterPoint();
    obj.setPositionByOrigin(new Point(cp.x, currentFormat.canvasHeight / 2), 'center', 'center');
    canvas.renderAll();
    saveHistorySnapshot(canvas);
    setObjectVersion((v) => v + 1);
  }

  // ── Copy / Paste / Duplicate ─────────────────────────────────────────────────
  function copyObject() {
    const obj = fabricRef.current?.getActiveObject();
    if (!obj || involvesPhotoZone(obj)) return;
    obj.clone(CLONE_PROPS).then((cloned) => { clipboardRef.current = cloned; });
  }

  function pasteObject() {
    const canvas = fabricRef.current;
    if (!canvas || !clipboardRef.current || involvesPhotoZone(clipboardRef.current)) return;
    clipboardRef.current.clone(CLONE_PROPS).then((copy) => {
      addCopy(canvas, copy);
      setSelectedObject(copy);
      saveHistorySnapshot(canvas);
      clipboardRef.current = copy;
    });
  }

  function duplicateObject() {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (!obj || involvesPhotoZone(obj)) return;
    obj.clone(CLONE_PROPS).then((copy) => {
      addCopy(canvas, copy);
      setSelectedObject(copy);
      saveHistorySnapshot(canvas);
    });
  }

  // ── Group / Ungroup ──────────────────────────────────────────────────────────
  function groupSelected() {
    const canvas = fabricRef.current;
    const active = canvas?.getActiveObject();
    if (!active || active.type !== 'activeSelection') return;
    // Fabric 7 n'a plus toGroup : sélection défaite, objets retirés puis regroupés, groupe ajouté au-dessus.
    const objs = selectedInStackOrder(canvas);
    canvas.discardActiveObject();
    canvas.remove(...objs);
    const group = new Group(objs);
    canvas.add(group);
    canvas.setActiveObject(group);
    canvas.renderAll();
    setSelectedObject(group);
    saveHistorySnapshot(canvas);
  }

  function ungroupSelected() {
    const canvas = fabricRef.current;
    const group = canvas?.getActiveObject();
    if (!group || group.type !== 'group') return;
    // Fabric 7 n'a plus toActiveSelection : les objets sortent du groupe à leur place sur le canvas.
    canvas.discardActiveObject();
    canvas.remove(group);
    const items = group.removeAll();
    canvas.add(...items);
    const sel = new ActiveSelection(items, { canvas });
    canvas.setActiveObject(sel);
    canvas.renderAll();
    setSelectedObject(sel);
    saveHistorySnapshot(canvas);
  }

  // ── Lock / Unlock ────────────────────────────────────────────────────────────
  function toggleLock() {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (!obj) return;
    const locked = !obj.locked;
    obj.set({
      locked,
      lockMovementX:  locked,
      lockMovementY:  locked,
      lockScalingX:   locked,
      lockScalingY:   locked,
      lockRotation:   locked || !!obj.isPhotoZone,
      hasControls:    !locked,
      hoverCursor:    locked ? 'default' : null,
    });
    canvas.renderAll();
    setObjectVersion((v) => v + 1);
    saveHistorySnapshot(canvas);
  }

  // ── Snap grid ────────────────────────────────────────────────────────────────
  function toggleSnapGrid() {
    const next = !snapGridRef.current;
    snapGridRef.current = next;
    setSnapGrid(next);
  }

  // ── Properties panel callback ────────────────────────────────────────────────
  function handleObjectChange() {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.renderAll();
    // Increment version to trigger PropertiesPanel re-render
    // (selectedObject is the actual Fabric object — no need to re-assign)
    setObjectVersion((v) => v + 1);
    saveHistorySnapshot(canvas);
  }

  // ── Context menu ─────────────────────────────────────────────────────────────
  function handleCanvasContextMenu(e) {
    e.preventDefault();
    const canvas = fabricRef.current;
    if (!canvas) return;
    const obj = canvas.getActiveObject();
    if (obj) {
      setContextMenu({ x: e.clientX, y: e.clientY });
    }
  }

  return {
    addObjectToCanvas, addText, addRect, addCircle, addLine, handleImageUpload, addKioskButton,
    addKioskVariable, addKioskSlot, addPhotoZone, deleteSelected, bringForward, sendBackward, bringToFront,
    sendToBack, alignLeft, alignRight, alignTop, alignBottom, centerH, centerV, copyObject, pasteObject,
    duplicateObject, groupSelected, ungroupSelected, toggleLock, toggleSnapGrid, handleObjectChange,
    handleCanvasContextMenu,
  };
}
