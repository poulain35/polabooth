// Habillage d'un événement (LAB-300) : contraste D7, lecture de form_config.branding, variables D3,
// longueurs et date en français.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  checkColor, COLOR_REFUSED_MESSAGE, contrastRatio, DARK_TEXT, eventTheme, fillVariables, formatEventDate,
  readBranding, TEXT_LIMITS, truncate, unknownVariables, WHITE,
} from './event-branding.ts';
import { BRAND } from './email-layout.ts';

test('texte foncé = BRAND.text des emails', () => {
  assert.equal(DARK_TEXT, BRAND.text);
});

test('module pur : aucun import (copié dans le front)', () => {
  const src = readFileSync(new URL('./event-branding.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^\s*import\s/m);
  assert.doesNotMatch(src, /Deno\./);
});

test('contraste WCAG : noir sur blanc 21:1, blanc sur blanc 1:1', () => {
  assert.equal(Math.round(contrastRatio('#000000', '#FFFFFF') * 100) / 100, 21);
  assert.equal(contrastRatio('#ffffff', '#FFFFFF'), 1);
  assert.equal(contrastRatio('#1F4E79', WHITE), contrastRatio(WHITE, '#1F4E79'));
});

test('#1F4E79 : bouton à texte blanc, titre en couleur', () => {
  assert.deepEqual(eventTheme('#1F4E79'), { accent: '#1F4E79', accentText: WHITE, titleColor: '#1F4E79' });
});

test('#FFE600 : bouton à texte foncé, titre en texte foncé (moins de 3:1 sur blanc)', () => {
  assert.deepEqual(eventTheme('#FFE600'), { accent: '#FFE600', accentText: DARK_TEXT, titleColor: DARK_TEXT });
});

test('#7A7A7A : refusée (ni blanc ni foncé à 4,5:1), message clair', () => {
  assert.ok(contrastRatio('#7A7A7A', WHITE) < 4.5);
  assert.ok(contrastRatio('#7A7A7A', DARK_TEXT) < 4.5);
  assert.deepEqual(checkColor('#7A7A7A'), { ok: false, error: COLOR_REFUSED_MESSAGE });
  assert.equal(eventTheme('#7A7A7A'), null);
});

test('titre : la couleur dès 3:1 sur blanc, même si le bouton prend un texte foncé', () => {
  // #E0533D : ~3,6:1 sur blanc (titre en couleur), mais le foncé contraste plus sur le bouton.
  const theme = eventTheme('#E0533D')!;
  assert.ok(contrastRatio('#E0533D', WHITE) >= 3);
  assert.equal(theme.titleColor, '#E0533D');
  assert.equal(theme.accentText, contrastRatio('#E0533D', WHITE) >= contrastRatio('#E0533D', DARK_TEXT) ? WHITE : DARK_TEXT);
});

test('couleur invalide : ignorée par le serveur, refusée par l’admin ; vide : pas de thème', () => {
  for (const bad of ['red', '#12345', '#000;background:url(x)', '#1F4E79 ', '1F4E79', '#GGGGGG', 42, {}]) {
    assert.equal(eventTheme(bad), null, String(bad));
    assert.equal(readBranding({ color: bad }).color, null, String(bad));
  }
  assert.equal(checkColor('red').ok, false);
  assert.deepEqual(checkColor(''), { ok: true, theme: null });
  assert.deepEqual(checkColor(null), { ok: true, theme: null });
  assert.equal(eventTheme('#1f4e79')?.accent, '#1f4e79', 'minuscules acceptées');
});

test('readBranding : valeurs sûres seulement, tolérant si absent', () => {
  assert.deepEqual(readBranding(undefined), { color: null, logoUrl: null, galleryText: '' });
  assert.deepEqual(readBranding('x'), { color: null, logoUrl: null, galleryText: '' });
  assert.deepEqual(readBranding({
    color: '#1F4E79', logo_url: 'https://cdn.example.com/brand-logo.png?v=1', gallery_text: 'Merci !', other: 'x',
  }), { color: '#1F4E79', logoUrl: 'https://cdn.example.com/brand-logo.png?v=1', galleryText: 'Merci !' });
  for (const url of ['javascript:alert(1)', 'http://cdn.example.com/a.png', ' https://x', 'data:image/png;base64,AA', 7]) {
    assert.equal(readBranding({ logo_url: url }).logoUrl, null, String(url));
  }
  assert.equal(Array.from(readBranding({ gallery_text: 'é'.repeat(400) }).galleryText).length, 300);
});

test('variables : toutes les occurrences, inconnue laissée telle quelle, absente = vide', () => {
  const values = { event_name: 'Mariage', event_date: 'samedi 13 juin 2026', client_name: 'Marie & Pierre' };
  assert.equal(
    fillVariables('Merci {client_name}, {event_name} le {event_date} ! {event_name}', values),
    'Merci Marie & Pierre, Mariage le samedi 13 juin 2026 ! Mariage',
  );
  assert.equal(fillVariables('{prenom} {Event_Name} {event_name}', values), '{prenom} {Event_Name} Mariage');
  assert.equal(fillVariables('Le {event_date}.', { event_date: '' }), 'Le .');
  assert.equal(fillVariables('{company_name}', {}), '');
  // Une seule passe : une valeur contenant une variable n'est pas remplacée à son tour ; `$&` reste du texte.
  assert.equal(fillVariables('{event_name}', { event_name: '{client_name} $& $1' }), '{client_name} $& $1');
  assert.deepEqual(unknownVariables('{prenom} {event_name} {prenom} {nom}'), ['prenom', 'nom']);
});

test('date : français, heure de Paris, « 1er », vide si absente ou illisible', () => {
  // L'exemple de la spec (« samedi 14 juin 2026 ») tombe un dimanche : le 13 juin 2026 est un samedi.
  assert.equal(formatEventDate('2026-06-13T18:00:00+02:00'), 'samedi 13 juin 2026');
  // 22 h 30 UTC le 13 = 0 h 30 le 14 à Paris (heure d'été).
  assert.equal(formatEventDate('2026-06-13T22:30:00+00:00'), 'dimanche 14 juin 2026');
  assert.equal(formatEventDate('2026-08-01'), 'samedi 1er août 2026');
  assert.equal(formatEventDate('2026-12-31T23:30:00Z'), 'vendredi 1er janvier 2027');
  for (const empty of [null, undefined, '', '  ', 'demain', 12]) assert.equal(formatEventDate(empty), '');
});

test('longueurs : saisie et coupe du serveur de la spec, coupe par caractère', () => {
  assert.deepEqual(TEXT_LIMITS, {
    subject: { input: 120, server: 150 },
    title: { input: 80, server: 100 },
    message: { input: 1500, server: 2000 },
    button_label: { input: 30, server: 40 },
    gallery_text: { input: 300, server: 300 },
  });
  assert.equal(truncate('abc', 3), 'abc');
  assert.equal(truncate('abcd', 3), 'abc');
  assert.equal(truncate('📷📷📷', 2), '📷📷', 'un emoji n’est pas coupé en deux');
});
