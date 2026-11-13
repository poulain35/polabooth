/**
 * Modules privés installés (open core L2b). Seul fichier du code ouvert qui lit src/modules/ :
 * la règle ESLint no-restricted-imports interdit tout autre import de src/modules/<id>/.
 * La construction sans modules privés (VITE_PRIVATE_MODULES=none) remplace le registre par
 * une liste vide (plugin de vite.config.js) : rien du code privé n'entre alors dans le build.
 *
 * Forme d'un module (src/modules/<id>/index.jsx, id = id de la fonctionnalité du catalogue) :
 *   routes : { public, client, admin, adminMaybe, adminStandalone } → [{ path, Component }]
 *   slots  : { '<emplacement>': [{ Component, ...extra }] } → rendus par <ModuleSlot name="…" />
 *   hooks  : { '<nom>': async (...args) => … } → moduleHook('<nom>')
 * Les composants sont chargés à la demande (React.lazy) : aucun import statique du code ouvert.
 */
import registry from '../modules/index.js';

export const MODULES = registry;
export const INSTALLED_MODULES = new Set(registry.map((module) => module.id));

/** Routes déclarées par les modules pour un emplacement de App.jsx, avec leur fonctionnalité. */
export function moduleRoutes(place) {
  return registry.flatMap((module) =>
    (module.routes?.[place] ?? []).map((route) => ({ ...route, feature: module.id })));
}

/** Contributions des modules à un emplacement d'écran (ex. 'event.billing'), avec leur fonctionnalité. */
export function moduleSlot(name) {
  return registry.flatMap((module) =>
    (module.slots?.[name] ?? []).map((item) => ({ ...item, feature: module.id })));
}

/** Fonction fournie par un module installé (ex. 'eventClientType') et sa fonctionnalité, ou null. */
export function moduleHook(name) {
  for (const module of registry) {
    if (module.hooks?.[name]) return { feature: module.id, run: module.hooks[name] };
  }
  return null;
}
