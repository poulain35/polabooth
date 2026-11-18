// Registre des modules privés installés, côté serveur. Le dépôt public n'en contient aucun : une instance
// peut ajouter les siens dans _shared/modules/<id>/ et déclarer ici leur catalogue (catalog.ts, données
// pures : libellé de la fonctionnalité, clés des services et leur test, conséquence de l'arrêt des tâches
// planifiées). Copie conforme côté front : src/modules/catalog.js.

import type { ModuleCatalog } from './features.ts';

export const PRIVATE_MODULES: ModuleCatalog[] = [];
