// Gardes de fonctionnalité des edge functions (open core, lot L3), en plus de requireFeature (features.ts).
// Sans import Deno/esm.sh : testé par feature-guard.test.ts sous `node --test`.

import { corsResponse } from './cors.ts';
import { FEATURE_DISABLED_ERROR, type FeatureId, type FeatureFlags, type FeaturesDb, isFeatureEnabled } from './features.ts';

const READ_ERROR = 'Lecture des fonctionnalités impossible';

/** 404 `fonctionnalite_desactivee`, quand les fonctionnalités de l'org sont déjà lues. */
export function featureDisabled(): Response {
  return corsResponse(404, { error: FEATURE_DISABLED_ERROR });
}

/**
 * Organisation de l'installation : une seule par instance (décision D1), la plus ancienne s'il y en
 * a plusieurs. `null` si aucune (valeurs par défaut du catalogue).
 */
export async function instanceOrg(db: FeaturesDb): Promise<{ id: string; features: FeatureFlags } | null> {
  const { data, error } = await db.from('organizations').select('id, features')
    .order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (error) throw new Error(`organisation de l'instance : ${error.message}`);
  return data ? { id: data.id, features: data.features } : null;
}

/** Garde des fonctions sans événement ni org (admin de l'instance, pages sans code). */
export async function requireInstanceFeature(db: FeaturesDb, id: FeatureId): Promise<Response | null> {
  let org;
  try { org = await instanceOrg(db); } catch { return corsResponse(500, { error: READ_ERROR }); }
  return isFeatureEnabled(org?.features, id) ? null : featureDisabled();
}

/**
 * Garde d'une tâche planifiée : `null` si la fonctionnalité est active, sinon 200 avec un résumé
 * (check-cron-alerts ne voit pas d'échec). `orgId` absent : organisation de l'instance.
 */
export async function cronFeatureGate(db: FeaturesDb, id: FeatureId, orgId?: string | null): Promise<Response | null> {
  let features: FeatureFlags;
  try {
    if (orgId) {
      const { data, error } = await db.from('organizations').select('features').eq('id', orgId).maybeSingle();
      if (error) throw new Error(error.message);
      features = data?.features;
    } else {
      features = (await instanceOrg(db))?.features;
    }
  } catch {
    return corsResponse(500, { error: READ_ERROR });
  }
  if (isFeatureEnabled(features, id)) return null;
  console.log(`fonctionnalité ${id} désactivée : tâche ignorée`);
  return corsResponse(200, { ok: true, skipped: FEATURE_DISABLED_ERROR, feature: id });
}
