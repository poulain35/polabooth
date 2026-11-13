// Logique pure de check-cron-alerts (LAB-102) : détection des crons en échec et dédoublonnage des
// emails. Sans Deno ni réseau, testée sous `node --test` (evaluate.test.ts).
//
// Trois détections par job pg_cron actif :
//   - run_failed       : la dernière exécution terminée est en `failed` (cron.job_run_details) ;
//   - http_*           : le dernier appel net.http_post tracé (cron_http_calls) a répondu hors 2xx,
//                        a expiré, ou n'a laissé aucune réponse ;
//   - silent           : au moins 2 déclenchements prévus du planning passés sans exécution.
// Exception (LAB-122) : pour les jobs de HTTP_FAILURE_STREAK (check-cron-alerts, le surveillant), un échec
// HTTP isolé est toléré ; l'alerte part à partir de N appels consécutifs en échec (historique cron_http_calls).
// Un job en anomalie ouvre une alerte (failing_since) ; il est résolu dès qu'il repasse au vert.
// Au plus un email par job et par 24 h (last_notified_at), y compris si l'alerte s'est refermée
// puis rouverte entre-temps.

export const NOTIFY_COOLDOWN_MS = 24 * 3_600_000;
/** Rétention par défaut de net._http_response : au-delà, une réponse absente n'est pas une preuve d'échec. */
export const HTTP_RESPONSE_RETENTION_MS = 6 * 3_600_000;
/** Marge après le timeout pg_net avant de considérer un appel sans réponse comme perdu. */
export const HTTP_SETTLE_GRACE_MS = 2 * 60_000;
/** Nombre de déclenchements prévus manqués à partir duquel un job est silencieux. */
export const SILENCE_FACTOR = 2;
/** Marge laissée à pg_cron pour lancer un déclenchement prévu avant de le compter comme manqué. */
export const SILENCE_GRACE_MS = 5 * 60_000;
/** Borne du décompte des déclenchements manqués (coût de la recherche et lisibilité du message). */
export const MISSED_FIRES_CAP = 100;
/**
 * Appels HTTP consécutifs en échec à partir desquels un job est en anomalie, quand un échec isolé ne
 * suffit pas. check-cron-alerts : timeouts SQL ponctuels, rattrapés au passage suivant (LAB-122).
 */
export const HTTP_FAILURE_STREAK: Record<string, number> = { 'check-cron-alerts': 2 };
/** Appels récents lus par job de HTTP_FAILURE_STREAK pour compter les échecs consécutifs. */
export const HTTP_HISTORY_LIMIT = 10;
/** Pause avant l'unique nouvel essai d'un appel base en échec transitoire. */
export const RPC_RETRY_DELAY_MS = 2_000;

export type ProblemKind = 'run_failed' | 'http_error' | 'http_timeout' | 'http_no_response' | 'silent';

export interface Problem {
  kind: ProblemKind;
  /** Texte brut (échappé au rendu de l'email). */
  detail: string;
}

/** Une ligne de public.cron_health_snapshot(). */
export interface CronJobSnapshot {
  jobid: number;
  jobname: string;
  schedule: string;
  last_start_at: string | null;
  last_status: string | null;
  last_finished_at: string | null;
  last_return_message: string | null;
  http_request_id: number | null;
  http_requested_at: string | null;
  http_timeout_ms: number | null;
  http_status_code: number | null;
  http_timed_out: boolean | null;
  http_error: string | null;
  http_excerpt: string | null;
  http_responded_at: string | null;
}

/** Un appel tracé de public.cron_http_calls (historique d'un job de HTTP_FAILURE_STREAK). */
export interface CronHttpCall {
  request_id: number;
  requested_at: string;
  timeout_ms: number;
  status_code: number | null;
  timed_out: boolean | null;
  error_msg: string | null;
  response_excerpt: string | null;
  responded_at: string | null;
}

/** Une ligne de public.cron_job_alerts (état persistant, une par job). */
export interface CronAlertState {
  job_name: string;
  jobid: number | null;
  first_seen_at: string;
  failing_since: string | null;
  problems: Problem[];
  last_notified_at: string | null;
  last_recipient: string | null;
  resolved_at: string | null;
}

export interface CronAlertPlan {
  /** États à enregistrer (upsert sur job_name). */
  states: CronAlertState[];
  /** Jobs en anomalie à notifier maintenant (cooldown de 24 h respecté). */
  notify: Array<{ jobName: string; schedule: string | null; problems: Problem[]; failingSince: string }>;
  opened: string[];
  resolved: string[];
}

// ── Planning cron ───────────────────────────────────────────────────────────

interface CronSpec {
  minutes: Set<number>;
  hours: Set<number>;
  days: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
  daysRestricted: boolean;
  weekdaysRestricted: boolean;
}

const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *', '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0', '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@hourly': '0 * * * *',
};
const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function parseValue(raw: string, names: string[] | null, nameOffset: number): number {
  const lower = raw.toLowerCase();
  const named = names ? names.indexOf(lower) : -1;
  if (named >= 0) return named + nameOffset;
  if (!/^\d+$/.test(raw)) throw new Error(`valeur cron invalide : ${raw}`);
  return Number(raw);
}

function parseField(field: string, min: number, max: number, names: string[] | null = null, nameOffset = 0): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const [range, stepRaw] = part.split('/');
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    if (!Number.isInteger(step) || step < 1) throw new Error(`pas cron invalide : ${part}`);
    let lo: number;
    let hi: number;
    if (range === '*') {
      lo = min;
      hi = max;
    } else if (range.includes('-')) {
      const [a, b] = range.split('-');
      lo = parseValue(a, names, nameOffset);
      hi = parseValue(b, names, nameOffset);
    } else {
      lo = parseValue(range, names, nameOffset);
      hi = stepRaw === undefined ? lo : max;
    }
    if (lo < min || hi > max || lo > hi) throw new Error(`plage cron invalide : ${part}`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

function parseCron(schedule: string): CronSpec | null {
  const expr = MACROS[schedule.trim().toLowerCase()] ?? schedule.trim();
  const fields = expr.split(/\s+/);
  if (fields.length !== 5) return null;
  try {
    const weekdays = parseField(fields[4], 0, 7, DAY_NAMES, 0);
    if (weekdays.has(7)) weekdays.add(0);
    return {
      minutes: parseField(fields[0], 0, 59),
      hours: parseField(fields[1], 0, 23),
      days: parseField(fields[2], 1, 31),
      months: parseField(fields[3], 1, 12, MONTH_NAMES, 1),
      weekdays,
      daysRestricted: fields[2] !== '*',
      weekdaysRestricted: fields[4] !== '*',
    };
  } catch {
    return null;
  }
}

function dayMatches(spec: CronSpec, d: Date): boolean {
  const dom = spec.days.has(d.getUTCDate());
  const dow = spec.weekdays.has(d.getUTCDay());
  // Règle Vixie cron (reprise par pg_cron) : jour du mois OU jour de semaine si les deux sont restreints.
  if (spec.daysRestricted && spec.weekdaysRestricted) return dom || dow;
  if (spec.daysRestricted) return dom;
  if (spec.weekdaysRestricted) return dow;
  return true;
}

const MINUTE = 60_000;

/** Dernier déclenchement prévu ≤ `at` (UTC, comme pg_cron sur Supabase), ou null au-delà de 400 jours. */
function previousFire(spec: CronSpec, at: number): number | null {
  let t = Math.floor(at / MINUTE) * MINUTE;
  const limit = at - 400 * 24 * 3_600_000;
  while (t >= limit) {
    const d = new Date(t);
    if (!spec.months.has(d.getUTCMonth() + 1)) {
      t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - MINUTE;
    } else if (!dayMatches(spec, d)) {
      t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - MINUTE;
    } else if (!spec.hours.has(d.getUTCHours())) {
      t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours()) - MINUTE;
    } else if (!spec.minutes.has(d.getUTCMinutes())) {
      t -= MINUTE;
    } else {
      return t;
    }
  }
  return null;
}

/**
 * Déclenchements prévus après `since` et échus depuis plus de SILENCE_GRACE_MS à `now`, plafonnés à
 * MISSED_FIRES_CAP. Compter les passages manqués plutôt que comparer le silence à un intervalle évite
 * les fausses alertes pendant la pause de nuit des plannings à plage horaire : pour '0 6-20 * * *',
 * rien n'est manqué entre 20:00 et 06:00. Syntaxe pg_cron « N seconds » acceptée. null si illisible.
 */
export function missedFires(schedule: string, since: number, now: number): number | null {
  const until = now - SILENCE_GRACE_MS;
  const seconds = schedule.trim().match(/^(\d+)\s*seconds?$/i);
  if (seconds) {
    const missed = Math.floor((until - since) / (Number(seconds[1]) * 1000));
    return Math.min(MISSED_FIRES_CAP, Math.max(0, missed));
  }
  const spec = parseCron(schedule);
  if (!spec) return null;
  let missed = 0;
  for (let t = previousFire(spec, until); t !== null && t > since && missed < MISSED_FIRES_CAP; t = previousFire(spec, t - MINUTE)) {
    missed++;
  }
  return missed;
}

// ── Détection ───────────────────────────────────────────────────────────────

const ts = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);

const formatParis = (ms: number) =>
  new Date(ms).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' });

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / MINUTE);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} j`;
}

function clip(text: string | null | undefined, max = 300): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

type HttpFields = Pick<CronJobSnapshot,
  'http_request_id' | 'http_requested_at' | 'http_timeout_ms' | 'http_status_code' | 'http_timed_out' |
  'http_error' | 'http_excerpt' | 'http_responded_at'>;

const httpFields = (c: CronHttpCall): HttpFields => ({
  http_request_id: c.request_id,
  http_requested_at: c.requested_at,
  http_timeout_ms: c.timeout_ms,
  http_status_code: c.status_code,
  http_timed_out: c.timed_out,
  http_error: c.error_msg,
  http_excerpt: c.response_excerpt,
  http_responded_at: c.responded_at,
});

function httpProblem(job: HttpFields, now: number): Problem | null {
  if (job.http_request_id == null) return null;
  if (job.http_responded_at) {
    if (job.http_timed_out) {
      return { kind: 'http_timeout', detail: `Appel HTTP expiré (délai de ${Math.round((job.http_timeout_ms ?? 0) / 1000)} s dépassé).` };
    }
    const code = job.http_status_code;
    if (code == null) return { kind: 'http_error', detail: `Appel HTTP en erreur : ${clip(job.http_error) || 'erreur réseau'}.` };
    if (code < 200 || code >= 300) {
      const excerpt = clip(job.http_excerpt);
      return { kind: 'http_error', detail: `Réponse HTTP ${code}${excerpt ? ` : ${excerpt}` : ''}.` };
    }
    return null;
  }
  const requestedAt = ts(job.http_requested_at);
  if (Number.isNaN(requestedAt)) return null;
  const age = now - requestedAt;
  const settled = age > (job.http_timeout_ms ?? 0) + HTTP_SETTLE_GRACE_MS;
  if (!settled || age > HTTP_RESPONSE_RETENTION_MS) return null;
  return { kind: 'http_no_response', detail: `Aucune réponse enregistrée pour l'appel HTTP lancé il y a ${formatDuration(age)}.` };
}

/**
 * Appels consécutifs en échec, du plus récent au plus ancien. Les appels encore en vol (dont l'appel du
 * passage courant) sont ignorés ; un appel sans réponse au-delà de la rétention pg_net arrête le décompte.
 */
export function httpFailureStreak(calls: CronHttpCall[], now: number): number {
  let streak = 0;
  for (const call of [...calls].sort((a, b) => ts(b.requested_at) - ts(a.requested_at))) {
    const inFlight = !call.responded_at && now - ts(call.requested_at) <= call.timeout_ms + HTTP_SETTLE_GRACE_MS;
    if (inFlight) continue;
    if (!httpProblem(httpFields(call), now)) break;
    streak++;
  }
  return streak;
}

/**
 * Anomalies d'un job. `firstSeenAt` remplace la dernière exécution quand le job n'a jamais tourné.
 * `recentCalls` : appels HTTP récents du job, requis pour les jobs de HTTP_FAILURE_STREAK.
 */
export function detectProblems(job: CronJobSnapshot, firstSeenAt: string, now: number, recentCalls?: CronHttpCall[]): Problem[] {
  const problems: Problem[] = [];

  if (job.last_status === 'failed') {
    problems.push({ kind: 'run_failed', detail: `Dernière exécution en échec : ${clip(job.last_return_message) || 'aucun message'}.` });
  }

  const http = httpProblem(job, now);
  const streakNeeded = HTTP_FAILURE_STREAK[job.jobname] ?? 1;
  if (http && streakNeeded <= 1) {
    problems.push(http);
  } else if (http) {
    // Sans historique (lecture en échec), l'échec est tenu pour isolé : pas d'alerte sur un doute.
    const streak = recentCalls ? httpFailureStreak(recentCalls, now) : 1;
    if (streak >= streakNeeded) {
      problems.push({ kind: http.kind, detail: `${streak} passages consécutifs en échec. Dernier : ${http.detail}` });
    }
  }

  const lastActivity = ts(job.last_start_at ?? firstSeenAt);
  const missed = Number.isNaN(lastActivity) ? null : missedFires(job.schedule, lastActivity, now);
  if (missed !== null && missed >= SILENCE_FACTOR) {
    const count = missed >= MISSED_FIRES_CAP ? `au moins ${MISSED_FIRES_CAP}` : `${missed}`;
    const tail = `${count} déclenchements prévus manqués (planning « ${job.schedule} »)`;
    problems.push({
      kind: 'silent',
      detail: job.last_start_at
        ? `Aucune exécution depuis ${formatDuration(now - lastActivity)} (dernière le ${formatParis(lastActivity)}) : ${tail}.`
        : `Aucune exécution enregistrée depuis ${formatDuration(now - lastActivity)} (première observation le ${formatParis(lastActivity)}) : ${tail}.`,
    });
  }

  return problems;
}

// ── Dédoublonnage / résolution ──────────────────────────────────────────────

export function canNotify(lastNotifiedAt: string | null, now: number): boolean {
  const last = ts(lastNotifiedAt);
  return Number.isNaN(last) || now - last >= NOTIFY_COOLDOWN_MS;
}

/**
 * Confronte le relevé courant à l'état persisté. Les jobs disparus ou désactivés (absents du relevé)
 * sont résolus. L'appelant enregistre `states`, envoie les emails de `notify` puis renseigne
 * last_notified_at des envois réussis. `httpHistory` : appels récents par nom de job (HTTP_FAILURE_STREAK).
 */
export function planCronAlerts(
  jobs: CronJobSnapshot[],
  previous: CronAlertState[],
  now: number,
  httpHistory: Record<string, CronHttpCall[]> = {},
): CronAlertPlan {
  const nowIso = new Date(now).toISOString();
  const prevByName = new Map(previous.map((s) => [s.job_name, s]));
  const plan: CronAlertPlan = { states: [], notify: [], opened: [], resolved: [] };

  for (const job of jobs) {
    const prev = prevByName.get(job.jobname);
    prevByName.delete(job.jobname);
    // Job recréé (unschedule + schedule → nouveau jobid) : son historique repart de zéro.
    const firstSeenAt = prev && prev.jobid === job.jobid ? prev.first_seen_at : nowIso;
    const problems = detectProblems(job, firstSeenAt, now, httpHistory[job.jobname]);
    const base = {
      job_name: job.jobname,
      jobid: job.jobid,
      first_seen_at: firstSeenAt,
      last_notified_at: prev?.last_notified_at ?? null,
      last_recipient: prev?.last_recipient ?? null,
    };

    if (problems.length) {
      const failingSince = prev?.failing_since ?? nowIso;
      if (!prev?.failing_since) plan.opened.push(job.jobname);
      plan.states.push({ ...base, failing_since: failingSince, problems, resolved_at: null });
      if (canNotify(base.last_notified_at, now)) {
        plan.notify.push({ jobName: job.jobname, schedule: job.schedule, problems, failingSince });
      }
    } else {
      if (prev?.failing_since) plan.resolved.push(job.jobname);
      plan.states.push({
        ...base,
        failing_since: null,
        problems: [],
        resolved_at: prev?.failing_since ? nowIso : prev?.resolved_at ?? null,
      });
    }
  }

  for (const prev of prevByName.values()) {
    if (!prev.failing_since) continue;
    plan.resolved.push(prev.job_name);
    plan.states.push({ ...prev, failing_since: null, problems: [], resolved_at: nowIso });
  }

  return plan;
}


// ── Erreurs transitoires ────────────────────────────────────────────────────

/** SQLSTATE et codes PostgREST d'un échec passager (délai, verrou, connexion, pool saturé). */
const TRANSIENT_CODES = new Set([
  '57014', // statement timeout (query_canceled)
  '55P03', // lock timeout
  '40001', '40P01', // sérialisation, interblocage
  '53300', '57P01', '57P03', // connexions saturées, arrêt / démarrage du serveur
  'PGRST000', 'PGRST001', 'PGRST002', 'PGRST003', // connexion PostgREST ↔ base, cache de schéma, pool
]);

/**
 * Erreur d'un appel supabase-js (RPC) qui vaut un nouvel essai. `status` 0 = échec réseau (fetch rejeté),
 * 502 à 504 = passerelle.
 */
export function isTransientDbError(error: { code?: string | null; message?: string | null } | null, status?: number): boolean {
  if (!error) return false;
  const code = error.code ?? '';
  if (TRANSIENT_CODES.has(code) || code.startsWith('08')) return true;
  if (status === 0 || status === 502 || status === 503 || status === 504) return true;
  return /statement timeout|lock timeout|fetch failed|connection (refused|reset|closed|terminated)|ECONNRESET/i.test(error.message ?? '');
}

/** Résultat d'un appel supabase-js : erreur éventuelle et statut HTTP (0 = échec réseau). */
export interface DbResult {
  error: { code?: string | null; message?: string | null } | null;
  status?: number;
}

/**
 * Lance `run`, puis le relance une seule fois après RPC_RETRY_DELAY_MS si l'erreur est transitoire
 * (isTransientDbError). Le second résultat est renvoyé tel quel, succès ou échec : jamais de troisième
 * essai. Une erreur non transitoire est renvoyée immédiatement. `sleep` est injectable pour les tests.
 */
export async function retryOnceIfTransient<T extends DbResult>(
  run: () => PromiseLike<T>,
  onRetry: (error: NonNullable<T['error']>) => void = () => {},
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  const first = await run();
  if (!first.error || !isTransientDbError(first.error, first.status)) return first;
  onRetry(first.error as NonNullable<T['error']>);
  await sleep(RPC_RETRY_DELAY_MS);
  return await run();
}
