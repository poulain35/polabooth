import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { getOrgFeatures, saveOrgFeatures } from '../lib/supabase';
import { isFeatureEnabled } from '../features/catalog';
import { featureAvailable, featureInstalled } from '../features/featureGate';
import { INSTALLED_MODULES } from '../features/modules';

// État partagé par tous les composants qui appellent useFeatures() : une seule lecture de
// organizations.features, et un enregistrement est vu partout (menu, pages, fiche).
let state = { orgId: null, features: {}, loading: true, error: '' };
let pending = null;
const listeners = new Set();

function setState(patch) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function load() {
  if (!pending) {
    pending = getOrgFeatures()
      .then(({ orgId, features }) => {
        // Sans org (pas encore connecté), on relira au prochain montage.
        if (!orgId) pending = null;
        setState({ orgId, features, loading: false, error: '' });
      })
      .catch((e) => {
        pending = null;
        setState({ loading: false, error: e.message });
      });
  }
  return pending;
}

/**
 * Fonctionnalités activées de l'entreprise (Paramètres > Fonctionnalités).
 * `isEnabled(id)` applique les valeurs par défaut, le socle et les dépendances du catalogue.
 * `isAvailable(id)` : pour masquer menu, routes et sections ; vrai tant que la lecture n'a pas abouti
 * (chargement, erreur, pas d'organisation), le serveur restant seul juge. Toujours faux pour une
 * fonctionnalité privée dont le module n'est pas installé (`isInstalled`, open core L2b).
 * `save(next)` enregistre l'objet complet (calculé par enableWithDependencies / disableWithDependents).
 */
export function useFeatures() {
  const snapshot = useSyncExternalStore(subscribe, () => state);

  useEffect(() => { load(); }, []);

  const isEnabled = useCallback((id) => isFeatureEnabled(snapshot.features, id), [snapshot.features]);

  const isInstalled = useCallback((id) => featureInstalled(id, INSTALLED_MODULES), []);
  const isAvailable = useCallback(
    (id) => featureInstalled(id, INSTALLED_MODULES) && featureAvailable(snapshot, id),
    [snapshot],
  );

  const save = useCallback(async (next) => {
    if (!state.orgId) throw new Error('Organisation introuvable');
    await saveOrgFeatures(state.orgId, next);
    setState({ features: next });
  }, []);

  return { features: snapshot.features, isEnabled, isAvailable, isInstalled, loading: snapshot.loading, error: snapshot.error, save };
}
