// Designs du client dans l'admin (LAB-290) : modèle photo (kind = 'print') et écran d'accueil de la
// borne (kind = 'home', 1920×1080). Module pur : libellés, regroupement des designs à valider,
// actions de validation possibles. Mêmes règles que l'edge function review-design.

export const DESIGN_KINDS = ['print', 'home'];

/** Libellés courts : « Template » reste le nom du modèle photo dans l'admin. */
export const DESIGN_KIND_LABELS = { print: 'Template', home: 'Écran d’accueil' };

/** Statuts de l'écran d'accueil, tels que l'admin les lit. */
export const HOME_DESIGN_STATUS = {
  draft:     { label: 'Brouillon',  color: 'bg-muted text-muted-foreground'   },
  submitted: { label: 'Envoyé',     color: 'bg-state-amber text-state-amber-fg' },
  approved:  { label: 'Validé',     color: 'bg-state-green text-state-green-fg' },
  rejected:  { label: 'À corriger', color: 'bg-state-red text-state-red-fg'     },
};

/**
 * Cadre 16:10 dans l'écran 16:9 : l'écran de la borne (16:10) garde toute la hauteur et coupe
 * environ 96 px de chaque côté sur 1920 (1080 × 16 / 10 = 1728 px de large). En % de la largeur.
 */
export const HOME_SAFE_SIDE_PERCENT = ((1920 - (1080 * 16) / 10) / 2 / 1920) * 100;

/**
 * Designs envoyés regroupés par événement : Map event_id → kinds (modèle photo d'abord).
 * Une ligne sans kind (lecture d'avant LAB-288) compte comme modèle photo.
 */
export function pendingKindsByEvent(rows) {
  const byEvent = new Map();
  for (const row of rows ?? []) {
    const kind = row.kind ?? 'print';
    if (!DESIGN_KINDS.includes(kind)) continue;
    const kinds = byEvent.get(row.event_id) ?? [];
    if (!kinds.includes(kind)) kinds.push(kind);
    byEvent.set(row.event_id, kinds);
  }
  for (const kinds of byEvent.values()) kinds.sort((a, b) => DESIGN_KINDS.indexOf(a) - DESIGN_KINDS.indexOf(b));
  return byEvent;
}

/**
 * Actions de l'admin sur un design. Un design validé (écran d'accueil, LAB-290, ou cadre du modèle
 * photo, LAB-294) est en lecture seule pour le client : l'admin le refuse avec un motif (« Rouvrir
 * pour correction ») pour qu'il redevienne modifiable. Même règle que review-design (canReview).
 */
export function designReviewActions(_kind, status) {
  const reopen = status === 'approved';
  return { canApprove: status === 'submitted', canReject: status === 'submitted' || reopen, reopen };
}

/** La borne affiche l'écran du client : validé et option active (comme kiosk_get_approved_design). */
export function homeDesignShownOnKiosk(home, homeDesign) {
  return homeDesign?.status === 'approved' && home?.personalized === true && home?.client_design === true;
}

// ── Plusieurs cadres par événement (LAB-314, spec docs/specs/choix-cadre-invite.md) ──
// Un cadre = un modèle photo (kind = 'print', slot 1 à 4). Mêmes règles que la RPC
// kiosk_get_approved_design : le cadre principal est le cadre validé au plus petit slot ; les
// autres cadres validés ne partent sur la borne que si frame_choice.enabled vaut true.

/** Papier de la borne par format : 10×15 (4x6) ou bande 5×15 (2x6). */
export const FRAME_PAPER = { portrait: '4x6', landscape: '4x6', stripV: '2x6', stripH: '2x6' };

const MIXED_PAPER_WARNING = 'Les cadres mélangent le 10×15 et la bande 5×15 : la borne changera de taille de papier '
  + 'd’une impression à l’autre. Faites un essai réel sur la DNP DS620 et sur la RX1-HS avant de l’activer chez un client.';

const slotOf = (frame) => (Number.isInteger(frame?.slot) ? frame.slot : 1);
const frameChoiceOn = (kiosk) => kiosk?.frame_choice?.enabled === true;
const paperOf = (frame) => FRAME_PAPER[frame?.format] ?? FRAME_PAPER.portrait;

/** Modèles photo triés par cadre (une ligne sans kind compte comme modèle photo). */
export function sortFrames(rows) {
  return (rows ?? [])
    .filter((row) => (row.kind ?? 'print') === 'print')
    .sort((a, b) => slotOf(a) - slotOf(b));
}

/** « Cadre 2 · Mariage » ou « Cadre 2 » sans nom. */
export function frameTitle(frame) {
  const label = typeof frame?.label === 'string' ? frame.label.trim() : '';
  return label ? `Cadre ${slotOf(frame)} · ${label}` : `Cadre ${slotOf(frame)}`;
}

/** Cadre principal : le cadre validé au plus petit numéro (null s'il n'y en a pas). */
export function mainFrame(frames) {
  return sortFrames(frames).find((frame) => frame.status === 'approved') ?? null;
}

/**
 * Cadres qui partent sur la borne : le principal seul quand le choix est coupé, sinon tous les
 * cadres validés (comme la RPC, max_frames ne coupe pas les cadres déjà validés).
 */
export function kioskFrames(frames, kiosk) {
  const approved = sortFrames(frames).filter((frame) => frame.status === 'approved');
  return frameChoiceOn(kiosk) ? approved : approved.slice(0, 1);
}

/**
 * Avertissements de l'admin : papiers mélangés quand le choix est actif (cadres envoyés ou validés),
 * choix coupé alors que l'événement a plusieurs cadres.
 */
export function frameWarnings(frames, kiosk) {
  const sorted = sortFrames(frames);
  if (frameChoiceOn(kiosk)) {
    const papers = new Set(sorted
      .filter((frame) => frame.status === 'approved' || frame.status === 'submitted')
      .map(paperOf));
    return papers.size > 1 ? [{ code: 'mixed_paper', message: MIXED_PAPER_WARNING }] : [];
  }
  if (sorted.length <= 1) return [];
  const main = mainFrame(sorted);
  const who = main ? `seul « ${frameTitle(main)} » part` : 'un seul cadre partira';
  return [{
    code: 'choice_off',
    message: `Le choix du cadre est coupé : ${who} sur la borne (le cadre validé au plus petit numéro). `
      + 'Activez « Proposer plusieurs cadres » ci-dessus pour proposer les autres.',
  }];
}

/**
 * Vue de la section « Template du client » : un seul cadre et choix coupé = affichage d'avant
 * (mode 'single'), sinon une liste de cadres avec leur titre et leur présence sur la borne.
 */
export function framesSectionView(frames, kiosk) {
  const sorted = sortFrames(frames);
  if (!frameChoiceOn(kiosk) && sorted.length <= 1) {
    return {
      mode: 'single',
      items: sorted.map((frame) => ({ frame, title: null, kioskNote: null, onKiosk: frame.status === 'approved' })),
      warnings: [],
    };
  }
  const onKioskIds = new Set(kioskFrames(sorted, kiosk).map((frame) => frame.id));
  return {
    mode: 'list',
    items: sorted.map((frame) => {
      const onKiosk = onKioskIds.has(frame.id);
      let kioskNote = null;
      if (onKiosk) kioskNote = 'Sur la borne';
      else if (frame.status === 'approved') kioskNote = 'Pas sur la borne : le choix du cadre est coupé';
      return { frame, title: frameTitle(frame), kioskNote, onKiosk };
    }),
    warnings: frameWarnings(sorted, kiosk),
  };
}

/**
 * Un email au client par événement (LAB-322) : avec plusieurs cadres, review-design ne prévient le
 * client que quand plus aucun cadre envoyé n'attend de décision. Texte affiché sous la décision quand
 * la réponse dit que le client n'est pas encore prévenu ; vide sinon.
 */
export function reviewPendingNotice(result) {
  const n = result?.pending_frames;
  if (result?.client_notified !== false || !Number.isInteger(n) || n < 1) return '';
  const left = n > 1 ? `${n} cadres` : '1 cadre';
  return `Décision enregistrée. Le client sera prévenu quand tous les cadres auront été traités (encore ${left} à traiter).`;
}

/** Rappel en tête de la liste des cadres quand plusieurs attendent une décision ; null sinon. */
export function framesReviewHint(frames) {
  const pending = (frames ?? []).filter((f) => f?.status === 'submitted').length;
  if (pending < 2) return null;
  return 'Le client recevra un seul email, quand tous les cadres envoyés auront été validés ou refusés.';
}
