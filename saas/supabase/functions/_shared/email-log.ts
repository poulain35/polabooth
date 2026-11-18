// Journalisation unique des emails clients dans email_logs (LAB-123) : chaque envoi trace son
// message-id Brevo (clé du webhook brevo-webhook), son type, son objet et son rattachement
// (lead, événement OU prospect du salon, contrainte email_logs_scope_chk). Sans import Deno : testé
// sous `node --test`.
//
// Les emails internes (alertes cron/kiosk, notifications admin) et les photos kiosk envoyées aux
// invités ne passent pas ici : email_logs est l'historique de communication avec le client.

type EmailLogScope = { leadId: string } | { eventId: string } | { prospectId: string };

export interface EmailLogEntry {
  scope: EmailLogScope;
  recipient: string;
  type: string;
  subject: string | null;
  messageId: string | null;
  /** Refus Brevo : la ligne est écrite au statut « error » avec ce motif. */
  error?: string | null;
}

// deno-lint-ignore no-explicit-any
export interface EmailLogDb { from(table: string): any }

const MAX_TEXT = 500;
const clip = (v: string | null | undefined) => (v ? v.slice(0, MAX_TEXT) : null);

export function emailLogRow(e: EmailLogEntry) {
  return {
    lead_id: 'leadId' in e.scope ? e.scope.leadId : null,
    event_id: 'eventId' in e.scope ? e.scope.eventId : null,
    prospect_id: 'prospectId' in e.scope ? e.scope.prospectId : null,
    recipient: e.recipient,
    type: e.type,
    subject: clip(e.subject),
    provider_message_id: e.messageId,
    status: e.error ? 'error' : 'sent',
    error_reason: clip(e.error),
  };
}

/** Insère la ligne ; un échec d'écriture est loggé sans faire échouer l'envoi déjà parti. */
export async function recordEmailLog(db: EmailLogDb, e: EmailLogEntry): Promise<void> {
  const { error } = await db.from('email_logs').insert(emailLogRow(e));
  if (error) console.error(`email_logs ${e.type} :`, error.message);
}
