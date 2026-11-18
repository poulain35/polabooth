// LAB-308 : get-event renvoie le bloc kiosk_preview (aperçu sur la borne) et aucun autre champ de
// form_config (règle de LAB-112). Le bloc est le même que celui calculé par l'admin (miroir client).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildKioskPreview } from './kiosk-preview.ts';
// @ts-ignore — module JS du front, importé pour vérifier la parité
import { kioskPreviewBlock } from '../../../src/lib/kioskPreviewContext.js';

const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

const SECRET = 'FUITE';

// Tous les réglages de la borne, chacun marqué : aucun ne doit apparaître dans le bloc.
const LEAKY_CONFIG = {
  features: { secret_feature: `${SECRET}-features` },
  rgpd_notice: `${SECRET}-root`,
  kiosk: {
    locale: `${SECRET}-locale`,
    home: {
      background_url: `https://${SECRET}.example/bg.png`,
      personalized: true,
      client_design: true,
      display_name: '  Camille & Thomas  ',
      buttons: {
        photo: { enabled: true, label: ' Photo souvenir ', color: `${SECRET}-color` },
        gif: { enabled: true, label: '' },
        boomerang: { enabled: false, label: `${SECRET}-boomerang` },
        gallery: { enabled: true, label: `${SECRET}-gallery` },
      },
    },
    capture: { mirror: true, countdown_seconds: 5, gif: { shots: 4, interval_ms: 1000 } },
    rgpd: { enabled: true, message: `${SECRET}-rgpd` },
    effects: { enabled_effects: [`${SECRET}-effect`] },
    email: {
      enabled: true,
      sender_name: `${SECRET}-sender`,
      sender_email: `${SECRET}@example.com`,
      subject: `${SECRET}-subject`,
      message: `${SECRET}-message`,
    },
    printer: { default_printer: `${SECRET}-printer`, paper_format: '4x6' },
    questionnaire: {
      enabled: true,
      required_for_photo: true,
      title: `${SECRET}-title`,
      intro: `${SECRET}-intro`,
      questions: [{ id: 'q1', label: `${SECRET}-question`, type: 'email', required: true }],
      controller: { name: `${SECRET}-controller`, contact_email: `${SECRET}@client.example` },
      notice: `${SECRET}-notice`,
      marketing_consent: { enabled: true, label: `${SECRET}-marketing` },
    },
    result: {
      auto_print: true,
      max_prints_per_event: 150,
      max_prints_per_photo: 3,
      show_remaining_prints: false,
      auto_return_seconds: 45,
      button_layout: `${SECRET}-layout`,
      buttons: { print: { enabled: true, label: `${SECRET}-print` }, qr: { enabled: false } },
    },
  },
};

test('kiosk_preview : seuls les champs prévus, aucune valeur de form_config en plus', () => {
  const block = buildKioskPreview(LEAKY_CONFIG, null);
  assert.deepEqual(Object.keys(block).sort(), ['display_name', 'formats', 'result', 'result_screen']);
  assert.deepEqual(Object.keys(block.result).sort(), [
    'auto_return_seconds', 'email_enabled', 'finish_enabled', 'max_prints_per_event', 'max_prints_per_photo',
    'print_enabled', 'qr_enabled', 'retake_enabled', 'show_remaining_prints',
  ]);
  assert.doesNotMatch(JSON.stringify(block), new RegExp(SECRET));
  assert.deepEqual(block, {
    display_name: 'Camille & Thomas',
    formats: [{ id: 'photo', label: 'Photo souvenir' }, { id: 'gif', label: 'GIF' }],
    result_screen: null,
    result: {
      print_enabled: true,
      max_prints_per_event: 150,
      max_prints_per_photo: 3,
      show_remaining_prints: false,
      auto_return_seconds: 45,
      email_enabled: true,
      qr_enabled: false,
      retake_enabled: true,
      finish_enabled: true,
    },
  });
});

test('kiosk_preview : défauts de la borne sans config', () => {
  for (const config of [null, undefined, {}, { kiosk: null }, { kiosk: 'cassé' }, []]) {
    assert.deepEqual(buildKioskPreview(config), {
      display_name: null,
      formats: [{ id: 'photo', label: 'Photo' }],
      result_screen: null,
      result: {
        print_enabled: true,
        max_prints_per_event: null,
        max_prints_per_photo: 2,
        show_remaining_prints: true,
        auto_return_seconds: 30,
        // kiosk.email.enabled vaut faux par défaut sur la borne.
        email_enabled: false,
        qr_enabled: true,
        retake_enabled: true,
        finish_enabled: true,
      },
    });
  }
});

test('kiosk_preview : formats comme HomeButtonsConfig (bouton présent sans enabled = activé)', () => {
  const formats = (buttons: unknown) => buildKioskPreview({ kiosk: { home: { buttons } } }).formats;
  assert.deepEqual(formats({ gif: { label: 'Animé' } }), [{ id: 'photo', label: 'Photo' }, { id: 'gif', label: 'Animé' }]);
  assert.deepEqual(formats({ photo: { enabled: false } }), []);
  assert.deepEqual(formats({ photo: { enabled: 'non' }, boomerang: { enabled: true } }),
    [{ id: 'photo', label: 'Photo' }, { id: 'boomerang', label: 'Boomerang' }]);
});

test('kiosk_preview : plafonds de tirage (absent = défaut, null = sans limite)', () => {
  const result = (r: unknown) => buildKioskPreview({ kiosk: { result: r } }).result;
  assert.equal(result({ max_prints_per_photo: null }).max_prints_per_photo, null);
  assert.equal(result({ max_prints_per_photo: 1.5 }).max_prints_per_photo, 2);
  assert.equal(result({ max_prints_per_event: '20' }).max_prints_per_event, null);
  assert.equal(result({ auto_return_seconds: 0 }).auto_return_seconds, 0);
  assert.equal(result({ auto_return_seconds: null }).auto_return_seconds, 30);
});

test('kiosk_preview : l\'écran de partage publié passe tel quel, sinon null', () => {
  const published = { version: 1, background: 'https://cdn.example/bg.png', elements: [] };
  assert.deepEqual(buildKioskPreview({}, published).result_screen, published);
  assert.equal(buildKioskPreview({}, 'texte').result_screen, null);
  assert.equal(buildKioskPreview({}, [published]).result_screen, null);
});

test('kiosk_preview : même bloc que le miroir du front (fiche de l\'événement)', () => {
  const configs = [
    LEAKY_CONFIG, null, {}, { kiosk: { home: { buttons: { gif: {}, photo: { enabled: false } } } } },
    { kiosk: { questionnaire: { enabled: true, questions: [{ id: 'a', label: 'A', type: 'tel' }] }, email: { enabled: true } } },
    { kiosk: { result: { max_prints_per_photo: null, buttons: { email: { enabled: false }, home: { enabled: false } } } } },
  ];
  for (const config of configs) {
    assert.deepEqual(kioskPreviewBlock(config, null), buildKioskPreview(config, null));
  }
});

test('get-event : kiosk_preview construit par buildKioskPreview, form_config jamais renvoyé', () => {
  assert.match(src, /import \{ buildKioskPreview \} from '\.\/kiosk-preview\.ts';/);
  assert.match(src, /const kioskPreview = buildKioskPreview\(form_config, resultScreen\?\.published \?\? null\);/);
  const response = src.slice(src.lastIndexOf('return corsResponse(200'));
  assert.match(response, /kiosk_preview:\s+kioskPreview,/);
  assert.doesNotMatch(response, /form_config/);
  assert.doesNotMatch(response, /\brow\b/);
  // L'identifiant du compte sert à lire l'écran publié, il n'est pas renvoyé.
  assert.match(src, /const \{ form_config, org_id: orgId, \.\.\.event \} = found\.event;/);
  assert.match(src, /\.from\('kiosk_screens'\)\s+\.select\('published'\)\s+\.eq\('org_id', orgId\)\s+\.eq\('kind', 'result'\)/);
});
