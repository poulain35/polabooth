// Planning pg_cron de check-cron-alerts (LAB-102, LAB-121) : lecture des expressions cron et décompte
// des déclenchements prévus manqués. Logique pure, testée sous `node --test` (schedule.test.ts).

/** Marge laissée à pg_cron pour lancer un déclenchement prévu avant de le compter comme manqué. */
const SILENCE_GRACE_MS = 5 * 60_000;
/** Borne du décompte des déclenchements manqués (coût de la recherche et lisibilité du message). */
export const MISSED_FIRES_CAP = 100;

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

export const MINUTE = 60_000;

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
