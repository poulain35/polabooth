/**
 * Vue admin « Logistique » et saisie manuelle des créneaux (LAB-72). Module pur.
 * Les créneaux sont stockés en UTC ; l'admin saisit et lit l'heure de Paris.
 */

const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Paris', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});
const PARIS_DAY = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Paris' });
const PARIS_TIME = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
const DAY_TITLE = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const DAY_MONTH = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

const civil = (date) => new Date(`${date}T00:00:00Z`);

export function addDays(date, n) {
  const d = civil(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Lundi de la semaine (date civile). */
export function mondayOf(date) {
  const wd = civil(date).getUTCDay() || 7;
  return addDays(date, 1 - wd);
}

export const parisDay = (iso) => PARIS_DAY.format(new Date(iso));
export const parisTime = (iso) => PARIS_TIME.format(new Date(iso));
export const dayTitle = (date) => DAY_TITLE.format(civil(date));

/** « 7 – 13 juin 2027 » (ou « 28 juin – 4 juillet 2027 »). */
export function weekTitle(monday) {
  const sunday = addDays(monday, 6);
  const sameMonth = monday.slice(0, 7) === sunday.slice(0, 7);
  return `${sameMonth ? civil(monday).getUTCDate() : DAY_MONTH.format(civil(monday))} – ${DAY_MONTH_YEAR.format(civil(sunday))}`;
}

function parisOffsetMs(ms) {
  const p = Object.fromEntries(PARTS.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms;
}

/** « 2027-06-10T18:30 » (heure de Paris, champ datetime-local) → ISO UTC. */
export function parisLocalToIso(local) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(local ?? ''));
  if (!m) return null;
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const ms = naive - parisOffsetMs(naive - parisOffsetMs(naive));
  return new Date(ms).toISOString();
}

/** ISO UTC → « 2027-06-10T18:30 » (heure de Paris). */
export function isoToParisLocal(iso) {
  if (!iso) return '';
  return `${parisDay(iso)}T${parisTime(iso)}`;
}

export const KIND_LABEL = {
  pickup: { retrait: 'Retrait', retour: 'Retour' },
  delivery: { retrait: 'Livraison', retour: 'Reprise' },
};
export const kindLabel = (kind, mode) => (KIND_LABEL[mode] ?? KIND_LABEL.pickup)[kind] ?? kind;

/** Créneaux de la semaine rangés par jour de Paris : [{ date, slots: [...] }] × 7. */
export function slotsByDay(monday, slots) {
  const days = Array.from({ length: 7 }, (_, i) => ({ date: addDays(monday, i), slots: [] }));
  for (const s of slots ?? []) {
    const day = days.find((d) => d.date === parisDay(s.starts_at));
    if (day) day.slots.push(s);
  }
  for (const d of days) d.slots.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  return days;
}

export const WARNING_LABEL = {
  hors_fenetre: 'Créneau en dehors de la fenêtre habituelle (jours de retrait / retour).',
  force: 'Capacité dépassée : créneau forcé.',
};
