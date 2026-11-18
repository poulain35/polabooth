// Tests de l'envoi du bilan d'événement (LAB-238) : ordre des étapes, erreurs de la RPC, e-mail.
// Exécution : `npm test` (runner natif Node, strip-types — aucune dépendance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BREVO_REFUSED_STATUS, brevoRefusedBody } from '../send-delivery/manual-send.ts';
import { renderEventReportEmail } from '../_shared/saas-emails.ts';
import {
  BLOCKER_CODES, MAX_REPORT_PHOTOS, NOTHING_TO_REPORT, REPORT_EMAIL_TYPE, freezeErrorResponse, parseBlockers,
  parsePhotoIds, reportUrl, rollbackPatch, sendEventReport, type SendDeps, type SentEmailLike,
} from './logic.ts';

const TOKEN = '3f2b8c1e-9d4a-4c6b-8e2f-1a2b3c4d5e6f';
const APP = 'https://photobooth.exemple.fr';
const PHOTO = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const asAdminSource = readFileSync(new URL('./admin-jwt.ts', import.meta.url), 'utf8');
const config = readFileSync(new URL('../../config.toml', import.meta.url), 'utf8');

const FROZEN = {
  report: { id: 'rep-1', token: TOKEN, status: 'sent', frozen_at: '2026-12-19T09:30:00Z', expires_at: '2027-12-19T09:30:00Z' },
};

function harness(opts: {
  freeze?: Awaited<ReturnType<SendDeps['freeze']>>;
  sent?: SentEmailLike;
  selectionError?: string;
  markError?: string;
} = {}) {
  const calls: string[] = [];
  const logged: SentEmailLike[] = [];
  const rollbacks: unknown[] = [];
  const emails: { reportUrl: string; expiresAt: string | null }[] = [];
  const deps: SendDeps = {
    freeze: async () => { calls.push('freeze'); return opts.freeze ?? { data: FROZEN, error: null }; },
    saveSelection: async (ids) => { calls.push(`selection:${ids.length}`); return { error: opts.selectionError ? { message: opts.selectionError } : null }; },
    sendEmail: async (p) => { calls.push('email'); emails.push(p); return opts.sent ?? { messageId: '<id@brevo>', subject: 'Bilan', error: null }; },
    logEmail: async (s) => { calls.push('log'); logged.push(s); },
    markSent: async (id, at) => { calls.push(`sent_at:${id}:${at}`); return { error: opts.markError ? { message: opts.markError } : null }; },
    rollback: async (id, patch) => { calls.push(`rollback:${id}`); rollbacks.push(patch); return { error: null }; },
    now: () => new Date('2026-12-19T09:31:00Z'),
    logError: () => {},
  };
  return { deps, calls, logged, rollbacks, emails };
}

const input = (over: Partial<Parameters<typeof sendEventReport>[1]> = {}) => ({
  appUrl: `${APP}/`,
  previous: { status: 'draft', frozen_at: null, expires_at: null },
  photoIds: null,
  brevoRefused: (e: string) => brevoRefusedBody("L'e-mail du bilan", e, 'Réessayez.'),
  ...over,
});

test('envoi réussi : gel (JWT) → photos → Brevo → email_logs → sent_at, dans cet ordre', async () => {
  const h = harness();
  const res = await sendEventReport(h.deps, input({ photoIds: [PHOTO(1), PHOTO(2)] }));
  assert.equal(res.status, 200);
  assert.deepEqual(h.calls, ['freeze', 'selection:2', 'email', 'log', 'sent_at:rep-1:2026-12-19T09:31:00.000Z']);
  assert.equal(h.emails[0].reportUrl, `${APP}/rapport/${TOKEN}`);
  assert.equal(h.emails[0].expiresAt, '2027-12-19T09:30:00Z');
  assert.equal(res.body.report_url, `${APP}/rapport/${TOKEN}`);
  assert.equal(res.body.sent_at, '2026-12-19T09:31:00.000Z');
  assert.equal(res.body.frozen_at, '2026-12-19T09:30:00Z');
  assert.deepEqual(h.rollbacks, []);
});

test('sans photo_ids : la sélection en base est gardée', async () => {
  const h = harness();
  await sendEventReport(h.deps, input());
  assert.deepEqual(h.calls.slice(0, 2), ['freeze', 'email']);
});

test('Brevo refuse : ligne email_logs écrite, aucun sent_at, 502 avec le motif, brouillon remis', async () => {
  const h = harness({ sent: { messageId: null, subject: 'Bilan', error: 'Brevo 400 : invalid email' } });
  const res = await sendEventReport(h.deps, input());
  assert.equal(res.status, BREVO_REFUSED_STATUS);
  assert.equal(res.body.code, 'brevo_refused');
  assert.match(String(res.body.error), /Brevo 400 : invalid email/);
  assert.deepEqual(h.calls, ['freeze', 'email', 'log', 'rollback:rep-1']);
  assert.equal(h.logged[0].error, 'Brevo 400 : invalid email');
  assert.ok(!h.calls.some((c) => c.startsWith('sent_at')));
  assert.deepEqual(h.rollbacks, [{ status: 'draft', frozen_at: null, expires_at: null }]);
});

test('Brevo refuse un renvoi : le lien déjà reçu reste en ligne', async () => {
  const h = harness({ sent: { messageId: null, subject: 'Bilan', error: 'Brevo 500' } });
  const res = await sendEventReport(h.deps, input({ previous: { status: 'sent', frozen_at: '2026-12-10T00:00:00Z', expires_at: '2027-12-10T00:00:00Z' } }));
  assert.equal(res.status, 502);
  assert.deepEqual(h.calls, ['freeze', 'email', 'log']);
});

test('dev sans clé Brevo ou adresse hors liste blanche : messageId null sans erreur = envoyé', async () => {
  const h = harness({ sent: { messageId: null, subject: 'Bilan', error: null } });
  const res = await sendEventReport(h.deps, input());
  assert.equal(res.status, 200);
  assert.ok(h.calls.at(-1)!.startsWith('sent_at'));
});

test('RPC en erreur : ni photos, ni e-mail, ni sent_at', async () => {
  for (const [code, status] of [['42501', 404], ['22023', 422], ['P0001', 409], ['XX000', 500]] as const) {
    const h = harness({ freeze: { data: null, error: { code, message: 'build_event_report : envoi bloque (kiosk_pending)' } } });
    const res = await sendEventReport(h.deps, input({ photoIds: [PHOTO(1)] }));
    assert.equal(res.status, status, code);
    assert.deepEqual(h.calls, ['freeze'], code);
  }
});

test('photos non enregistrées : pas d’e-mail, brouillon remis', async () => {
  const h = harness({ selectionError: 'denied' });
  const res = await sendEventReport(h.deps, input({ photoIds: [PHOTO(1)] }));
  assert.equal(res.status, 500);
  assert.deepEqual(h.calls, ['freeze', 'selection:1', 'rollback:rep-1']);
});

test('sent_at non écrit après un e-mail parti : 200 quand même (l’e-mail ne se rattrape pas)', async () => {
  const h = harness({ markError: 'boom' });
  const res = await sendEventReport(h.deps, input());
  assert.equal(res.status, 200);
  assert.equal(res.body.sent_at, null);
});

test('freezeErrorResponse : codes P0001 traduits, 22023 « Rien à présenter »', () => {
  const blocked = freezeErrorResponse({ code: 'P0001', message: 'build_event_report : envoi bloque (kiosk_pending, no_client_email)' });
  assert.equal(blocked.status, 409);
  assert.deepEqual(blocked.body.blockers, ['kiosk_pending', 'no_client_email']);
  assert.match(String(blocked.body.error), /n'a pas fini d'envoyer ses photos et ses impressions/);
  assert.match(String(blocked.body.error), /Ajoutez l'e-mail du client dans la fiche de l'événement/);
  assert.equal(freezeErrorResponse({ code: '22023' }).body.error, NOTHING_TO_REPORT);
  assert.equal(freezeErrorResponse({ code: '42501' }).status, 404);
});

test('parseBlockers : tous les codes de la RPC, rien d’inventé', () => {
  assert.deepEqual(parseBlockers(`envoi bloque (${BLOCKER_CODES.join(', ')})`), [...BLOCKER_CODES]);
  assert.deepEqual(parseBlockers('envoi bloque (autre)'), []);
  assert.deepEqual(parseBlockers(null), []);
});

test('parsePhotoIds : 6 UUID distincts au plus', () => {
  assert.equal(parsePhotoIds(undefined), null);
  assert.deepEqual(parsePhotoIds([]), []);
  assert.deepEqual(parsePhotoIds([PHOTO(1), PHOTO(2)]), [PHOTO(1), PHOTO(2)]);
  assert.equal(parsePhotoIds(Array.from({ length: MAX_REPORT_PHOTOS + 1 }, (_, i) => PHOTO(i))), false);
  assert.equal(parsePhotoIds(['nope']), false);
  assert.equal(parsePhotoIds([PHOTO(1), PHOTO(1)]), false);
  assert.equal(parsePhotoIds('x'), false);
});

test('rollbackPatch : brouillon ou révoqué remis, renvoi gardé', () => {
  assert.deepEqual(rollbackPatch(null), { status: 'draft', frozen_at: null, expires_at: null });
  assert.deepEqual(rollbackPatch({ status: 'revoked', frozen_at: 'a', expires_at: 'b' }), { status: 'revoked', frozen_at: 'a', expires_at: 'b' });
  assert.equal(rollbackPatch({ status: 'sent', frozen_at: 'a', expires_at: 'b' }), null);
});

test('reportUrl : /rapport/{token} sans double barre', () => {
  assert.equal(reportUrl(`${APP}/`, TOKEN), `${APP}/rapport/${TOKEN}`);
  assert.equal(reportUrl(APP, TOKEN), `${APP}/rapport/${TOKEN}`);
});

test('index : gel sous le JWT de l’admin, sent_at et remise en état par service_role, type event_report', () => {
  assert.equal(REPORT_EMAIL_TYPE, 'event_report');
  assert.match(asAdminSource, /userDb\.rpc\('build_event_report', \{ p_event_id: eventId, p_freeze: true \}\)/);
  // Client au JWT de l'admin : userClient() partagé de _shared/auth.ts (clé anon + Authorization, LAB-392).
  assert.match(asAdminSource, /import \{ userClient \} from '\.\.\/_shared\/auth\.ts';/);
  assert.match(asAdminSource, /const userDb = userClient\(authHeader\);/);
  assert.match(asAdminSource, /saveSelection: \(ids: string\[\]\) => userDb\.from\('event_reports'\)\.update\(\{ selected_photo_ids: ids \}\)/);
  const asAdminCode = asAdminSource.replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(asAdminCode, /email_logs|service_role|SERVICE_ROLE/i);
  assert.match(source, /const asAdmin = adminJwtCalls\(authHeader, eventId\);/);
  assert.match(source, /freeze: asAdmin\.freeze,\s*saveSelection: asAdmin\.saveSelection,/);
  assert.doesNotMatch(source, /createClient\(/);
  assert.match(source, /markSent: \(reportId, sentAt\) => db\.from\('event_reports'\)\.update\(\{ sent_at: sentAt \}\)/);
  assert.match(source, /type: REPORT_EMAIL_TYPE/);
  assert.match(source, /requireOrgAccess\(db, user\.id, \{ kind: 'event', id: eventId \}\)/);
  assert.match(source, /isServiceRoleRequest\(authHeader, serviceRoleKey\)/);
  assert.doesNotMatch(source, /db\.rpc\('build_event_report'/);
  const block = config.split(/^\[functions\./m).find((b) => b.startsWith('send-event-report]'));
  assert.ok(block && /verify_jwt\s*=\s*true/.test(block), 'config.toml : verify_jwt = true');
});

test('e-mail du bilan : bouton vers le lien, aucun chiffre, données échappées', () => {
  const { subject, html } = renderEventReportEmail({
    clientName: 'Léa <b>', eventName: 'Mariage & fête', brand: 'Studio Exemple',
    reportUrl: `${APP}/rapport/${TOKEN}`, expiresAt: '2027-12-19T09:30:00Z',
  });
  assert.equal(subject, 'Le bilan de votre événement — Mariage & fête');
  assert.match(html, /Voir le bilan de votre événement/);
  assert.ok(html.includes(`href="${APP}/rapport/${TOKEN}"`));
  assert.match(html, /Léa &lt;b&gt;/);
  assert.match(html, /Mariage &amp; fête/);
  assert.match(html, /valable jusqu(&#39;|')au 19\/12\/2027/);
  // Aucun chiffre du bilan : le corps (hors pied de page commun) ne contient pas de nombre.
  const body = html.slice(html.indexOf('<h1'), html.indexOf('plus de 60 avis'));
  const text = body.replace(/<[^>]*>/g, ' ').replace(/&#\d+;/g, ' ').replace(/\d{2}\/\d{2}\/\d{4}/, '');
  assert.doesNotMatch(text, /\d/);
});

test('e-mail du bilan : date de validité absente ou invalide → pas de mention', () => {
  const p = { clientName: 'Léa', eventName: 'Mariage', brand: 'Pola', reportUrl: `${APP}/rapport/${TOKEN}` };
  assert.doesNotMatch(renderEventReportEmail(p).html, /valable/);
  assert.doesNotMatch(renderEventReportEmail({ ...p, expiresAt: 'n/a' }).html, /valable/);
});
