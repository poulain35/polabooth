// Images du bucket kiosk-backgrounds (LAB-282).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  KIOSK_BG_ACCEPT, KIOSK_BG_MAX_BYTES, eventBackgroundPath, kioskBackgroundContentType,
  kioskBackgroundExtension, kioskBackgroundProblem, kioskStorageErrorMessage, setupBackgroundPath,
} from './kioskBackground.js';

const file = (over = {}) => ({ name: 'fond.png', type: 'image/png', size: 1_500_000, ...over });

test('PNG et JPG acceptés, extension et type du fichier rangé', () => {
  assert.equal(kioskBackgroundProblem(file()), null);
  assert.equal(kioskBackgroundExtension(file()), 'png');
  assert.equal(kioskBackgroundExtension(file({ name: 'fond.jpeg', type: 'image/jpeg' })), 'jpg');
  assert.equal(kioskBackgroundExtension(file({ name: 'Fond.JPG', type: '' })), 'jpg');
  assert.equal(kioskBackgroundContentType('png'), 'image/png');
  assert.equal(kioskBackgroundContentType('jpg'), 'image/jpeg');
});

test('WebP, SVG, GIF et autres refusés avec un message clair', () => {
  for (const f of [
    file({ name: 'fond.webp', type: 'image/webp' }),
    file({ name: 'fond.svg', type: 'image/svg+xml' }),
    file({ name: 'fond.gif', type: 'image/gif' }),
    file({ name: 'fond.heic', type: 'image/heic' }),
    file({ name: 'fond.webp', type: '' }),
    // Type déclaré prioritaire sur l'extension.
    file({ name: 'fond.png', type: 'image/webp' }),
  ]) {
    assert.equal(kioskBackgroundExtension(f), null, f.name);
    assert.match(kioskBackgroundProblem(f), /PNG ou JPG/);
  }
  assert.equal(kioskBackgroundProblem(null), 'Aucun fichier choisi.');
});

test('10 Mo au maximum, comme le bucket', () => {
  assert.equal(KIOSK_BG_MAX_BYTES, 10485760);
  assert.equal(kioskBackgroundProblem(file({ size: KIOSK_BG_MAX_BYTES })), null);
  assert.match(kioskBackgroundProblem(file({ size: KIOSK_BG_MAX_BYTES + 1 })), /trop lourde \(10 Mo\) : 10 Mo au maximum/);
});

test('chemins conformes aux règles du bucket (D1, D2)', () => {
  assert.equal(eventBackgroundPath('3f1c', 'jpg'), '3f1c/background.jpg');
  assert.equal(setupBackgroundPath('png'), 'default/setup_background.png');
});

test('erreurs de Storage traduites', () => {
  assert.match(
    kioskStorageErrorMessage({ message: 'new row violates row-level security policy', statusCode: '403' }),
    /n'a pas le droit/,
  );
  assert.match(kioskStorageErrorMessage({ message: 'mime type image/webp is not supported', statusCode: '415' }), /PNG ou JPG/);
  assert.match(kioskStorageErrorMessage({ message: 'The object exceeded the maximum allowed size', statusCode: '413' }), /10 Mo/);
  assert.equal(kioskStorageErrorMessage({ message: 'Failed to fetch' }), 'Failed to fetch');
  assert.equal(kioskStorageErrorMessage(null), "L'envoi a échoué. Réessayez.");
});

test('accept des champs, limite et types alignés sur la migration', () => {
  assert.equal(KIOSK_BG_ACCEPT, 'image/png,image/jpeg');
  const sql = readFileSync(
    new URL('../../supabase/migrations/20261217000000_lab282_kiosk_backgrounds_lockdown.sql', import.meta.url), 'utf8');
  assert.match(sql, /file_size_limit = 10485760/);
  assert.match(sql, /ARRAY\['image\/png', 'image\/jpeg', 'application\/json'\]/);
  for (const page of ['../pages/admin/AdminSettings.jsx', '../pages/admin/AdminEventDetail.jsx']) {
    const src = readFileSync(new URL(page, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /accept="image\/\*"/, `${page} accepte encore toutes les images`);
  }
});
