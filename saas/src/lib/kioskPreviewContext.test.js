import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KIOSK_SUPPORTED_FORMATS, SAMPLE_PREVIEW_CONTEXT, firstGuestRemainingPrints, homeTiles, kioskPreviewBlock,
  previewContext,
} from './kioskPreviewContext.js';
import { VARIABLE_SAMPLES } from './kioskScreenLayout.js';
import { remainingPrintsText, shareInputsForState, shareTexts } from './kioskScreenState.js';

const EVENT = {
  id: 'e1',
  name: 'Mariage Martin',
  start_date: '2027-06-12T14:00:00+02:00',
  end_date: '2027-06-13T02:00:00+02:00',
};

test('sans événement : valeurs d\'exemple (D6), pastille, pas de mention', () => {
  const ctx = previewContext();
  assert.equal(ctx.sample, true);
  assert.deepEqual(ctx.texts, { event_name: VARIABLE_SAMPLES.event_name, event_date: VARIABLE_SAMPLES.event_date });
  assert.deepEqual(ctx.tiles, [{ format: 'photo', title: 'Photo', subtitle: 'Imprimée et partagée', isPrimary: true }]);
  assert.equal(ctx.resultScreen, null);
  assert.equal(remainingPrintsText(ctx.share.remainingPrints), VARIABLE_SAMPLES.prints_remaining);
  assert.deepEqual(SAMPLE_PREVIEW_CONTEXT, ctx);
});

test('événement : nom affiché, date de la borne', () => {
  const block = kioskPreviewBlock({
    kiosk: {
      home: { display_name: ' Camille & Thomas ' },
      questionnaire: { enabled: true, questions: [{ id: 'q', label: 'Email', type: 'email' }] },
    },
  });
  const ctx = previewContext({ event: EVENT, block });
  assert.equal(ctx.sample, false);
  assert.deepEqual(ctx.texts, { event_name: 'Camille & Thomas', event_date: 'Du 12 au 13 juin 2027' });
});

test('événement sans nom affiché ni bloc : nom de l\'événement, réglages par défaut de la borne', () => {
  const ctx = previewContext({ event: { ...EVENT, end_date: null } });
  assert.deepEqual(ctx.texts, { event_name: 'Mariage Martin', event_date: 'Samedi 12 juin 2027' });
  assert.deepEqual(ctx.share, {
    printEnabled: true, remainingPrints: 2, showRemainingPrints: true, autoReturnSeconds: 30,
    emailEnabled: false, qrEnabled: true, retakeEnabled: true, finishEnabled: true,
  });
});

test('tirages restants du premier invité : le plus petit plafond, null sans limite', () => {
  assert.equal(firstGuestRemainingPrints(null, null), null);
  assert.equal(firstGuestRemainingPrints(150, 3), 3);
  assert.equal(firstGuestRemainingPrints(1, 3), 1);
  assert.equal(firstGuestRemainingPrints(null, 2), 2);
  assert.equal(firstGuestRemainingPrints(0, null), 0);
});

test('écran de partage avec les réglages de l\'événement', () => {
  const block = kioskPreviewBlock({
    kiosk: {
      email: { enabled: true },
      result: { max_prints_per_event: 1, auto_return_seconds: 45, buttons: { qr: { enabled: false } } },
    },
  });
  const share = previewContext({ event: EVENT, block }).share;
  const texts = shareTexts(shareInputsForState('idle', share));
  assert.equal(texts.prints_remaining, 'encore 1 tirage possible');
  assert.equal(texts.countdown, "Retour à l'accueil dans 45 s");
  assert.equal(texts.print_status, '');
  assert.equal(share.emailEnabled, true);
  assert.equal(share.qrEnabled, false);
});

test('tuiles : formats que la borne sait réaliser, jamais vides', () => {
  assert.deepEqual(KIOSK_SUPPORTED_FORMATS, ['photo']);
  const formats = [{ id: 'photo', label: 'Souvenir' }, { id: 'gif', label: 'GIF' }];
  // Borne actuelle : photo seule, donc pastille.
  assert.equal(homeTiles(formats).length, 1);
  // Photo désactivée : la borne propose quand même la photo.
  assert.deepEqual(homeTiles([{ id: 'gif', label: 'GIF' }]).map((t) => t.format), ['photo']);
  // Le jour où la borne réalise le GIF : tuiles avec leurs noms.
  assert.deepEqual(homeTiles(formats, ['photo', 'gif', 'boomerang']), [
    { format: 'photo', title: 'Souvenir', subtitle: 'Imprimée et partagée', isPrimary: true },
    { format: 'gif', title: 'GIF', subtitle: 'Animé, à partager', isPrimary: false },
  ]);
});

test('écran de partage publié transmis au contexte', () => {
  const published = { background: 'https://cdn.example/bg.png', elements: [] };
  const ctx = previewContext({ event: EVENT, block: kioskPreviewBlock({}, published) });
  assert.deepEqual(ctx.resultScreen, published);
});
