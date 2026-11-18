// Stock de matériel par type (LAB-358, spec docs/specs/stock-materiel.md, lot S1).
// Règles pures, sans import Deno/esm.sh : testables sous `node --test`. Le miroir côté admin est
// saas/src/lib/equipment.js (un test vérifie l'accord).
//
// - Type de matériel : equipment_types (key stable, un type par défaut, archived_at).
// - Matériel : equipment_items, en service ou retiré, avec une période d'indisponibilité facultative
//   (unavailable_from compris ; unavailable_until compris, null = sans limite).
// - Besoin : { "<clé de type>": quantité } (events.equipment_needs ; null = 1 du type par défaut).
// Les dates sont des jours 'AAAA-MM-JJ' (comparaison de chaînes).

export const TYPE_KEY_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const TYPE_KEY_MAX_LENGTH = 40;
/** Quantité maximale d'un type dans un besoin (catalogue, événement). */
export const MAX_NEED_QUANTITY = 50;

export type EquipmentType = {
  id: string;
  key: string;
  label: string;
  is_default?: boolean | null;
  sort_order?: number | null;
  archived_at?: string | null;
  created_at?: string | null;
};

export type EquipmentItem = {
  id?: string;
  type_id?: string;
  /** Clé du type, si l'appelant l'a déjà jointe (sinon résolue par `types`). */
  type_key?: string;
  status?: string | null;
  unavailable_from?: string | null;
  unavailable_until?: string | null;
};

export type Needs = Record<string, number>;

/** Jour 'AAAA-MM-JJ' d'une date ou d'un horodatage ISO ; null si illisible. */
function toDay(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const day = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/**
 * Clé de type calculée depuis le libellé (D2) : minuscules sans accents, mots séparés par « - »,
 * 40 caractères au plus. « Livre d'or audio » → « livre-d-or-audio ». Chaîne vide si rien d'utilisable.
 */
export function slugifyTypeKey(label: unknown): string {
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

/** Clé de type valide (même règle que la contrainte en base). */
export function isValidTypeKey(key: unknown): key is string {
  return typeof key === 'string' && key.length <= TYPE_KEY_MAX_LENGTH && TYPE_KEY_PATTERN.test(key);
}

/** Quantité valide d'un besoin : entier de 0 à 50 ; null sinon. */
function parseNeedQuantity(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > MAX_NEED_QUANTITY) return null;
  return n;
}

/**
 * Besoin propre : objet { clé valide: entier 1..50 }. Les quantités nulles, invalides ou hors bornes
 * et les clés mal formées sont retirées ; avec `allowedKeys`, les clés hors de la liste aussi (types
 * inconnus ou archivés). Une valeur qui n'est pas un objet donne {}.
 */
export function normalizeNeeds(value: unknown, allowedKeys?: Iterable<string> | null): Needs {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const allowed = allowedKeys ? new Set(allowedKeys) : null;
  const out: Needs = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!isValidTypeKey(key)) continue;
    if (allowed && !allowed.has(key)) continue;
    const qty = parseNeedQuantity(raw);
    if (qty) out[key] = qty;
  }
  return out;
}

/** Somme de deux besoins, le second multiplié par `factor` (quantité d'une ligne, par exemple). */
export function addNeeds(a: unknown, b: unknown, factor = 1): Needs {
  const out: Needs = {};
  const add = (needs: unknown, k: number) => {
    if (!needs || typeof needs !== 'object' || Array.isArray(needs)) return;
    for (const [key, raw] of Object.entries(needs as Record<string, unknown>)) {
      if (!isValidTypeKey(key) || typeof raw !== 'number' || !Number.isFinite(raw)) continue;
      const qty = raw * k;
      if (qty > 0) out[key] = (out[key] ?? 0) + qty;
    }
  };
  add(a, 1);
  add(b, Number.isFinite(factor) && factor > 0 ? factor : 0);
  return out;
}

/**
 * Besoin d'un événement (D8) : equipment_needs propre, ou { type par défaut: 1 } s'il vaut null
 * (événement saisi à la main ou créé avant le stock). Sans type par défaut : {}.
 */
export function eventNeeds(event: { equipment_needs?: unknown } | null | undefined, defaultKey: string | null | undefined): Needs {
  const raw = event?.equipment_needs;
  if (raw === null || raw === undefined) {
    return defaultKey && isValidTypeKey(defaultKey) ? { [defaultKey]: 1 } : {};
  }
  return normalizeNeeds(raw);
}

/** Clé du type par défaut non archivé, ou null. */
export function defaultTypeKey(types: readonly EquipmentType[] | null | undefined): string | null {
  return (types ?? []).find((t) => t.is_default && !t.archived_at)?.key ?? null;
}

/** Le matériel est-il dans sa période d'indisponibilité ce jour-là ? (début ≤ jour ≤ fin, fin facultative) */
function isUnavailableOn(item: EquipmentItem, date: string): boolean {
  const day = toDay(date);
  const from = toDay(item.unavailable_from);
  if (!day || !from || day < from) return false;
  const until = toDay(item.unavailable_until);
  return !until || day <= until;
}

/** Compté dans le stock ce jour-là : en service et hors de sa période d'indisponibilité (D5). */
function isAvailableOn(item: EquipmentItem, date: string): boolean {
  return item.status !== 'retired' && !isUnavailableOn(item, date);
}

function itemKey(item: EquipmentItem, keysById: Map<string, string> | null): string | null {
  if (item.type_key) return item.type_key;
  return item.type_id && keysById ? keysById.get(item.type_id) ?? null : null;
}

/**
 * Stock d'un type à une date (D5) : matériels en service du type, moins ceux dont la période
 * d'indisponibilité couvre la date. La clé de chaque matériel vient de `type_key`, ou de `types`
 * (par `type_id`).
 */
export function stockOn(
  items: readonly EquipmentItem[] | null | undefined,
  typeKey: string,
  date: string,
  types?: readonly EquipmentType[] | null,
): number {
  const keysById = types ? new Map(types.map((t) => [t.id, t.key])) : null;
  let n = 0;
  for (const item of items ?? []) {
    if (itemKey(item, keysById) === typeKey && isAvailableOn(item, date)) n += 1;
  }
  return n;
}

function byOrder(a: EquipmentType, b: EquipmentType): number {
  return (a.sort_order ?? 0) - (b.sort_order ?? 0)
    || String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
    || a.label.localeCompare(b.label, 'fr');
}

/**
 * Types suivis (D6) : non archivés, avec au moins un matériel non retiré, triés par sort_order.
 * Un type non suivi n'est jamais vérifié (ni « complet », ni blocage).
 */
export function trackedTypes(
  types: readonly EquipmentType[] | null | undefined,
  items: readonly EquipmentItem[] | null | undefined,
): EquipmentType[] {
  const list = types ?? [];
  const keysById = new Map(list.map((t) => [t.id, t.key]));
  const used = new Set<string>();
  for (const item of items ?? []) {
    if (item.status === 'retired') continue;
    const key = itemKey(item, keysById);
    if (key) used.add(key);
  }
  return list.filter((t) => !t.archived_at && used.has(t.key)).sort(byOrder);
}
