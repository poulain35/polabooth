// Stock de matériel par type (LAB-358, spec docs/specs/stock-materiel.md, lot S1).
// Règles pures, miroir de supabase/functions/_shared/equipment.ts (un test vérifie l'accord), plus
// ce que l'admin affiche : regroupement par type, compteurs, libellés, validation de la fenêtre.
// Les dates sont des jours 'AAAA-MM-JJ' (comparaison de chaînes).

export const TYPE_KEY_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const TYPE_KEY_MAX_LENGTH = 40;
export const MAX_NEED_QUANTITY = 50;
export const TYPE_LABEL_MAX_LENGTH = 60;
export const ITEM_NAME_MAX_LENGTH = 60;
export const REASON_MAX_LENGTH = 200;
export const NOTES_MAX_LENGTH = 1000;

/** Suggestions de l'écran vide (D1) : affichées, jamais insérées d'office. */
export const SUGGESTED_TYPE_LABELS = ['Borne photo', "Livre d'or audio", 'Cabine photo', 'Vidéobooth', 'Caravane photobooth'];

// ── Règles partagées avec le serveur ────────────────────────────────────────────────────────

/** Jour 'AAAA-MM-JJ' d'une date ou d'un horodatage ISO ; null si illisible. */
function toDay(value) {
  if (typeof value !== 'string') return null;
  const day = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/** Clé de type depuis le libellé : « Livre d'or audio » → « livre-d-or-audio ». */
export function slugifyTypeKey(label) {
  if (typeof label !== 'string') return '';
  const ascii = label
    .replace(/[œŒ]/g, 'oe')
    .replace(/[æÆ]/g, 'ae')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  const slug = ascii.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.slice(0, TYPE_KEY_MAX_LENGTH).replace(/-+$/, '');
}

function isValidTypeKey(key) {
  return typeof key === 'string' && key.length <= TYPE_KEY_MAX_LENGTH && TYPE_KEY_PATTERN.test(key);
}

/** Quantité valide d'un besoin : entier de 0 à 50 ; null sinon. */
export function parseNeedQuantity(value) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > MAX_NEED_QUANTITY) return null;
  return n;
}

/** Besoin propre { clé valide: entier 1..50 } ; `allowedKeys` filtre les types inconnus ou archivés. */
export function normalizeNeeds(value, allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const allowed = allowedKeys ? new Set(allowedKeys) : null;
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!isValidTypeKey(key)) continue;
    if (allowed && !allowed.has(key)) continue;
    const qty = parseNeedQuantity(raw);
    if (qty) out[key] = qty;
  }
  return out;
}

/** Somme de deux besoins, le second multiplié par `factor`. */
export function addNeeds(a, b, factor = 1) {
  const out = {};
  const add = (needs, k) => {
    if (!needs || typeof needs !== 'object' || Array.isArray(needs)) return;
    for (const [key, raw] of Object.entries(needs)) {
      if (!isValidTypeKey(key) || typeof raw !== 'number' || !Number.isFinite(raw)) continue;
      const qty = raw * k;
      if (qty > 0) out[key] = (out[key] ?? 0) + qty;
    }
  };
  add(a, 1);
  add(b, Number.isFinite(factor) && factor > 0 ? factor : 0);
  return out;
}

/** Besoin d'un événement : equipment_needs propre, ou { type par défaut: 1 } s'il vaut null. */
export function eventNeeds(event, defaultKey) {
  const raw = event?.equipment_needs;
  if (raw === null || raw === undefined) {
    return defaultKey && isValidTypeKey(defaultKey) ? { [defaultKey]: 1 } : {};
  }
  return normalizeNeeds(raw);
}

export function defaultTypeKey(types) {
  return (types ?? []).find((t) => t.is_default && !t.archived_at)?.key ?? null;
}

function isUnavailableOn(item, date) {
  const day = toDay(date);
  const from = toDay(item.unavailable_from);
  if (!day || !from || day < from) return false;
  const until = toDay(item.unavailable_until);
  return !until || day <= until;
}

function isAvailableOn(item, date) {
  return item.status !== 'retired' && !isUnavailableOn(item, date);
}

function itemKey(item, keysById) {
  if (item.type_key) return item.type_key;
  return item.type_id && keysById ? keysById.get(item.type_id) ?? null : null;
}

export function stockOn(items, typeKey, date, types) {
  const keysById = types ? new Map(types.map((t) => [t.id, t.key])) : null;
  let n = 0;
  for (const item of items ?? []) {
    if (itemKey(item, keysById) === typeKey && isAvailableOn(item, date)) n += 1;
  }
  return n;
}

export function compareTypes(a, b) {
  return (a.sort_order ?? 0) - (b.sort_order ?? 0)
    || String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
    || a.label.localeCompare(b.label, 'fr');
}

export function trackedTypes(types, items) {
  const list = types ?? [];
  const keysById = new Map(list.map((t) => [t.id, t.key]));
  const used = new Set();
  for (const item of items ?? []) {
    if (item.status === 'retired') continue;
    const key = itemKey(item, keysById);
    if (key) used.add(key);
  }
  return list.filter((t) => !t.archived_at && used.has(t.key)).sort(compareTypes);
}

// ── Affichage (admin) ───────────────────────────────────────────────────────────────────────

/** Jour local 'AAAA-MM-JJ' (aujourd'hui par défaut). */
export function localDay(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** « 20/11 », ou « 20/11/2027 » quand l'année n'est pas celle de `today`. */
export function formatDay(day, today) {
  const d = toDay(day);
  if (!d) return '';
  const [y, m, dd] = d.split('-');
  const sameYear = toDay(today)?.slice(0, 4) === y;
  return sameYear ? `${dd}/${m}` : `${dd}/${m}/${y}`;
}

function compareItems(a, b) {
  return (a.sort_order ?? 0) - (b.sort_order ?? 0)
    || String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
    || String(a.name ?? '').localeCompare(String(b.name ?? ''), 'fr', { numeric: true });
}

/**
 * Blocs de l'onglet Matériel : types non archivés (puis archivés) dans l'ordre, chacun avec ses
 * matériels en service (`active`), ses retirés, et ses compteurs du jour : `total` = en service,
 * `available` = en service et hors période d'indisponibilité.
 */
export function groupEquipment(types, items, today) {
  const byType = new Map();
  for (const item of items ?? []) {
    if (!byType.has(item.type_id)) byType.set(item.type_id, []);
    byType.get(item.type_id).push(item);
  }
  const blocks = [...(types ?? [])].sort(compareTypes).map((type) => {
    const list = (byType.get(type.id) ?? []).slice().sort(compareItems);
    const active = list.filter((i) => i.status !== 'retired');
    const retired = list.filter((i) => i.status === 'retired');
    const available = active.filter((i) => isAvailableOn(i, today)).length;
    return { type, active, retired, total: active.length, available, itemCount: list.length };
  });
  return {
    active: blocks.filter((b) => !b.type.archived_at),
    archived: blocks.filter((b) => b.type.archived_at),
  };
}

/** « 5 disponibles sur 6 », « 1 disponible sur 1 », « Aucun matériel en service ». */
export function availabilityLabel(available, total) {
  if (!total) return 'Aucun matériel en service';
  return `${available} ${available > 1 ? 'disponibles' : 'disponible'} sur ${total}`;
}

/** « 2 retirés · Afficher » */
export function retiredToggleLabel(count, open) {
  return `${count} ${count > 1 ? 'retirés' : 'retiré'} · ${open ? 'Masquer' : 'Afficher'}`;
}

/** Période ce jour-là : 'none' (aucune), 'past' (terminée), 'current' (en cours), 'future' (à venir). */
export function periodState(item, today) {
  const from = toDay(item.unavailable_from);
  if (!from) return 'none';
  const until = toDay(item.unavailable_until);
  if (until && until < today) return 'past';
  return from <= today ? 'current' : 'future';
}

/**
 * Pastille d'un matériel : { label, tone } avec tone 'ok' (En service), 'off' (indisponible
 * aujourd'hui), 'planned' (indisponibilité à venir), 'retired' (Retiré).
 */
export function itemStatus(item, today) {
  if (item.status === 'retired') return { label: 'Retiré', tone: 'retired' };
  const state = periodState(item, today);
  const from = formatDay(item.unavailable_from, today);
  const until = item.unavailable_until ? formatDay(item.unavailable_until, today) : null;
  if (state === 'current') {
    return until
      ? { label: `Indisponible du ${from} au ${until}`, tone: 'off' }
      : { label: `Indisponible depuis le ${from}, sans date de fin`, tone: 'off' };
  }
  if (state === 'future') {
    return until
      ? { label: `Indisponible du ${from} au ${until}`, tone: 'planned' }
      : { label: `Indisponible à partir du ${from}`, tone: 'planned' };
  }
  return { label: 'En service', tone: 'ok' };
}

/** Période terminée : « Dernière indisponibilité : du 20/11 au 24/11 » ; sinon null. */
export function lastUnavailabilityLabel(item, today) {
  if (periodState(item, today) !== 'past') return null;
  return `Dernière indisponibilité : du ${formatDay(item.unavailable_from, today)} au ${formatDay(item.unavailable_until, today)}`;
}

/** Libellé comparé sans accents, sans casse, espaces réduits. */
function normalizeLabel(label) {
  return String(label ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Un autre type non archivé porte-t-il déjà ce libellé ? (« Ce type existe déjà ») */
export function isDuplicateTypeLabel(label, types, exceptId = null) {
  const wanted = normalizeLabel(label);
  if (!wanted) return false;
  return (types ?? []).some((t) => t.id !== exceptId && !t.archived_at && normalizeLabel(t.label) === wanted);
}

/** Clé libre pour un nouveau type : slug du libellé, suffixé -2, -3… si déjà prise (même archivée). */
export function uniqueTypeKey(label, types) {
  const base = slugifyTypeKey(label) || 'type';
  const taken = new Set((types ?? []).map((t) => t.key));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const head = base.slice(0, TYPE_KEY_MAX_LENGTH - suffix.length).replace(/-+$/, '');
    const key = `${head}${suffix}`;
    if (!taken.has(key)) return key;
  }
}

/** Nom proposé pour un nouveau matériel : « Borne photo 7 » (après le plus grand numéro du type). */
export function suggestItemName(typeLabel, items) {
  const label = String(typeLabel ?? '').trim();
  const list = items ?? [];
  const prefix = normalizeLabel(label);
  let max = list.length;
  for (const item of list) {
    const m = /^(.*?)\s*(\d+)$/.exec(String(item.name ?? '').trim());
    if (m && normalizeLabel(m[1]) === prefix) max = Math.max(max, Number(m[2]));
  }
  return `${label} ${max + 1}`.slice(0, ITEM_NAME_MAX_LENGTH);
}

/** Libellé d'un type : null si valide, sinon le message à afficher. */
export function validateTypeLabel(label, types, exceptId = null) {
  const trimmed = String(label ?? '').trim();
  if (!trimmed) return 'Indiquez un nom';
  if (trimmed.length > TYPE_LABEL_MAX_LENGTH) return `${TYPE_LABEL_MAX_LENGTH} caractères au plus`;
  if (isDuplicateTypeLabel(trimmed, types, exceptId)) return 'Ce type existe déjà';
  return null;
}

/**
 * Fenêtre d'un matériel : { field: message } des erreurs (vide si tout est bon). Mêmes règles que
 * les contraintes en base : nom 1..60, fin seulement avec un début et pas avant lui, motif ≤ 200,
 * notes ≤ 1000.
 */
export function validateItemDraft(draft) {
  const errors = {};
  const name = String(draft?.name ?? '').trim();
  if (!name) errors.name = 'Indiquez un nom';
  else if (name.length > ITEM_NAME_MAX_LENGTH) errors.name = `${ITEM_NAME_MAX_LENGTH} caractères au plus`;
  const from = draft?.unavailable_from || null;
  const until = draft?.unavailable_until || null;
  if (from && !toDay(from)) errors.unavailable_from = 'Date invalide';
  if (until && !toDay(until)) errors.unavailable_until = 'Date invalide';
  else if (until && !from) errors.unavailable_from = 'Indiquez la date de début';
  else if (until && from && toDay(from) && until < from) errors.unavailable_until = 'La fin doit être après le début';
  if (String(draft?.unavailable_reason ?? '').length > REASON_MAX_LENGTH) {
    errors.unavailable_reason = `${REASON_MAX_LENGTH} caractères au plus`;
  }
  if (String(draft?.notes ?? '').length > NOTES_MAX_LENGTH) errors.notes = `${NOTES_MAX_LENGTH} caractères au plus`;
  return errors;
}

/** Ligne à écrire depuis la fenêtre d'un matériel (textes nettoyés, période vide = null). */
export function itemPayload(draft) {
  const from = draft.unavailable_from || null;
  const reason = String(draft.unavailable_reason ?? '').trim();
  const notes = String(draft.notes ?? '').trim();
  return {
    name: String(draft.name ?? '').trim(),
    status: draft.status === 'retired' ? 'retired' : 'in_service',
    unavailable_from: from,
    unavailable_until: from ? draft.unavailable_until || null : null,
    unavailable_reason: from && reason ? reason : null,
    notes: notes || null,
  };
}

/**
 * Monter / Descendre un type parmi les types non archivés : nouvelles valeurs de sort_order
 * ([{ id, sort_order }], seulement celles qui changent). Rien si le type est déjà au bout.
 */
export function moveType(types, id, direction) {
  const list = (types ?? []).filter((t) => !t.archived_at).sort(compareTypes);
  const from = list.findIndex((t) => t.id === id);
  const to = from + (direction === 'up' ? -1 : 1);
  if (from < 0 || to < 0 || to >= list.length) return [];
  const next = list.slice();
  [next[from], next[to]] = [next[to], next[from]];
  return next
    .map((t, index) => ({ id: t.id, sort_order: index, before: t.sort_order ?? 0 }))
    .filter((t) => t.sort_order !== t.before)
    .map(({ id: typeId, sort_order }) => ({ id: typeId, sort_order }));
}

/** sort_order d'un nouvel élément : après le plus grand. */
export function nextSortOrder(rows) {
  return (rows ?? []).reduce((max, r) => Math.max(max, (r.sort_order ?? 0) + 1), 0);
}

/**
 * Ligne « Matériel » de la fiche de l'événement : « 1 Borne photo · 1 Livre d'or audio » ;
 * null → « 1 Borne photo (par défaut) » ; {} ou rien de connu → « Aucun matériel ».
 * Les clés inconnues ou de types archivés sont ignorées.
 */
export function needsSummary(equipmentNeeds, types) {
  const active = (types ?? []).filter((t) => !t.archived_at).sort(compareTypes);
  if (equipmentNeeds === null || equipmentNeeds === undefined) {
    const def = active.find((t) => t.is_default);
    return def ? `1 ${def.label} (par défaut)` : 'Par défaut (aucun type par défaut choisi)';
  }
  const needs = normalizeNeeds(equipmentNeeds, active.map((t) => t.key));
  const parts = active.filter((t) => needs[t.key]).map((t) => `${needs[t.key]} ${t.label}`);
  return parts.length ? parts.join(' · ') : 'Aucun matériel';
}
