// Deux designs par événement (client_designs.kind, LAB-288/289) : 'print' = modèle photo,
// 'home' = écran d'accueil de la borne (1920×1080). Sans import Deno/esm.sh : testable sous
// `node --test`. Le miroir côté éditeur est saas/src/lib/designKind.js (un test vérifie l'accord).

export const DESIGN_KINDS = ['print', 'home'] as const;
export type DesignKind = typeof DESIGN_KINDS[number];

export const PRINT_FORMATS = ['portrait', 'landscape', 'stripV', 'stripH'] as const;
export const HOME_FORMAT_ID = 'home';

export const HOME_LOCKED_ERROR = "Votre écran d'accueil est validé. Pour le modifier, contactez-nous.";
export const PRINT_LOCKED_ERROR = 'Votre cadre est validé. Contactez-nous pour le modifier.';
/** Code renvoyé avec le 409 quand le client écrit un design validé (autosave, version, envoi). */
export const DESIGN_LOCKED_CODE = 'design_locked';
export const HOME_DISABLED_ERROR = "L'écran d'accueil n'est pas ouvert pour cet événement";

/** `kind` absent → 'print' ; 'print' ou 'home' → lui-même ; toute autre valeur → null (à refuser). */
export function parseDesignKind(value: unknown): DesignKind | null {
  if (value === undefined || value === null) return 'print';
  return (DESIGN_KINDS as readonly unknown[]).includes(value) ? value as DesignKind : null;
}

/** Le modèle photo n'accepte que les formats d'impression, l'écran d'accueil que 'home'. */
export function formatAllowedForKind(kind: DesignKind, format: unknown): boolean {
  if (kind === 'home') return format === HOME_FORMAT_ID;
  return (PRINT_FORMATS as readonly unknown[]).includes(format);
}

/** Onglet « Mon écran d'accueil » : form_config.kiosk.home.personalized ET client_design (booléens stricts). */
export function homeEditorEnabled(formConfig: unknown): boolean {
  const home = (formConfig as { kiosk?: { home?: Record<string, unknown> } } | null | undefined)?.kiosk?.home;
  return home?.personalized === true && home?.client_design === true;
}

/**
 * Le client peut-il encore écrire ce design (autosave, version, envoi) ? Un design validé (écran
 * d'accueil, LAB-290, ou cadre du modèle photo, LAB-294) est en lecture seule : l'admin le rouvre
 * en le refusant. Pas d'exception admin : les fonctions du client sont publiques (code d'accès).
 */
export function clientCanWriteDesign(_kind: DesignKind, status: unknown): boolean {
  return status !== 'approved';
}

/** Message du refus (409) quand le design est validé. */
export function designLockedError(kind: DesignKind): string {
  return kind === 'home' ? HOME_LOCKED_ERROR : PRINT_LOCKED_ERROR;
}

// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any };

/**
 * Le design (événement, kind, cadre) est-il validé, donc fermé au client ? Lu juste avant
 * l'écriture par autosave-design, design-versions (save) et submit-design.
 */
export async function clientDesignLocked(db: Db, eventId: string, kind: DesignKind, slot: number): Promise<boolean> {
  const { data: current } = await db
    .from('client_designs')
    .select('status')
    .eq('event_id', eventId)
    .eq('kind', kind)
    .eq('slot', slot)
    .maybeSingle();
  return !clientCanWriteDesign(kind, current?.status);
}

// ── Plusieurs cadres par événement (client_designs.slot, LAB-311/312, spec choix-cadre-invite) ──
// Un « cadre » = un design 'print' (slot 1 à 4, chacun son statut) ; l'écran d'accueil reste en
// slot 1. Le nombre de cadres ouverts au client vient de form_config.kiosk.frame_choice.

export const MAX_FRAME_SLOTS = 4;
export const FRAME_CHOICE_MAX_FRAMES = [2, 3, 4] as const;
export const DEFAULT_MAX_FRAMES = 2;
export const FRAME_LABEL_MAX_LENGTH = 24;

export const FRAME_LIMIT_ERROR = "Ce cadre n'est pas ouvert pour cet événement";
export const FRAME_LOCKED_ERROR = 'Ce cadre est validé : il ne peut plus être supprimé.';
export const FIRST_FRAME_ERROR = 'Le premier cadre ne peut pas être supprimé';

export interface FrameChoice { enabled: boolean; max_frames: number }

/** `slot` absent → 1 ; entier de 1 à 4 → lui-même ; toute autre valeur → null (à refuser). */
export function parseDesignSlot(value: unknown): number | null {
  if (value === undefined || value === null) return 1;
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_FRAME_SLOTS
    ? value as number
    : null;
}

/** L'écran d'accueil n'a qu'un emplacement (slot 1) ; le modèle photo en a jusqu'à 4. */
export function slotAllowedForKind(kind: DesignKind, slot: number): boolean {
  return kind === 'home' ? slot === 1 : slot >= 1 && slot <= MAX_FRAME_SLOTS;
}

/** form_config.kiosk.frame_choice : enabled booléen strict (faux par défaut), max_frames 2, 3 ou 4 (2 par défaut). */
export function frameChoiceConfig(formConfig: unknown): FrameChoice {
  const fc = (formConfig as { kiosk?: { frame_choice?: Record<string, unknown> } } | null | undefined)?.kiosk?.frame_choice;
  const max = fc?.max_frames;
  return {
    enabled: fc?.enabled === true,
    max_frames: (FRAME_CHOICE_MAX_FRAMES as readonly unknown[]).includes(max) ? max as number : DEFAULT_MAX_FRAMES,
  };
}

/** Plus grand numéro de cadre que le client peut écrire : max_frames si le choix est actif, 1 sinon. */
export function maxFrameSlot(formConfig: unknown): number {
  const fc = frameChoiceConfig(formConfig);
  return fc.enabled ? fc.max_frames : 1;
}

/** Le client peut-il écrire ce cadre (autosave, version, envoi) ? Choix coupé = cadre 1 seulement. */
export function clientCanWriteSlot(kind: DesignKind, slot: number, formConfig: unknown): boolean {
  if (!slotAllowedForKind(kind, slot)) return false;
  return kind === 'home' || slot <= maxFrameSlot(formConfig);
}

/** Supprimer un cadre : ajouté (slot > 1), modèle photo, pas encore validé. */
export function clientCanDeleteFrame(kind: DesignKind, slot: number, status: unknown): boolean {
  return kind === 'print' && slot > 1 && status !== 'approved';
}

/**
 * Nom du cadre sur la borne : absent (ou d'un autre type) → undefined (on ne touche pas au nom
 * enregistré) ; null ou blanc → null ; sinon coupé à 24 caractères.
 */
export function parseFrameLabel(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const label = Array.from(value.trim()).slice(0, FRAME_LABEL_MAX_LENGTH).join('').trim();
  return label || null;
}
