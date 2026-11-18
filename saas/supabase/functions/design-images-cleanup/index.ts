/**
 * design-images-cleanup — appelée par pg_cron une fois par jour (service_role), LAB-356.
 *
 * Supprime du bucket `designs` les images des modèles qui ne servent plus : celles rangées par
 * upload-design-image et remove-background (`{event_id}/images/…`, `templates/images/…`) et les
 * aperçus des modèles de la bibliothèque (`templates/previews/…`). Rien d'autre (PNG finals,
 * reste du bucket) n'est jamais touché.
 *
 * Une image est supprimée seulement si :
 * - elle a plus de 7 jours dans le stockage (création et dernière réécriture) ;
 * - son empreinte (nom = SHA-256) n'apparaît dans aucune ligne de client_designs (toutes sortes,
 *   tous cadres), design_versions (historique), templates, kiosk_screens, events, organizations ni
 *   decorations, lignes entières lues comme du texte (RPC design_image_references).
 *
 * En cas de doute, on garde : une erreur de lecture (stockage ou base), une réponse inattendue ou
 * un parcours trop long → rien n'est supprimé et la réponse est 500 (tracée dans cron_http_calls →
 * alerte check-cron-alerts). Au plus 300 images examinées par passage (tirées au hasard), suppression
 * par lots de 100. Règles dans logic.ts (testées sous node --test). verify_jwt = true + rôle
 * service_role exigé.
 */

import { adminClient } from '../_shared/auth.ts';
import { cronOnly } from '../_shared/admin-guard.ts';
import { corsResponse } from '../_shared/cors.ts';
import { DESIGN_IMAGES_BUCKET } from '../_shared/design-images.ts';
import { type CandidateRow, type CleanupStore, runCleanup } from './logic.ts';

Deno.serve(async (req) => {
  const denied = cronOnly(req, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
  if (denied) return denied;

  const db = adminClient();
  const store: CleanupStore = {
    async candidates(cutoff, limit, names) {
      const { data, error } = await db.rpc('design_image_cleanup_candidates', {
        p_cutoff: cutoff,
        p_limit: limit,
        p_names: names ?? null,
      });
      if (error) throw new Error(`lecture du stockage impossible (${error.message})`);
      if (!Array.isArray(data)) throw new Error('lecture du stockage : réponse inattendue');
      return data as CandidateRow[];
    },
    async references(source, afterId, limit, maxBytes) {
      const { data, error } = await db.rpc('design_image_references', {
        p_source: source,
        p_after: afterId,
        p_limit: limit,
        p_max_bytes: maxBytes,
      });
      if (error) throw new Error(`${source} : lecture impossible (${error.message})`);
      return data;
    },
    async remove(paths) {
      const { error } = await db.storage.from(DESIGN_IMAGES_BUCKET).remove(paths);
      if (error) throw new Error(error.message);
    },
  };

  let summary;
  try {
    summary = await runCleanup(store, new Date());
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const failed = { deleted: 0, errors: [`rien n’a été supprimé : ${message}`] };
    console.error('design-images-cleanup', JSON.stringify(failed));
    return corsResponse(500, failed);
  }
  const body = { ...summary, errors: summary.errors.slice(0, 20) };
  console.log('design-images-cleanup', JSON.stringify(body));
  return corsResponse(summary.errors.length ? 500 : 200, body);
});
