// Tests de la détection des crons en échec et du dédoublonnage des emails (LAB-102).
// Planning : schedule.test.ts ; surveillant : watcher.test.ts ; nouvel essai : retry.test.ts ; email : email.test.ts.
// Exécution : `npm test` (runner natif Node, strip-types — aucune dépendance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectProblems, NOTIFY_COOLDOWN_MS, planCronAlerts } from './evaluate.ts';
import { H, MIN, NOW, ago, failed, job, kinds, state } from './cron.fixture.ts';

// ── Détection ───────────────────────────────────────────────────────────────

test('job sain : aucune anomalie', () => {
  assert.deepEqual(kinds(job()), []);
});

test('exécution pg_cron en échec → run_failed', () => {
  const r = detectProblems(job({ last_status: 'failed', last_return_message: 'ERROR: Secrets Vault absents' }), ago(30 * 24 * H), NOW);
  assert.deepEqual(r.map((p) => p.kind), ['run_failed']);
  assert.match(r[0].detail, /Secrets Vault absents/);
});

test('réponse HTTP 500 → http_error avec extrait', () => {
  const r = detectProblems(job({ http_status_code: 500, http_excerpt: '{"error":"Brevo 401"}' }), ago(30 * 24 * H), NOW);
  assert.deepEqual(r.map((p) => p.kind), ['http_error']);
  assert.match(r[0].detail, /HTTP 500.*Brevo 401/);
});

test('timeout pg_net → http_timeout', () => {
  assert.deepEqual(kinds(job({ http_status_code: null, http_timed_out: true, http_error: 'Timeout of 60000 ms reached' })), ['http_timeout']);
});

test('erreur réseau sans code → http_error', () => {
  assert.deepEqual(kinds(job({ http_status_code: null, http_error: 'Couldn\'t resolve host' })), ['http_error']);
});

test('appel sans réponse : en vol → rien ; au-delà du timeout → http_no_response ; au-delà de la rétention → rien', () => {
  const pending = { http_status_code: null, http_responded_at: null, http_excerpt: null };
  assert.deepEqual(kinds(job({ ...pending, http_requested_at: ago(30_000) })), []);
  assert.deepEqual(kinds(job({ ...pending, http_requested_at: ago(10 * MIN) })), ['http_no_response']);
  assert.deepEqual(kinds(job({ ...pending, http_requested_at: ago(7 * H), last_start_at: ago(40 * MIN) })), []);
});

test('job sans appel HTTP tracé (cron SQL pur) : seule l\'exécution compte', () => {
  const sqlJob = job({
    jobname: 'purge-booking-rate-limits', schedule: '0 3 * * *', last_start_at: ago(9 * H),
    http_request_id: null, http_requested_at: null, http_status_code: null, http_responded_at: null,
  });
  assert.deepEqual(kinds(sqlJob), []);
});

test('job silencieux : au moins 2 déclenchements manqués → silent', () => {
  assert.deepEqual(kinds(job({ last_start_at: ago(90 * MIN) })), []);
  const r = detectProblems(job({ last_start_at: ago(3 * H) }), ago(30 * 24 * H), NOW);
  assert.deepEqual(r.map((p) => p.kind), ['silent']);
  assert.match(r[0].detail, /depuis 3 h .* : 3 déclenchements prévus manqués/);
});

test('silence d\'un job quotidien : un passage manqué toléré, alerte au second', () => {
  const daily = { schedule: '0 8 * * *' };
  assert.deepEqual(kinds(job({ ...daily, last_start_at: '2026-10-22T08:00:02Z' })), []);
  assert.deepEqual(kinds(job({ ...daily, last_start_at: '2026-10-21T08:00:02Z' })), ['silent']);
});

test('pas de fausse alerte de silence à 6 h pour un planning de jour (dernière exécution à 20:20 la veille)', () => {
  const at = Date.parse('2026-10-23T06:00:00Z');
  const j = job({ last_start_at: '2026-10-22T20:20:00Z', http_requested_at: '2026-10-22T20:20:00Z', http_responded_at: '2026-10-22T20:20:30Z' });
  assert.deepEqual(detectProblems(j, '2026-09-01T00:00:00Z', at), []);
});

test('job jamais exécuté : déclenchements manqués comptés depuis sa première observation', () => {
  const never = job({ last_start_at: null, last_status: null, http_request_id: null, http_responded_at: null });
  assert.deepEqual(kinds(never, ago(30 * MIN)), []);
  assert.deepEqual(kinds(never, ago(3 * H)), ['silent']);
  const r = detectProblems(never, ago(3 * H), NOW);
  assert.match(r[0].detail, /^Aucune exécution enregistrée depuis 3 h \(première observation le .+\) : 3 déclenchements prévus manqués/);
});

// ── Silence et pause de nuit (LAB-121) ──────────────────────────────────────

const night = (lastStart: string | null) => job({
  jobname: 'booking-reminders', schedule: '0 6-20 * * *', last_start_at: lastStart,
  http_requested_at: lastStart, http_responded_at: lastStart,
});
const nightKinds = (lastStart: string | null, at: string, firstSeen = '2026-09-01T00:00:00Z') =>
  detectProblems(night(lastStart), firstSeen, Date.parse(at)).map((p) => p.kind);

test('planning de jour : pas d\'alerte le soir ni pendant la nuit après le dernier passage de 20:00', () => {
  const last = '2026-10-25T20:00:01Z';
  assert.deepEqual(nightKinds(last, '2026-10-25T22:00:00Z'), []);
  assert.deepEqual(nightKinds(last, '2026-10-25T22:15:00Z'), []);
  assert.deepEqual(nightKinds(last, '2026-10-26T05:59:00Z'), []);
});

test('planning de jour : alerte quand 06:00 et 07:00 sont manqués, pas après 06:00 seul', () => {
  const last = '2026-10-25T20:00:01Z';
  assert.deepEqual(nightKinds(last, '2026-10-26T06:10:00Z'), []);
  const r = detectProblems(night(last), '2026-09-01T00:00:00Z', Date.parse('2026-10-26T07:10:00Z'));
  assert.deepEqual(r.map((p) => p.kind), ['silent']);
  // 20:00 UTC = 21:00 à Paris (heure d'hiver depuis le 25/10).
  assert.match(r[0].detail, /^Aucune exécution depuis 11 h \(dernière le 25\/10\/2026 21:00\) : 2 déclenchements prévus manqués \(planning « 0 6-20 \* \* \* »\)\.$/);
});

test('planning de jour, job jamais exécuté : même règle depuis la première observation', () => {
  const firstSeen = '2026-10-25T20:30:00Z';
  assert.deepEqual(nightKinds(null, '2026-10-26T05:59:00Z', firstSeen), []);
  assert.deepEqual(nightKinds(null, '2026-10-26T06:10:00Z', firstSeen), []);
  assert.deepEqual(nightKinds(null, '2026-10-26T07:10:00Z', firstSeen), ['silent']);
});

test('toutes les 15 min : alerte après 2 passages manqués', () => {
  const quarter = (lastStart: string, at: string) => detectProblems(
    job({ schedule: '*/15 * * * *', last_start_at: lastStart, http_requested_at: lastStart, http_responded_at: lastStart }),
    '2026-09-01T00:00:00Z', Date.parse(at),
  ).map((p) => p.kind);
  const last = '2026-10-23T12:00:01Z';
  assert.deepEqual(quarter(last, '2026-10-23T12:34:00Z'), []); // 12:15 manqué, 12:30 dans la grâce
  assert.deepEqual(quarter(last, '2026-10-23T12:35:00Z'), ['silent']); // 12:15 et 12:30 manqués
});

// ── Dédoublonnage / résolution ──────────────────────────────────────────────

test('un échec → alerte ouverte et email', () => {
  const plan = planCronAlerts([failed()], [state()], NOW);
  assert.deepEqual(plan.opened, ['payment-reconcile']);
  assert.equal(plan.notify.length, 1);
  assert.equal(plan.notify[0].jobName, 'payment-reconcile');
  assert.equal(plan.states[0].failing_since, new Date(NOW).toISOString());
  assert.equal(plan.states[0].resolved_at, null);
});

test('premier passage sans état : un échec est notifié', () => {
  const plan = planCronAlerts([failed()], [], NOW);
  assert.equal(plan.notify.length, 1);
  assert.equal(plan.states[0].first_seen_at, new Date(NOW).toISOString());
});

test('échec persistant dans les 24 h → pas de second email, failing_since conservé', () => {
  const prev = state({ failing_since: ago(2 * H), last_notified_at: ago(2 * H), problems: [{ kind: 'run_failed', detail: 'x' }] });
  const plan = planCronAlerts([failed()], [prev], NOW);
  assert.equal(plan.notify.length, 0);
  assert.deepEqual(plan.opened, []);
  assert.equal(plan.states[0].failing_since, ago(2 * H));
  assert.equal(plan.states[0].last_notified_at, ago(2 * H));
});

test('second échec après résolution, dans les 24 h → alerte rouverte sans email', () => {
  const prev = state({ resolved_at: ago(1 * H), last_notified_at: ago(5 * H) });
  const plan = planCronAlerts([failed()], [prev], NOW);
  assert.deepEqual(plan.opened, ['payment-reconcile']);
  assert.equal(plan.notify.length, 0);
});

test('échec toujours là après 24 h → un rappel', () => {
  const prev = state({ failing_since: ago(25 * H), last_notified_at: new Date(NOW - NOTIFY_COOLDOWN_MS).toISOString() });
  const plan = planCronAlerts([failed()], [prev], NOW);
  assert.equal(plan.notify.length, 1);
  assert.equal(plan.notify[0].failingSince, ago(25 * H));
});

test('job revenu au vert → résolu, sans email', () => {
  const prev = state({ failing_since: ago(3 * H), last_notified_at: ago(3 * H), problems: [{ kind: 'http_error', detail: 'x' }] });
  const plan = planCronAlerts([job()], [prev], NOW);
  assert.deepEqual(plan.resolved, ['payment-reconcile']);
  assert.equal(plan.notify.length, 0);
  assert.equal(plan.states[0].failing_since, null);
  assert.deepEqual(plan.states[0].problems, []);
  assert.equal(plan.states[0].resolved_at, new Date(NOW).toISOString());
  assert.equal(plan.states[0].last_notified_at, ago(3 * H));
});

test('job sain resté sain : rien d\'ouvert ni de résolu, resolved_at inchangé', () => {
  const prev = state({ resolved_at: ago(48 * H) });
  const plan = planCronAlerts([job()], [prev], NOW);
  assert.deepEqual([plan.opened, plan.resolved, plan.notify], [[], [], []]);
  assert.equal(plan.states[0].resolved_at, ago(48 * H));
});

test('job silencieux (déclenchements manqués) → alerte et email', () => {
  const plan = planCronAlerts([job({ last_start_at: ago(5 * H) })], [state()], NOW);
  assert.equal(plan.notify.length, 1);
  assert.deepEqual(plan.notify[0].problems.map((p) => p.kind), ['silent']);
});

test('job recréé (nouveau jobid) : first_seen_at repart de maintenant, pas de silence immédiat', () => {
  const recreated = job({ jobid: 42, schedule: '0 8 * * *', last_start_at: null, last_status: null, http_request_id: null, http_responded_at: null });
  const plan = planCronAlerts([recreated], [state({ jobid: 7, first_seen_at: ago(60 * 24 * H) })], NOW);
  assert.equal(plan.notify.length, 0);
  assert.equal(plan.states[0].jobid, 42);
  assert.equal(plan.states[0].first_seen_at, new Date(NOW).toISOString());
});

test('job disparu ou désactivé alors qu\'en alerte → résolu', () => {
  const prev = state({ job_name: 'ancien-job', failing_since: ago(H), last_notified_at: ago(H) });
  const plan = planCronAlerts([], [prev], NOW);
  assert.deepEqual(plan.resolved, ['ancien-job']);
  assert.equal(plan.states[0].failing_since, null);
});

test('plusieurs jobs : chacun son cooldown', () => {
  const other = job({ jobid: 8, jobname: 'booking-reminders', schedule: '0 8 * * *', last_status: 'failed', last_start_at: ago(4 * H) });
  const prev = [state({ failing_since: ago(H), last_notified_at: ago(H) })];
  const plan = planCronAlerts([failed(), other], prev, NOW);
  assert.deepEqual(plan.notify.map((n) => n.jobName), ['booking-reminders']);
});

// ── Planning décalé « 3-59/15 » (étude LAB-122) ─────────────────────────────

test('planning 3-59/15 : passage à l\'heure non compté, silence après 2 passages manqués', () => {
  const quarter3 = (lastStart: string, at: string) => detectProblems(
    job({ schedule: '3-59/15 * * * *', last_start_at: lastStart, http_requested_at: lastStart, http_responded_at: lastStart }),
    '2026-09-01T00:00:00Z', Date.parse(at),
  );
  const last = '2026-10-23T12:03:01Z';
  assert.deepEqual(quarter3(last, '2026-10-23T12:20:00Z'), []);
  assert.deepEqual(quarter3(last, '2026-10-23T12:37:59Z'), []); // 12:18 manqué, 12:33 dans la grâce
  const r = quarter3(last, '2026-10-23T12:38:00Z');
  assert.deepEqual(r.map((p) => p.kind), ['silent']);
  assert.match(r[0].detail, /2 déclenchements prévus manqués \(planning « 3-59\/15 \* \* \* \* »\)/);
});
