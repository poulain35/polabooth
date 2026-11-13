// LAB-235 : formats de la borne (photo, GIF, boomerang) dans form_config.kiosk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDefaultCapture, buildDefaultHome, buildDefaultHomeButtons, buildDefaultResultButtons, cleanKioskFormats, cleanResultConfig, DISPLAY_NAME_MAX, enabledFormats,
  FORMAT_LABEL_MAX, KIOSK_FORMATS, NO_FORMAT_ERROR, validateKioskFormats, withCaptureDefaults, withHomeDefaults,
  withResultButtonsDefaults,
} from './kioskFormats.js';
import { buildPolaBundle } from './polaBundle.js';
import { animatedMediaLabel } from '../utils/media.js';

const codes = (kiosk) => validateKioskFormats(kiosk).map((e) => e.code);

test('défauts : photo seule, GIF 4 photos à 1 s, boomerang 2 s sans impression', () => {
  assert.deepEqual(buildDefaultHomeButtons(), {
    photo:     { enabled: true,  label: 'Photo' },
    gif:       { enabled: false, label: 'GIF' },
    boomerang: { enabled: false, label: 'Boomerang' },
    gallery:   { enabled: false, label: 'Galerie' },
  });
  assert.deepEqual(buildDefaultHome(), {
    background_url: null, personalized: false, display_name: '', buttons: buildDefaultHomeButtons(),
  });
  assert.deepEqual(buildDefaultCapture(), {
    mirror: true, countdown_seconds: 5,
    gif: { shots: 4, interval_ms: 1000 },
    boomerang: { duration_ms: 2000, print_frame: false },
  });
  assert.deepEqual(KIOSK_FORMATS.map((f) => f.key), ['photo', 'gif', 'boomerang']);
});

test('les défauts sont des copies : modifier l’un ne touche pas les suivants', () => {
  const a = buildDefaultHome();
  a.buttons.gif.enabled = true;
  assert.equal(buildDefaultHome().buttons.gif.enabled, false);
});

test('événement existant sans réglage de formats : photo seule et accueil inchangé', () => {
  const raw = { home: { title: 'Bienvenue', background_url: 'https://cdn/bg.jpg' }, capture: { countdown_seconds: 3, mirror: false } };
  const home = withHomeDefaults(raw.home);
  assert.equal(home.title, 'Bienvenue');
  assert.equal(home.background_url, 'https://cdn/bg.jpg');
  assert.deepEqual(home.buttons, buildDefaultHomeButtons());
  const capture = withCaptureDefaults(raw.capture);
  assert.equal(capture.countdown_seconds, 3);
  assert.equal(capture.mirror, false);
  assert.deepEqual(capture.gif, { shots: 4, interval_ms: 1000 });
  assert.deepEqual(enabledFormats(raw), ['photo']);
  assert.deepEqual(enabledFormats({}), ['photo']);
  assert.deepEqual(enabledFormats(undefined), ['photo']);
  assert.deepEqual(validateKioskFormats(raw), []);
});

test('fusion : réglages enregistrés gardés, champs manquants complétés, boutons inconnus conservés', () => {
  const home = withHomeDefaults({ buttons: { gif: { enabled: true }, photo: { label: 'Clic !' }, selfie: { enabled: true, label: 'X' } } });
  assert.deepEqual(home.buttons.gif, { enabled: true, label: 'GIF' });
  assert.deepEqual(home.buttons.photo, { enabled: true, label: 'Clic !' });
  assert.deepEqual(home.buttons.selfie, { enabled: true, label: 'X' });
  const capture = withCaptureDefaults({ gif: { shots: 6 }, boomerang: { print_frame: true } });
  assert.deepEqual(capture.gif, { shots: 6, interval_ms: 1000 });
  assert.deepEqual(capture.boomerang, { duration_ms: 2000, print_frame: true });
});

test('valeurs illisibles (null, tableau, texte) remplacées par les défauts', () => {
  assert.deepEqual(withHomeDefaults(null).buttons, buildDefaultHomeButtons());
  assert.deepEqual(withHomeDefaults({ buttons: [] }).buttons, buildDefaultHomeButtons());
  assert.deepEqual(withCaptureDefaults({ gif: 'x', boomerang: null }).gif, { shots: 4, interval_ms: 1000 });
});

test('aucun format coché : enregistrement refusé avec un message, onglet Accueil', () => {
  const kiosk = { home: { buttons: { photo: { enabled: false }, gif: { enabled: false }, boomerang: { enabled: false } } } };
  const errors = validateKioskFormats(kiosk);
  assert.deepEqual(errors, [{ code: 'no_format', message: NO_FORMAT_ERROR, tab: 'accueil' }]);
  assert.match(NO_FORMAT_ERROR, /au moins un format/);
});

test('un seul format non photo suffit (GIF seul, boomerang seul)', () => {
  const only = (key) => ({ home: { buttons: { photo: { enabled: false }, [key]: { enabled: true } } } });
  assert.deepEqual(codes(only('gif')), []);
  assert.deepEqual(enabledFormats(only('gif')), ['gif']);
  assert.deepEqual(codes(only('boomerang')), []);
  assert.deepEqual(enabledFormats(only('boomerang')), ['boomerang']);
});

test('« enabled » doit valoir true : une chaîne ou 1 ne coche pas un format', () => {
  const kiosk = { home: { buttons: { photo: { enabled: 'false' }, gif: { enabled: 1 } } } };
  assert.deepEqual(enabledFormats(kiosk), []);
  assert.deepEqual(codes(kiosk), ['no_format']);
  assert.equal(cleanKioskFormats(kiosk).home.buttons.photo.enabled, false);
});

test('libellés : rognés, vide = libellé par défaut, plus de 20 caractères refusé', () => {
  const clean = cleanKioskFormats({ home: { buttons: { photo: { label: '  Clic  ' }, gif: { label: '   ' } } } });
  assert.equal(clean.home.buttons.photo.label, 'Clic');
  assert.equal(clean.home.buttons.gif.label, 'GIF');
  assert.equal(clean.home.buttons.boomerang.label, 'Boomerang');
  assert.deepEqual(codes({ home: { buttons: { photo: { label: 'x'.repeat(FORMAT_LABEL_MAX) } } } }), []);
  const errors = validateKioskFormats({ home: { buttons: { gif: { label: 'x'.repeat(FORMAT_LABEL_MAX + 1) } } } });
  assert.deepEqual(errors.map((e) => [e.code, e.tab]), [['format_label', 'accueil']]);
  assert.match(errors[0].message, /GIF.*20 caractères/);
});

test('LAB-250 : accueil personnalisé désactivé par défaut, gardé à la fusion', () => {
  assert.equal(withHomeDefaults(null).personalized, false);
  assert.equal(withHomeDefaults(null).display_name, '');
  const home = withHomeDefaults({ personalized: true, display_name: 'Camille & Thomas' });
  assert.equal(home.personalized, true);
  assert.equal(home.display_name, 'Camille & Thomas');
});

test('LAB-250 : nettoyage de l’accueil personnalisé (booléen strict, nom rogné, vide = nom de l’événement)', () => {
  const clean = (home) => cleanKioskFormats({ home }).home;
  assert.equal(clean({ personalized: 'true' }).personalized, false);
  assert.equal(clean({ personalized: true }).personalized, true);
  assert.equal(clean({ display_name: '  Camille & Thomas  ' }).display_name, 'Camille & Thomas');
  assert.equal(clean({ display_name: '   ' }).display_name, '');
  assert.equal(clean({ display_name: null }).display_name, '');
  assert.equal(clean({ personalized: true, background_url: 'https://cdn/bg.jpg' }).background_url, 'https://cdn/bg.jpg');
});

test('LAB-250 : nom affiché limité, erreur sur l’onglet Accueil', () => {
  assert.deepEqual(codes({ home: { display_name: 'x'.repeat(DISPLAY_NAME_MAX) } }), []);
  const errors = validateKioskFormats({ home: { display_name: 'x'.repeat(DISPLAY_NAME_MAX + 1) } });
  assert.deepEqual(errors.map((e) => [e.code, e.tab]), [['display_name', 'accueil']]);
});

test('LAB-250 / LAB-254 : boutons de l’écran de partage sans couleur ni libellé, activation gardée', () => {
  assert.deepEqual(withResultButtonsDefaults(null), buildDefaultResultButtons());
  assert.ok(Object.values(buildDefaultResultButtons()).every((b) => Object.keys(b).join() === 'enabled'));
  const buttons = withResultButtonsDefaults({
    print: { enabled: false, label: '', color: '#FF0000' },
    qr: { color: '#00FF00', label: 'QR Code' },
    selfie: { enabled: true },
  });
  assert.deepEqual(buttons.print, { enabled: false });
  assert.deepEqual(buttons.qr, { enabled: true });
  assert.deepEqual(Object.keys(buttons), ['retake', 'print', 'qr', 'email', 'home']);
});

test('LAB-254 : à l’enregistrement, anciens libellés et button_layout effacés, activation et reste gardés', () => {
  const old = {
    auto_return_seconds: 45,
    share: { qr: false },
    button_layout: 'bottom',
    buttons: {
      retake: { enabled: false, label: 'Reprendre' },
      print:  { enabled: true,  label: '' },
      qr:     { label: 'QR Code' },
      email:  { enabled: false, label: 'Email', color: '#FF0000' },
      home:   { enabled: true,  label: 'Accueil' },
    },
  };
  const result = cleanResultConfig(old);
  assert.ok(!('button_layout' in result));
  assert.deepEqual(result.buttons, {
    retake: { enabled: false }, print: { enabled: true }, qr: { enabled: true },
    email: { enabled: false }, home: { enabled: true },
  });
  assert.equal(result.auto_return_seconds, 45);
  assert.deepEqual(result.share, { qr: false });
  assert.equal(old.button_layout, 'bottom', 'la config d’origine n’est pas modifiée');

  const saved = cleanKioskFormats({ home: { buttons: { photo: { enabled: true } } }, result: old });
  assert.ok(!('button_layout' in saved.result));
  assert.ok(Object.values(saved.result.buttons).every((b) => !('label' in b)));
  assert.equal(saved.result.buttons.retake.enabled, false);
  assert.equal(saved.result.buttons.email.enabled, false);
  assert.ok(!('result' in cleanKioskFormats({})), 'pas d’écran de partage créé s’il n’y en a pas');
});

test('réglages GIF et boomerang : bornes de la spec, erreurs sur l’onglet Capture', () => {
  const cap = (capture) => codes({ capture });
  assert.deepEqual(cap({ gif: { shots: 3, interval_ms: 500 }, boomerang: { duration_ms: 1000 } }), []);
  assert.deepEqual(cap({ gif: { shots: 6, interval_ms: 3000 }, boomerang: { duration_ms: 3000 } }), []);
  assert.deepEqual(cap({ gif: { shots: 2 } }), ['gif_shots']);
  assert.deepEqual(cap({ gif: { shots: 7 } }), ['gif_shots']);
  assert.deepEqual(cap({ gif: { interval_ms: 400 } }), ['gif_interval']);
  assert.deepEqual(cap({ gif: { interval_ms: 3500 } }), ['gif_interval']);
  assert.deepEqual(cap({ boomerang: { duration_ms: 900 } }), ['boomerang_duration']);
  assert.deepEqual(cap({ boomerang: { duration_ms: 3100 } }), ['boomerang_duration']);
  assert.ok(validateKioskFormats({ capture: { gif: { shots: 9 } } }).every((e) => e.tab === 'capture'));
});

test('nettoyage : nombres en entiers (valeurs de liste en texte), print_frame booléen, reste du kiosk gardé', () => {
  const clean = cleanKioskFormats({
    questionnaire: { enabled: true },
    capture: { countdown_seconds: 3, gif: { shots: '5', interval_ms: '1500' }, boomerang: { duration_ms: '2500', print_frame: 'oui' } },
  });
  assert.deepEqual(clean.questionnaire, { enabled: true });
  assert.equal(clean.capture.countdown_seconds, 3);
  assert.deepEqual(clean.capture.gif, { shots: 5, interval_ms: 1500 });
  assert.deepEqual(clean.capture.boomerang, { duration_ms: 2500, print_frame: false });
});

test('.pola : cocher « GIF » donne home.buttons.gif.enabled = true dans le fichier exporté', () => {
  const kiosk = cleanKioskFormats({
    home: { background_url: null, buttons: { gif: { enabled: true, label: 'Mon GIF' } } },
    capture: { gif: { shots: 5, interval_ms: 1000 } },
  });
  assert.deepEqual(validateKioskFormats(kiosk), []);
  const bundle = buildPolaBundle({
    event: {
      id: 'ev-1', org_id: 'org-1', name: 'Soirée', access_code: 'ABC123',
      form_config: { kiosk, features: { audio: true } },
    },
    design: { id: 'ds-1', status: 'approved', format: 'portrait', canvas_json: { objects: [] }, final_png_url: 'https://cdn/d.png' },
    designPngBase64: 'UE5H',
    exportedAt: '2026-11-04T10:00:00.000Z',
  });
  const { buttons } = bundle.event.form_config.kiosk.home;
  assert.equal(buttons.gif.enabled, true);
  assert.equal(buttons.gif.label, 'Mon GIF');
  assert.equal(buttons.photo.enabled, true);
  assert.equal(buttons.boomerang.enabled, false);
  assert.deepEqual(bundle.event.form_config.kiosk.capture.gif, { shots: 5, interval_ms: 1000 });
  assert.deepEqual(bundle.event.form_config.kiosk.capture.boomerang, { duration_ms: 2000, print_frame: false });
  // Après passage en JSON (fichier compressé), la valeur reste un vrai booléen.
  assert.equal(JSON.parse(JSON.stringify(bundle)).event.form_config.kiosk.home.buttons.gif.enabled, true);
});

test('badges : GIF et Boomerang selon photos.media_type, rien pour une photo ou sans colonne', () => {
  assert.equal(animatedMediaLabel({ media_type: 'gif' }), 'GIF');
  assert.equal(animatedMediaLabel({ media_type: 'boomerang' }), 'Boomerang');
  assert.equal(animatedMediaLabel({ media_type: 'photo' }), null);
  assert.equal(animatedMediaLabel({ photo_url: 'https://cdn/a.mp4' }), null);
  assert.equal(animatedMediaLabel(null), null);
});
