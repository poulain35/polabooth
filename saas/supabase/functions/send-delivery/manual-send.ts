// Décisions des envois d'emails client (LAB-126), sans import Deno : testées sous `node --test`.
// Utilisé par send-delivery, resend-access-email et review-design.

export type DeliveryMode = 'manual' | 'cron';
export type DeliveryDecision = 'send' | 'already_sent';

/**
 * Faut-il envoyer la livraison, au vu des lignes email_logs « delivery » déjà écrites pour
 * l'événement ?
 *
 * - Mode manuel : seule une ligne qui n'est pas un refus Brevo (status ≠ 'error') compte comme
 *   livraison envoyée. Après un refus, un nouveau clic de l'admin relance donc l'envoi.
 * - Mode cron : toute ligne bloque, refus compris. Le cron ne retente jamais : un refus Brevo
 *   est en général durable (adresse invalide, facture inaccessible…) et un nouvel essai
 *   quotidien empilerait les erreurs sans fin. Le refus est visible dans « Emails envoyés » et
 *   l'admin relance à la main.
 */
export function deliveryDecision(mode: DeliveryMode, logs: ReadonlyArray<{ status: string | null }>): DeliveryDecision {
  const blocking = mode === 'cron' ? logs : logs.filter((l) => l.status !== 'error');
  return blocking.length ? 'already_sent' : 'send';
}

/** Statut HTTP d'un envoi manuel refusé par Brevo. */
export const BREVO_REFUSED_STATUS = 502;

/**
 * Corps de réponse d'un envoi manuel refusé par Brevo, affiché tel quel par l'admin.
 * `what` : l'email concerné (« L'email de livraison »), `next` : quoi faire ensuite.
 */
export function brevoRefusedBody(what: string, error: string, next: string) {
  return {
    error: `${what} n'a pas été envoyé : Brevo a refusé l'envoi (${error}). ${next}`,
    code: 'brevo_refused' as const,
  };
}
