// Parité front / serveur de l'habillage de l'événement (LAB-302) : src/lib/eventBranding.js est la
// copie de supabase/functions/_shared/event-branding.ts. Même logique de couleur, de contraste (D7),
// de variables (D3), de longueurs et de date.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as front from './eventBranding.js';
import * as server from '../../supabase/functions/_shared/event-branding.ts';

const exportedNames = (mod) => Object.keys(mod).sort();

test('parité : mêmes exports et mêmes constantes', () => {
  assert.deepEqual(exportedNames(front), exportedNames(server));
  for (const name of ['DARK_TEXT', 'WHITE', 'BUTTON_MIN_CONTRAST', 'TITLE_MIN_CONTRAST', 'COLOR_REFUSED_MESSAGE', 'TEXT_LIMITS', 'EMAIL_VARIABLES']) {
    assert.deepEqual(front[name], server[name], name);
  }
  assert.equal(front.HEX_COLOR.source, server.HEX_COLOR.source);
  assert.equal(front.HEX_COLOR.flags, server.HEX_COLOR.flags);
});

const COLORS = [
  undefined, null, '', '#1F4E79', '#1f4e79', '#FFE600', '#7A7A7A', '#777777', '#000000', '#FFFFFF',
  '#E91E63', '#00A86B', '#26081A', 'red', '#12345', '#1234567', '#000;background:url(x)', ' #1F4E79', 12, {},
];

test('parité : couleur, contraste et thème', () => {
  for (const c of COLORS) {
    assert.equal(front.isHexColor(c), server.isHexColor(c), `isHexColor ${String(c)}`);
    assert.deepEqual(front.checkColor(c), server.checkColor(c), `checkColor ${String(c)}`);
    assert.deepEqual(front.eventTheme(c), server.eventTheme(c), `eventTheme ${String(c)}`);
  }
  for (const [a, b] of [['#1F4E79', '#FFFFFF'], ['#FFE600', '#26081A'], ['#7A7A7A', '#7A7A7A']]) {
    assert.equal(front.contrastRatio(a, b), server.contrastRatio(a, b));
    assert.equal(front.relativeLuminance(a), server.relativeLuminance(a));
  }
});

test('parité : cas de la spec (D7)', () => {
  assert.deepEqual(front.checkColor('#1F4E79'), { ok: true, theme: { accent: '#1F4E79', accentText: '#FFFFFF', titleColor: '#1F4E79' } });
  assert.deepEqual(front.checkColor('#FFE600'), { ok: true, theme: { accent: '#FFE600', accentText: '#26081A', titleColor: '#26081A' } });
  assert.deepEqual(front.checkColor('#7A7A7A'), { ok: false, error: front.COLOR_REFUSED_MESSAGE });
});

test('parité : lecture de form_config.branding', () => {
  const cases = [
    undefined, null, 'x', {}, { color: '#1F4E79', logo_url: 'https://cdn/x.png', gallery_text: 'Bienvenue' },
    { color: 'red', logo_url: 'javascript:alert(1)', gallery_text: 42 },
    { logo_url: 'http://cdn/x.png', gallery_text: 'é'.repeat(400) }, { gallery_text: '🎉'.repeat(301) },
  ];
  for (const raw of cases) assert.deepEqual(front.readBranding(raw), server.readBranding(raw), JSON.stringify(raw));
});

test('parité : variables, coupe et date', () => {
  const values = { event_name: 'Mariage', event_date: 'samedi 14 juin 2026', client_name: 'Marie & Pierre', company_name: 'Loueur', photo_url: 'https://x' };
  const texts = [
    '', 'Merci {client_name}, {event_name} le {event_date} ! {event_name}', '{inconnue} {event_name} {Event_Name} {photo_url}',
    '{company_name}{company_name}', '{a}{b}{a}', '{ event_name }', '{}',
  ];
  for (const t of texts) {
    assert.equal(front.fillVariables(t, values), server.fillVariables(t, values), t);
    assert.equal(front.fillVariables(t, {}), server.fillVariables(t, {}), t);
    assert.deepEqual(front.unknownVariables(t), server.unknownVariables(t), t);
  }
  for (const [t, n] of [['abc', 2], ['🎉🎉🎉', 2], ['court', 300], ['', 0]]) {
    assert.equal(front.truncate(t, n), server.truncate(t, n));
  }
  for (const d of [null, '', '  ', '2026-06-14', '2026-06-01', '2026-11-15T23:30:00Z', 'pas une date', 20260614]) {
    assert.equal(front.formatEventDate(d), server.formatEventDate(d), String(d));
  }
  assert.equal(front.formatEventDate('2026-06-13'), 'samedi 13 juin 2026');
});
