// Plusieurs cadres dans l'éditeur du client (LAB-313, lot C3 de docs/specs/choix-cadre-invite.md).
// Règles pures de la barre des cadres de /e/:code ; le serveur (autosave-design, submit-design,
// design-versions) refait les mêmes contrôles avec _shared/design-kind.ts.

import { FRAME_LABEL_MAX_LENGTH, MAX_FRAME_SLOTS, PRINT_FORMATS, frameChoiceConfig } from './designKind.js';

/**
 * Choix du cadre lu dans la réponse de get-event : actif seulement si `frame_choice.enabled` vaut
 * true ET que `frames` est une liste (le serveur renvoie null quand le choix est coupé).
 */
export function editorFrameChoice(response) {
  const fc = frameChoiceConfig({ kiosk: { frame_choice: response?.frame_choice } });
  const enabled = fc.enabled && Array.isArray(response?.frames);
  return { enabled, max_frames: enabled ? fc.max_frames : 1 };
}

/**
 * Champs ajoutés aux appels des fonctions de design : rien quand le choix est coupé (corps
 * identiques à avant LAB-313), sinon `slot` et, si donné, `label`.
 */
export function frameFields({ slot, label } = {}) {
  if (slot === undefined || slot === null) return {};
  return label === undefined ? { slot } : { slot, label };
}

/** Clé de l'état d'un éditeur (brouillon, « modifié ») : un par onglet et par cadre. */
export function designKey(kind, slot = 1) {
  return kind === 'home' ? 'home' : `print:${slot}`;
}

/** Inverse de designKey : { kind, slot }. */
export function parseDesignKey(key) {
  if (key === 'home') return { kind: 'home', slot: 1 };
  const slot = Number(String(key ?? '').split(':')[1]);
  return { kind: 'print', slot: Number.isInteger(slot) && slot >= 1 ? slot : 1 };
}

/** Nom affiché d'un cadre : son nom, sinon « Cadre n ». */
export function frameDisplayName(frame) {
  const label = typeof frame?.label === 'string' ? frame.label.trim() : '';
  return label || `Cadre ${frame?.slot ?? 1}`;
}

/** Saisie du nom : 24 caractères au plus (les emojis comptent pour un), espaces gardés pendant la frappe. */
export function clampFrameLabel(value) {
  if (typeof value !== 'string') return '';
  return Array.from(value).slice(0, FRAME_LABEL_MAX_LENGTH).join('');
}

/** Nom envoyé au serveur : null si vide (la borne affiche alors « Cadre n »). */
export function frameLabelForRequest(value) {
  const label = clampFrameLabel(value ?? '').trim();
  return label || null;
}

/** Formats proposés pour un nouveau cadre : ceux de l'événement, dans l'ordre, formats d'impression seulement. */
export function frameFormatChoices(allowedFormats) {
  const list = Array.isArray(allowedFormats) && allowedFormats.length ? allowedFormats : PRINT_FORMATS;
  return list.filter((id, i) => PRINT_FORMATS.includes(id) && list.indexOf(id) === i);
}

/**
 * Cadres de départ de l'éditeur, triés par numéro. Sans cadre enregistré, un cadre 1 vide.
 * Chaque cadre : { slot, id, label, format, status, saved }.
 */
export function initialFrames(frames) {
  const list = (Array.isArray(frames) ? frames : [])
    .filter((f) => Number.isInteger(f?.slot) && f.slot >= 1 && f.slot <= MAX_FRAME_SLOTS)
    .map((f) => ({
      slot: f.slot,
      id: f.id ?? null,
      label: typeof f.label === 'string' ? f.label : '',
      format: f.format ?? null,
      status: f.status ?? null,
      saved: true,
    }))
    .sort((a, b) => a.slot - b.slot);
  if (!list.some((f) => f.slot === 1)) list.unshift(newFrame(1, null));
  return list;
}

export function newFrame(slot, format) {
  return { slot, id: null, label: '', format: format ?? null, status: null, saved: false };
}

/** Brouillon de départ d'un cadre de get-event : son canvas_json et son format. */
export function frameDraft(frame, formats) {
  return { key: 0, json: frame?.canvas_json ?? null, format: (frame?.format && formats?.[frame.format]) || null };
}

/** Premier numéro libre de 1 à max_frames, ou null : pas de cadre au-delà de max_frames. */
export function nextFrameSlot(frames, maxFrames) {
  const used = new Set((frames ?? []).map((f) => f.slot));
  const max = Math.min(maxFrames ?? 1, MAX_FRAME_SLOTS);
  if (used.size >= max) return null;
  for (let slot = 1; slot <= max; slot++) if (!used.has(slot)) return slot;
  return null;
}

/** Ajouter un cadre : seulement s'il reste un numéro libre (max_frames cadres au plus). */
export function canAddFrame(frames, maxFrames) {
  return nextFrameSlot(frames, maxFrames) !== null;
}

/** Supprimer un cadre : pas le cadre 1, pas un cadre validé (même règle que autosave-design). */
export function canDeleteFrame(frame) {
  return !!frame && frame.slot > 1 && frame.status !== 'approved';
}

/** Cadre à afficher après la suppression de `slot` : le précédent dans l'ordre, sinon le cadre 1. */
export function slotAfterDelete(frames, slot) {
  const before = (frames ?? []).filter((f) => f.slot < slot).map((f) => f.slot);
  return before.length ? Math.max(...before) : 1;
}

/**
 * Cadres envoyés par « Envoyer mes cadres », dans l'ordre : tous ceux qui ne sont pas validés
 * (un cadre validé reste sur la borne, il n'est pas renvoyé) et qui sont ouverts (slot <= max_frames).
 */
export function framesToSubmit(frames, maxFrames) {
  return (frames ?? [])
    .filter((f) => f.status !== 'approved' && f.slot <= (maxFrames ?? 1))
    .map((f) => f.slot)
    .sort((a, b) => a - b);
}

/** Badge du statut d'un cadre dans la barre ; null pour un brouillon. */
export function frameStatusLabel(status) {
  if (status === 'approved') return 'Validé';
  if (status === 'submitted') return 'Envoyé';
  if (status === 'rejected') return 'À corriger';
  return null;
}
