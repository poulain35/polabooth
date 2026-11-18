// Écran composé tel que la borne l'affiche, pour l'aperçu (spec docs/specs/apercu-borne.md, lot P4).
// Module pur : il assemble les règles déjà copiées de la borne (kioskScreenState.js) sur un plan
// `layout` (normalizeScreenLayout) :
//   - boutons : ShareScreenState.Actions ou HomeViewModel.HomeActionStates, puis DesignedScreen
//     (masqué = absent, grisé = voile) ;
//   - textes vivants : valeurs, visibilité (vide, personalized_only en neutre) et DisplayText ;
//   - fond : BackgroundFor(personalized) ; bandeau d'impression : ShareScreenState.PrintBanner.
// Les cases « Fonction coupée » (D11) ne touchent pas la config : elles changent les entrées de
// l'aperçu comme le ferait un bouton coupé dans form_config.kiosk.
import {
  ACTION_STATE, actionStateOf, displayText, homeActionStates, isTextVisible, printBanner,
  shareActionStates, shareInputsForState, shareTexts,
} from './kioskScreenState.js';
import { normalizeScreenLayout } from './kioskScreenLayout.js';
import { publishedPlan } from './kioskScreensPublish.js';

/**
 * Fonctions qu'un événement peut couper, par écran : `option` = entrée de shareInputsForState,
 * `actions` = boutons masqués. Libellés de la fiche de l'événement (réglages de la borne).
 */
export const CUT_FEATURES = Object.freeze({
  home: Object.freeze([
    Object.freeze({ id: 'gallery', label: 'Photos', actions: Object.freeze(['gallery']) }),
  ]),
  result: Object.freeze([
    Object.freeze({ id: 'print', label: 'Imprimer', option: 'printEnabled', actions: Object.freeze(['print', 'copies_minus', 'copies_plus']) }),
    Object.freeze({ id: 'email', label: 'Email', option: 'emailEnabled', actions: Object.freeze(['email']) }),
    Object.freeze({ id: 'qr', label: 'QR code', option: 'qrEnabled', actions: Object.freeze(['qr']) }),
    Object.freeze({ id: 'retake', label: 'Reprendre', option: 'retakeEnabled', actions: Object.freeze(['retake']) }),
    Object.freeze({ id: 'finish', label: 'Accueil (Terminer)', option: 'finishEnabled', actions: Object.freeze(['finish']) }),
  ]),
});

/** Cases « Fonction coupée » au départ : les fonctions coupées par l'événement (`share` du contexte). */
export function initialCutFeatures(kind, share = {}) {
  const features = CUT_FEATURES[kind] ?? [];
  return Object.fromEntries(features.map((f) => [f.id, f.option ? share?.[f.option] === false : false]));
}

/** Options de shareInputsForState avec les cases cochées : une fonction cochée est coupée. */
export function shareOptionsWithCuts(share = {}, cut = {}) {
  const options = { ...(share ?? {}) };
  for (const f of CUT_FEATURES.result) {
    if (typeof cut?.[f.id] === 'boolean') options[f.option] = !cut[f.id];
  }
  return options;
}

/**
 * Modèle de l'écran composé, prêt à dessiner.
 * @param {object} p
 * @param {object} p.layout   plan normalisé (normalizeScreenLayout), images en adresses
 * @param {string} [p.stateId]  partage : état de l'aperçu (SHARE_PREVIEW_STATES)
 * @param {object} [p.inputs]   partage : ShareScreenInputs déjà calculées (prioritaires sur stateId)
 * @param {object} [p.share]    partage : options de shareInputsForState (contexte de l'aperçu)
 * @param {object} [p.cut]      cases « Fonction coupée » ({ print: true, … })
 * @param {object} [p.texts]    accueil : event_name, event_date
 * @param {boolean} [p.hasPhotos]  accueil : l'événement a déjà des photos
 * @param {boolean} [p.personalized]  accueil : personnalisé (sinon neutre)
 * @returns {{kind, personalized, background, underlay, buttons, texts, slots, actions, values, printBanner}}
 */
export function designedScreenModel({
  layout, stateId = 'idle', inputs = null, share = {}, cut = {}, texts = {}, hasPhotos = true, personalized = true,
}) {
  const kind = layout.kind;
  let actions;
  let values;
  let banner = '';
  if (kind === 'result') {
    const s = inputs ?? shareInputsForState(stateId, shareOptionsWithCuts(share, cut));
    actions = shareActionStates(s);
    values = shareTexts(s);
    banner = printBanner(layout.texts.some((t) => t.variable === 'print_status'), s);
  } else {
    actions = homeActionStates({ hasPhotos });
    if (cut?.gallery === true) actions.gallery = ACTION_STATE.hidden;
    values = { event_name: texts?.event_name ?? '', event_date: texts?.event_date ?? '' };
  }

  // Le partage est toujours « personnalisé » (DesignedScreen.Personalized vaut true par défaut).
  const isPersonalized = kind === 'home' ? personalized !== false : true;
  return {
    kind,
    personalized: isPersonalized,
    background: isPersonalized ? layout.background : layout.background_neutral ?? layout.background,
    underlay: layout.transparent_background === true,
    buttons: layout.buttons
      .map((b) => ({ ...b, state: actionStateOf(actions, b.action) }))
      .filter((b) => b.state !== ACTION_STATE.hidden),
    texts: layout.texts.flatMap((spec) => {
      const value = values[spec.variable];
      return isTextVisible(value, spec, isPersonalized) ? [{ spec, text: displayText(value, spec) }] : [];
    }),
    slots: layout.slots,
    actions,
    values,
    printBanner: banner,
  };
}

/**
 * Source de l'aperçu d'un écran composé (`kind: 'screen'`) depuis un plan publié (adresses des
 * images), ou null si la borne le refuserait (elle afficherait alors l'écran standard).
 */
export function screenSourceFromPlan(plan) {
  const layout = normalizeScreenLayout(plan);
  if (!layout) return null;
  return { kind: 'screen', screenKind: layout.kind, layout };
}

/**
 * Même source depuis l'export par parties (LAB-298) : `layout` de buildScreenLayout (noms d'images)
 * et `images` = [{ name, dataUrl }] d'exportScreenParts. Les polices gardent leur nom de fichier :
 * l'aperçu écrit avec la famille déjà chargée par la page.
 */
export function screenSourceFromParts(layout, images) {
  const byName = new Map((images ?? []).map((i) => [i.name, i.dataUrl]));
  return screenSourceFromPlan(publishedPlan(layout, (name) => byName.get(name) ?? null, (name) => name));
}
