// Deux designs par événement (LAB-289) : 'print' = modèle photo, 'home' = écran d'accueil de la
// borne. Règles pures, miroir de supabase/functions/_shared/design-kind.ts (le serveur décide,
// l'éditeur affiche la même chose ; un test vérifie que les deux sont d'accord).

export const DESIGN_KINDS = ['print', 'home'];
export const PRINT_FORMATS = ['portrait', 'landscape', 'stripV', 'stripH'];
export const HOME_FORMAT_ID = 'home';

export const HOME_LOCKED_MESSAGE = "Votre écran d'accueil est validé. Pour le modifier, contactez-nous.";
export const PRINT_LOCKED_MESSAGE = 'Votre cadre est validé. Contactez-nous pour le modifier.';

/** `kind` absent → 'print' ; 'print' ou 'home' → lui-même ; toute autre valeur → null. */
export function parseDesignKind(value) {
  if (value === undefined || value === null) return 'print';
  return DESIGN_KINDS.includes(value) ? value : null;
}

/** Le modèle photo n'accepte que les formats d'impression, l'écran d'accueil que 'home'. */
export function formatAllowedForKind(kind, format) {
  if (kind === 'home') return format === HOME_FORMAT_ID;
  return PRINT_FORMATS.includes(format);
}

/** Onglet « Mon écran d'accueil » : form_config.kiosk.home.personalized ET client_design. */
export function homeEditorEnabled(formConfig) {
  const home = formConfig?.kiosk?.home;
  return home?.personalized === true && home?.client_design === true;
}

/**
 * Un design validé (écran d'accueil, LAB-290, ou cadre du modèle photo, LAB-294) est en lecture
 * seule pour le client, admin connecté compris : l'admin le rouvre en le refusant.
 */
export function clientCanWriteDesign(_kind, status) {
  return status !== 'approved';
}

/** Message affiché sur un design validé (même texte que le refus 409 du serveur). */
export function designLockedMessage(kind) {
  return kind === 'home' ? HOME_LOCKED_MESSAGE : PRINT_LOCKED_MESSAGE;
}

/**
 * Ce que montre l'onglet d'un design : 'editor' (modifiable), 'locked' (design validé, aperçu
 * seul, même pour un admin) ou 'pending' (envoyé, en attente de validation ; un admin connecté
 * peut corriger). Le modèle photo envoyé reste « pending » tant que l'événement est en `submitted`
 * (comportement historique) ; l'écran d'accueil suit son propre statut et ne touche pas l'événement.
 */
export function designTabView({ kind, designStatus, eventStatus, isAdmin }) {
  if (!clientCanWriteDesign(kind, designStatus)) return 'locked';
  const submitted = kind === 'home' ? designStatus === 'submitted' : eventStatus === 'submitted';
  if (submitted && !isAdmin) return 'pending';
  return 'editor';
}

// Plusieurs cadres par événement (client_designs.slot, LAB-312) : miroir des règles de
// supabase/functions/_shared/design-kind.ts. Un cadre = un design 'print' (slot 1 à 4) ;
// l'écran d'accueil reste en slot 1. form_config.kiosk.frame_choice fixe le nombre de cadres.

export const MAX_FRAME_SLOTS = 4;
export const FRAME_CHOICE_MAX_FRAMES = [2, 3, 4];
export const DEFAULT_MAX_FRAMES = 2;
export const FRAME_LABEL_MAX_LENGTH = 24;

export const FRAME_LIMIT_MESSAGE = "Ce cadre n'est pas ouvert pour cet événement";
export const FRAME_LOCKED_MESSAGE = 'Ce cadre est validé : il ne peut plus être supprimé.';
export const FIRST_FRAME_MESSAGE = 'Le premier cadre ne peut pas être supprimé';

/** `slot` absent → 1 ; entier de 1 à 4 → lui-même ; toute autre valeur → null. */
export function parseDesignSlot(value) {
  if (value === undefined || value === null) return 1;
  return Number.isInteger(value) && value >= 1 && value <= MAX_FRAME_SLOTS ? value : null;
}

/** L'écran d'accueil n'a qu'un emplacement (slot 1) ; le modèle photo en a jusqu'à 4. */
export function slotAllowedForKind(kind, slot) {
  return kind === 'home' ? slot === 1 : slot >= 1 && slot <= MAX_FRAME_SLOTS;
}

/** form_config.kiosk.frame_choice : enabled strict (faux par défaut), max_frames 2, 3 ou 4 (2 par défaut). */
export function frameChoiceConfig(formConfig) {
  const fc = formConfig?.kiosk?.frame_choice;
  const max = fc?.max_frames;
  return {
    enabled: fc?.enabled === true,
    max_frames: FRAME_CHOICE_MAX_FRAMES.includes(max) ? max : DEFAULT_MAX_FRAMES,
  };
}

/** Plus grand numéro de cadre que le client peut écrire : max_frames si le choix est actif, 1 sinon. */
export function maxFrameSlot(formConfig) {
  const fc = frameChoiceConfig(formConfig);
  return fc.enabled ? fc.max_frames : 1;
}

/** Le client peut-il écrire ce cadre ? Choix coupé = cadre 1 seulement. */
export function clientCanWriteSlot(kind, slot, formConfig) {
  if (!slotAllowedForKind(kind, slot)) return false;
  return kind === 'home' || slot <= maxFrameSlot(formConfig);
}

/** Supprimer un cadre : ajouté (slot > 1), modèle photo, pas encore validé. */
export function clientCanDeleteFrame(kind, slot, status) {
  return kind === 'print' && slot > 1 && status !== 'approved';
}

/** Nom du cadre : absent → undefined (inchangé) ; null ou blanc → null ; sinon 24 caractères au plus. */
export function parseFrameLabel(value) {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const label = Array.from(value.trim()).slice(0, FRAME_LABEL_MAX_LENGTH).join('').trim();
  return label || null;
}
