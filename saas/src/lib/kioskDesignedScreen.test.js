import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CUT_FEATURES, designedScreenModel, initialCutFeatures, screenSourceFromParts, screenSourceFromPlan,
  shareOptionsWithCuts,
} from './kioskDesignedScreen.js';
import { ALLOWED, VARIABLE_SAMPLES, buildScreenLayoutFromState } from './kioskScreenLayout.js';
import { kioskScreenTemplate } from './kioskScreenTemplates.js';
import { SHARE_PREVIEW_STATES, SHARE_STATUS, PRINT_TEXTS } from './kioskScreenState.js';
import { SAMPLE_PREVIEW_CONTEXT } from './kioskPreviewContext.js';

// Cas communs avec les tests de la borne (ShareScreenState, DesignedScreen).
const FIXTURE = JSON.parse(
  readFileSync(new URL('../../../docs/specs/fixtures/kiosk-screen-state-cases.json', import.meta.url), 'utf8'),
);

/** Plan des modèles d'origine, tel que publié (images en adresses) puis lu par la borne. */
function standardSource(kind) {
  const { layout } = buildScreenLayoutFromState(kioskScreenTemplate(kind), kind);
  const names = [layout.background, layout.background_neutral, ...layout.buttons.map((b) => b.image)].filter(Boolean);
  return screenSourceFromParts(layout, names.map((name) => ({ name, dataUrl: `data:image/png;base64,${name}` })));
}

const RESULT = standardSource('result').layout;
const HOME = standardSource('home').layout;
// Partage sans texte « État de l'impression » : la borne écrit alors le bandeau.
const RESULT_NO_STATUS = { ...RESULT, texts: RESULT.texts.filter((t) => t.variable !== 'print_status') };

const shown = (model) => Object.fromEntries(model.buttons.map((b) => [b.action, b.state]));
const shownTexts = (model) => Object.fromEntries(model.texts.map((t) => [t.spec.variable, t.text]));

test('modèles d\'origine : toutes les actions et tous les textes du partage sont posés', () => {
  assert.deepEqual(RESULT.buttons.map((b) => b.action).sort(), [...ALLOWED.result.actions].sort());
  assert.deepEqual(RESULT.texts.map((t) => t.variable).sort(), [...ALLOWED.result.variables].sort());
  assert.ok(RESULT.buttons.every((b) => b.image.startsWith('data:image/png')));
});

for (const c of FIXTURE.share) {
  test(`écran composé (cas commun) — ${c.name}`, () => {
    const model = designedScreenModel({ layout: RESULT, inputs: c.inputs });
    assert.deepEqual(model.actions, c.actions);
    assert.deepEqual(model.values, c.texts);
    // Boutons dessinés : tous sauf les masqués, avec leur état.
    const expected = Object.fromEntries(Object.entries(c.actions).filter(([, s]) => s !== 'hidden'));
    assert.deepEqual(shown(model), expected);
    // Textes dessinés : les valeurs non vides.
    const texts = Object.fromEntries(Object.entries(c.texts).filter(([, v]) => v.trim() !== ''));
    assert.deepEqual(shownTexts(model), texts);
    // Le plan pose « État de l'impression » : pas de bandeau. Sans lui, celui de la borne.
    assert.equal(model.printBanner, '');
    assert.equal(designedScreenModel({ layout: RESULT_NO_STATUS, inputs: c.inputs }).printBanner, c.print_banner);
  });
}

test('états de l\'aperçu (D11) : au repos, préparation, impression, plus de tirage', () => {
  const share = SAMPLE_PREVIEW_CONTEXT.share;
  const ids = SHARE_PREVIEW_STATES.map((s) => s.id);
  assert.deepEqual(ids, ['idle', 'preparing', 'printing', 'no_prints']);

  const idle = designedScreenModel({ layout: RESULT, stateId: 'idle', share });
  assert.equal(idle.values.print_status, '');
  assert.equal(shown(idle).copies_minus, 'disabled');
  assert.equal(shown(idle).print, 'active');
  assert.equal(shownTexts(idle).prints_remaining, VARIABLE_SAMPLES.prints_remaining);

  const preparing = designedScreenModel({ layout: RESULT, stateId: 'preparing', share });
  assert.equal(shown(preparing).email, 'disabled');
  assert.equal(shown(preparing).qr, 'disabled');
  assert.equal(shownTexts(preparing).share_status, SHARE_STATUS.preparing);

  const printing = designedScreenModel({ layout: RESULT, stateId: 'printing', share });
  for (const a of ['print', 'copies_minus', 'copies_plus']) assert.equal(shown(printing)[a], 'disabled', a);
  assert.equal(shownTexts(printing).print_status, PRINT_TEXTS.printing);
  assert.equal(designedScreenModel({ layout: RESULT_NO_STATUS, stateId: 'printing', share }).printBanner, PRINT_TEXTS.printing);

  const none = designedScreenModel({ layout: RESULT, stateId: 'no_prints', share });
  for (const a of ['print', 'copies_minus', 'copies_plus']) assert.equal(shown(none)[a], 'disabled', a);
  assert.equal(shownTexts(none).print_status, PRINT_TEXTS.noPrints);
  assert.equal(shownTexts(none).prints_remaining, undefined);
});

test('fonction coupée : son bouton disparaît de l\'aperçu (partage)', () => {
  for (const feature of CUT_FEATURES.result) {
    for (const stateId of ['idle', 'preparing']) {
      const model = designedScreenModel({ layout: RESULT, stateId, cut: { [feature.id]: true } });
      for (const action of feature.actions) assert.equal(shown(model)[action], undefined, `${feature.id} → ${action}`);
      const others = ALLOWED.result.actions.filter((a) => !feature.actions.includes(a));
      for (const action of others) assert.ok(shown(model)[action], `${feature.id} garde ${action}`);
    }
  }
  // Impression coupée : les textes du bloc d'impression disparaissent aussi.
  const noPrint = shownTexts(designedScreenModel({ layout: RESULT, stateId: 'printing', cut: { print: true } }));
  assert.equal(noPrint.copies, undefined);
  assert.equal(noPrint.prints_remaining, undefined);
  assert.equal(noPrint.print_status, undefined);
  // Tout coupé : comme le cas commun « toutes les fonctions coupées », sans compte à rebours ici.
  const all = Object.fromEntries(CUT_FEATURES.result.map((f) => [f.id, true]));
  assert.deepEqual(shown(designedScreenModel({ layout: RESULT, cut: all })), {});
  // Case décochée : la fonction revient, même coupée par l'événement.
  const back = designedScreenModel({ layout: RESULT, share: { qrEnabled: false }, cut: { qr: false } });
  assert.equal(shown(back).qr, 'active');
});

test('fonction coupée : « Photos » de l\'accueil, et accueil sans photo', () => {
  const texts = SAMPLE_PREVIEW_CONTEXT.texts;
  assert.deepEqual(shown(designedScreenModel({ layout: HOME, texts })), { start: 'active', gallery: 'active' });
  assert.deepEqual(shown(designedScreenModel({ layout: HOME, texts, cut: { gallery: true } })), { start: 'active' });
  for (const c of FIXTURE.home_actions) {
    const model = designedScreenModel({ layout: HOME, texts, hasPhotos: c.has_photos });
    assert.deepEqual(model.actions, c.actions);
  }
});

test('accueil : textes de l\'événement, mode neutre (fond neutre, textes personnalisés masqués)', () => {
  const texts = { event_name: 'Léa & Hugo', event_date: 'Samedi 14 juin 2027' };
  const personalized = designedScreenModel({ layout: HOME, texts });
  assert.deepEqual(shownTexts(personalized), texts);
  assert.equal(personalized.background, HOME.background);

  const neutral = designedScreenModel({ layout: HOME, texts, personalized: false });
  assert.deepEqual(shownTexts(neutral), {});
  assert.equal(neutral.background, HOME.background_neutral);
  assert.notEqual(neutral.background, HOME.background);

  // Le partage ignore le mode neutre (la borne ne le lui applique pas).
  assert.equal(designedScreenModel({ layout: RESULT, personalized: false }).personalized, true);
});

test('textes vivants (cas communs) : vides masqués, personalized_only masqués en neutre', () => {
  for (const c of FIXTURE.text_visible) {
    const spec = { ...HOME.texts[0], personalized_only: c.personalized_only };
    const model = designedScreenModel({
      layout: { ...HOME, texts: [spec] }, texts: { event_name: c.value }, personalized: c.personalized,
    });
    assert.equal(model.texts.length === 1, c.visible, JSON.stringify(c));
  }
});

test('cases « Fonction coupée » au départ : celles de l\'événement', () => {
  assert.deepEqual(initialCutFeatures('result', SAMPLE_PREVIEW_CONTEXT.share),
    { print: false, email: false, qr: false, retake: false, finish: false });
  assert.deepEqual(initialCutFeatures('result', { printEnabled: false, emailEnabled: false, finishEnabled: true }),
    { print: true, email: true, qr: false, retake: false, finish: false });
  assert.deepEqual(initialCutFeatures('home', {}), { gallery: false });
  assert.deepEqual(shareOptionsWithCuts({ remainingPrints: 3, qrEnabled: false }, { print: true, qr: false }),
    { remainingPrints: 3, qrEnabled: true, printEnabled: false });
  assert.deepEqual(shareOptionsWithCuts({ emailEnabled: false }, {}), { emailEnabled: false });
});

test('source d\'un écran composé : images de l\'export par parties, plan refusé = null', () => {
  const { layout } = buildScreenLayoutFromState(kioskScreenTemplate('result'), 'result');
  const source = screenSourceFromParts(layout, [{ name: layout.background, dataUrl: 'data:image/png;base64,AA' }]);
  assert.equal(source.kind, 'screen');
  assert.equal(source.screenKind, 'result');
  assert.equal(source.layout.background, 'data:image/png;base64,AA');
  // Bouton sans image exportée : écarté, comme la borne.
  assert.equal(source.layout.buttons.length, 0);
  assert.equal(screenSourceFromPlan({ kind: 'result' }), null);
  assert.equal(screenSourceFromPlan(null), null);
});
