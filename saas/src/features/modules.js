/**
 * Modules privés installés (open core L2b). Seul fichier du code ouvert qui lit src/modules/ :
 * la règle ESLint no-restricted-imports interdit tout autre import de src/modules/<id>/.
 * La construction sans modules privés (VITE_PRIVATE_MODULES=none) remplace le registre par
 * une liste vide (plugin de vite.config.js) : rien du code privé n'entre alors dans le build.
 *
 * Forme d'un module (src/modules/<id>/index.jsx, id = id de la fonctionnalité du catalogue) :
 *   routes : { public, client, admin, adminMaybe, adminStandalone } → [{ path, Component }]
 *   slots  : { '<emplacement>': [{ Component, ...extra }] } → rendus par <ModuleSlot name="…" />
 *   hooks  : { '<nom>': async (...args) => … } → moduleHook('<nom>') (le premier module qui le fournit)
 *            ou moduleHooks('<nom>') (tous, pour les crochets que plusieurs modules remplissent)
 * Les composants sont chargés à la demande (React.lazy) : aucun import statique du code ouvert.
 */
import registry from '../modules/index.js';

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

/** Toutes les fonctions `name` des modules installés, dans l'ordre du registre, avec leur fonctionnalité. */
export function moduleHooks(name) {
  return registry
    .filter((module) => module.hooks?.[name])
    .map((module) => ({ feature: module.id, run: module.hooks[name] }));
}

/**
 * Lance sans l'attendre le crochet `name` d'un module si sa fonctionnalité est disponible (ex.
 * 'event.calendarSync' après l'enregistrement d'un événement). Sans effet sans module ; ne lève jamais.
 */
export function fireModuleHook(name, isAvailable, ...args) {
  const hook = moduleHook(name);
  if (!hook || !isAvailable(hook.feature)) return;
  Promise.resolve().then(() => hook.run(...args)).catch(() => {});
}
