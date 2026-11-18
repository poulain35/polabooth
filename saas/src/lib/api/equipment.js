// Stock de matériel.
import { normalizeNeeds } from '../equipment.js';
import { supabase } from './client.js';

// ── Stock de matériel (LAB-358, spec docs/specs/stock-materiel.md) ────────────
// Types (equipment_types) et matériels (equipment_items) du propriétaire connecté (RLS : son
// organisation ; org_id par défaut côté base). Règles et libellés : lib/equipment.js.

const EQUIPMENT_TYPE_COLUMNS = 'id, key, label, is_default, sort_order, archived_at, created_at';
const EQUIPMENT_ITEM_COLUMNS = 'id, type_id, name, status, unavailable_from, unavailable_until, unavailable_reason, notes, sort_order, retired_at, created_at';

/** Types et matériels de l'organisation : `{ types, items }`, dans l'ordre d'affichage. */
export async function fetchEquipment() {
  const [types, items] = await Promise.all([
    supabase.from('equipment_types').select(EQUIPMENT_TYPE_COLUMNS).order('sort_order').order('created_at'),
    supabase.from('equipment_items').select(EQUIPMENT_ITEM_COLUMNS).order('sort_order').order('created_at'),
  ]);
  if (types.error) throw types.error;
  if (items.error) throw items.error;
  return { types: types.data ?? [], items: items.data ?? [] };
}

/**
 * Crée (sans `id` : `key`, `label`, `is_default`, `sort_order`) ou modifie (`label`, `is_default`,
 * `sort_order`) un type. La clé n'est jamais réécrite (D2). Passer un type par défaut retire
 * d'abord le défaut des autres (un seul par organisation, index unique en base).
 */
export async function saveEquipmentType(type) {
  if (type.is_default) {
    let reset = supabase.from('equipment_types').update({ is_default: false }).eq('is_default', true);
    if (type.id) reset = reset.neq('id', type.id);
    const { error } = await reset;
    if (error) throw error;
  }
  const fields = {};
  for (const k of ['label', 'is_default', 'sort_order']) if (type[k] !== undefined) fields[k] = type[k];
  if (typeof fields.label === 'string') fields.label = fields.label.trim();
  const query = type.id
    ? supabase.from('equipment_types').update(fields).eq('id', type.id)
    : supabase.from('equipment_types').insert({ ...fields, key: type.key });
  const { data, error } = await query.select(EQUIPMENT_TYPE_COLUMNS).single();
  if (error) throw error;
  return data;
}

/** Archive (ou, avec `archived = false`, restaure) un type. Le type par défaut n'est pas archivé. */
export async function archiveEquipmentType(id, archived = true) {
  const { data, error } = await supabase
    .from('equipment_types')
    .update(archived ? { archived_at: new Date().toISOString(), is_default: false } : { archived_at: null })
    .eq('id', id)
    .select(EQUIPMENT_TYPE_COLUMNS)
    .single();
  if (error) throw error;
  return data;
}

/** Supprime un type sans matériel (la base refuse s'il en a encore : ON DELETE RESTRICT). */
export async function deleteEquipmentType(id) {
  const { error } = await supabase.from('equipment_types').delete().eq('id', id);
  if (error) throw error;
}

/** Crée (sans `id`, avec `type_id`) ou modifie un matériel ; renvoie la ligne écrite. */
export async function saveEquipmentItem(item) {
  const fields = {};
  for (const k of ['type_id', 'name', 'status', 'unavailable_from', 'unavailable_until', 'unavailable_reason', 'notes', 'sort_order']) {
    if (item[k] !== undefined) fields[k] = item[k];
  }
  const query = item.id
    ? supabase.from('equipment_items').update(fields).eq('id', item.id)
    : supabase.from('equipment_items').insert(fields);
  const { data, error } = await query.select(EQUIPMENT_ITEM_COLUMNS).single();
  if (error) throw error;
  return data;
}

export async function deleteEquipmentItem(id) {
  const { error } = await supabase.from('equipment_items').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Besoin de matériel d'un événement (events.equipment_needs) : objet { clé: quantité } nettoyé,
 * ou null (= 1 du type par défaut). Renvoie la valeur enregistrée.
 */
export async function updateEventEquipmentNeeds(eventId, needs) {
  const value = needs === null ? null : normalizeNeeds(needs);
  const { data, error } = await supabase
    .from('events')
    .update({ equipment_needs: value })
    .eq('id', eventId)
    .select('equipment_needs')
    .single();
  if (error) throw error;
  return data.equipment_needs ?? null;
}
