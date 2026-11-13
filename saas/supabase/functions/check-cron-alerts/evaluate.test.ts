// Tests de la détection des crons en échec et du dédoublonnage des emails (LAB-102).
// Exécution : `npm test` (runner natif Node, strip-types — aucune dépendance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectProblems, HTTP_HISTORY_LIMIT, HTTP_SETTLE_GRACE_MS, httpFailureStreak, isTransientDbError, missedFires,
  MISSED_FIRES_CAP, NOTIFY_COOLDOWN_MS, planCronAlerts, retryOnceIfTransient, RPC_RETRY_DELAY_MS,
  type CronAlertState, type CronHttpCall, type CronJobSnapshot, type DbResult,
} from './evaluate.ts';
import { renderCronAlertEmail } from './email.ts';

const H = 3_600_000;
const MIN = 60_000;
const NOW = Date.parse('2026-10-23T12:05:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function job(over: Partial<CronJobSnapshot> = {}): CronJobSnapshot {
  return {
    jobid: 7,
    jobname: 'payment-reconcile',
    schedule: '20 5-20 * * *',
    last_start_at: ago(45 * MIN),
    last_status: 'succeeded',
    last_finished_at: ago(45 * MIN),
    last_return_message: '1 row',
    http_request_id: 101,
    http_requested_at: ago(45 * MIN),
    http_timeout_ms: 60_000,
    http_status_code: 200,
    http_timed_out: false,
    http_error: null,
    http_excerpt: '{"ok":true}',
    http_responded_at: ago(44 * MIN),
    ...over,
  };
}

function state(over: Partial<CronAlertState> = {}): CronAlertState {
  return {
    job_name: 'payment-reconcile',
    jobid: 7,
    first_seen_at: ago(30 * 24 * H),
    failing_since: null,
    problems: [],
    last_notified_at: null,
    last_recipient: null,
    resolved_at: null,
    ...over,
  };
}

const kinds = (j: CronJobSnapshot, firstSeen = ago(30 * 24 * H), now = NOW) =>
  detectProblems(j, firstSeen, now).map((p) => p.kind).sort();

// ── Planning ────────────────────────────────────────────────────────────────

test('déclenchements manqués : toutes les 5 min, horaire de jour, quotidien, hebdo, macro', () => {
  const since = Date.parse('2026-10-23T11:00:30Z');
  assert.equal(missedFires('*/5 * * * *', since, NOW), 12); // 11:05 → 12:00 (12:05 encore dans la grâce)
  assert.equal(missedFires('20 5-20 * * *', since, NOW), 1); // 11:20
  assert.equal(missedFires('0 8 * * *', since, NOW), 0);
  assert.equal(missedFires('0 8 * * *', Date.parse('2026-10-21T08:00:05Z'), NOW), 2); // 22 et 23 à 08:00
  assert.equal(missedFires('0 0 * * 1', Date.parse('2026-10-05T00:00:05Z'), NOW), 2); // lundis 12 et 19
  assert.equal(missedFires('@hourly', since, NOW), 1); // 12:00
});

test('déclenchements manqués : marge de grâce pour la latence de pg_cron', () => {
  const since = Date.parse('2026-10-23T11:00:05Z');
  assert.equal(missedFires('0 * * * *', since, Date.parse('2026-10-23T12:04:00Z')), 0);
  assert.equal(missedFires('0 * * * *', since, Date.parse('2026-10-23T12:05:00Z')), 1);
});

test('déclenchements manqués : syntaxe « N seconds » (intervalles écoulés après la grâce)', () => {
  assert.equal(missedFires('30 seconds', NOW - 6 * MIN, NOW), 2);
  assert.equal(missedFires('30 seconds', NOW - 5 * MIN - 59_000, NOW), 1);
  assert.equal(missedFires('30 seconds', NOW - 5 * MIN, NOW), 0);
});

test('déclenchements manqués : décompte plafonné, planning illisible → null', () => {
  assert.equal(missedFires('* * * * *', NOW - 30 * 24 * H, NOW), MISSED_FIRES_CAP);
  assert.equal(missedFires('n importe quoi', NOW - H, NOW), null);
  assert.equal(missedFires('61 * * * *', NOW - H, NOW), null);
});

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
  const r = detectProblems(job({ http_status_code: 500, http_excerpt: '{"error":"Pennylane 401"}' }), ago(30 * 24 * H), NOW);
  assert.deepEqual(r.map((p) => p.kind), ['http_error']);
  assert.match(r[0].detail, /HTTP 500.*Pennylane 401/);
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
  jobname: 'pennylane-sync', schedule: '0 6-20 * * *', last_start_at: lastStart,
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

const failed = () => job({ last_status: 'failed', last_return_message: 'boom' });

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

// ── Erreurs transitoires de la RPC ──────────────────────────────────────────

test('erreur transitoire : timeout SQL, verrou, connexion, réseau, passerelle → nouvel essai', () => {
  assert.equal(isTransientDbError({ code: '57014', message: 'canceling statement due to statement timeout' }, 500), true);
  assert.equal(isTransientDbError({ code: '', message: 'canceling statement due to statement timeout' }, 500), true);
  assert.equal(isTransientDbError({ code: '55P03', message: 'canceling statement due to lock timeout' }, 500), true);
  assert.equal(isTransientDbError({ code: '08006', message: 'connection failure' }, 503), true);
  assert.equal(isTransientDbError({ code: 'PGRST003', message: 'Timed out acquiring connection from connection pool.' }, 504), true);
  assert.equal(isTransientDbError({ code: '', message: 'TypeError: fetch failed' }, 0), true);
  assert.equal(isTransientDbError({ code: '', message: '<html>Bad Gateway</html>' }, 502), true);
});

test('erreur non transitoire : droits, fonction absente, erreur SQL → pas de nouvel essai', () => {
  assert.equal(isTransientDbError(null, 200), false);
  assert.equal(isTransientDbError({ code: '42501', message: 'permission denied for function cron_health_snapshot' }, 403), false);
  assert.equal(isTransientDbError({ code: 'PGRST202', message: 'Could not find the function public.cron_health_snapshot' }, 404), false);
  assert.equal(isTransientDbError({ code: '42P01', message: 'relation "cron.job" does not exist' }, 400), false);
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

// ── Nouvel essai du relevé (retryOnceIfTransient) ───────────────────────────

/** Faux appel RPC : renvoie les résultats dans l'ordre et compte les appels ; sleep et onRetry espionnés. */
function rpcStub(results: DbResult[]) {
  const calls = { run: 0, sleeps: [] as number[], retries: [] as string[] };
  const run = () => Promise.resolve(results[Math.min(calls.run++, results.length - 1)]);
  const sleep = (ms: number) => { calls.sleeps.push(ms); return Promise.resolve(); };
  const onRetry = (e: { message?: string | null }) => { calls.retries.push(e.message ?? ''); };
  return { calls, go: () => retryOnceIfTransient(run, onRetry, sleep) };
}
const OK: DbResult = { error: null, status: 200 };
const TIMEOUT: DbResult = { error: { code: '57014', message: 'canceling statement due to statement timeout' }, status: 500 };
const DENIED: DbResult = { error: { code: '42501', message: 'permission denied for function cron_health_snapshot' }, status: 403 };

test('relevé : succès du premier coup → un seul appel, aucune pause', async () => {
  const s = rpcStub([OK]);
  assert.equal(await s.go(), OK);
  assert.deepEqual([s.calls.run, s.calls.sleeps, s.calls.retries], [1, [], []]);
});

test('relevé : erreur non transitoire → renvoyée immédiatement (→ 500), sans nouvel essai', async () => {
  const s = rpcStub([DENIED, OK]);
  assert.equal(await s.go(), DENIED);
  assert.deepEqual([s.calls.run, s.calls.sleeps], [1, []]);
});

test('relevé : timeout SQL puis succès → un nouvel essai après 2 s', async () => {
  const s = rpcStub([TIMEOUT, OK]);
  assert.equal(await s.go(), OK);
  assert.deepEqual([s.calls.run, s.calls.sleeps, s.calls.retries], [2, [RPC_RETRY_DELAY_MS], [TIMEOUT.error!.message!]]);
  assert.equal(RPC_RETRY_DELAY_MS, 2_000);
});

test('relevé : deux timeouts → une seule relance, la seconde erreur est renvoyée', async () => {
  const second: DbResult = { error: { code: '57014', message: 'second timeout' }, status: 500 };
  const s = rpcStub([TIMEOUT, second, OK]);
  assert.equal(await s.go(), second);
  assert.deepEqual([s.calls.run, s.calls.sleeps.length], [2, 1]);
});

test('relevé : échec réseau (status 0) puis erreur non transitoire → relancé une fois, erreur renvoyée', async () => {
  const network: DbResult = { error: { code: '', message: 'TypeError: fetch failed' }, status: 0 };
  const s = rpcStub([network, DENIED]);
  assert.equal(await s.go(), DENIED);
  assert.equal(s.calls.run, 2);
});

// ── Planning décalé « 3-59/15 » (étude LAB-122) ─────────────────────────────

test('planning 3-59/15 : déclenchements à :03, :18, :33, :48', () => {
  const since = Date.parse('2026-10-23T11:00:30Z');
  assert.equal(missedFires('3-59/15 * * * *', since, NOW), 4); // 11:03, 11:18, 11:33, 11:48 (12:03 dans la grâce)
  assert.equal(missedFires('3-59/15 * * * *', since, Date.parse('2026-10-23T12:07:59Z')), 4);
  assert.equal(missedFires('3-59/15 * * * *', since, Date.parse('2026-10-23T12:08:00Z')), 5); // + 12:03
  // Écriture abrégée acceptée par evaluate.ts avec le même sens (pg_cron : préférer la forme explicite).
  assert.equal(missedFires('3/15 * * * *', since, NOW), 4);
});

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

test('planning 3-59/15 : passage d\'heure et de jour (23:48 → 00:03 → 00:18)', () => {
  const since = Date.parse('2026-10-23T23:48:01Z');
  assert.equal(missedFires('3-59/15 * * * *', since, Date.parse('2026-10-24T00:22:59Z')), 1); // 00:03
  assert.equal(missedFires('3-59/15 * * * *', since, Date.parse('2026-10-24T00:23:00Z')), 2); // 00:03, 00:18
  assert.equal(missedFires('3-59/15 * * * *', since, Date.parse('2026-10-24T00:07:59Z')), 0);
});

// ── Email ───────────────────────────────────────────────────────────────────

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
