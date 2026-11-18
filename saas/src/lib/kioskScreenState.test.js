import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ACTION_STATE,
  SHARE_ACTIONS,
  SHARE_PREVIEW_STATES,
  SHARE_STATUS,
  SHARE_TEXTS,
  actionStateOf,
  displayText,
  formatEventDate,
  formatEventDateShort,
  homeActionStates,
  homeDisplayName,
  homeLastPhoto,
  homeTexts,
  isTextVisible,
  paperLabel,
  printBanner,
  printStatusText,
  remainingPrintsText,
  shareActionStates,
  shareInputsForState,
  shareScreenForState,
  shareTexts,
  standardShareTexts,
} from './kioskScreenState.js';
import { ALLOWED, VARIABLE_SAMPLES } from './kioskScreenLayout.js';

// Cas communs avec les tests de la borne (ShareScreenState, EventDateFormatter, HomeScreen, DesignedScreen).
const FIXTURE = JSON.parse(
  readFileSync(new URL('../../../docs/specs/fixtures/kiosk-screen-state-cases.json', import.meta.url), 'utf8'),
);

test('cas communs : présents et nommés', () => {
  assert.ok(FIXTURE.share.length >= 10);
  assert.deepEqual(SHARE_ACTIONS, ALLOWED.result.actions);
  assert.deepEqual(SHARE_TEXTS, ALLOWED.result.variables);
  for (const c of FIXTURE.share) {
    assert.deepEqual(Object.keys(c.actions), SHARE_ACTIONS, c.name);
    assert.deepEqual(Object.keys(c.texts), SHARE_TEXTS, c.name);
  }
});

for (const c of FIXTURE.share) {
  test(`partage (cas commun) — ${c.name}`, () => {
    assert.deepEqual(shareActionStates(c.inputs), c.actions);
    assert.deepEqual(shareTexts(c.inputs), c.texts);
    assert.equal(printBanner(false, c.inputs), c.print_banner);
    assert.equal(printBanner(true, c.inputs), '');
  });
}

test('PrintStatus (cas communs) : en cours, erreur, confirmation, plus de tirage', () => {
  for (const c of FIXTURE.print_status) {
    assert.equal(printStatusText(c.isPrinting, c.error, c.notice, c.canPrint), c.expected, JSON.stringify(c));
  }
});

test('RemainingText (cas communs)', () => {
  for (const c of FIXTURE.remaining_text) assert.equal(remainingPrintsText(c.remaining), c.expected);
});

test('EventDateFormatter (cas communs) : heure de Paris, « 1er », plages', () => {
  for (const c of FIXTURE.event_dates) {
    assert.equal(formatEventDate(c.start, c.end), c.long, `${c.start} → ${c.end}`);
    assert.equal(formatEventDateShort(c.start), c.short, c.start);
  }
});

test('dates : objets Date et valeurs illisibles', () => {
  assert.equal(formatEventDate(new Date('2026-06-14T14:00:00Z')), 'Dimanche 14 juin 2026');
  assert.equal(formatEventDate('pas une date'), null);
  assert.equal(formatEventDate(''), null);
  assert.equal(formatEventDate('2026-06-14T14:00:00Z', 'pas une date'), 'Dimanche 14 juin 2026');
});

test('HomeScreen.DisplayName (cas communs)', () => {
  for (const c of FIXTURE.display_name) assert.equal(homeDisplayName(c.display_name, c.event_name), c.expected);
});

test('HomeActionStates (cas communs) : galerie masquée sans photo', () => {
  for (const c of FIXTURE.home_actions) assert.deepEqual(homeActionStates({ hasPhotos: c.has_photos }), c.actions);
});

test('HomeTexts : nom affiché et date ; sans date, texte vide (masqué)', () => {
  assert.deepEqual(
    homeTexts({ displayName: ' ', eventName: 'Mariage Léa', startDate: '2026-06-14T14:00:00Z', endDate: '2026-06-15T02:00:00Z' }),
    { event_name: 'Mariage Léa', event_date: 'Du 14 au 15 juin 2026' },
  );
  assert.deepEqual(homeTexts({ eventName: 'Mariage Léa' }), { event_name: 'Mariage Léa', event_date: '' });
});

test('HomeSlots : dernière photo, sinon le design, sinon rien', () => {
  assert.equal(homeLastPhoto('photo.jpg', 'design.png'), 'photo.jpg');
  assert.equal(homeLastPhoto(null, 'design.png'), 'design.png');
  assert.equal(homeLastPhoto(undefined, undefined), null);
});

test('DisplayText (cas communs) : majuscules et espaces fines', () => {
  for (const c of FIXTURE.display_text) {
    assert.equal(displayText(c.value, { uppercase: c.uppercase, char_spacing: c.char_spacing }), c.expected, JSON.stringify(c));
  }
});

test('visibilité des textes vivants (cas communs)', () => {
  for (const c of FIXTURE.text_visible) {
    assert.equal(isTextVisible(c.value, { personalized_only: c.personalized_only }, c.personalized), c.visible, JSON.stringify(c));
  }
});

test('bouton sans état : actif, comme DesignedScreen', () => {
  assert.equal(actionStateOf({}, 'print'), ACTION_STATE.active);
  assert.equal(actionStateOf(null, 'print'), ACTION_STATE.active);
  assert.equal(actionStateOf({ print: 'hidden' }, 'print'), ACTION_STATE.hidden);
  assert.equal(actionStateOf({ print: 'disabled' }, 'print'), ACTION_STATE.disabled);
});

// ── États de l'aperçu (spec, « États du partage proposés dans le sélecteur ») ──

test('aperçu « Au repos » : tout actif, print_status vide, « − » grisé à 1 copie', () => {
  const { actions, texts } = shareScreenForState('idle', { remainingPrints: 120 });
  assert.deepEqual(actions, {
    print: 'active', copies_minus: 'disabled', copies_plus: 'active',
    email: 'active', qr: 'active', retake: 'active', finish: 'active',
  });
  assert.equal(texts.print_status, '');
  assert.equal(texts.share_status, '');
  assert.equal(texts.prints_remaining, 'encore 120 tirages possibles');
  assert.equal(texts.countdown, "Retour à l'accueil dans 30 s");
});

test('aperçu « Photo en préparation » : email et QR grisés, share_status de la borne', () => {
  const { actions, texts } = shareScreenForState('preparing');
  assert.equal(actions.email, 'disabled');
  assert.equal(actions.qr, 'disabled');
  assert.equal(actions.print, 'active');
  assert.equal(texts.share_status, 'Préparation de votre photo…');
});

test('aperçu « Impression en cours » : bloc grisé, « Impression… »', () => {
  const { actions, texts } = shareScreenForState('printing', { copies: 2 });
  assert.deepEqual([actions.print, actions.copies_minus, actions.copies_plus], ['disabled', 'disabled', 'disabled']);
  assert.equal(texts.print_status, 'Impression…');
  assert.equal(texts.copies, '2');
});

test('aperçu « Plus de tirage » : bloc grisé (après une impression), « Plus de tirage disponible »', () => {
  const { inputs, actions, texts } = shareScreenForState('no_prints', { remainingPrints: 120, copies: 3 });
  assert.deepEqual([actions.print, actions.copies_minus, actions.copies_plus], ['disabled', 'disabled', 'disabled']);
  assert.equal(texts.print_status, 'Plus de tirage disponible');
  assert.equal(texts.prints_remaining, '');
  assert.equal(inputs.Copies, 1);
  assert.equal(inputs.MaxCopies, 1);
});

test('aperçu : fonctions coupées par l’admin → boutons masqués', () => {
  const { actions, texts } = shareScreenForState('preparing', {
    printEnabled: false, emailEnabled: false, qrEnabled: false, retakeEnabled: false, finishEnabled: false,
    autoReturnSeconds: 0,
  });
  assert.ok(Object.values(actions).every((s) => s === 'hidden'));
  assert.ok(Object.values(texts).every((t) => t === ''));
});

test('aperçu : plafonds des copies de ResultViewModel', () => {
  assert.equal(shareInputsForState('idle', { remainingPrints: null }).MaxCopies, 10);
  assert.equal(shareInputsForState('idle', { remainingPrints: 120 }).MaxCopies, 20);
  assert.equal(shareInputsForState('idle', { remainingPrints: 3, copies: 9 }).Copies, 3);
  assert.equal(shareInputsForState('idle', { remainingPrints: null }).CanPrint, true);
});

test('aperçu : quatre états dans le sélecteur', () => {
  assert.deepEqual(SHARE_PREVIEW_STATES.map((s) => s.label), [
    'Au repos', 'Photo en préparation', 'Impression en cours', 'Plus de tirage',
  ]);
});

// ── Écran de partage standard (ResultViewModel) ─────────────────────────────

test('PaperLabel : bandelette pour stripV et stripH, 10×15 sinon', () => {
  assert.equal(paperLabel('stripV'), 'bandelette 5×15');
  assert.equal(paperLabel('stripH'), 'bandelette 5×15');
  assert.equal(paperLabel('portrait'), '10×15');
  assert.equal(paperLabel('landscape'), '10×15');
  assert.equal(paperLabel(undefined), '10×15');
});

test('partage standard au repos : « Imprimer 1 exemplaire », tirages restants', () => {
  const t = standardShareTexts(shareInputsForState('idle', { remainingPrints: 2 }));
  assert.equal(t.printButton, 'Imprimer 1 exemplaire');
  assert.equal(t.printSubtitle, 'Tirage 10×15, encore 2 tirages possibles');
  assert.equal(t.subtitle, 'Imprimez, envoyez ou récupérez vos photos.');
  assert.equal(t.retake, 'Refaire la photo');
  assert.equal(standardShareTexts(shareInputsForState('idle', { remainingPrints: 1 })).printSubtitle,
    'Tirage 10×15, encore 1 tirage possible');
});

test('partage standard : plusieurs copies, sans plafond, bandelette, plusieurs photos', () => {
  const t = standardShareTexts(shareInputsForState('idle', { copies: 3 }), { formatId: 'stripV', photoCount: 3 });
  assert.equal(t.printButton, 'Imprimer 3 exemplaires');
  assert.equal(t.printSubtitle, 'Tirage bandelette 5×15, prêt en quelques secondes');
  assert.equal(t.retake, 'Refaire les photos');
  assert.equal(standardShareTexts(shareInputsForState('idle', { remainingPrints: 5, showRemainingPrints: false }))
    .printSubtitle, 'Tirage 10×15, prêt en quelques secondes');
});

test('partage standard : impression en cours et plus de tirage', () => {
  const printing = standardShareTexts(shareInputsForState('printing', { remainingPrints: 2 }));
  assert.equal(printing.printButton, 'Impression…');
  assert.equal(printing.printSubtitle, 'Tirage 10×15, encore 2 tirages possibles');
  const none = standardShareTexts(shareInputsForState('no_prints', { remainingPrints: 2 }));
  assert.equal(none.printButton, 'Plus de tirage disponible');
  assert.equal(none.printSubtitle, 'Tirage 10×15 : limite atteinte pour cette photo');
});

test('partage standard : erreur puis confirmation passent avant le tirage', () => {
  const inputs = shareInputsForState('idle');
  assert.equal(standardShareTexts(inputs, { printError: 'E', printNotice: 'N' }).printSubtitle, 'E');
  assert.equal(standardShareTexts(inputs, { printNotice: 'N' }).printSubtitle, 'N');
});

test("partage standard : sous-titre selon l'impression et les tuiles", () => {
  const sub = (o) => standardShareTexts(shareInputsForState('idle', o)).subtitle;
  assert.equal(sub({ emailEnabled: false, qrEnabled: false }), 'Imprimez votre photo en quelques secondes.');
  assert.equal(sub({ printEnabled: false }), 'Envoyez ou récupérez vos photos.');
  assert.equal(sub({ printEnabled: false, emailEnabled: false, qrEnabled: false }), 'Votre photo est bien enregistrée.');
});

// ── Exemples de l'éditeur (D6) ───────────────────────────────────────────────

test('VARIABLE_SAMPLES : des textes que la borne affiche vraiment', () => {
  assert.equal(VARIABLE_SAMPLES.event_date, formatEventDate('2027-06-12T14:00:00Z'));
  assert.equal(VARIABLE_SAMPLES.prints_remaining, remainingPrintsText(120));
  assert.equal(VARIABLE_SAMPLES.print_status, printStatusText(true, '', '', true));
  assert.equal(VARIABLE_SAMPLES.share_status, SHARE_STATUS.preparing);
  const idle = shareScreenForState('idle').texts;
  assert.equal(VARIABLE_SAMPLES.copies, idle.copies);
  assert.equal(VARIABLE_SAMPLES.countdown, idle.countdown);
  for (const value of Object.values(VARIABLE_SAMPLES)) assert.notEqual(value.trim(), '');
  assert.ok(!Object.values(VARIABLE_SAMPLES).includes('Prêt à imprimer'));
});
