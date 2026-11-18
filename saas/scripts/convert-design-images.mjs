/**
 * LAB-348 : range dans le bucket `designs` les images encore intégrées (data URL) aux modèles
 * existants, puis remplace leur source par l'adresse publique (comme le fait l'éditeur désormais).
 *
 * Tables : client_designs, design_versions, templates (colonne canvas_json). Les images vont dans
 * `{event_id}/images/{sha256}.{ext}` (designs des clients) ou `templates/images/{sha256}.{ext}`
 * (bibliothèque de modèles), comme la fonction upload-design-image.
 *
 * - Essai à blanc par défaut : rien n'est envoyé ni écrit, rapport seulement (tailles après calculées
 *   avec les adresses que les images auraient).
 * - Idempotent : une ligne sans image intégrée est ignorée ; une image déjà rangée n'est pas renvoyée
 *   (même contenu = même nom).
 * - Une image impossible à ranger (SVG, adresse Replicate expirée, trop lourde…) reste intégrée.
 * - client_designs : mise à jour seulement si la ligne n'a pas changé depuis la lecture (updated_at),
 *   pour ne pas écraser une sauvegarde du client faite pendant la conversion.
 *
 * Usage (depuis saas/) :
 *   node scripts/convert-design-images.mjs            # essai à blanc
 *   node scripts/convert-design-images.mjs --apply    # conversion
 *   node scripts/convert-design-images.mjs --help
 */

import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataUrlToBytes, isDataImage } from '../src/lib/designImages.js';
import {
  DESIGN_IMAGES_BUCKET, MAX_IMAGE_BYTES, designImagePath, detectImageType, sha256Hex, storeDesignImage,
} from '../supabase/functions/_shared/design-images.ts';
import {
  TABLE_COLUMNS, USAGE, addRow, convertCanvasJson, emptyStats, parseArgs, reportLines, scopeForRow,
} from './convert-design-images-lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envPath = resolve(__dirname, '../.env');
  const fileEnv = existsSync(envPath)
    ? Object.fromEntries(readFileSync(envPath, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
      .map((l) => { const [k, ...rest] = l.split('='); return [k.trim(), rest.join('=').trim().replace(/^["']|["']$/g, '')]; }))
    : {};
  const get = (k) => process.env[k] || fileEnv[k];
  return { url: get('SUPABASE_URL') || get('VITE_SUPABASE_URL'), key: get('SUPABASE_SERVICE_ROLE_KEY') };
}

/** Octets d'une source : data URL décodée, ou adresse temporaire téléchargée (souvent expirée). */
async function sourceBytes(src) {
  if (isDataImage(src)) return dataUrlToBytes(src).bytes;
  const res = await fetch(src, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`téléchargement impossible (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.error) {
    console.error(opts.error);
    console.error(USAGE);
    process.exit(1);
  }
  if (opts.help) {
    console.log(USAGE);
    return;
  }
  const { url, key } = loadEnv();
  if (!url || !key) {
    console.error('SUPABASE_URL (ou VITE_SUPABASE_URL) et SUPABASE_SERVICE_ROLE_KEY sont nécessaires.');
    process.exit(1);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });
  console.log(`${opts.apply ? 'Conversion' : 'Essai à blanc'} sur ${new URL(url).host}`);

  const failures = [];
  const statsByTable = {};
  for (const table of opts.tables) {
    const stats = (statsByTable[table] = emptyStats());
    let lastId = null;
    for (;;) {
      // Pagination par id (pas d'offset : les lignes mises à jour ne décalent pas les pages).
      let query = db.from(table).select(TABLE_COLUMNS[table]).order('id').limit(opts.page);
      if (lastId) query = query.gt('id', lastId);
      const { data: rows, error } = await query;
      if (error) throw new Error(`${table} : lecture impossible (${error.message})`);
      if (!rows.length) break;
      lastId = rows.at(-1).id;

      for (const row of rows) {
        let scope;
        try {
          scope = scopeForRow(table, row);
        } catch (err) {
          failures.push(err.message);
          addRow(stats, await convertCanvasJson(row.canvas_json, async () => null));
          continue;
        }
        const storeSource = async (src) => {
          try {
            const bytes = await sourceBytes(src);
            if (opts.apply) return (await storeDesignImage(db, scope, bytes)).url;
            // Essai à blanc : mêmes vérifications que la fonction, adresse calculée sans envoi.
            const type = detectImageType(bytes);
            if (!type) throw new Error('format non pris en charge (PNG, JPEG ou WebP)');
            if (bytes.length > MAX_IMAGE_BYTES) throw new Error('image trop lourde');
            const path = designImagePath(scope, await sha256Hex(bytes), type.ext);
            return db.storage.from(DESIGN_IMAGES_BUCKET).getPublicUrl(path).data.publicUrl;
          } catch (err) {
            failures.push(`${table} ${row.id} : ${err.message} (${src.slice(0, 40)}…)`);
            return null;
          }
        };
        const result = await convertCanvasJson(row.canvas_json, storeSource);
        let written = true;
        if (result.changed && opts.apply) {
          let update = db.from(table).update({ canvas_json: result.value }).eq('id', row.id);
          if (table === 'client_designs') update = update.eq('updated_at', row.updated_at);
          const { data: updated, error: updateError } = await update.select('id');
          if (updateError) {
            failures.push(`${table} ${row.id} : mise à jour impossible (${updateError.message})`);
            written = false;
          } else if (!updated?.length) {
            written = false; // modifiée entre-temps : comptée en conflit, à relancer
          }
        }
        addRow(stats, result, written);
        if (result.changed) {
          console.log(`  ${table} ${row.id} : ${result.stored} image(s)${opts.apply ? (written ? ' rangée(s)' : ' — non écrite') : ''}`);
        }
      }
    }
  }

  console.log('');
  for (const line of reportLines(statsByTable, { apply: opts.apply })) console.log(line);
  if (failures.length) {
    console.log(`\n${failures.length} problème(s) :`);
    for (const f of failures) console.log(`  - ${f}`);
  }
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
