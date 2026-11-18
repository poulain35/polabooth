// Parties pures de convert-template-previews.mjs (LAB-356), testées par convert-template-previews-lib.test.mjs.
import { needsStorage } from '../src/lib/designImages.js';

export const USAGE = `Usage : node scripts/convert-template-previews.mjs [--apply] [--page <n>]

Range dans le bucket « designs » (dossier templates/previews/) les aperçus des modèles de la
bibliothèque encore intégrés à la base (data URL) ou restés sur une adresse temporaire (Replicate),
puis remplace templates.preview_url par l'adresse https.

  (sans option)    essai à blanc : rien n'est envoyé ni écrit, rapport seulement
  --apply          envoie les aperçus et met à jour les modèles
  --page <n>       modèles lus par requête (défaut 20)

Variables : SUPABASE_URL (ou VITE_SUPABASE_URL) et SUPABASE_SERVICE_ROLE_KEY, lues dans
l'environnement puis dans saas/.env.`;

/** Arguments de la ligne de commande → options, ou { error }. */
export function parseArgs(argv) {
  const opts = { apply: false, page: 20, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') opts.apply = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--page') {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1 || n > 200) return { error: '--page : nombre entier de 1 à 200' };
      opts.page = n;
    } else return { error: `Option inconnue : ${arg}` };
  }
  return opts;
}

/** Aperçu à ranger : intégré (data URL) ou adresse temporaire. Une adresse https stable est gardée. */
export function previewNeedsStorage(previewUrl) {
  return needsStorage(previewUrl);
}

/** Compteurs vides. */
export function emptyStats() {
  return { rows: 0, toConvert: 0, converted: 0, conflicts: 0, failed: 0 };
}

/**
 * Ajoute le résultat d'un modèle : 'skipped' (rien à faire), 'converted' (rangé, ou rangeable à
 * blanc), 'conflict' (modifié entre-temps, non écrit), 'failed' (aperçu impossible à ranger).
 */
export function addResult(stats, outcome) {
  if (!['skipped', 'converted', 'conflict', 'failed'].includes(outcome)) throw new Error(`Résultat inconnu : ${outcome}`);
  stats.rows++;
  if (outcome === 'skipped') return stats;
  stats.toConvert++;
  if (outcome === 'converted') stats.converted++;
  else if (outcome === 'conflict') stats.conflicts++;
  else stats.failed++;
  return stats;
}

/** Rapport lisible. */
export function reportLines(stats, { apply }) {
  const lines = [apply ? 'Conversion appliquée :' : 'Essai à blanc (rien n’a été envoyé ni écrit, relancer avec --apply) :'];
  let line = `- templates : ${stats.rows} modèle(s) lu(s), ${stats.toConvert} aperçu(s) à ranger, `
    + `${stats.converted} ${apply ? 'rangé(s)' : 'rangeable(s)'}`;
  if (stats.failed) line += ` ; ${stats.failed} impossible(s) à ranger (laissé(s) tel(s) quel(s))`;
  if (stats.conflicts) line += ` ; ${stats.conflicts} modifié(s) pendant la conversion (relancer le script)`;
  lines.push(line);
  if (!stats.toConvert) lines.push('Rien à faire : tous les aperçus sont déjà rangés.');
  return lines;
}
