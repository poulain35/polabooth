/**
 * brevo-webhook — ingestion des événements du webhook transactionnel Brevo (LAB-123).
 *
 * Chaque événement (request, delivered, opened, click, bounce, spam…) est historisé dans
 * email_events puis la ligne email_logs (retrouvée par provider_message_id) est recalculée depuis
 * tout son historique : logique pure et testée dans _shared/email-tracking.ts.
 *
 * Auth : Brevo n'envoie pas de JWT Supabase (verify_jwt = false dans config.toml) → jeton en query
 *        string (?token=<BREVO_WEBHOOK_SECRET>), comparé en temps constant. 401 si absent ou faux,
 *        500 si le secret n'est pas configuré.
 *
 * Réponses : 200 dès que le lot est traité, y compris message-id inconnu (email non journalisé,
 *            ex. photo kiosk) ou événement non suivi, pour que Brevo ne réessaie pas indéfiniment.
 *            500 sur erreur base : Brevo réessaie, le dédoublonnage absorbe la relivraison.
 */

import { adminClient } from '../_shared/auth.ts';
import { jsonResponse } from '../_shared/cors.ts';
import { applyBrevoEvents, authorizeWebhook, groupByMessageId, parseWebhookBody } from '../_shared/email-tracking.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Méthode non autorisée' });

  const auth = authorizeWebhook(new URL(req.url).searchParams.get('token'), Deno.env.get('BREVO_WEBHOOK_SECRET'));
  if (auth === 'misconfigured') {
    console.error('BREVO_WEBHOOK_SECRET non configuré');
    return jsonResponse(500, { error: 'Webhook secret non configuré' });
  }
  if (auth === 'unauthorized') return jsonResponse(401, { error: 'Non autorisé' });

  let body: unknown;
  try { body = await req.json(); } catch { return jsonResponse(400, { error: 'Body JSON invalide' }); }

  const { events, ignored } = parseWebhookBody(body);
  if (!events.length) return jsonResponse(200, { received: 0, ignored });

  const db = adminClient();
  const nowIso = new Date().toISOString();
  let matched = 0;
  let updated = 0;
  try {
    for (const [messageId, list] of groupByMessageId(events)) {
      const res = await applyBrevoEvents(db, messageId, list, 'webhook', nowIso);
      matched += res.matched;
      updated += res.updated;
    }
  } catch (err) {
    console.error('brevo-webhook :', (err as Error).message);
    return jsonResponse(500, { error: 'Erreur base' });
  }

  return jsonResponse(200, { received: events.length, ignored, matched, updated });
});
