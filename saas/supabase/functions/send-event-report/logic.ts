// Logique pure de send-event-report (LAB-238), sans import Deno : testée sous `node --test`.
// L'index fournit les accès (RPC sous le JWT de l'admin, client service_role, Brevo) ; l'ordre des
// étapes est fixé ici : gel (JWT admin) → photos → e-mail (Brevo) → sent_at + email_logs.

/** Type de la ligne email_logs écrite à chaque envoi du bilan. */
export const REPORT_EMAIL_TYPE = 'event_report';

/** Photos du bilan : 6 au plus (contrainte CHECK de event_reports.selected_photo_ids). */
export const MAX_REPORT_PHOTOS = 6;

/** Codes de blocage renvoyés par build_event_report (P0001), dans l'ordre de la RPC. */
export const BLOCKER_CODES = ['kiosk_pending', 'kiosk_unknown', 'kiosk_not_seen', 'kiosk_unidentified', 'no_client_email'] as const;
export type BlockerCode = typeof BLOCKER_CODES[number];

/** Messages sans le nom des bornes (la carte de l'admin les précise après actualisation). */
const BLOCKER_MESSAGES: Record<BlockerCode, string> = {
  kiosk_pending: "Une borne n'a pas fini d'envoyer ses photos et ses impressions. Allumez-la avec une connexion, puis actualisez le bilan.",
  kiosk_unknown: "Une borne n'a pas encore indiqué si tout est envoyé. Allumez-la avec une connexion, puis actualisez le bilan.",
  kiosk_not_seen: "La borne n'a pas été connectée depuis l'événement.",
  kiosk_unidentified: "Des photos viennent d'une borne inconnue. Associez la borne à l'événement, puis actualisez le bilan.",
  no_client_email: "Ajoutez l'e-mail du client dans la fiche de l'événement.",
};

export const NOTHING_TO_REPORT = 'Rien à présenter pour cet événement.';
const EVENT_NOT_FOUND = 'Événement introuvable';
export const INVALID_PHOTOS = 'Choisissez 6 photos au plus.';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Codes de blocage lus dans le message P0001 (« envoi bloque (kiosk_pending, no_client_email) »). */
export function parseBlockers(message: string | null | undefined): BlockerCode[] {
  const text = String(message ?? '');
  return BLOCKER_CODES.filter((code) => new RegExp(`\\b${code}\\b`).test(text));
}

function blockerMessage(code: BlockerCode): string {
  return BLOCKER_MESSAGES[code];
}

export interface HttpResult {
  status: number;
  body: Record<string, unknown>;
}

/** Erreur de build_event_report(p_freeze => true) → réponse HTTP. */
export function freezeErrorResponse(err: { code?: string | null; message?: string | null }): HttpResult {
  if (err.code === '42501') return { status: 404, body: { error: EVENT_NOT_FOUND, code: 'not_found' } };
  if (err.code === '22023') return { status: 422, body: { error: NOTHING_TO_REPORT, code: 'nothing_to_report' } };
  if (err.code === 'P0001') {
    const blockers = parseBlockers(err.message);
    const text = blockers.length
      ? blockers.map(blockerMessage).join(' ')
      : 'Envoi bloqué : actualisez le bilan pour voir ce qui manque.';
    return { status: 409, body: { error: text, code: 'blocked', blockers } };
  }
  return { status: 500, body: { error: 'Le bilan n’a pas pu être préparé, réessayez.', code: 'build_failed' } };
}

/**
 * Photos demandées : `undefined`/`null` = garder la sélection en base ; sinon tableau de 6 UUID
 * distincts au plus, dans l'ordre d'affichage. `false` si la valeur est invalide.
 */
export function parsePhotoIds(value: unknown): string[] | null | false {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > MAX_REPORT_PHOTOS) return false;
  if (!value.every((v) => typeof v === 'string' && UUID_RE.test(v))) return false;
  if (new Set(value.map((v) => v.toLowerCase())).size !== value.length) return false;
  return value as string[];
}

/** Lien public du bilan. */
export function reportUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/$/, '')}/rapport/${token}`;
}

export interface PreviousReport {
  status: string | null;
  frozen_at: string | null;
  expires_at: string | null;
}

/**
 * Remise en état après un envoi raté (le gel a mis le rapport en ligne avant l'e-mail) :
 * un premier envoi (brouillon) ou un envoi après révocation repasse à l'état d'avant, pour que le
 * lien ne soit pas en ligne sans que le client l'ait reçu. Un renvoi (déjà « sent ») garde son
 * lien : le client l'a déjà.
 */
export function rollbackPatch(previous: PreviousReport | null): PreviousReport | null {
  if (previous?.status === 'sent') return null;
  return {
    status: previous?.status === 'revoked' ? 'revoked' : 'draft',
    frozen_at: previous?.frozen_at ?? null,
    expires_at: previous?.expires_at ?? null,
  };
}

interface FrozenReport {
  id: string;
  token: string;
  status: string;
  frozen_at: string | null;
  expires_at: string | null;
}

export interface SentEmailLike {
  messageId: string | null;
  subject: string | null;
  error: string | null;
}

type DbResult = { error: { message?: string } | null };

export interface SendDeps {
  /** build_event_report(p_event_id, p_freeze => true) sous le JWT de l'admin. */
  freeze(): PromiseLike<{ data: { report?: FrozenReport } | null; error: { code?: string; message?: string } | null }>;
  /** Mise à jour de selected_photo_ids sous le JWT de l'admin. */
  saveSelection(photoIds: string[]): PromiseLike<DbResult>;
  /** E-mail au client (Brevo, garde d'envoi de _shared/email.ts). */
  sendEmail(p: { reportUrl: string; expiresAt: string | null }): Promise<SentEmailLike>;
  /** Ligne email_logs (type event_report), écrite que Brevo accepte ou refuse. */
  logEmail(sent: SentEmailLike): Promise<void>;
  /** sent_at, par le client service_role (authenticated n'a pas ce droit). */
  markSent(reportId: string, sentAt: string): PromiseLike<DbResult>;
  /** Remise en état par le client service_role (le garde de statut ne vise que authenticated/anon). */
  rollback(reportId: string, patch: PreviousReport): PromiseLike<DbResult>;
  now(): Date;
  logError(message: string, detail?: unknown): void;
}

export interface SendInput {
  appUrl: string;
  previous: PreviousReport | null;
  photoIds: string[] | null;
  brevoRefused(error: string): Record<string, unknown>;
}

/** Envoi du bilan : gel → photos → e-mail → sent_at + email_logs. Aucun sent_at si Brevo refuse. */
export async function sendEventReport(deps: SendDeps, input: SendInput): Promise<HttpResult> {
  const { data, error } = await deps.freeze();
  if (error) return freezeErrorResponse(error);
  const report = data?.report;
  if (!report?.id || !report.token) {
    deps.logError('build_event_report : réponse sans rapport', data);
    return { status: 500, body: { error: 'Le bilan n’a pas pu être préparé, réessayez.', code: 'build_failed' } };
  }

  const undo = async () => {
    const patch = rollbackPatch(input.previous);
    if (!patch) return;
    const { error: rbErr } = await deps.rollback(report.id, patch);
    if (rbErr) deps.logError('event_reports : remise en état impossible', rbErr.message);
  };

  if (input.photoIds) {
    const { error: selErr } = await deps.saveSelection(input.photoIds);
    if (selErr) {
      deps.logError('event_reports : photos non enregistrées', selErr.message);
      await undo();
      return { status: 500, body: { error: 'Les photos du bilan n’ont pas pu être enregistrées, réessayez.', code: 'selection_failed' } };
    }
  }

  const link = reportUrl(input.appUrl, report.token);
  const sent = await deps.sendEmail({ reportUrl: link, expiresAt: report.expires_at });
  await deps.logEmail(sent);
  if (sent.error) {
    await undo();
    return { status: 502, body: input.brevoRefused(sent.error) };
  }

  const sentAt = deps.now().toISOString();
  const { error: markErr } = await deps.markSent(report.id, sentAt);
  if (markErr) deps.logError('event_reports : sent_at non enregistré', markErr.message);

  return {
    status: 200,
    body: {
      message: 'Bilan envoyé',
      report_url: link,
      token: report.token,
      frozen_at: report.frozen_at,
      expires_at: report.expires_at,
      sent_at: markErr ? null : sentAt,
    },
  };
}
