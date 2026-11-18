// Données communes des tests de check-cron-alerts (LAB-102) : instant de référence, ligne du relevé et
// état d'alerte par défaut, à surcharger champ par champ.
import { detectProblems, type CronAlertState, type CronJobSnapshot } from './evaluate.ts';

export const H = 3_600_000;
export const MIN = 60_000;
export const NOW = Date.parse('2026-10-23T12:05:00Z');
export const ago = (ms: number) => new Date(NOW - ms).toISOString();

export function job(over: Partial<CronJobSnapshot> = {}): CronJobSnapshot {
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

export function state(over: Partial<CronAlertState> = {}): CronAlertState {
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

export const kinds = (j: CronJobSnapshot, firstSeen = ago(30 * 24 * H), now = NOW) =>
  detectProblems(j, firstSeen, now).map((p) => p.kind).sort();
export const failed = () => job({ last_status: 'failed', last_return_message: 'boom' });
