// LAB-331 : fichier TTF d'une police Google pour les textes vivants des écrans de la borne.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fontCssUrls, fontFileUrl, isFontFile, parseFontRequest } from './logic.ts';

test('requête : famille Google et graisse 100 à 900, rien d’autre', () => {
  assert.deepEqual(parseFontRequest({ family: ' Exo 2 ', weight: 700 }), { family: 'Exo 2', weight: 700 });
  assert.deepEqual(parseFontRequest({ family: 'M PLUS 1p', weight: 100 }), { family: 'M PLUS 1p', weight: 100 });
  for (const family of ['', 'a&b', 'Roboto:wght@400', 'x'.repeat(61), "Pacifico'", 'Ro\nboto', 42]) {
    assert.ok('error' in parseFontRequest({ family, weight: 400 }), String(family));
  }
  for (const weight of [50, 950, 450.5, '400', null]) {
    assert.ok('error' in parseFontRequest({ family: 'Roboto', weight }), String(weight));
  }
  assert.ok('error' in parseFontRequest(null));
});

test('adresses CSS : graisse demandée puis graisse par défaut', () => {
  assert.deepEqual(fontCssUrls({ family: 'Great Vibes', weight: 700 }), [
    'https://fonts.googleapis.com/css2?family=Great+Vibes:wght@700',
    'https://fonts.googleapis.com/css2?family=Great+Vibes',
  ]);
});

test('feuille CSS : premier fichier TrueType de fonts.gstatic.com seulement', () => {
  // Réponse réelle de fonts.googleapis.com (User-Agent ancien), relevée le 2026-11-15.
  const css = `@font-face {
  font-family: 'Exo 2';
  font-style: normal;
  font-weight: 700;
  src: url(https://fonts.gstatic.com/s/exo2/v26/7cH1v4okm5zmbvwkAx_sfcEuiD8jWfWcPg.ttf) format('truetype');
}`;
  assert.equal(fontFileUrl(css), 'https://fonts.gstatic.com/s/exo2/v26/7cH1v4okm5zmbvwkAx_sfcEuiD8jWfWcPg.ttf');
  assert.equal(fontFileUrl("src: url(https://evil.example/x.ttf) format('truetype');"), null);
  assert.equal(fontFileUrl("src: url(https://fonts.gstatic.com/s/x.woff2) format('woff2');"), null);
  assert.equal(fontFileUrl('<html>400</html>'), null);
});

test('signature : TrueType ou OpenType', () => {
  assert.equal(isFontFile(new Uint8Array([0, 1, 0, 0, 9])), true);
  assert.equal(isFontFile(new TextEncoder().encode('OTTO....')), true);
  assert.equal(isFontFile(new TextEncoder().encode('true....')), true);
  assert.equal(isFontFile(new TextEncoder().encode('wOF2....')), false);
  assert.equal(isFontFile(new TextEncoder().encode('<!DOCTYPE')), false);
  assert.equal(isFontFile(new Uint8Array([0, 1])), false);
});
