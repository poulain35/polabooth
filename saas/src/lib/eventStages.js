// Étapes d'un événement, refonte de la navigation de l'admin (LAB-335, LAB-337). Logique pure,
// testée dans eventStages.test.js. Un seul calcul sert à la barre d'étapes et à l'encadré
// « Prochaine étape » de la fiche (`/admin/events/:id`) et aux filtres d'étape de la liste
// (`/admin/events?etape=`).
//
// Contexte d'un événement (`ctx`), fourni par la page :
//   frames       : cadres du client (client_designs kind 'print'), au moins { status } ;
//   homePending  : écran d'accueil du client envoyé, à valider ;
//   deliverySent : email de livraison envoyé (email_logs type 'delivery') ;
//   isAvailable  : (featureId) => bool, fonctionnalités actives (toutes par défaut) ;
//   now          : date de référence.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Étapes dans l'ordre des filtres ; `null` = tous les événements non archivés compris. */
export const EVENT_STAGES = [
  { id: 'a-preparer', label: 'À préparer' },
  { id: 'prets', label: 'Prêts' },
  { id: 'semaine', label: 'Cette semaine' },
  { id: 'a-livrer', label: 'À livrer' },
  { id: 'archives', label: 'Archives' },
];

const STAGE_IDS = EVENT_STAGES.map((s) => s.id);

/**
 * Étapes de la barre de la fiche. `feature` : l'étape est masquée sans cette fonctionnalité.
 * `beforeDay` : étape à finir avant le jour J (liste « Avant le jour J », filtre « À préparer »).
 */
const EVENT_STEPS = [
  { id: 'reserve', label: 'Réservé', feature: 'booking', beforeDay: true },
  { id: 'acompte', label: 'Acompte', feature: 'booking', beforeDay: true },
  { id: 'cadres', label: 'Cadres validés', feature: 'client_design', beforeDay: true },
  { id: 'borne', label: 'Borne prête', feature: 'core', beforeDay: true },
  { id: 'jour-j', label: 'Jour J', feature: 'core', beforeDay: false },
  { id: 'livre', label: 'Livré', feature: 'core', beforeDay: false },
];

/** Pastille d'étape de la fiche. */
export const STAGE_BADGES = {
  'a-preparer': 'À préparer',
  prets: 'Prêt',
  'en-cours': 'En cours',
  'a-livrer': 'À livrer',
  livre: 'Livré',
  archives: 'Archivé',
};

/** Statut d'un événement : archived, unplanned, upcoming, finished ou ongoing. */
export function eventStatusKey(ev, now = new Date()) {
  if (ev?.status === 'archived') return 'archived';
  const start = ev?.start_date ? new Date(ev.start_date) : null;
  const end = ev?.end_date ? new Date(ev.end_date) : null;
  if (!start) return 'unplanned';
  if (start > now) return 'upcoming';
  if (end && end < now) return 'finished';
  return 'ongoing';
}

/** Étape demandée par l'adresse (`etape`), ou null (tous). */
export function stageFromParams(params) {
  const etape = params?.get?.('etape');
  return STAGE_IDS.includes(etape) ? etape : null;
}

const allFeatures = () => true;

/** Un cadre ou l'écran d'accueil du client attend la validation de l'admin. */
function hasPendingDesign(ctx = {}) {
  return Boolean(ctx.homePending) || (ctx.frames ?? []).some((f) => f?.status === 'submitted');
}

/**
 * Acompte réglé ou rien à régler. Même règle que isDepositDue du module booking : un devis signé
 * sans montant d'acompte (pro à 0 %) n'a rien à régler.
 */
function depositSettled(ev) {
  return ev?.deposit_status === 'regle' || !(Number(ev?.deposit_amount) > 0);
}

/** Réservé : devis signé, ou événement créé sans devis (saisi directement dans l'admin). */
function isReserved(ev) {
  return ev?.quote_status == null || ev.quote_status === 'signe';
}

/**
 * Étapes visibles de l'événement : `[{ id, label, done, beforeDay }]`, sans celles dont la
 * fonctionnalité est coupée.
 */
export function eventSteps(ev, ctx = {}) {
  const isAvailable = ctx.isAvailable ?? allFeatures;
  const now = ctx.now ?? new Date();
  const status = eventStatusKey(ev, now);
  const archived = status === 'archived';
  const started = archived || status === 'ongoing' || status === 'finished';
  const approvedFrame = (ctx.frames ?? []).some((f) => f?.status === 'approved');
  const done = {
    reserve: isReserved(ev),
    acompte: isReserved(ev) && depositSettled(ev),
    cadres: approvedFrame,
    borne: approvedFrame && Boolean(ev?.photobooth_id),
    'jour-j': started,
    livre: archived || Boolean(ctx.deliverySent),
  };
  return EVENT_STEPS
    .filter((step) => isAvailable(step.feature))
    .map((step) => ({ id: step.id, label: step.label, beforeDay: step.beforeDay, done: done[step.id] }));
}

/** Toutes les étapes d'avant le jour J sont faites (et la date est fixée). */
function readyForDay(ev, steps, now) {
  return eventStatusKey(ev, now) !== 'unplanned' && steps.every((s) => !s.beforeDay || s.done);
}

/** Pastille de la fiche : clé de STAGE_BADGES. */
export function eventStage(ev, ctx = {}) {
  const now = ctx.now ?? new Date();
  const status = eventStatusKey(ev, now);
  if (status === 'archived') return 'archives';
  const steps = eventSteps(ev, { ...ctx, now });
  if (status === 'finished') return steps.find((s) => s.id === 'livre')?.done ? 'livre' : 'a-livrer';
  if (status === 'ongoing') return 'en-cours';
  return !hasPendingDesign(ctx) && readyForDay(ev, steps, now) ? 'prets' : 'a-preparer';
}

/**
 * Prochaine action de l'encadré « Prochaine étape » : `{ label, hint, button, to }` (`to` = adresse
 * relative à la fiche, `?tab=…[#section]`, ou absolue) ou `{ …, action: 'archive' }` ; null pour
 * un événement archivé.
 */
export function nextEventAction(ev, ctx = {}) {
  const isAvailable = ctx.isAvailable ?? allFeatures;
  const now = ctx.now ?? new Date();
  const status = eventStatusKey(ev, now);
  if (status === 'archived') return null;
  const steps = eventSteps(ev, { ...ctx, now });
  const todo = (id) => steps.some((s) => s.id === id && !s.done);
  const frames = ctx.frames ?? [];

  if (frames.some((f) => f?.status === 'submitted')) {
    return { label: 'Valider le cadre envoyé par le client', hint: 'Le client attend votre réponse pour finir son cadre.', button: 'Voir le cadre', to: '?tab=creation' };
  }
  if (ctx.homePending) {
    return { label: 'Valider l’écran d’accueil du client', hint: 'Le client attend votre réponse.', button: 'Voir l’écran', to: '?tab=creation#ecran-accueil' };
  }
  if (status === 'finished') {
    if (todo('livre')) {
      return { label: 'Livrer les photos au client', hint: 'L’événement est terminé : envoyez les photos et le bilan.', button: 'Photos et livraison', to: '?tab=livraison&partie=envoi' };
    }
    return { label: 'Archiver l’événement', hint: 'Les photos sont livrées.', button: 'Archiver', action: 'archive' };
  }
  if (status === 'ongoing') {
    return { label: 'Suivre la borne en direct', hint: 'L’événement a lieu en ce moment.', button: 'Jour J', to: '?tab=jour-j' };
  }
  if (status === 'unplanned') {
    return { label: 'Fixer la date de l’événement', hint: 'Sans date, la borne et les rappels ne peuvent pas être prévus.', button: 'Modifier', to: '?tab=resume#mise-a-disposition' };
  }
  if (todo('reserve')) {
    return { label: 'Faire signer le devis', hint: 'Le devis n’est pas encore signé.', button: 'Voir les devis', to: '/admin/ventes?tab=devis' };
  }
  if (todo('acompte')) {
    return { label: 'Encaisser l’acompte', hint: 'L’acompte n’est pas encore réglé.', button: 'Résumé', to: '?tab=resume' };
  }
  if (!frames.some((f) => f?.status === 'approved')) {
    if (isAvailable('client_design') && frames.length === 0) {
      return { label: 'Faire créer le cadre par le client', hint: 'Envoyez-lui le lien de création du cadre.', button: 'Création du client', to: '?tab=creation' };
    }
    return { label: 'Attendre le cadre du client', hint: 'Aucun cadre validé : la borne n’a rien à imprimer.', button: 'Création du client', to: '?tab=creation' };
  }
  if (todo('borne')) {
    return { label: 'Assigner une borne', hint: 'Choisissez la borne qui ira à l’événement.', button: 'Jour J', to: '?tab=jour-j' };
  }
  return { label: 'Tout est prêt', hint: 'Vérifiez les réglages de la borne avant le jour J.', button: 'Réglages de la borne', to: '?tab=borne' };
}

/**
 * L'événement est-il dans l'étape `stage` de la liste ? Un événement peut être dans deux étapes
 * (prêt et cette semaine). Même calcul que la barre d'étapes de la fiche.
 */
export function eventInStage(ev, stage, ctx = {}) {
  const now = ctx.now ?? new Date();
  const status = eventStatusKey(ev, now);
  switch (stage) {
    case null:
    case undefined:
      return true;
    case 'a-preparer':
    case 'prets':
    case 'a-livrer':
      if (status === 'archived') return false;
      if (stage === 'a-preparer') {
        return hasPendingDesign(ctx) || eventStage(ev, { ...ctx, now }) === 'a-preparer';
      }
      return eventStage(ev, { ...ctx, now }) === stage;
    case 'semaine': {
      if (status === 'ongoing') return true;
      if (status !== 'upcoming') return false;
      return new Date(ev.start_date).getTime() - now.getTime() <= 7 * DAY_MS;
    }
    case 'archives':
      return status === 'archived';
    default:
      return true;
  }
}
