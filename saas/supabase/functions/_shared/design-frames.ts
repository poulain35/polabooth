// Plusieurs cadres du modèle photo (LAB-322) : un email par événement, pas un par cadre. Règles
// pures et rendus (sans Deno ni réseau, testés par node --test), lus par submit-design (email à
// l'admin quand tous les cadres créés sont envoyés), review-design (email au client quand plus
// aucun cadre envoyé n'attend de décision) et send-design-reminders (cadres restant à envoyer).
// Un événement à un seul cadre garde les emails d'avant : ces règles répondent alors « single ».

import { button, detailsTable, escapeHtml, layout, mutedNote, softBox, trackingLine } from './email-layout.ts';
import { maxFrameSlot } from './design-kind.ts';

export interface FrameRow {
  id?: string;
  slot?: number | null;
  label?: string | null;
  format?: string | null;
  status?: string | null;
  review_feedback?: string | null;
}

const FRAME_FORMAT_LABELS: Record<string, string> = {
  portrait:  'Portrait',
  landscape: 'Paysage',
  stripV:    'Bandelette verticale',
  stripH:    'Bandelette horizontale',
};

/** Statuts d'un cadre envoyé par le client (en attente de décision ou validé). */
const SENT_STATUSES = ['submitted', 'approved'];

function slotOf(f: FrameRow): number {
  return typeof f.slot === 'number' ? f.slot : 1;
}

/** Nom du cadre : celui saisi par le client, sinon « Cadre n ». */
export function frameName(f: FrameRow): string {
  const label = typeof f.label === 'string' ? f.label.trim() : '';
  return label || `Cadre ${slotOf(f)}`;
}

export function frameFormatName(format: unknown): string {
  return typeof format === 'string' && format ? FRAME_FORMAT_LABELS[format] ?? format : '—';
}

/**
 * Cadres du client pris en compte, triés par numéro : ceux des cadres ouverts (choix coupé = cadre 1
 * seulement). `keepId` garde un cadre hors limite (l'admin peut relire un cadre d'un choix coupé depuis).
 */
export function openFrames(frames: FrameRow[] | null | undefined, formConfig: unknown, keepId?: string): FrameRow[] {
  const max = maxFrameSlot(formConfig);
  return (frames ?? [])
    .filter((f) => slotOf(f) <= max || (keepId !== undefined && f.id === keepId))
    .sort((a, b) => slotOf(a) - slotOf(b));
}

/** Cadres créés pas encore envoyés : brouillon, ou refusé et pas encore renvoyé. */
export function framesLeftToSend(frames: FrameRow[]): number {
  return frames.filter((f) => !SENT_STATUSES.includes(f.status ?? '')).length;
}

/**
 * Email à l'admin après un envoi (lu après l'enregistrement du cadre) :
 * - `none` : le client a demandé de ne pas notifier (`notify: false`, cadres d'un envoi groupé
 *   avant le dernier) ou un cadre créé reste à envoyer ;
 * - `single` : un seul cadre, email d'avant ;
 * - `frames` : plusieurs cadres, un seul email qui les liste.
 */
export function submitNotification(frames: FrameRow[], notify: boolean): 'none' | 'single' | 'frames' {
  if (!notify || framesLeftToSend(frames) > 0) return 'none';
  return frames.length > 1 ? 'frames' : 'single';
}

/**
 * Email au client après une décision de l'admin sur un cadre (lu après l'enregistrement) :
 * - `single` : un seul cadre envoyé (ou un seul cadre tout court), email d'avant ;
 * - `wait` : un autre cadre envoyé attend encore une décision, pas d'email (`pending` = combien) ;
 * - `summary` : plus rien n'attend, un seul email qui résume les cadres validés et refusés.
 * Les brouillons ne comptent pas : ils n'attendent pas de décision et ne figurent pas au bilan.
 */
export function reviewOutcome(frames: FrameRow[]): { mode: 'single' | 'wait' | 'summary'; pending: number } {
  const sent = frames.filter((f) => f.status === 'submitted' || f.status === 'approved' || f.status === 'rejected');
  if (sent.length <= 1) return { mode: 'single', pending: 0 };
  const pending = frames.filter((f) => f.status === 'submitted').length;
  return pending ? { mode: 'wait', pending } : { mode: 'summary', pending: 0 };
}

/** Cadres cités dans le résumé au client : validés et refusés, par numéro. */
export function decidedFrames(frames: FrameRow[]): FrameRow[] {
  return frames.filter((f) => f.status === 'approved' || f.status === 'rejected');
}

/** Le résumé ne contient que des cadres validés (type email_logs design_approved, sinon design_rejected). */
export function allFramesApproved(frames: FrameRow[]): boolean {
  return decidedFrames(frames).every((f) => f.status === 'approved');
}

/**
 * Relance du client (send-design-reminders) : `0` = relance d'avant (aucun cadre envoyé ni validé),
 * `n` = il reste n cadres créés à envoyer alors que d'autres sont partis (plusieurs cadres seulement),
 * `null` = rien à relancer. Un seul cadre : relance tant qu'il n'est pas envoyé, comme avant.
 */
export function reminderFramesLeft(frames: FrameRow[] | null | undefined, formConfig: unknown): number | null {
  const all = frames ?? [];
  if (!all.some((f) => SENT_STATUSES.includes(f.status ?? ''))) return 0;
  const open = openFrames(all, formConfig);
  if (open.length <= 1) return null;
  const left = framesLeftToSend(open);
  return left > 0 ? left : null;
}

const PARIS_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
});

/**
 * Jours entiers restants avant la fin de l'événement, au jour près (calendrier de Paris). Accepte un
 * timestamptz (events.end_date depuis 2026-06) ou une date seule ; NaN si la date est illisible.
 * Avant, `${end_date}T00:00:00Z` donnait une date invalide sur un timestamptz : aucune relance ne partait.
 */
export function reminderDaysLeft(endDate: string, now: number): number {
  const end = new Date(endDate);
  if (Number.isNaN(end.getTime())) return NaN;
  const day = (d: Date) => Date.parse(`${PARIS_DAY.format(d)}T00:00:00Z`);
  return Math.round((day(end) - day(new Date(now))) / 86_400_000);
}

function plural(n: number, one: string, many: string): string {
  return n > 1 ? many : one;
}

/** Notification admin : le client a envoyé tous ses cadres (ceux en attente de validation sont listés). */
export function renderFramesSubmitNotificationEmail(p: {
  eventName: string;
  clientName: string;
  adminUrl: string;
  frames: FrameRow[];
}) {
  const toReview = p.frames.filter((f) => f.status === 'submitted');
  const approved = p.frames.filter((f) => f.status === 'approved');
  const n = toReview.length;
  const approvedNote = approved.length
    ? mutedNote(`${plural(approved.length, 'Déjà validé', 'Déjà validés')} : ${approved.map(frameName).join(', ')}.`)
    : '';
  return {
    subject: `✅ ${n} ${plural(n, 'cadre soumis', 'cadres soumis')} — ${p.eventName}`,
    html: layout('✅ Nouveaux cadres reçus', `
    <p><strong>${escapeHtml(p.clientName)}</strong> a envoyé tous ses cadres pour l'événement
    <strong>${escapeHtml(p.eventName)}</strong>. ${plural(n, 'Cadre à valider', 'Cadres à valider')} :</p>
    ${detailsTable(toReview.map((f) => [frameName(f), escapeHtml(frameFormatName(f.format))]))}
    ${approvedNote}
    ${button(p.adminUrl, 'Voir et valider →')}`, { audience: 'admin' }),
  };
}

/** Email client : bilan des cadres validés et refusés (motif de chaque refus). */
export function renderFramesReviewEmail(p: {
  clientName: string;
  eventName: string;
  editorUrl: string;
  frames: FrameRow[];
  /** Lien « Suivre ma réservation » (clientTrackingUrl) ; absent = email d'avant. */
  trackingUrl?: string | null;
}) {
  const decided = decidedFrames(p.frames);
  const rejected = decided.filter((f) => f.status === 'rejected');
  const rows = detailsTable(decided.map((f) => [
    frameName(f),
    f.status === 'approved' ? '✅ Validé' : '🔄 À modifier',
  ]));
  if (!rejected.length) {
    return {
      subject: `✅ Vos cadres ont été validés — ${p.eventName}`,
      html: layout('✅ Cadres validés !', `
    <p>Bonjour <strong>${escapeHtml(p.clientName)}</strong>,</p>
    <p>Vos cadres photobooth pour l'événement <strong>${escapeHtml(p.eventName)}</strong> ont été validés par notre équipe. 🎉</p>
    ${rows}
    <p style="margin:20px 0 0;">Tout est prêt pour le jour J. Vous n'avez rien d'autre à faire.</p>${trackingLine(p.trackingUrl)}`),
    };
  }
  const feedbacks = rejected.map((f) => softBox(
    `<strong>${escapeHtml(frameName(f))} :</strong><br>${escapeHtml(f.review_feedback ?? '')}`,
    { tone: 'warning', preWrap: true, margin: '16px 0 0' },
  )).join('\n    ');
  return {
    subject: `🔄 ${rejected.length} ${plural(rejected.length, 'cadre nécessite', 'cadres nécessitent')} des modifications — ${p.eventName}`,
    html: layout('🔄 Modifications demandées', `
    <p>Bonjour <strong>${escapeHtml(p.clientName)}</strong>,</p>
    <p>Notre équipe a relu vos cadres photobooth pour l'événement <strong>${escapeHtml(p.eventName)}</strong> :</p>
    ${rows}
    <p style="margin:20px 0 0;"><strong>Retour de notre équipe</strong></p>
    ${feedbacks}
    <p style="margin:20px 0 0;">Modifiez ${plural(rejected.length, 'ce cadre', 'ces cadres')} dans l'éditeur, puis cliquez sur « Envoyer mes cadres ».</p>
    ${button(p.editorUrl, 'Modifier mes cadres →')}${trackingLine(p.trackingUrl)}`),
  };
}
