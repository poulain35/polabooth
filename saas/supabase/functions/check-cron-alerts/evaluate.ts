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
// Planning cron : schedule.ts ; nouvel essai sur erreur transitoire : retry.ts.

import { MINUTE, MISSED_FIRES_CAP, missedFires } from './schedule.ts';

export const NOTIFY_COOLDOWN_MS = 24 * 3_600_000;
/** Rétention par défaut de net._http_response : au-delà, une réponse absente n'est pas une preuve d'échec. */
const HTTP_RESPONSE_RETENTION_MS = 6 * 3_600_000;
/** Marge après le timeout pg_net avant de considérer un appel sans réponse comme perdu. */
export const HTTP_SETTLE_GRACE_MS = 2 * 60_000;
/** Nombre de déclenchements prévus manqués à partir duquel un job est silencieux. */
const SILENCE_FACTOR = 2;
/**
 * Appels HTTP consécutifs en échec à partir desquels un job est en anomalie, quand un échec isolé ne
 * suffit pas. check-cron-alerts : timeouts SQL ponctuels, rattrapés au passage suivant (LAB-122).
 */
export const HTTP_FAILURE_STREAK: Record<string, number> = { 'check-cron-alerts': 2 };
/** Appels récents lus par job de HTTP_FAILURE_STREAK pour compter les échecs consécutifs. */
export const HTTP_HISTORY_LIMIT = 10;

type ProblemKind = 'run_failed' | 'http_error' | 'http_timeout' | 'http_no_response' | 'silent';

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

// ── Détection ───────────────────────────────────────────────────────────────

const ts = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);

const formatParis = (ms: number) =>
  new Date(ms).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' });

function formatDuration(ms: number): string {
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

function canNotify(lastNotifiedAt: string | null, now: number): boolean {
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
