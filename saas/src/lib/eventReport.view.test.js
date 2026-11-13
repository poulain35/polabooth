// LAB-236 : rendu réel du bilan (JSX compilé par Vite, rendu serveur React), page, route et en-têtes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BRAND, siteLabel } from './instanceBrand.js';

const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const APP = 'https://photobooth.exemple.fr';
// Site du bouton « Réserver à nouveau » passé explicitement : indépendant de la marque installée.
const SITE = 'https://exemple.fr';
const VIEW = '../components/report/EventReportView.jsx';

async function loadView() {
  const viewUrl = new URL(VIEW, import.meta.url);
  const { code: js } = await transformWithOxc(src(VIEW), 'EventReportView.jsx', { lang: 'jsx', jsx: { runtime: 'automatic' } });
  const out = js
    .replace(/from "(\.{1,2}\/[^"]+)"/g, (_, rel) => `from ${JSON.stringify(new URL(rel, viewUrl).href)}`)
    .replace('"react/jsx-runtime"', JSON.stringify(import.meta.resolve('react/jsx-runtime')))
    .replace('"react"', JSON.stringify(import.meta.resolve('react')));
  assert.doesNotMatch(out, /from "\.{1,2}\//, 'tous les imports relatifs sont réécrits');
  return import(`data:text/javascript,${encodeURIComponent(out)}`);
}

const report = (over = {}) => ({
  name: 'Mariage de Léa et Hugo',
  start_date: '2026-12-12',
  end_date: '2026-12-12',
  company: 'Studio Exemple',
  frozen_at: '2026-12-19T09:30:00+00:00',
  metrics: {
    sessions: 412, timed_sessions: 412,
    hours: [{ day: '2026-12-12', hour: 21, sessions: 150 }, { day: '2026-12-12', hour: 22, sessions: 262 }],
    prints: 380, qr_photos: 120, kiosk_emails: 14, gallery_opens: 97, downloads: 60,
    audio: { messages: 23, seconds: 2460 },
    questionnaire: { responses: 57, consents: 12 },
  },
  photos: [{ id: 'p1', url: 'https://pub.r2.dev/p1.jpg', thumbnail_url: 'https://pub.r2.dev/p1_t.jpg' }],
  gallery_online: true, audio_online: true, access_code: 'LEAHUGO',
  review_url: 'https://g.page/r/abc/review',
  client_type: 'particulier', event_type: 'mariage',
  ...over,
});

const text = (html) => html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replaceAll('&amp;', '&').replace(/\s+/g, ' ');
const links = (html) => [...html.matchAll(/<a ([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attrs, inner]) => ({
  text: inner.replace(/<[^>]+>/g, '').trim(),
  href: attrs.match(/href="([^"]*)"/)[1].replaceAll('&amp;', '&'),
  cls: attrs.match(/class="([^"]*)"/)?.[1] ?? '',
  target: attrs.match(/target="([^"]*)"/)?.[1],
  rel: attrs.match(/rel="([^"]*)"/)?.[1],
}));

test('bilan complet : tous les blocs, boutons, URL en clair à l\'impression', async () => {
  const { default: View } = await loadView();
  const html = renderToStaticMarkup(createElement(View, { report: report(), appUrl: APP, site: SITE }));
  const t = text(html);
  for (const s of [
    'Mariage de Léa et Hugo', 'Samedi 12 décembre 2026', 'Bilan arrêté au 19 décembre 2026',
    '412 séances photo', '97 ouvertures de la galerie', '380 tirages imprimés',
    'Le moment le plus animé : 22 h – 23 h', 'Livre d’or audio', '23 messages, 41 min au total',
    '57 invités ont répondu au questionnaire', 'Aucun nom ni contact n’apparaît dans ce bilan.',
    'Merci de nous avoir fait confiance.', 'Télécharger en PDF',
  ]) assert.ok(t.includes(s), s);

  const a = links(html);
  const rebook = a.find((l) => l.text === 'Réserver à nouveau');
  assert.equal(rebook.href, 'https://exemple.fr/disponibilites/?utm_source=rapport&utm_medium=email&utm_campaign=mariage');
  assert.match(rebook.cls, /print:hidden/);
  assert.equal(rebook.target, '_blank');
  assert.equal(rebook.rel, 'noopener noreferrer');
  assert.equal(a.find((l) => l.text === 'Laisser un avis').href, 'https://g.page/r/abc/review');
  assert.equal(a.find((l) => l.text === 'Voir toute la galerie').href, `${APP}/photos/LEAHUGO`);
  assert.equal(a.find((l) => l.text === 'Écouter les messages').href, `${APP}/audio/LEAHUGO`);

  // À l'impression : chaque bouton devient « libellé : URL » (bloc caché à l'écran).
  const printed = [...html.matchAll(/<p class="hidden print:block[^"]*">([\s\S]*?)<\/p>/g)].map(([, inner]) => text(inner).trim());
  assert.deepEqual(printed, [
    `Voir toute la galerie : ${APP}/photos/LEAHUGO`,
    `Écouter les messages : ${APP}/audio/LEAHUGO`,
    'Réserver à nouveau : https://exemple.fr/disponibilites/?utm_source=rapport&utm_medium=email&utm_campaign=mariage',
    'Laisser un avis : https://g.page/r/abc/review',
  ]);

  // Impression : A4 portrait, couleurs de l'histogramme gardées, cartes jamais coupées.
  assert.match(html, /@page \{ size: A4 portrait;/);
  assert.match(html, /print-color-adjust: exact/);
  assert.ok((html.match(/break-inside-avoid/g) ?? []).length >= 10);
  assert.match(html, /<img src="https:\/\/pub\.r2\.dev\/p1_t\.jpg"/);
});

test('bilan minimal : impression, livre d\'or, questionnaire, photos et avis masqués', async () => {
  const { default: View } = await loadView();
  const html = renderToStaticMarkup(createElement(View, {
    report: report({ metrics: { sessions: 3 }, photos: [], gallery_online: false, audio_online: false, access_code: undefined, review_url: null }),
    appUrl: APP, site: SITE,
  }));
  const t = text(html);
  assert.ok(t.includes('3 séances photo'));
  for (const s of ['tirage', 'Livre d’or', 'questionnaire', 'galerie', 'Le moment le plus animé', 'Laisser un avis', 'Quelques photos']) {
    assert.ok(!t.includes(s), `absent : ${s}`);
  }
  // Pied de page : lien vers le site de la marque installée, s'il y en a un.
  assert.deepEqual(links(html).map((l) => l.text), ['Réserver à nouveau', ...(BRAND.site ? [siteLabel(BRAND.site)] : [])]);
});

test('pro : « Réserver à nouveau » mène à la page entreprises avec utm rapport/email', async () => {
  const { default: View } = await loadView();
  const html = renderToStaticMarkup(createElement(View, { report: report({ client_type: 'professionnel', event_type: 'entreprise' }), appUrl: APP, site: SITE }));
  const rebook = links(html).find((l) => l.text === 'Réserver à nouveau');
  assert.ok(rebook.href.startsWith('https://exemple.fr/pour-les-entreprises/?utm_source=rapport&utm_medium=email'), rebook.href);
});

test('indisponible : seul le message, sans cause', async () => {
  const { default: View, ReportUnavailable } = await loadView();
  assert.equal(renderToStaticMarkup(createElement(View, { report: null })), '');
  const t = text(renderToStaticMarkup(createElement(ReportUnavailable)));
  assert.ok(t.includes('Ce bilan n’est plus disponible'));
  for (const s of ['expiré', 'révoqué', 'inconnu', 'introuvable']) assert.ok(!t.includes(s), s);
});

test('page : route publique, jeton vérifié avant l\'appel, noindex, même message pour toute cause', () => {
  const app = src('../App.jsx');
  assert.match(app, /lazy\(\(\) => import\('\.\/pages\/EventReport'\)\)/);
  assert.match(app, /\{ path: '\/rapport\/:token', element: P\(<EventReport \/>\) \}/);
  const page = src('../pages/EventReport.jsx');
  assert.match(page, /usePolaPublicHead\([^)]*privatePage: true/);
  assert.match(page, /isReportToken\(token\)/);
  assert.match(page, /getEventReport\(token\.trim\(\)\)/);
  assert.match(page, /report \? \{ key, status: 'ready', report \} : \{ key, status: 'unavailable' \}/);
});

test('vercel.json : /rapport/ en noindex, sans référent ni cache', () => {
  const cfg = JSON.parse(src('../../vercel.json'));
  const block = cfg.headers.find((h) => h.source === '/rapport/(.*)');
  const get = (k) => block.headers.find((h) => h.key === k)?.value;
  assert.equal(get('X-Robots-Tag'), 'noindex, nofollow');
  assert.equal(get('Referrer-Policy'), 'no-referrer');
  assert.equal(get('Cache-Control'), 'no-store');
  assert.ok(cfg.rewrites.some((r) => r.destination === '/' || r.destination === '/index.html'), 'rewrite SPA');
});
