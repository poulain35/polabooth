// Tests du surveillant check-cron-alerts : échecs HTTP consécutifs tolérés jusqu'au seuil (LAB-122).
// Exécution : `npm test` (runner natif Node, strip-types — aucune dépendance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectProblems, HTTP_HISTORY_LIMIT, HTTP_SETTLE_GRACE_MS, httpFailureStreak, NOTIFY_COOLDOWN_MS, planCronAlerts,
  type CronAlertState, type CronHttpCall, type CronJobSnapshot,
} from './evaluate.ts';
import { H, MIN, NOW, ago, failed, job, state } from './cron.fixture.ts';

// ── Surveillant : échecs consécutifs de check-cron-alerts (LAB-122) ─────────

const WATCHER = 'check-cron-alerts';
const QUARTER = 15 * MIN;

/** Appel du surveillant lancé il y a `age` ms : 200, 500 (timeout SQL), ou sans réponse. */
function call(age: number, outcome: 'ok' | 'ko' | 'pending'): CronHttpCall {
  const base = { request_id: 1000 - Math.round(age / QUARTER), requested_at: ago(age), timeout_ms: 30_000 };
  if (outcome === 'pending') {
    return { ...base, status_code: null, timed_out: null, error_msg: null, response_excerpt: null, responded_at: null };
  }
  return {
    ...base,
    status_code: outcome === 'ok' ? 200 : 500,
    timed_out: false,
    error_msg: null,
    response_excerpt: outcome === 'ok' ? '{"ok":true}' : '{"error":"canceling statement due to statement timeout"}',
    responded_at: new Date(NOW - age + 9_000).toISOString(),
  };
}

/** Ligne du relevé du surveillant : l'appel HTTP retenu est le plus récent ayant répondu. */
function watcherJob(calls: CronHttpCall[]): CronJobSnapshot {
  const settled = calls.find((c) => c.responded_at);
  return job({
    jobid: 13, jobname: WATCHER, schedule: '*/15 * * * *', last_start_at: ago(5_000), last_finished_at: ago(4_000),
    http_request_id: settled?.request_id ?? null,
    http_requested_at: settled?.requested_at ?? null,
    http_timeout_ms: settled?.timeout_ms ?? null,
    http_status_code: settled?.status_code ?? null,
    http_timed_out: settled?.timed_out ?? null,
    http_error: settled?.error_msg ?? null,
    http_excerpt: settled?.response_excerpt ?? null,
    http_responded_at: settled?.responded_at ?? null,
  });
}

const watcherState = (over: Partial<CronAlertState> = {}) => state({ job_name: WATCHER, jobid: 13, ...over });

test('surveillant : décompte des échecs consécutifs, appel en vol ignoré', () => {
  assert.equal(httpFailureStreak([call(5_000, 'pending'), call(QUARTER, 'ko'), call(2 * QUARTER, 'ko'), call(3 * QUARTER, 'ok')], NOW), 2);
  assert.equal(httpFailureStreak([call(5_000, 'pending'), call(QUARTER, 'ko'), call(2 * QUARTER, 'ok'), call(3 * QUARTER, 'ko')], NOW), 1);
  assert.equal(httpFailureStreak([call(QUARTER, 'ok'), call(2 * QUARTER, 'ko')], NOW), 0);
  // Ordre de l'historique indifférent.
  assert.equal(httpFailureStreak([call(3 * QUARTER, 'ok'), call(QUARTER, 'ko'), call(2 * QUARTER, 'ko')], NOW), 2);
  // Appel réglé sans réponse (perdu) : un échec ; au-delà de la rétention pg_net : décompte arrêté.
  assert.equal(httpFailureStreak([call(QUARTER, 'ko'), call(2 * QUARTER, 'pending')], NOW), 2);
  assert.equal(httpFailureStreak([call(QUARTER, 'ko'), call(7 * H, 'pending'), call(8 * H, 'ko')], NOW), 1);
});

test('surveillant : un échec isolé (500 timeout SQL) ne produit ni alerte ni email', () => {
  const history = [call(5_000, 'pending'), call(QUARTER, 'ko'), call(2 * QUARTER, 'ok')];
  assert.deepEqual(detectProblems(watcherJob(history), ago(30 * 24 * H), NOW, history), []);
  const plan = planCronAlerts([watcherJob(history)], [watcherState()], NOW, { [WATCHER]: history });
  assert.deepEqual([plan.opened, plan.notify], [[], []]);
  assert.equal(plan.states[0].failing_since, null);
});

test('surveillant : 2 échecs consécutifs → alerte et email, avec le dernier message', () => {
  const history = [call(5_000, 'pending'), call(QUARTER, 'ko'), call(2 * QUARTER, 'ko'), call(3 * QUARTER, 'ok')];
  const plan = planCronAlerts([watcherJob(history)], [watcherState()], NOW, { [WATCHER]: history });
  assert.deepEqual(plan.opened, [WATCHER]);
  assert.equal(plan.notify.length, 1);
  assert.deepEqual(plan.notify[0].problems.map((p) => p.kind), ['http_error']);
  assert.match(plan.notify[0].problems[0].detail, /^2 passages consécutifs en échec\. Dernier : Réponse HTTP 500 : .*statement timeout/);
});

test('surveillant : échecs répétés dans les 24 h → un seul email', () => {
  const history = [call(5_000, 'pending'), call(QUARTER, 'ko'), call(2 * QUARTER, 'ko'), call(3 * QUARTER, 'ko')];
  const prev = watcherState({ failing_since: ago(2 * H), last_notified_at: ago(2 * H), problems: [{ kind: 'http_error', detail: 'x' }] });
  const plan = planCronAlerts([watcherJob(history)], [prev], NOW, { [WATCHER]: history });
  assert.equal(plan.notify.length, 0);
  assert.equal(plan.states[0].failing_since, ago(2 * H));
});

test('surveillant : historique illisible → échec tenu pour isolé ; autres jobs : un échec suffit toujours', () => {
  const history = [call(QUARTER, 'ko'), call(2 * QUARTER, 'ko')];
  assert.deepEqual(detectProblems(watcherJob(history), ago(30 * 24 * H), NOW), []);
  assert.deepEqual(detectProblems(job({ http_status_code: 500 }), ago(30 * 24 * H), NOW, []).map((p) => p.kind), ['http_error']);
});

test('surveillant revenu au vert après 2 échecs → alerte résolue', () => {
  const history = [call(5_000, 'pending'), call(QUARTER, 'ok'), call(2 * QUARTER, 'ko'), call(3 * QUARTER, 'ko')];
  const prev = watcherState({ failing_since: ago(QUARTER), last_notified_at: ago(QUARTER), problems: [{ kind: 'http_error', detail: 'x' }] });
  const plan = planCronAlerts([watcherJob(history)], [prev], NOW, { [WATCHER]: history });
  assert.deepEqual(plan.resolved, [WATCHER]);
  assert.equal(plan.notify.length, 0);
});

// ── Surveillant : cas limites (revue LAB-122) ───────────────────────────────

const pendingFor = (age: number): CronHttpCall => call(age, 'pending');
/** Ligne du relevé du surveillant dont l'appel retenu est `c` (le relevé retient aussi un appel réglé sans réponse). */
const watcherWith = (c: CronHttpCall, over: Partial<CronJobSnapshot> = {}) => job({
  jobid: 13, jobname: WATCHER, schedule: '*/15 * * * *', last_start_at: ago(5_000), last_finished_at: ago(4_000),
  http_request_id: c.request_id, http_requested_at: c.requested_at, http_timeout_ms: c.timeout_ms,
  http_status_code: c.status_code, http_timed_out: c.timed_out, http_error: c.error_msg,
  http_excerpt: c.response_excerpt, http_responded_at: c.responded_at, ...over,
});

test('surveillant : historique vide ou seulement en vol → décompte nul', () => {
  assert.equal(httpFailureStreak([], NOW), 0);
  assert.equal(httpFailureStreak([pendingFor(5_000)], NOW), 0);
  assert.equal(httpFailureStreak([pendingFor(5_000), pendingFor(60_000)], NOW), 0);
});

test('surveillant : appel sans réponse, borne timeout + marge (en vol jusqu\'à 2 min 30, perdu au-delà)', () => {
  const limit = 30_000 + HTTP_SETTLE_GRACE_MS;
  assert.equal(httpFailureStreak([pendingFor(limit)], NOW), 0);
  assert.equal(httpFailureStreak([pendingFor(limit + 1_000)], NOW), 1);
  assert.equal(httpFailureStreak([pendingFor(limit + 1_000), call(QUARTER, 'ko')], NOW), 2);
});

test('surveillant : alternance succès / échec → jamais plus d\'un échec consécutif', () => {
  const alternate = (first: 'ok' | 'ko') => Array.from({ length: 8 }, (_, i) =>
    call((i + 1) * QUARTER, (i % 2 === 0) === (first === 'ko') ? 'ko' : 'ok'));
  assert.equal(httpFailureStreak(alternate('ko'), NOW), 1);
  assert.equal(httpFailureStreak(alternate('ok'), NOW), 0);
  const history = [pendingFor(5_000), ...alternate('ko')];
  assert.deepEqual(detectProblems(watcherJob(history), ago(30 * 24 * H), NOW, history), []);
});

test('surveillant : expiration pg_net et erreur réseau comptent comme des échecs', () => {
  const timedOut = { ...call(QUARTER, 'ko'), status_code: null, timed_out: true, response_excerpt: null };
  const network = { ...call(2 * QUARTER, 'ko'), status_code: null, error_msg: 'Couldn\'t connect to server', response_excerpt: null };
  assert.equal(httpFailureStreak([timedOut, network, call(3 * QUARTER, 'ok')], NOW), 2);
  const r = detectProblems(watcherWith(timedOut), ago(30 * 24 * H), NOW, [pendingFor(5_000), timedOut, network]);
  assert.deepEqual(r.map((p) => p.kind), ['http_timeout']);
  assert.match(r[0].detail, /^2 passages consécutifs en échec\. Dernier : Appel HTTP expiré/);
});

test('surveillant : date illisible → décompte arrêté (pas d\'alerte sur un doute)', () => {
  assert.equal(httpFailureStreak([{ ...pendingFor(QUARTER), requested_at: 'pas une date' }], NOW), 0);
});

test('surveillant : historique complet en échec → décompte borné par HTTP_HISTORY_LIMIT', () => {
  const history = Array.from({ length: HTTP_HISTORY_LIMIT }, (_, i) => call((i + 1) * QUARTER, 'ko'));
  assert.equal(httpFailureStreak(history, NOW), HTTP_HISTORY_LIMIT);
  const r = detectProblems(watcherJob(history), ago(30 * 24 * H), NOW, history);
  assert.match(r[0].detail, new RegExp(`^${HTTP_HISTORY_LIMIT} passages consécutifs`));
});

test('surveillant : historique lu mais vide alors que le relevé montre un échec → pas d\'alerte', () => {
  assert.deepEqual(detectProblems(watcherWith(call(QUARTER, 'ko')), ago(30 * 24 * H), NOW, []), []);
});

test('surveillant : 2 appels consécutifs perdus (sans réponse) → http_no_response', () => {
  const history = [pendingFor(5_000), pendingFor(QUARTER), pendingFor(2 * QUARTER), call(3 * QUARTER, 'ok')];
  const r = detectProblems(watcherWith(pendingFor(QUARTER)), ago(30 * 24 * H), NOW, history);
  assert.deepEqual(r.map((p) => p.kind), ['http_no_response']);
});

test('surveillant : la tolérance ne vaut que pour HTTP ; une exécution pg_cron en échec alerte dès la première', () => {
  const history = [pendingFor(5_000), call(QUARTER, 'ok')];
  const runFailed = { ...watcherJob(history), last_status: 'failed', last_return_message: 'ERROR: boom' };
  const r = detectProblems(runFailed, ago(30 * 24 * H), NOW, history);
  assert.deepEqual(r.map((p) => p.kind), ['run_failed']);
});

test('autres jobs : un échec HTTP alerte dès le premier, même si un historique leur est fourni', () => {
  const okHistory = [call(QUARTER, 'ok'), call(2 * QUARTER, 'ok')];
  const failing = job({ http_status_code: 500, http_excerpt: 'boom' });
  const plan = planCronAlerts([failing], [state()], NOW, { 'payment-reconcile': okHistory });
  assert.deepEqual(plan.opened, ['payment-reconcile']);
  assert.deepEqual(plan.notify[0].problems.map((p) => p.kind), ['http_error']);
  const lost = job({ http_status_code: null, http_responded_at: null, http_excerpt: null, http_requested_at: ago(10 * MIN) });
  assert.deepEqual(detectProblems(lost, ago(30 * 24 * H), NOW, okHistory).map((p) => p.kind), ['http_no_response']);
});

test('surveillant toléré et autre job en échec au même passage : seul l\'autre job est notifié', () => {
  const history = [pendingFor(5_000), call(QUARTER, 'ko'), call(2 * QUARTER, 'ok')];
  const plan = planCronAlerts([watcherJob(history), failed()], [watcherState(), state()], NOW, { [WATCHER]: history });
  assert.deepEqual(plan.notify.map((n) => n.jobName), ['payment-reconcile']);
});

test('surveillant : limite d\'un email par 24 h (23 h 59 → rien, 24 h → rappel, réouverture < 24 h → sans email)', () => {
  const history = [pendingFor(5_000), call(QUARTER, 'ko'), call(2 * QUARTER, 'ko')];
  const failing = (notifiedAgo: number) => watcherState({ failing_since: ago(25 * H), last_notified_at: ago(notifiedAgo), problems: [{ kind: 'http_error', detail: 'x' }] });
  assert.equal(planCronAlerts([watcherJob(history)], [failing(NOTIFY_COOLDOWN_MS - MIN)], NOW, { [WATCHER]: history }).notify.length, 0);
  assert.equal(planCronAlerts([watcherJob(history)], [failing(NOTIFY_COOLDOWN_MS)], NOW, { [WATCHER]: history }).notify.length, 1);
  const reopened = planCronAlerts([watcherJob(history)], [watcherState({ resolved_at: ago(H), last_notified_at: ago(3 * H) })], NOW, { [WATCHER]: history });
  assert.deepEqual([reopened.opened, reopened.notify.length], [[WATCHER], 0]);
});
