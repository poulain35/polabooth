// Parties pures de convert-design-images.mjs (LAB-348), testées par convert-design-images-lib.test.mjs.
import { imageSourcesToStore, replaceImageSources } from '../src/lib/designImages.js';

/** Tables converties : colonne `canvas_json`, et `event_id` pour le dossier des images. */
export const TABLES = Object.freeze(['client_designs', 'design_versions', 'templates']);

/** Colonnes lues par table (`updated_at` : garde contre une sauvegarde du client pendant la conversion). */
export const TABLE_COLUMNS = Object.freeze({
  client_designs: 'id, event_id, updated_at, canvas_json',
  design_versions: 'id, event_id, canvas_json',
  templates: 'id, canvas_json',
});

export const USAGE = `Usage : node scripts/convert-design-images.mjs [--apply] [--table <nom>] [--page <n>]

Range dans le bucket « designs » les images intégrées (data URL) des modèles :
client_designs, design_versions et templates (colonne canvas_json).

  (sans option)    essai à blanc : rien n'est envoyé ni écrit, rapport seulement
  --apply          envoie les images et met à jour les lignes
  --table <nom>    une seule table (${TABLES.join(', ')})
  --page <n>       lignes lues par requête (défaut 5 : un modèle peut peser plusieurs dizaines de Mo)

Variables : SUPABASE_URL (ou VITE_SUPABASE_URL) et SUPABASE_SERVICE_ROLE_KEY, lues dans
l'environnement puis dans saas/.env.`;

/** Arguments de la ligne de commande → options, ou { error }. */
export function parseArgs(argv) {
  const opts = { apply: false, tables: [...TABLES], page: 5, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') opts.apply = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--table') {
      const name = argv[++i];
      if (!TABLES.includes(name)) return { error: `Table inconnue : ${name ?? '(vide)'}` };
      opts.tables = [name];
    } else if (arg === '--page') {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1 || n > 100) return { error: '--page : nombre entier de 1 à 100' };
      opts.page = n;
    } else return { error: `Option inconnue : ${arg}` };
  }
  return opts;
}

/** Dossier des images d'une ligne : celui de l'événement, ou le dossier commun des modèles. */
export function scopeForRow(table, row) {
  if (table === 'templates') return { kind: 'templates' };
  if (!row?.event_id) throw new Error(`${table} ${row?.id} : event_id manquant`);
  return { kind: 'event', eventId: row.event_id };
}

/** Poids en octets d'un canvas_json (objet ou chaîne), tel qu'il est stocké en JSON. */
export function jsonBytes(value) {
  if (value == null) return 0;
  return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
}

/**
 * Convertit un canvas_json (objet ou chaîne, rendu sous la même forme) : chaque image à ranger
 * passe par `storeSource(src)` (→ adresse, ou null si impossible : l'image reste intégrée).
 * Renvoie { changed, value, before, after, stored, failed }. Sans image à ranger : inchangé
 * (le script est donc idempotent : une ligne déjà convertie est ignorée).
 */
export async function convertCanvasJson(canvasJson, storeSource) {
  const before = jsonBytes(canvasJson);
  const empty = { changed: false, value: canvasJson, before, after: before, stored: 0, failed: 0 };
  if (canvasJson == null) return empty;
  const asString = typeof canvasJson === 'string';
  let state;
  try {
    state = asString ? JSON.parse(canvasJson) : canvasJson;
  } catch {
    return empty;
  }
  const sources = imageSourcesToStore(state);
  if (!sources.length) return empty;
  const map = new Map();
  for (const src of sources) {
    const url = await storeSource(src);
    if (url) map.set(src, url);
  }
  if (!map.size) return { ...empty, failed: sources.length };
  const next = replaceImageSources(state, map);
  const value = asString ? JSON.stringify(next) : next;
  return { changed: true, value, before, after: jsonBytes(value), stored: map.size, failed: sources.length - map.size };
}

/** Taille lisible (o, Ko, Mo, Go). */
export function formatBytes(bytes) {
  const units = ['o', 'Ko', 'Mo', 'Go'];
  let v = Number(bytes) || 0;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? v : v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} ${units[i]}`;
}

/** Compteurs vides d'une table. */
export function emptyStats() {
  return { rows: 0, withImages: 0, converted: 0, conflicts: 0, images: 0, failedImages: 0, before: 0, after: 0 };
}

/** Ajoute le résultat d'une ligne aux compteurs (`written` : false si la ligne a changé entre-temps). */
export function addRow(stats, result, written = true) {
  stats.rows++;
  stats.before += result.before;
  if (result.changed || result.failed) stats.withImages++;
  stats.images += result.stored;
  stats.failedImages += result.failed;
  if (result.changed && written) {
    stats.converted++;
    stats.after += result.after;
  } else {
    if (result.changed && !written) stats.conflicts++;
    stats.after += result.before;
  }
  return stats;
}

/** Rapport lisible : une ligne par table, puis le total. */
export function reportLines(statsByTable, { apply }) {
  const lines = [apply ? 'Conversion appliquée :' : 'Essai à blanc (rien n’a été envoyé ni écrit, relancer avec --apply) :'];
  const total = emptyStats();
  for (const [table, s] of Object.entries(statsByTable)) {
    for (const k of Object.keys(total)) total[k] += s[k];
    lines.push(describe(table, s, apply));
  }
  if (Object.keys(statsByTable).length > 1) lines.push(describe('Total', total, apply));
  return lines;
}

function describe(label, s, apply) {
  const verb = apply ? 'converties' : 'à convertir';
  let line = `- ${label} : ${s.rows} ligne(s) lue(s), ${s.withImages} avec des images intégrées, `
    + `${s.converted} ${verb} (${s.images} image(s)) ; ${formatBytes(s.before)} → ${formatBytes(s.after)}`;
  if (s.failedImages) line += ` ; ${s.failedImages} image(s) non rangée(s) (laissées intégrées)`;
  if (s.conflicts) line += ` ; ${s.conflicts} ligne(s) modifiée(s) pendant la conversion (relancer le script)`;
  return line;
}
