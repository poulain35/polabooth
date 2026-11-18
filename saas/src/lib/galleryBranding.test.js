// LAB-303 — Galerie des invités aux couleurs de l'événement : règles (galleryLook), en-tête rendu pour
// de vrai (JSX compilé par Vite, rendu serveur React) et branchement dans PhotoGallery.jsx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ACCENT_TEXT_VAR, ACCENT_VAR, DEFAULT_GALLERY_CLASSES, GALLERY_PAGE_BACKGROUND, galleryLook,
} from './galleryBranding.js';
import { contrastRatio, DARK_TEXT, WHITE } from './eventBranding.js';
import { parsePublicEvent } from './publicEvent.js';
import { BRAND } from './instanceBrand.js';

const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const branding = (b) => parsePublicEvent({ id: 'e1', name: 'Mariage', branding: b }).branding;

// Classes de la galerie sans réglage : palette noyer du site (LAB-397, avant : dégradé rose-violet), recopiées telles quelles.
const SITE = {
  uploadEmpty: 'pola-pf-focus mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold bg-pf-noyer text-white hover:bg-pf-noyer-h transition-all shadow-sm',
  upload: 'pola-pf-focus flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold bg-pf-noyer text-white hover:bg-pf-noyer-h transition-all shadow-sm',
  selection: 'pola-pf-focus flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium bg-pf-noyer text-white hover:bg-pf-noyer-h disabled:opacity-60 transition-colors',
  tab: "activeTab === t.key ? `bg-white text-pf-noyer shadow-sm` : 'text-pf-muted hover:text-pf-text'",
  tabCount: "<span className={activeTab === t.key ? 'text-pf-noyer' : 'text-pf-muted/70'}>",
};

// ── Règles ───────────────────────────────────────────────────────────────────

test('galleryLook : sans réglage (null, absent, vide) → classes d\'avant, aucun style, ni logo ni texte', () => {
  for (const b of [null, undefined, 'x', 42, branding(undefined), branding(null), branding({}), branding([])]) {
    const look = galleryLook(b);
    assert.equal(look.style, undefined, JSON.stringify(b));
    assert.equal(look.logoUrl, null);
    assert.equal(look.text, '');
    assert.deepEqual(look.classes, DEFAULT_GALLERY_CLASSES);
  }
  assert.equal(branding(undefined), null, 'RPC sans branding : null');
  assert.equal(branding(null), null);
});

test('galleryLook : couleur foncée #1F4E79 → boutons pleins, texte blanc, titre et onglet en couleur', () => {
  const look = galleryLook(branding({ color: '#1F4E79' }));
  assert.deepEqual(look.style, { [ACCENT_VAR]: '#1F4E79', [ACCENT_TEXT_VAR]: WHITE });
  assert.equal(look.classes.primaryButton, 'bg-[color:var(--event-accent)] text-[color:var(--event-accent-text)] hover:brightness-95');
  assert.equal(look.classes.selectionButton, look.classes.primaryButton);
  assert.equal(look.classes.title, 'text-[color:var(--event-accent)]');
  assert.equal(look.classes.activeTab, 'text-[color:var(--event-accent)]');
  assert.doesNotMatch(Object.values(look.classes).join(' '), /gradient|bg-primary/);
});

test('galleryLook : couleur claire #FFE600 → texte du bouton foncé, titre et onglet aux couleurs d\'avant', () => {
  const look = galleryLook(branding({ color: '#FFE600' }));
  assert.deepEqual(look.style, { [ACCENT_VAR]: '#FFE600', [ACCENT_TEXT_VAR]: DARK_TEXT });
  assert.equal(look.classes.title, DEFAULT_GALLERY_CLASSES.title);
  assert.equal(look.classes.activeTab, DEFAULT_GALLERY_CLASSES.activeTab);
});

test('galleryLook : titre dès 3:1 sur le fond de page, onglet seulement dès 4,5:1 sur blanc', () => {
  // #2F9E44 : entre 3 et 4,5 sur blanc.
  const mid = '#2F9E44';
  assert.ok(contrastRatio(mid, GALLERY_PAGE_BACKGROUND) >= 3 && contrastRatio(mid, WHITE) < 4.5);
  const look = galleryLook(branding({ color: mid }));
  assert.equal(look.classes.title, 'text-[color:var(--event-accent)]');
  assert.equal(look.classes.activeTab, DEFAULT_GALLERY_CLASSES.activeTab);
  assert.ok(look.style, 'bouton plein quand même : texte foncé ou blanc à 4,5:1');
});

test('galleryLook : couleur refusée (D7) ou invalide → couleurs d\'avant, logo et texte gardés', () => {
  for (const color of ['#7A7A7A', 'red', '#12345', '#000;background:url(x)', 42]) {
    const look = galleryLook({ color, logoUrl: 'https://cdn.exemple.fr/l.png', galleryText: 'Bienvenue' });
    assert.equal(look.style, undefined, String(color));
    assert.deepEqual(look.classes, DEFAULT_GALLERY_CLASSES);
    assert.equal(look.logoUrl, 'https://cdn.exemple.fr/l.png');
    assert.equal(look.text, 'Bienvenue');
  }
});

test('galleryLook : logo https seulement, texte blanc ignoré, texte coupé à 300 par parsePublicEvent', () => {
  assert.equal(galleryLook(branding({ logo_url: 'javascript:alert(1)' })).logoUrl, null);
  assert.equal(galleryLook(branding({ logo_url: 'http://x.fr/l.png' })).logoUrl, null);
  assert.equal(galleryLook({ logoUrl: 'data:image/png;base64,AA' }).logoUrl, null);
  assert.equal(galleryLook(branding({ logo_url: 'https://x.fr/l.png?v=1' })).logoUrl, 'https://x.fr/l.png?v=1');
  assert.equal(galleryLook(branding({ gallery_text: '  \n ' })).text, '');
  assert.equal(Array.from(galleryLook(branding({ gallery_text: 'é'.repeat(400) })).text).length, 300);
});

test('galleryBranding.js : contraste repris de eventBranding.js, pas recopié', () => {
  const code = src('./galleryBranding.js');
  assert.match(code, /from '\.\/eventBranding\.js'/);
  assert.doesNotMatch(code, /0\.2126|0\.03928|luminance|function contrast|HEX_COLOR|\[0-9A-Fa-f\]/i);
});

// ── En-tête rendu ────────────────────────────────────────────────────────────

const rewrite = (js, baseUrl, jsxUrls) => js
  .replace(/from "(\.{1,2}\/[^"]+)"/g, (_, rel) => `from ${JSON.stringify(jsxUrls[rel] ?? new URL(rel, baseUrl).href)}`)
  .replace('"react/jsx-runtime"', JSON.stringify(import.meta.resolve('react/jsx-runtime')))
  .replace('"react"', JSON.stringify(import.meta.resolve('react')));

async function compile(rel) {
  const { code } = await transformWithOxc(src(rel), rel.split('/').pop(), { lang: 'jsx', jsx: { runtime: 'automatic' } });
  return code;
}

async function loadHeading() {
  const logoRel = '../components/BrandLogo.jsx';
  const logo = rewrite(await compile(logoRel), new URL(logoRel, import.meta.url), {});
  const rel = '../components/GalleryHeading.jsx';
  const out = rewrite(await compile(rel), new URL(rel, import.meta.url), {
    './BrandLogo.jsx': `data:text/javascript,${encodeURIComponent(logo)}`,
  });
  assert.doesNotMatch(out, /from "\.{1,2}\//, 'tous les imports relatifs sont réécrits');
  return (await import(`data:text/javascript,${encodeURIComponent(out)}`)).default;
}

const esc = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
// En-tête sans réglage, palette du site (LAB-397) : logo de l'instance, nom du loueur, nom de l'événement, compteur.
const siteHeading = ({ companyName, eventName, count }) => {
  const logo = BRAND.logoSquare ? `<img src="${esc(BRAND.logoSquare)}" alt="${esc(companyName || BRAND.name)}" class="h-10 w-auto"/>` : '';
  return `<div class="mb-4">${logo}</div>`
    + (companyName ? `<p class="text-xs font-semibold text-pf-noyer uppercase tracking-widest mb-1">${esc(companyName)}</p>` : '')
    + (eventName ? `<h1 class="font-pf-serif font-normal text-[26px] leading-tight text-pf-text text-center">${esc(eventName)}</h1>` : '')
    + `<p class="text-xs text-pf-muted mt-1">${count} photo${count !== 1 ? 's' : ''}</p>`;
};
// React 19 ajoute un <link rel="preload"> pour chaque image rendue côté serveur : sans objet dans le navigateur.
const render = (Heading, props) => renderToStaticMarkup(createElement(Heading, props)).replace(/<link rel="preload" as="image" href="[^"]*"\/>/g, '');

test('en-tête : sans réglage (branding null ou absent), HTML aux couleurs du site', async () => {
  const Heading = await loadHeading();
  const cases = [
    { companyName: 'Studio Exemple', eventName: 'Mariage de Léa & Hugo', count: 12 },
    { companyName: '', eventName: 'Soirée', count: 1 },
    { companyName: 'Studio', eventName: '', count: 0 },
  ];
  for (const c of cases) {
    for (const b of [undefined, null]) {
      const look = galleryLook(parsePublicEvent({ id: 'e1', name: c.eventName, ...(b === undefined ? {} : { branding: b }) }).branding);
      assert.equal(render(Heading, { look, ...c }), siteHeading(c), JSON.stringify(c));
    }
  }
});

test('en-tête : logo de l\'événement à la place du logo de l\'instance, nom en couleur, texte d\'accueil', async () => {
  const Heading = await loadHeading();
  const look = galleryLook(branding({
    color: '#1F4E79', logo_url: 'https://cdn.exemple.fr/logo.png?v=2',
    gallery_text: 'Merci d\'être venus !\n<b>Bisous</b> <script>alert(1)</script>',
  }));
  const html = render(Heading, { look, companyName: 'Studio', eventName: 'Mariage', count: 3 });
  assert.match(html, /^<div class="mb-4"><img src="https:\/\/cdn\.exemple\.fr\/logo\.png\?v=2" alt="Mariage" class="h-16 w-auto max-w-\[240px\] object-contain"\/><\/div>/);
  assert.equal(html.match(/<img /g).length, 1, 'un seul logo');
  assert.match(html, /<p class="text-xs font-semibold text-pf-noyer uppercase tracking-widest mb-1">Studio<\/p>/, 'ligne du loueur inchangée');
  assert.match(html, /<h1 class="font-pf-serif font-normal text-\[26px\] leading-tight text-\[color:var\(--event-accent\)\] text-center">Mariage<\/h1>/);
  assert.ok(html.endsWith('<p class="mt-3 max-w-md text-sm text-pf-muted text-center whitespace-pre-line break-words">Merci d&#x27;être venus !\n&lt;b&gt;Bisous&lt;/b&gt; &lt;script&gt;alert(1)&lt;/script&gt;</p>'), html);
  assert.doesNotMatch(html, /<b>|<script>/);
});

test('en-tête : texte seul (sans couleur ni logo) → logo de l\'instance et titre du site', async () => {
  const Heading = await loadHeading();
  const look = galleryLook(branding({ gallery_text: 'Bienvenue' }));
  const c = { companyName: 'Studio', eventName: 'Mariage', count: 2 };
  const html = render(Heading, { look, ...c });
  assert.ok(html.startsWith(siteHeading(c)));
  assert.ok(html.endsWith('>Bienvenue</p>'));
});

// ── Branchement dans la page ─────────────────────────────────────────────────

const PHOTO = src('../pages/PhotoGallery.jsx');
// Page avec les classes sans réglage remises à la place des expressions : doit redonner les classes du site.
const DEFAULT_PAGE = PHOTO.replace(/\$\{look\.classes\.(\w+)\}/g, (_, k) => {
  assert.ok(k in DEFAULT_GALLERY_CLASSES, k);
  return DEFAULT_GALLERY_CLASSES[k];
}).replace(/look\.classes\.(\w+)/g, (_, k) => `'${DEFAULT_GALLERY_CLASSES[k]}'`);

test('page photo : sans réglage, boutons pleins et onglets avec exactement les classes du site', () => {
  assert.ok(DEFAULT_PAGE.includes(`className={\`${SITE.uploadEmpty}\`}`), 'bouton d\'ajout (galerie vide)');
  assert.ok(DEFAULT_PAGE.includes(`className={\`${SITE.upload}\`}`), 'bouton d\'ajout');
  assert.ok(DEFAULT_PAGE.includes(`className={\`${SITE.selection}\`}`), 'télécharger la sélection');
  assert.ok(DEFAULT_PAGE.includes(SITE.tab), 'onglet actif');
  assert.ok(DEFAULT_PAGE.includes(SITE.tabCount), 'compteur de l\'onglet actif');
  assert.doesNotMatch(PHOTO, /gradient|bg-primary text-white|bg-pf-noyer text-white/, 'plus de classe de bouton plein en dur');
});

test('page photo : habillage lu dans la réponse, variables CSS sur la racine, en-tête partagé', () => {
  assert.match(PHOTO, /bookingBanner: bannerSetting, eventType, branding: brand \}, features\]\)/);
  assert.match(PHOTO, /setBranding\(brand \?\? null\);/);
  assert.match(PHOTO, /useState\(null\);\s+\/\/ habillage/);
  assert.match(PHOTO, /const look = useMemo\(\(\) => galleryLook\(branding\), \[branding\]\);/);
  assert.ok(PHOTO.indexOf('const look = useMemo(') < PHOTO.indexOf("if (status === 'loading')"), 'hook avant les retours anticipés');
  assert.match(PHOTO, /<div className="pola-client pola-pf-page min-h-screen pb-16" style=\{look\.style\}>/);
  assert.match(PHOTO, /<div className="pola-client pola-pf-page min-h-screen flex items-center justify-center px-6" style=\{look\.style\}>\s+<div className="text-center">/);
  assert.equal(PHOTO.match(/<GalleryHeading look=\{look\} companyName=\{companyName\} eventName=\{eventName\} count=\{filtered\.length\} \/>/g).length, 1);
  assert.doesNotMatch(PHOTO, /BrandLogo|dangerouslySetInnerHTML/);
  assert.match(src('./api/photos.js'), /return \{ event, photos: withDownloadUrls\(photos, downloadUrls\), companyName, bookingBanner, eventType, branding \};/);
});
