import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { centeredScroll, fitZoom } from '../../lib/editorFit';
import { zoomAnchorFraction, zoomScrollDelta } from '../../lib/editorMobile';

// La feuille des propriétés (téléphone) prend 40 vh : le zoom d'ajustement se recalcule quand elle s'ouvre.
export const SHEET_VH = 0.40; // doit correspondre au maxHeight du bottom sheet

// Zoom du modèle par transformation CSS (Fabric reste à 1 : coordonnées exactes) : ajustement à la zone
// de travail, boutons, pincement (téléphone). La molette est dans useWheelZoom, appelé plus bas dans l'éditeur.
export function useEditorZoom({
  currentFormat, showPropertiesSheet,
}) {
  const [cssZoom,    setCssZoom]    = useState(1);  // CSS transform scale sur le wrapper canvas
  const cssZoomRef  = useRef(1);                    // mirror pour les handlers touch
  const fitScaleRef = useRef(1);                    // scale d'ajustement initial (mobile)
  const canvasAreaRef     = useRef(null); // zone scrollable (mesure largeur pour auto-fit)
  const canvasInnerDivRef = useRef(null); // div CSS-transform → utilisé pour positionner la toolbar flottante
  const pinchRef = useRef({ active: false, dist: 0, initZoom: 1 });

  // ── Recalcul du zoom quand le bottom sheet s'ouvre/ferme (mobile) ─────────────
  // La sheet prend 40 vh → le canvas visible au-dessus se réduit → on ré-ajuste le scale
  useEffect(() => {
    if (!canvasAreaRef.current || window.innerWidth >= 768) return;
    const fmt   = currentFormat;
    const PAD   = 8;
    const areaW = canvasAreaRef.current.clientWidth  - PAD * 2;
    const areaH = canvasAreaRef.current.clientHeight - PAD * 2;

    // La sheet couvre environ SHEET_VH * vh depuis le bas de la zone canvas (8 px de marge au-dessus).
    const availH = showPropertiesSheet ? Math.max(60, areaH - window.innerHeight * SHEET_VH - 8) : areaH;
    applyFitZoom(fitZoom({ areaW, areaH: availH, canvasWidth: fmt.canvasWidth, canvasHeight: fmt.canvasHeight }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPropertiesSheet, currentFormat.id]);

  // ── Réajustement quand la zone de travail change de taille (grand écran) ─────
  // Panneau ouvert ou fermé, fenêtre redimensionnée : tant que l'utilisateur n'a pas zoomé lui-même,
  // le modèle reprend le zoom d'ajustement et reste centré.
  useEffect(() => {
    const area = canvasAreaRef.current;
    if (!area || typeof ResizeObserver === 'undefined') return;
    let last = { w: area.clientWidth, h: area.clientHeight };
    const observer = new ResizeObserver(() => {
      if (area.clientWidth === last.w && area.clientHeight === last.h) return;
      last = { w: area.clientWidth, h: area.clientHeight };
      if (window.innerWidth < 768) return; // téléphone : effet de la sheet ci-dessus
      if (Math.abs(cssZoomRef.current - fitScaleRef.current) > 0.001) return; // zoom choisi par l'utilisateur
      const PAD = 32; // p-8
      applyFitZoom(fitZoom({
        areaW: area.clientWidth - PAD * 2, areaH: area.clientHeight - PAD * 2,
        canvasWidth: currentFormat.canvasWidth, canvasHeight: currentFormat.canvasHeight,
      }));
    });
    observer.observe(area);
    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFormat.id]);

  // ── Pinch-to-zoom (mobile) ───────────────────────────────────────────────────
  function handleCanvasTouchStart(e) {
    if (e.touches.length !== 2) return;
    e.preventDefault();
    const dist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY,
    );
    pinchRef.current = { active: true, dist, initZoom: cssZoomRef.current };
  }

  // Zoom d'ajustement : le modèle (sans la zone de débord) remplit la zone de travail, puis la zone
  // est recentrée, puisque le débord dépasse et se lit en défilant (editorFit.js).
  function applyFitZoom(zoom) {
    fitScaleRef.current = zoom;
    cssZoomRef.current  = zoom;
    setCssZoom(zoom);
    centerCanvasArea();
  }

  function centerCanvasArea() {
    // Après le rendu de la nouvelle taille : deux images pour laisser React appliquer le zoom.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const area = canvasAreaRef.current;
      if (!area) return;
      const { left, top } = centeredScroll(area);
      area.scrollLeft = left;
      area.scrollTop  = top;
    }));
  }

  // Zoom ancré (LAB-353) : le point du modèle sous `anchor` (coordonnées écran ; par défaut le centre
  // de la zone) y reste après le zoom. Sans cela, le défilement restait à 0 et le modèle se décentrait.
  const zoomAnchorRef = useRef(null);
  function applyZoom(newZoom, anchor = null) {
    const clamped = Math.min(4, Math.max(fitScaleRef.current, newZoom));
    const area = canvasAreaRef.current;
    const model = canvasInnerDivRef.current;
    if (area && model && clamped !== cssZoomRef.current) {
      const a = area.getBoundingClientRect();
      const point = anchor ?? { x: a.left + area.clientWidth / 2, y: a.top + area.clientHeight / 2 };
      zoomAnchorRef.current = { point, fraction: zoomAnchorFraction(point, model.getBoundingClientRect()) };
    }
    cssZoomRef.current = clamped;
    setCssZoom(clamped);
  }

  useLayoutEffect(() => {
    const pending = zoomAnchorRef.current;
    zoomAnchorRef.current = null;
    const area = canvasAreaRef.current;
    const model = canvasInnerDivRef.current;
    if (!pending || !area || !model) return;
    const delta = zoomScrollDelta(pending.point, pending.fraction, model.getBoundingClientRect());
    area.scrollLeft += delta.x;
    area.scrollTop  += delta.y;
  }, [cssZoom]);

  function handleCanvasTouchMove(e) {
    if (!pinchRef.current.active || e.touches.length !== 2) return;
    e.preventDefault();
    const dist    = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY,
    );
    applyZoom(pinchRef.current.initZoom * (dist / pinchRef.current.dist), {
      x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
      y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
    });
  }

  function handleCanvasTouchEnd() { pinchRef.current.active = false; }

  function resetCanvasZoom() {
    cssZoomRef.current = fitScaleRef.current;
    setCssZoom(fitScaleRef.current);
    centerCanvasArea();
  }
  function zoomIn()  { applyZoom(Math.round((cssZoomRef.current + 0.25) * 100) / 100); }
  function zoomOut() { applyZoom(Math.round((cssZoomRef.current - 0.25) * 100) / 100); }

  return {
    cssZoom, setCssZoom, cssZoomRef, fitScaleRef, canvasAreaRef, canvasInnerDivRef, handleCanvasTouchStart,
    applyFitZoom, applyZoom, handleCanvasTouchMove, handleCanvasTouchEnd, resetCanvasZoom, zoomIn, zoomOut,
  };
}

// Zoom à la molette avec Ctrl ou Cmd (grand écran), posé une fois au montage.
export function useWheelZoom({
  cssZoomRef, canvasAreaRef, applyZoom,
}) {
  // ── Wheel zoom (desktop) ─────────────────────────────────────────────────────
  useEffect(() => {
    const el = canvasAreaRef.current;
    if (!el) return;
    function onWheel(e) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const next  = Math.round((cssZoomRef.current + delta) * 100) / 100;
      applyZoom(next, { x: e.clientX, y: e.clientY });
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
