import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  DEFAULT_THEME_CHOICE, THEME_CHOICES, THEME_LABELS, THEME_STORAGE_KEY, UNTHEMED_ADMIN_PATHS,
  ADMIN_UI_CLASS, bootThemeIsDark, hasStoredSession, isAdminAreaPath, isAdminUiPath, isImmersiveEditorPath,
  isProductScreenPath,
  isSessionThemedPath, isThemeChoice, isThemedPath, readThemeChoice, resolveTheme, writeThemeChoice,
} from './theme.js';
import { RESET_PASSWORD_PATH } from './passwordRules.js';

const memoryStorage = (initial = {}) => {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    get length() { return Object.keys(data).length; },
    key: (i) => Object.keys(data)[i] ?? null,
  };
};
const throwingStorage = {
  getItem: () => { throw new Error('SecurityError'); },
  setItem: () => { throw new Error('QuotaExceededError'); },
};

test('choix : Clair, Sombre, Système ; Système par défaut', () => {
  assert.deepEqual(THEME_CHOICES, ['light', 'dark', 'system']);
  assert.deepEqual(Object.keys(THEME_LABELS), THEME_CHOICES);
  assert.equal(DEFAULT_THEME_CHOICE, 'system');
  assert.equal(THEME_STORAGE_KEY, 'pola-admin-theme');
  for (const c of THEME_CHOICES) assert.equal(isThemeChoice(c), true);
  for (const c of [null, undefined, '', 'auto', 'Dark', 1]) assert.equal(isThemeChoice(c), false);
});

test('readThemeChoice : valeur enregistrée, sinon Système', () => {
  assert.equal(readThemeChoice(memoryStorage({ [THEME_STORAGE_KEY]: 'dark' })), 'dark');
  assert.equal(readThemeChoice(memoryStorage({ [THEME_STORAGE_KEY]: 'light' })), 'light');
  assert.equal(readThemeChoice(memoryStorage({ [THEME_STORAGE_KEY]: 'system' })), 'system');
  assert.equal(readThemeChoice(memoryStorage({ [THEME_STORAGE_KEY]: 'bleu' })), 'system');
  assert.equal(readThemeChoice(memoryStorage()), 'system');
  assert.equal(readThemeChoice(null), 'system');
  assert.equal(readThemeChoice(undefined), 'system');
  assert.equal(readThemeChoice(throwingStorage), 'system');
});

test('writeThemeChoice : enregistre un choix valide, ne jette jamais', () => {
  const s = memoryStorage();
  assert.equal(writeThemeChoice(s, 'dark'), true);
  assert.equal(s.data[THEME_STORAGE_KEY], 'dark');
  assert.equal(writeThemeChoice(s, 'nuit'), false);
  assert.equal(s.data[THEME_STORAGE_KEY], 'dark');
  assert.equal(writeThemeChoice(null, 'dark'), false);
  assert.equal(writeThemeChoice(throwingStorage, 'light'), false);
});

test('resolveTheme : Système suit la préférence, les autres choix l\'imposent', () => {
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('inconnu', true), 'dark');
  assert.equal(resolveTheme(undefined, false), 'light');
});

const THEMED = [
  '/admin', '/admin/', '/admin/aujourdhui', '/admin/events', '/admin/events/123?tab=borne',
  '/admin/events/0f8fad5b-d9cb-469f-a165-70867728950e', '/admin/bornes', '/admin/reglages/',
  '/admin/templates', '/admin/ecrans-borne', '/admin/prospects/12', '/admin/ventes',
];
// Éditeurs plein écran : toujours clairs (portails hors des îlots clairs).
const EDITORS = [
  '/admin/templates/new', '/admin/templates/new/', '/admin/templates/abc/edit', '/admin/ecrans-borne/home',
  '/admin/ecrans-borne/result/',
];
const UNTHEMED = [
  '/', '/e/TUQNA5', '/photos/TUQNA5', '/slideshow/TUQNA5', '/rapport/abc', '/reservation/abc', '/cgl',
  '/audio/TUQNA5', '/aide', '/aide/TUQNA5', '/associer', '/admin/login', '/admin/login/', RESET_PASSWORD_PATH,
  '/admin/demandes/12', '/admin/demandes/12/preuve', '/administration', '/adminx/events', '', null,
  ...EDITORS,
];

test('isThemedPath : pages de l\'admin sous le menu seulement', () => {
  for (const p of THEMED) assert.equal(isThemedPath(p.split('?')[0]), true, p);
  for (const p of UNTHEMED) assert.equal(isThemedPath(p), false, String(p));
  assert.ok(UNTHEMED_ADMIN_PATHS.includes(RESET_PASSWORD_PATH), 'page du lien de réinitialisation');
});

test('isImmersiveEditorPath : éditeur de cadre photo et écrans de la borne seulement', () => {
  for (const p of EDITORS) assert.equal(isImmersiveEditorPath(p), true, p);
  for (const p of ['/admin/templates', '/admin/templates/abc', '/admin/ecrans-borne', '/admin/events/new',
    '/admin/bornes', '/e/TUQNA5', null]) {
    assert.equal(isImmersiveEditorPath(p), false, String(p));
  }
});

test('isAdminAreaPath : admin hors connexion et nouveau mot de passe', () => {
  assert.equal(isAdminAreaPath('/admin/events'), true);
  assert.equal(isAdminAreaPath('/admin/demandes/12'), true);
  assert.equal(isAdminAreaPath('/admin/login'), false);
  assert.equal(isAdminAreaPath(RESET_PASSWORD_PATH), false);
  assert.equal(isAdminAreaPath('/e/TUQNA5'), false);
  assert.equal(isAdminAreaPath(undefined), false);
});

// Script en ligne de index.html : exécuté avec un faux document, il doit donner la même chose que
// isThemedPath + readThemeChoice + resolveTheme, pour chaque chemin et chaque état du stockage.
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const bootScript = html.match(/<script id="admin-theme-boot">([\s\S]*?)<\/script>/)?.[1];

const SESSION_KEY = 'sb-abcdefghijklmnopqrst-auth-token';
const storageOf = ({ stored, session = false, storageThrows = false }) => (storageThrows ? throwingStorage : memoryStorage({
  ...(stored ? { [THEME_STORAGE_KEY]: stored } : {}),
  ...(session ? { [SESSION_KEY]: '{}' } : {}),
}));

function bootClasses(pathname, { stored, session, prefersDark, storageThrows = false, noMatchMedia = false }) {
  const classes = new Set();
  const window = {
    localStorage: storageOf({ stored, session, storageThrows }),
    matchMedia: noMatchMedia ? undefined : (q) => ({ matches: q === '(prefers-color-scheme: dark)' && prefersDark }),
  };
  const document = { documentElement: { classList: { add: (c) => classes.add(c) } } };
  vm.runInNewContext(bootScript, { window, document, location: { pathname } });
  return classes;
}
const runBoot = (pathname, state) => bootClasses(pathname, state).has('dark');

test('index.html : script contre le flash présent, avant les feuilles de style', () => {
  assert.ok(bootScript, 'script #admin-theme-boot');
  assert.ok(html.indexOf('admin-theme-boot') < html.indexOf('rel="stylesheet"'));
  assert.ok(bootScript.includes(`'${THEME_STORAGE_KEY}'`), 'même clé de stockage');
});

test('index.html : même règle que theme.js (chemins, choix, préférence système)', () => {
  const states = [
    { stored: undefined, prefersDark: true }, { stored: undefined, prefersDark: false },
    { stored: 'dark', prefersDark: false }, { stored: 'light', prefersDark: true },
    { stored: 'system', prefersDark: true }, { stored: 'bleu', prefersDark: true },
    { storageThrows: true, prefersDark: true }, { stored: 'system', prefersDark: true, noMatchMedia: true },
  ];
  for (const p of [...THEMED.map((x) => x.split('?')[0]), ...UNTHEMED.filter((x) => typeof x === 'string' && x)]) {
    for (const base of states) {
      for (const st of [base, { ...base, session: true }]) {
        const expected = bootThemeIsDark(p, storageOf(st), st.noMatchMedia ? false : st.prefersDark);
        assert.equal(runBoot(p, st), expected, `${p} ${JSON.stringify(st)}`);
      }
    }
  }
});

// Thème de l'admin (LAB-363) : classe admin-ui sur tout l'admin, écrans d'accès et éditeurs compris.
const ADMIN_UI = [
  ...THEMED.map((x) => x.split('?')[0]), ...EDITORS, '/associer', '/associer/', '/admin/login', '/admin/login/',
  RESET_PASSWORD_PATH, '/admin/demandes/12', '/admin/demandes/12/',
];
const NOT_ADMIN_UI = [
  '/', '/e/TUQNA5', '/photos/TUQNA5', '/slideshow/TUQNA5', '/rapport/abc', '/reservation/abc', '/cgl',
  '/audio/TUQNA5', '/aide', '/aide/', '/aide/TUQNA5', '/aide/TUQNA5/', '/aide/TUQNA5/x', '/aidex', '/desinscription/abc', '/administration', '/adminx/events',
  '/associer/x', '/admin/demandes/12/preuve', '/admin/demandes/12/preuve/', '',
];

test('isAdminUiPath : tout l’admin et l’association d’une borne, jamais une page client (aide comprise)', () => {
  assert.equal(ADMIN_UI_CLASS, 'admin-ui');
  for (const p of ADMIN_UI) assert.equal(isAdminUiPath(p), true, p);
  for (const p of [...NOT_ADMIN_UI, null, undefined]) assert.equal(isAdminUiPath(p), false, String(p));
});

test('index.html : classe admin-ui posée selon la même règle, quel que soit le thème', () => {
  const states = [
    { prefersDark: false }, { stored: 'dark', prefersDark: false }, { stored: 'light', prefersDark: true, session: true },
    { storageThrows: true, prefersDark: true }, { prefersDark: true, noMatchMedia: true },
  ];
  for (const p of [...ADMIN_UI, ...NOT_ADMIN_UI.filter(Boolean)]) {
    for (const st of states) {
      assert.equal(bootClasses(p, st).has(ADMIN_UI_CLASS), isAdminUiPath(p), `${p} ${JSON.stringify(st)}`);
    }
  }
  const login = bootClasses('/admin/login', { stored: 'dark', prefersDark: true });
  assert.deepEqual([...login], [ADMIN_UI_CLASS], 'connexion : palette de l’admin, jamais en sombre');
  const editor = bootClasses('/admin/templates/new', { stored: 'dark', prefersDark: true });
  assert.deepEqual([...editor], [ADMIN_UI_CLASS], 'éditeur plein écran : clair');
  const request = bootClasses('/admin/demandes/12', { stored: 'dark', prefersDark: true });
  assert.deepEqual([...request], [ADMIN_UI_CLASS], 'lien signé sans session : palette claire de l’admin');
  const help = bootClasses('/aide/TUQNA5', { stored: 'dark', prefersDark: true, session: true });
  assert.equal(help.size, 0, 'page d’aide : style du site, aucune classe de l’admin');
  assert.equal(bootClasses('/e/TUQNA5', { stored: 'dark', prefersDark: true }).size, 0, 'page client : aucune classe');
});

test('demande ouverte avec une session : thème posé dès le chargement (pas d’éclair clair)', () => {
  assert.equal(isSessionThemedPath('/admin/demandes/12'), true);
  assert.equal(isSessionThemedPath('/admin/demandes/12/'), true);
  assert.equal(isSessionThemedPath('/admin/demandes/12/preuve'), false);
  assert.equal(isSessionThemedPath('/admin/events/12'), false);
  assert.equal(hasStoredSession(memoryStorage({ [SESSION_KEY]: '{}' })), true);
  assert.equal(hasStoredSession(memoryStorage({ 'sb-x-auth-token-code-verifier': '1' })), false);
  assert.equal(hasStoredSession(memoryStorage({ [THEME_STORAGE_KEY]: 'dark' })), false);
  assert.equal(hasStoredSession(throwingStorage), false);
  assert.equal(hasStoredSession(null), false);
  const dark = { stored: 'dark', prefersDark: false };
  assert.equal(runBoot('/admin/demandes/12', { ...dark, session: true }), true);
  assert.equal(runBoot('/admin/demandes/12', dark), false, 'lien signé sans session : page claire');
  assert.equal(runBoot('/admin/demandes/12/preuve', { ...dark, session: true }), false, 'preuve imprimable : claire');
  assert.equal(runBoot('/admin/demandes/12', { stored: 'light', prefersDark: true, session: true }), false);
});

test('isProductScreenPath : chargement Polabooth sur les écrans du logiciel, jamais l’aide ni une page client', () => {
  for (const p of ['/admin', '/admin/', '/admin/aujourdhui', '/admin/login', '/admin/nouveau-mot-de-passe',
    '/admin/events/12', '/admin/demandes/12', '/admin/templates/new', '/associer']) {
    assert.equal(isProductScreenPath(p), true, p);
  }
  for (const p of ['/', '/aide', '/aide/', '/aide/TUQNA5', '/e/TUQNA5', '/photos/TUQNA5', '/slideshow/TUQNA5',
    '/reservation/abc', '/rapport/abc', '/admin/demandes/12/preuve', '/administration', '', null, undefined]) {
    assert.equal(isProductScreenPath(p), false, String(p));
  }
});
