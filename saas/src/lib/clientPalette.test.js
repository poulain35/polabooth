// Pages client (LAB-397) : une seule palette, celle du site (tokens pf / pola), classes globales écrites
// telles quelles. Garde statique : aucune couleur brute de Tailwind, aucun dégradé, aucun emoji.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { sep } from 'node:path';
import { PRIVATE_HISTORY } from '../../scripts/private-history.mjs';

const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
// Éditeur découpé (LAB-404) : Editor.jsx puis les fichiers de components/editor/.
const editorFamily = () => ['../components/Editor.jsx',
  ...readdirSync(new URL('../components/editor/', import.meta.url), { recursive: true })
    .filter((f) => /\.jsx?$/.test(f)).sort().map((f) => `../components/editor/${f.replaceAll('\\', '/')}`)];

// Page de l'éditeur découpée (LAB-404) : EditorPage.jsx puis ses morceaux dans pages/editor/.
const editorPageParts = () => readdirSync(new URL('../pages/editor/', import.meta.url))
  .filter((f) => /\.jsx?$/.test(f)).sort().map((f) => `../pages/editor/${f}`);

const CLIENT_FILES = [
  '../pages/PhotoGallery.jsx',
  '../components/GalleryHeading.jsx',
  '../components/GuestUploader.jsx',
  '../components/ClientFrameBar.jsx',
  '../pages/EditorPage.jsx',
  ...editorPageParts(),
  '../pages/Slideshow.jsx',
  '../components/RouteError.jsx',
  '../components/GalleryBookingBanner.jsx',
  './galleryBranding.js',
  '../pages/Assistance.jsx',
];
// Pages client des modules privés, absentes du dépôt public (LAB-419).
const PRIVATE_CLIENT_FILES = [
  '../modules/audio_guestbook/pages/AudioGallery.jsx',
];

const RAW_PALETTE = /\b(?:[a-z]+:)*(?:bg|text|border|ring|ring-offset|from|via|to|fill|stroke|divide|outline|decoration|shadow|accent|caret|placeholder)-(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;
const EMOJI = /\p{Extended_Pictographic}/u;

for (const rel of [...CLIENT_FILES, ...PRIVATE_CLIENT_FILES]) {
  const skip = PRIVATE_CLIENT_FILES.includes(rel) && PRIVATE_HISTORY;
  test(`${rel} : palette du site seulement, sans dégradé ni emoji`, { skip }, () => {
    const s = src(rel);
    assert.doesNotMatch(s, RAW_PALETTE, 'couleur brute de Tailwind : utiliser les tokens pf / pola / editor');
    assert.doesNotMatch(s, /gradient/i, 'pas de dégradé sur les pages client');
    assert.doesNotMatch(s, EMOJI, 'pas d\'emoji sur les pages client');
  });
}

test('livre d\'or audio : racine noyer sur chaque écran, police du site, roue partagée', { skip: PRIVATE_HISTORY }, () => {
  const s = src('../modules/audio_guestbook/pages/AudioGallery.jsx');
  assert.equal(s.match(/<div className="pola-client pola-pf-page /g)?.length, 4, 'lecteur, chargement, indisponible, erreur');
  assert.match(s, /usePfFonts\(\);/, 'polices du site chargées');
  assert.doesNotMatch(s, /Lexend|font-sans\b/, 'pas la police de l\'admin');
  assert.match(s, /import \{ Spinner \} from '\.\.\/\.\.\/\.\.\/components\/ui\/spinner';/);
  assert.doesNotMatch(s, /\banimate-spin\b/, 'plus de roue recopiée');
  assert.doesNotMatch(s, /className="fixed inset-0 z-50/, 'pas de fenêtre maison');
});

test('page d\'aide : style du site, sans composant ni jeton de l\'admin', () => {
  const s = src('../pages/Assistance.jsx');
  assert.match(s, /const PAGE = 'pola-client pola-pf-page /, 'racine noyer');
  assert.match(s, /usePfFonts\(\);/, 'polices du site chargées');
  const uiImports = [...s.matchAll(/from '\.\.\/components\/(ui|admin)\/([\w-]+)'/g)].map((m) => `${m[1]}/${m[2]}`);
  assert.deepEqual(uiImports, ['ui/spinner'], 'seule la roue partagée vient des composants');
  assert.doesNotMatch(s, /\b(?:bg|text|border|ring)-(?:primary|foreground|muted|card|state-|soft\b|background)/, 'jeton de l\'admin');
});

test('constantes de style : plus aucune chaîne de classes (alias BTN_* / PF_* retirés)', () => {
  for (const rel of ['../components/public/polaStyles.js', '../components/public/clientEditorStyles.js']) {
    const s = src(rel);
    assert.doesNotMatch(s, /export const (?:BTN|PF)_/, `${rel} : alias retiré`);
    assert.doesNotMatch(s, /['"`][^'"`\n]*\bpola-(?:pf-)?(?:btn|link|input|card|label|focus|title)[^'"`\n]*['"`]/, `${rel} : pas de chaîne de classes`);
  }
});

test('alias retirés : aucun fichier de src ne les importe encore', () => {
  const root = new URL('../', import.meta.url);
  const files = readdirSync(root, { recursive: true })
    .map((p) => p.split(sep).join('/'))
    .filter((p) => /\.(?:jsx?|mjs)$/.test(p));
  const importsAlias = /import\s*\{[^}]*\b(?:BTN|PF)_[A-Z_]+[^}]*\}\s*from\s*'[^']*(?:polaStyles|clientEditorStyles)/;
  const offenders = files.filter((p) => importsAlias.test(readFileSync(new URL(p, root), 'utf8')));
  assert.ok(files.length > 100, 'parcours de src');
  assert.deepEqual(offenders, []);
});

test('fenêtres maison remplacées : Dialog et Lightbox', () => {
  assert.match(src('../components/GuestUploader.jsx'), /<Dialog open/);
  assert.match(src('../components/ClientFrameBar.jsx'), /<Dialog open onOpenChange=\{\(open\) => \{ if \(!open && !sending\) onClose\(\); \}\}>/, 'pas de fermeture pendant l\'envoi');
  assert.match(src('../pages/editor/HistoryPanel.jsx'), /<Dialog open onOpenChange=\{\(open\) => \{ if \(!open\) onClose\(\); \}\}>/, 'historique des versions');
  assert.match(src('../pages/PhotoGallery.jsx'), /<Lightbox open onClose=\{closeLightbox\}/);
  for (const rel of ['../components/GuestUploader.jsx', '../components/ClientFrameBar.jsx', '../pages/EditorPage.jsx', ...editorPageParts(), '../pages/PhotoGallery.jsx']) {
    assert.doesNotMatch(src(rel), /className="fixed inset-0 z-50/, `${rel} : plus de fenêtre maison`);
  }
});

test('éditeur et formulaire du client : roue Spinner et classe checkerboard, plus de copie (LAB-419)', () => {
  const files = [
    ...editorFamily(),
    ...['PropertiesPanel', 'StickerPanel', 'TemplatesSidebar', 'ColorInput', 'ClientForm'].map((n) => `../components/${n}.jsx`),
  ];
  for (const name of files) {
    const s = src(name);
    // Seule une icône (Loader2, svg de lucide) tourne encore à la main.
    const spins = s.match(/<(?!Loader2\b)\w+ className="[^"]*\banimate-spin\b[^"]*"/g) ?? [];
    assert.deepEqual(spins, [], `${name} : roue recopiée, utiliser <Spinner />`);
    assert.doesNotMatch(s, /repeating-conic-gradient|linear-gradient\(45deg/, `${name} : damier recopié, utiliser .checkerboard`);
  }
  for (const name of ['StickerPanel', 'ClientForm']) {
    assert.match(src(`../components/${name}.jsx`), /import \{ Spinner \} from '\.\/ui\/spinner';/, name);
  }
  // Éditeur : chaque fichier qui affiche la roue l'importe de ui/spinner, et au moins un l'affiche.
  const withSpinner = editorFamily().filter((rel) => src(rel).includes('<Spinner'));
  assert.ok(withSpinner.length > 0, 'éditeur : aucune roue <Spinner />');
  for (const rel of withSpinner) {
    assert.match(src(rel), /import \{ Spinner \} from '\.\.?\/ui\/spinner';/, rel);
  }
  // Une couleur de bordure passée en className efface le haut transparent dans tailwind-merge : remis.
  assert.match(src('../components/ui/spinner.jsx'), /\/\(\?:\^\|\\s\)border-t-\/\.test\(classes\) \? classes : `\$\{classes\} border-t-transparent`/);
});

test('couleur de marque de l\'événement toujours dynamique (variables CSS)', () => {
  assert.match(src('./galleryBranding.js'), /var\(--event-accent\)/);
});
