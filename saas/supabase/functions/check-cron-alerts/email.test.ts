// Tests de l'email admin « cron en échec » (LAB-102) : sujet, impact métier, échappement.
// Exécution : `npm test` (runner natif Node, strip-types — aucune dépendance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderCronAlertEmail } from './email.ts';
import { H, ago } from './cron.fixture.ts';

test('email : impact métier des jobs LAB-122 (purge-cron-history, check-cron-alerts)', () => {
  const render = (jobName: string) => renderCronAlertEmail({
    jobName, schedule: '7 3 * * *', failingSince: ago(H), dashboardUrl: null,
    problems: [{ kind: 'run_failed', detail: 'x' }],
  }).html;
  assert.match(render('purge-cron-history'), /historique des exécutions pg_cron/);
  assert.match(render('check-cron-alerts'), /surveillance des tâches planifiées/);
});

test('email : impact métier de purge-kiosk-guest-responses (LAB-219)', () => {
  const { html } = renderCronAlertEmail({
    jobName: 'purge-kiosk-guest-responses', schedule: '15 3 * * *', failingSince: ago(H), dashboardUrl: null,
    problems: [{ kind: 'run_failed', detail: 'x' }],
  });
  assert.match(html, /questionnaire de la borne/);
  assert.match(html, /30 jours après la fin de l’événement/);
});

test('email : impact métier de purge-kiosk-photo-consents (LAB-223)', () => {
  const { html } = renderCronAlertEmail({
    jobName: 'purge-kiosk-photo-consents', schedule: '20 3 * * *', failingSince: ago(H), dashboardUrl: null,
    problems: [{ kind: 'run_failed', detail: 'x' }],
  });
  assert.match(html, /consentements photo de la borne/);
  assert.match(html, /suppression des photos/);
});

test('email : impact métier de purge-kiosk-logs (LAB-325)', () => {
  const { html } = renderCronAlertEmail({
    jobName: 'purge-kiosk-logs', schedule: '25 3 * * *', failingSince: ago(H), dashboardUrl: null,
    problems: [{ kind: 'run_failed', detail: 'x' }],
  });
  assert.match(html, /journaux de la borne/);
  assert.match(html, /90 jours/);
});

test('email : sujet, impact métier, détail échappé', () => {
  const { subject, html } = renderCronAlertEmail({
    jobName: 'send-delivery', schedule: '20 5-20 * * *', failingSince: ago(H), dashboardUrl: 'https://supabase.com/dashboard/project/x/integrations/cron/jobs',
    problems: [{ kind: 'http_error', detail: 'Réponse HTTP 500 : <script>' }],
  });
  assert.match(subject, /send-delivery/);
  assert.match(html, /livraison des photos/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});
