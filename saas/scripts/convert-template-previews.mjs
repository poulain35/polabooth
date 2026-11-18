/**
 * LAB-356 : range dans le bucket `designs` les aperçus des modèles de la bibliothèque encore
 * intégrés à la base (templates.preview_url en data URL) ou restés sur une adresse temporaire
 * (Replicate), puis remplace preview_url par l'adresse publique, comme le fait l'admin désormais.
 *
 * Les aperçus vont dans `templates/previews/{sha256}.{ext}`, comme la fonction upload-design-image
 * appelée avec ?kind=preview.
 *
 * - Essai à blanc par défaut : rien n'est envoyé ni écrit, rapport seulement.
 * - Idempotent : un modèle dont l'aperçu est déjà une adresse stable est ignoré ; une seconde passe
 *   ne trouve rien.
 * - Un aperçu impossible à ranger (format, adresse expirée…) reste tel quel.
 * - Mise à jour seulement si le modèle n'a pas changé depuis la lecture (updated_at : un aperçu
 *   intégré est trop long pour servir de filtre dans l'adresse de la requête).
 *
 * Usage (depuis saas/) :
 *   node scripts/convert-template-previews.mjs            # essai à blanc
 *   node scripts/convert-template-previews.mjs --apply    # conversion
 *   node scripts/convert-template-previews.mjs --help
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
  USAGE, addResult, emptyStats, parseArgs, previewNeedsStorage, reportLines,
} from './convert-template-previews-lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCOPE = Object.freeze({ kind: 'templatePreviews' });

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

/** Octets d'un aperçu : data URL décodée, ou adresse temporaire téléchargée (souvent expirée). */
async function sourceBytes(src) {
  if (isDataImage(src)) return dataUrlToBytes(src).bytes;
  const res = await fetch(src, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`téléchargement impossible (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Adresse publique de l'aperçu : rangé (--apply) ou calculée sans envoi (essai à blanc). */
async function previewAddress(db, src, apply) {
  const bytes = await sourceBytes(src);
  if (apply) return (await storeDesignImage(db, SCOPE, bytes)).url;
  // Essai à blanc : mêmes vérifications que la fonction, adresse calculée sans envoi.
  const type = detectImageType(bytes);
  if (!type) throw new Error('format non pris en charge (PNG, JPEG ou WebP)');
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('image trop lourde');
  const path = designImagePath(SCOPE, await sha256Hex(bytes), type.ext);
  return db.storage.from(DESIGN_IMAGES_BUCKET).getPublicUrl(path).data.publicUrl;
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
  const stats = emptyStats();
  let lastId = null;
  for (;;) {
    // Pagination par id (pas d'offset : les lignes mises à jour ne décalent pas les pages).
    let query = db.from('templates').select('id, name, preview_url, updated_at').order('id').limit(opts.page);
    if (lastId) query = query.gt('id', lastId);
    const { data: rows, error } = await query;
    if (error) throw new Error(`templates : lecture impossible (${error.message})`);
    if (!rows.length) break;
    lastId = rows.at(-1).id;

    for (const row of rows) {
      if (!previewNeedsStorage(row.preview_url)) {
        addResult(stats, 'skipped');
        continue;
      }
      const label = `${row.name ?? 'sans nom'} (${row.id})`;
      let publicUrl;
      try {
        publicUrl = await previewAddress(db, row.preview_url, opts.apply);
      } catch (err) {
        failures.push(`${label} : ${err.message}`);
        addResult(stats, 'failed');
        continue;
      }
      if (!opts.apply) {
        console.log(`  ${label} → ${publicUrl}`);
        addResult(stats, 'converted');
        continue;
      }
      // Écrit seulement si le modèle n'a pas changé depuis la lecture (sauvegarde de l'admin entre-temps).
      let update = db.from('templates').update({ preview_url: publicUrl }).eq('id', row.id);
      update = row.updated_at ? update.eq('updated_at', row.updated_at) : update.is('updated_at', null);
      const { data: updated, error: updateError } = await update.select('id');
      if (updateError) {
        failures.push(`${label} : mise à jour impossible (${updateError.message})`);
        addResult(stats, 'failed');
      } else if (!updated?.length) {
        addResult(stats, 'conflict');
      } else {
        console.log(`  ${label} → ${publicUrl}`);
        addResult(stats, 'converted');
      }
    }
  }

  console.log('');
  for (const line of reportLines(stats, { apply: opts.apply })) console.log(line);
  if (failures.length) {
    console.log(`\n${failures.length} problème(s) :`);
    for (const f of failures) console.log(`  - ${f}`);
  }
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
