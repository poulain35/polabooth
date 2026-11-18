// LAB-355 : les écrans de l'éditeur du client parlent en mots simples et suivent le style du site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
// Éditeur découpé (LAB-404) : Editor.jsx puis les fichiers de components/editor/.
const editorDir = new URL('../components/editor/', import.meta.url);
const readEditor = () => [new URL('../components/Editor.jsx', import.meta.url),
  ...readdirSync(editorDir, { recursive: true }).filter((f) => /\.jsx?$/.test(f)).sort()
    .map((f) => new URL(f.replaceAll('\\', '/'), editorDir))]
  .map((url) => readFileSync(url, 'utf8')).join('\n');
// Retire les commentaires (/* */, {/* */} et //) : seuls le code et les textes affichés comptent.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

// Écrans vus seulement par le client (accès par code, formulaire, styles partagés, page de l'éditeur).
const CLIENT_ONLY = {
  'pages/Landing.jsx': stripComments(read('../pages/Landing.jsx')),
  'components/ClientForm.jsx': stripComments(read('../components/ClientForm.jsx')),
  'components/public/clientEditorStyles.js': stripComments(read('../components/public/clientEditorStyles.js')),
  'pages/EditorPage.jsx': stripComments(read('../pages/EditorPage.jsx')),
  // Morceaux de la page de l'éditeur (LAB-404).
  ...Object.fromEntries(readdirSync(new URL('../pages/editor/', import.meta.url)).filter((f) => /\.jsx?$/.test(f)).sort()
    .map((f) => [`pages/editor/${f}`, stripComments(read(`../pages/editor/${f}`))])),
};

test('écrans client : ni indigo, ni violet, ni dégradé', () => {
  for (const [file, src] of Object.entries(CLIENT_ONLY)) {
    assert.doesNotMatch(src, /indigo|violet|purple|#6366f1|#8b5cf6|#a5b4fc|#f0abfc|linear-gradient|bg-gradient-to/i, file);
  }
});

test('écrans client : « template » n’apparaît dans aucun texte affiché', () => {
  for (const [file, src] of Object.entries(CLIENT_ONLY)) {
    // Textes entre guillemets ou entre balises : pas de « template » (les noms de code restent).
    assert.doesNotMatch(src, /['">][^'"<>{}\n]*\b[Tt]emplate\b[^'"<>{}\n]*['"<]/, file);
  }
});

test('éditeur : plus de « Valider votre template », sous-titre de bienvenue lisible', () => {
  const editor = readEditor();
  assert.doesNotMatch(editor, /Valider votre template|Votre template sera/);
  assert.doesNotMatch(editor, /text-primary\/20/);
  assert.doesNotMatch(editor, /to-violet-600/);
  assert.match(editor, /et des décorations\./);
});

test('barre d’outils et décorations : mots simples', () => {
  const toolbar = read('../components/Toolbar.jsx');
  for (const word of ['>Stickers<', '>Rect.<', '>Ctr H<', '>Ctr V<', 'title="Stickers"']) {
    assert.ok(!toolbar.includes(word), word);
  }
  assert.match(toolbar, /ariaLabel="Centrer horizontalement"/);
  assert.match(toolbar, /ariaLabel="Centrer verticalement"/);

  const stickers = read('../components/StickerPanel.jsx');
  assert.doesNotMatch(stickers, /au canvas|Aucun sticker|>Stickers<|✦ Mes stickers/);

  const props = read('../components/PropertiesPanel.jsx');
  assert.doesNotMatch(props, /Fond du canvas|'Sticker'/);
});

test('accent noyer du client : variables redéfinies sous .pola-client', () => {
  const css = read('../index.css');
  assert.match(css, /\.pola-client,\s*\.pola-client \.light-island \{[^}]*--primary: 22\.7 45\.2% 28\.6%;[^}]*--editor-accent: #6A4128;/);
});
