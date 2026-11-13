/**
 * send-delivery — email de livraison post-événement (photos, liens des fonctionnalités, avis, pièce jointe).
 *
 * Deux modes d'invocation :
 *   1. MANUEL (admin) — Authorization: Bearer {admin_jwt}, body { "event_id": "uuid" }.
 *      Envoie la livraison pour cet événement. Erreur 422 si photo_gallery_url manquant.
 *   2. CRON (service_role) — Authorization: Bearer {service_role_key}, body {} (ou aucun event_id).
 *      Parcourt les organisations dont business_profile.delivery_auto.enabled, et pour chaque
 *      événement dont la fin remonte à >= days_after jours et qui a un photo_gallery_url,
 *      envoie la livraison si elle n'a pas déjà été faite.
 *
 * Idempotence (trace dans email_logs, type = 'delivery', décision dans manual-send.ts) :
 *   - manuel : une ligne « error » (refus Brevo) ne compte pas, un nouveau clic relance l'envoi ;
 *     un refus Brevo répond 502 avec le motif ;
 *   - cron : toute ligne, refus compris, bloque l'envoi — jamais deux fois, jamais de nouvel essai.
 *
 * Contenu de l'email (générique, open core L4) : lien photos (photo_gallery_url), boutons
 * events.delivery_links remplis par les fonctionnalités (le livre d'or audio par un déclencheur SQL),
 * CTA avis (business_profile.google_review_url) et document joint (events.delivery_attachment_url).
 * Cette fonction ne connaît ni l'audio ni la facture.
 */

import { handleCors, corsResponse } from '../_shared/cors.ts';
import { adminClient, sessionUser } from '../_shared/auth.ts';
import { authenticate, cronOnly, forbiddenOrg, isServiceRoleRequest } from '../_shared/admin-guard.ts';
import { sendDeliveryEmail, type SentEmail } from '../_shared/email.ts';
import { recordEmailLog } from '../_shared/email-log.ts';
import { orgSender } from '../_shared/org-identity.ts';
import { isFeatureEnabled } from '../_shared/features.ts';
import { featureDisabled } from '../_shared/feature-guard.ts';
import { BREVO_REFUSED_STATUS, brevoRefusedBody, deliveryDecision, type DeliveryMode } from './manual-send.ts';
import { deliveryAttachmentUrl, deliveryLinks } from '../_shared/delivery-links.ts';
import { appUrl } from '../_shared/app-url.ts';

const serviceRoleKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APP_URL         = appUrl().replace(/\/$/, '');
const DEFAULT_DAYS_AFTER = 2;
const EVENT_COLUMNS = 'id, name, org_id, client_name, client_email, end_date, photo_gallery_url, delivery_links, delivery_attachment_url';

type EventRow = {
  id: string;
  name: string | null;
  org_id: string;
  client_name: string | null;
  client_email: string | null;
  end_date: string | null;
  photo_gallery_url: string | null;
  delivery_links: unknown;
  delivery_attachment_url: string | null;
};

type BusinessProfile = {
  company_name?: string;
  google_review_url?: string;
  delivery_auto?: { enabled?: boolean; days_after?: number };
};

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return corsResponse(405, { error: 'Method not allowed' });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return corsResponse(401, { error: 'Non autorisé' });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* body vide autorisé (cron) */ }
  const eventId = (body as { event_id?: string }).event_id;

  const db = adminClient();

  // Mode cron : service_role (clé exacte ou JWT du Vault) et sans event_id.
  if (!eventId) {
    const denied = cronOnly(req, serviceRoleKey);
    if (denied) return denied;
    return await runCron(db);
  }

  // Mode manuel : admin propriétaire de l'organisation de l'événement.
  if (isServiceRoleRequest(authHeader, serviceRoleKey)) {
    return corsResponse(400, { error: "Le mode cron ne prend pas d'event_id" });
  }
  const auth = await authenticate(authHeader, sessionUser);
  if (auth.response) return auth.response;
  const user = auth.user;

  const { data: eventData, error: evErr } = await db
    .from('events')
    .select(EVENT_COLUMNS)
    .eq('id', eventId)
    .single();

  if (evErr || !eventData) return corsResponse(404, { error: 'Événement introuvable' });
  const event = eventData as EventRow;

  // Vérifier que l'admin est propriétaire de l'organisation.
  const { data: org } = await db
    .from('organizations')
    .select('id, features, business_profile')
    .eq('id', event.org_id)
    .eq('owner_id', user.id)
    .maybeSingle();

  if (!org) return forbiddenOrg();
  if (!isFeatureEnabled(org.features, 'delivery_email')) return featureDisabled();

  if (!event.client_email) {
    return corsResponse(422, { error: 'Aucun email client renseigné pour cet événement' });
  }
  if (!event.photo_gallery_url) {
    return corsResponse(422, { error: 'Aucun lien galerie photos renseigné — impossible d\'envoyer la livraison' });
  }

  let decision;
  try {
    decision = await deliveryDecisionFor(db, event.id, 'manual');
  } catch (e) {
    console.error('Lecture email_logs (livraison manuelle)', event.id, e);
    return corsResponse(500, { error: 'Impossible de vérifier les livraisons précédentes, réessayez.' });
  }
  if (decision === 'already_sent') return corsResponse(200, { message: 'Livraison déjà envoyée', skipped: true });

  const sentEmail = await deliver(db, event, (org.business_profile as BusinessProfile) ?? {});
  if (sentEmail.error) {
    return corsResponse(BREVO_REFUSED_STATUS, brevoRefusedBody(
      "L'email de livraison", sentEmail.error, 'Corrigez si besoin puis cliquez à nouveau sur « Envoyer la livraison ».',
    ));
  }
  return corsResponse(200, { message: 'Livraison envoyée avec succès' });
});

/** Traite tous les événements dûs pour l'envoi automatique (mode cron). */
async function runCron(db: ReturnType<typeof adminClient>) {
  const now = Date.now();

  const { data: orgs, error: orgErr } = await db
    .from('organizations')
    .select('id, features, business_profile')
    .eq('business_profile->delivery_auto->>enabled', 'true');

  if (orgErr) return corsResponse(500, { error: orgErr.message });
  if (!orgs?.length) return corsResponse(200, { checked: 0, sent: 0 });

  let sent = 0;

  for (const org of orgs) {
    if (!isFeatureEnabled(org.features, 'delivery_email')) continue;
    const profile: BusinessProfile = org.business_profile ?? {};
    const daysAfter = Number.isFinite(profile.delivery_auto?.days_after)
      ? Number(profile.delivery_auto!.days_after)
      : DEFAULT_DAYS_AFTER;

    const { data: events } = await db
      .from('events')
      .select(EVENT_COLUMNS)
      .eq('org_id', org.id)
      .not('client_email', 'is', null)
      .not('end_date', 'is', null)
      .not('photo_gallery_url', 'is', null);

    for (const ev of (events ?? []) as EventRow[]) {
      if (!ev.client_email || !ev.photo_gallery_url) continue;

      const daysSinceEnd = daysSince(ev.end_date!, now);
      if (daysSinceEnd < daysAfter) continue;

      try {
        if (await deliveryDecisionFor(db, ev.id, 'cron') === 'already_sent') continue;
        const sentEmail = await deliver(db, ev, profile);
        if (sentEmail.error) console.error('Livraison auto refusée par Brevo', ev.id, sentEmail.error);
        else sent++;
      } catch (e) {
        console.error('Échec livraison auto', ev.id, e);
      }
    }
  }

  return corsResponse(200, { checked: orgs.length, sent });
}

/** Envoie l'email de livraison et trace l'envoi dans email_logs. */
async function deliver(db: ReturnType<typeof adminClient>, ev: EventRow, profile: BusinessProfile): Promise<SentEmail> {
  const sentEmail = await sendDeliveryEmail({
    to:              ev.client_email!,
    clientName:      ev.client_name ?? 'Client',
    eventName:       ev.name || 'votre événement',
    companyName:     profile.company_name ?? '',
    photoGalleryUrl: ev.photo_gallery_url!,
    links:           deliveryLinks(ev.delivery_links, APP_URL),
    reviewUrl:       profile.google_review_url || undefined,
    attachmentUrl:   deliveryAttachmentUrl(ev.delivery_attachment_url) ?? undefined,
    sender:          await orgSender(db, ev.org_id),
  });

  await recordEmailLog(db, { scope: { eventId: ev.id }, recipient: ev.client_email!, type: 'delivery', ...sentEmail });
  return sentEmail;
}

/**
 * Décision d'envoi d'après les livraisons déjà tracées. Lève si email_logs est illisible : sans
 * cela, une lecture en échec passerait pour « aucune livraison » et le cron enverrait un doublon.
 */
async function deliveryDecisionFor(db: ReturnType<typeof adminClient>, eventId: string, mode: DeliveryMode) {
  const { data, error } = await db
    .from('email_logs')
    .select('status')
    .eq('event_id', eventId)
    .eq('type', 'delivery');
  if (error) throw new Error(`email_logs : ${error.message}`);
  return deliveryDecision(mode, data ?? []);
}

/** Jours entiers écoulés depuis une date de fin (UTC minuit). */
function daysSince(endDate: string, now: number): number {
  const end   = new Date(`${endDate.slice(0, 10)}T00:00:00Z`).getTime();
  const today = new Date(new Date(now).toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
  return Math.round((today - end) / 86_400_000);
}
