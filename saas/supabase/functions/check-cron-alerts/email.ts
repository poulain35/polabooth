// Email admin « cron en échec » (LAB-102). Rendu pur (sans Deno ni réseau), testé sous `node --test`.

import { BRAND_MARKS, button, detailsTable, escapeHtml, layout, mutedNote, softBox } from '../_shared/email-layout.ts';
import { PRIVATE_MODULES } from '../_shared/private-modules.ts';
import type { Problem } from './evaluate.ts';

/**
 * Conséquence métier d'un job arrêté, pour que l'email dise quoi vérifier à la main. Les jobs d'un module
 * privé sont décrits par son catalogue (cronImpact, _shared/private-modules.ts, LAB-403).
 */
const IMPACT: Record<string, string> = {
  'booking-reminders': 'Les relances de devis, d’acompte et de solde, et les expirations automatiques ne partent plus.',
  'booking-slot-reminders': 'Les rappels de créneaux de retrait / retour ne partent plus.',
  'send-access-emails': 'Les emails d’accès à l’éditeur ne partent plus.',
  'send-design-reminders': 'Les relances de design non soumis ne partent plus.',
  'send-delivery': 'Les emails de livraison des photos ne partent plus.',
  'check-kiosk-alerts': 'Les alertes du parc kiosk ne sont plus vérifiées.',
  'design-images-cleanup': 'Les images des modèles qui ne servent plus ne sont pas supprimées du stockage (rien n’a été effacé à tort : en cas d’erreur, tout est gardé ; nouvel essai au prochain passage).',
  'billing-documents-cleanup': 'Les PDF de facturation des demandes supprimées ne sont plus effacés du stockage (rien n’a été effacé à tort : en cas d’erreur, tout est gardé ; nouvel essai au prochain passage).',
  'media-expiry': 'Les rappels avant expiration des galeries ne partent plus, ou des photos et messages audio expirés depuis plus de 30 jours n’ont pas été supprimés (relance au prochain passage).',
  'purge-booking-rate-limits': 'Les compteurs de rate limit du formulaire ne sont plus purgés.',
  'purge-kiosk-guest-responses': 'Les réponses au questionnaire de la borne (contacts invités) ne sont plus supprimées 30 jours après la fin de l’événement : elles restent en base au-delà de la durée annoncée aux invités.',
  'purge-kiosk-photo-consents': 'Les consentements photo de la borne ne sont plus supprimés avec les photos de l’événement : ils restent en base après la suppression des photos qu’ils couvrent.',
  'purge-kiosk-logs': 'Les journaux de la borne ne sont plus supprimés après 90 jours : la table kiosk_logs grossit sans limite.',
  'purge-cron-history': 'L’historique des exécutions pg_cron n’est plus purgé : la table grossit et ralentit la surveillance des crons.',
  'check-cron-alerts': 'La surveillance des tâches planifiées a échoué plusieurs fois de suite : une panne d’un autre cron a pu passer inaperçue.',
  ...Object.assign({}, ...PRIVATE_MODULES.map((m) => m.cronImpact ?? {})),
};

const LABEL: Record<Problem['kind'], string> = {
  run_failed: 'Exécution en échec',
  http_error: 'Erreur HTTP',
  http_timeout: 'Délai dépassé',
  http_no_response: 'Pas de réponse',
  silent: 'Job silencieux',
};

export function renderCronAlertEmail(p: {
  jobName: string;
  schedule: string | null;
  problems: Problem[];
  failingSince: string;
  dashboardUrl: string | null;
}): { subject: string; html: string } {
  const since = new Date(p.failingSince).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' });
  const impact = IMPACT[p.jobName];
  const rows: Array<[string, string]> = [
    ['Job', `<strong>${escapeHtml(p.jobName)}</strong>`],
    ['Planning', escapeHtml(p.schedule ?? '—')],
    ['En anomalie depuis', escapeHtml(since)],
    ...p.problems.map((pb): [string, string] => [LABEL[pb.kind], escapeHtml(pb.detail)]),
  ];
  return {
    subject: `⚠️ Tâche planifiée en échec : ${p.jobName}`,
    html: layout('⚠️ Tâche planifiée en échec', `
    ${softBox(escapeHtml(impact ?? 'Une tâche planifiée (pg_cron) ne s’exécute plus correctement.'), { tone: 'danger', margin: '0 0 16px' })}
    ${detailsTable(rows)}
    ${p.dashboardUrl ? button(p.dashboardUrl, 'Ouvrir les crons Supabase →') : ''}
    ${mutedNote(`Alerte automatique (au plus un email par tâche et par 24 h) · ${BRAND_MARKS.name}`, '0')}`, { audience: 'admin' }),
  };
}
