// Tests de la page docs/guide-installation.html (LAB-377) : sa logique pure (bloc <script id="guide-lib">)
// est exécutée hors navigateur, et le fichier instance.env qu'elle produit est relu par le script d'installation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { parseEnvFile, validateInstanceEnv } from './install-instance-lib.mjs';

const saasDir = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(new URL('../../docs/guide-installation.html', import.meta.url), 'utf8');

function extractLib() {
  const m = html.match(/<script id="guide-lib">([\s\S]*?)<\/script>/);
  assert.ok(m, 'bloc <script id="guide-lib"> introuvable');
  return m[1];
}

function loadLib() {
  const context = vm.createContext({ URL });
  vm.runInContext(`${extractLib()}\nthis.GuideLib = GuideLib;`, context);
  return context.GuideLib;
}

const L = loadLib();

const VALID = {
  SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst',
  SUPABASE_ACCESS_TOKEN: 'sbp_' + '0123456789abcdef'.repeat(3).slice(0, 40),
  SUPABASE_DB_PASSWORD: 'p@ss w0rd#"quoted" \'apostrophe\' $HOME \\n`x`',
  APP_URL: 'https://photobooth.example.fr',
  COMPANY_NAME: "L'Atelier Photo & Co",
  COMPANY_PHONE: '02 99 00 00 00',
  ADMIN_EMAIL: 'Admin@Example.fr',
  SMTP_HOST: 'smtp.example.fr',
  SMTP_PORT: '465',
  SMTP_USER: 'contact@example.fr',
  SMTP_PASSWORD: 'smtp pass #1',
  FROM_EMAIL: 'contact@example.fr',
  FROM_NAME: 'Atelier "Photo"',
  STORAGE_ENDPOINT: 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com',
  STORAGE_REGION: 'auto',
  STORAGE_ACCESS_KEY_ID: 'AKIA0123',
  STORAGE_SECRET_ACCESS_KEY: 'sec/ret+key=',
  STORAGE_BUCKET: 'medias',
  STORAGE_PUBLIC_URL: 'https://medias.example.fr',
  STORAGE_PHOTOS_BUCKET: '',
  STORAGE_PHOTOS_PUBLIC_URL: '',
  STORAGE_FORCE_PATH_STYLE: '',
};

const exampleKeys = () => Object.keys(parseEnvFile(readFileSync(`${saasDir}/instance.env.example`, 'utf8')).values);

test('les champs de la page couvrent instance.env.example plus SUPABASE_ACCESS_TOKEN', () => {
  const pageKeys = L.FIELDS.map((f) => f.key);
  assert.equal(new Set(pageKeys).size, pageKeys.length, 'clé en double');
  const expected = [...new Set([...exampleKeys(), 'SUPABASE_ACCESS_TOKEN'])].sort();
  assert.deepEqual([...pageKeys].sort(), expected);
});

test('les champs secrets sont déclarés et marqués comme tels', () => {
  assert.deepEqual([...L.SECRET_KEYS].sort(), [
    'SMTP_PASSWORD', 'STORAGE_ACCESS_KEY_ID', 'STORAGE_SECRET_ACCESS_KEY', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD',
  ]);
  for (const f of L.FIELDS) assert.equal(f.secret, L.SECRET_KEYS.includes(f.key), f.key);
});

test('le fichier instance.env produit est relu à l\'identique et accepté par le script', () => {
  const text = L.buildInstanceEnv(VALID, '18/11/2026 10:00:00');
  const { values, errors } = parseEnvFile(text);
  assert.deepEqual(errors, []);
  for (const f of L.FIELDS) assert.equal(values[f.key], VALID[f.key], f.key);
  const result = validateInstanceEnv(values);
  assert.deepEqual(result.errors, []);
  assert.equal(result.config.adminEmail, 'admin@example.fr');
  assert.equal(result.config.appUrl, 'https://photobooth.example.fr');
  assert.equal(L.validate(VALID).errors.length, 0);
});

test('chaque forme de valeur traverse le lecteur du script', () => {
  const samples = ['simple', 'a b', 'a#b', ' a #b', "l'apostrophe", 'les "guillemets"', `l'un et "l'autre"`,
    'back\\slash', 'fin\\', '\\n littéral', '$VAR', '`cmd`', 'é à ç €', ''];
  for (const sample of samples) {
    const { values, errors } = parseEnvFile(`X=${L.formatValue(sample)}\n`);
    assert.deepEqual(errors, [], sample);
    assert.equal(values.X, sample.trim(), sample);
  }
  assert.throws(() => L.formatValue('deux\nlignes'));
});

test('la validation de la page suit celle du script', () => {
  const cases = [
    { SUPABASE_PROJECT_REF: 'ABC' },
    { SUPABASE_PROJECT_REF: '' },
    { SUPABASE_DB_PASSWORD: '' },
    { APP_URL: 'http://photobooth.example.fr' },
    { APP_URL: 'https://photobooth.example.fr/admin' },
    { APP_URL: 'photobooth.example.fr' },
    { COMPANY_NAME: '' },
    { ADMIN_EMAIL: 'pas-un-email' },
    { FROM_EMAIL: '' },
    { SMTP_HOST: '' },
    { SMTP_PORT: '587' },
    { SMTP_PORT: '25' },
    { SMTP_PORT: 'abc' },
    { SMTP_PORT: '70000' },
    { SMTP_PORT: '' },
    { SMTP_USER: '' },
    { SMTP_PASSWORD: '' },
    { STORAGE_ENDPOINT: 'ftp://x' },
    { STORAGE_ENDPOINT: 'http://localhost:9000' },
    { STORAGE_ACCESS_KEY_ID: '' },
    { STORAGE_SECRET_ACCESS_KEY: '' },
    { STORAGE_BUCKET: '' },
    { STORAGE_PUBLIC_URL: 'http://medias.example.fr' },
    { STORAGE_PUBLIC_URL: 'https://medias.example.fr/' },
    { STORAGE_PHOTOS_PUBLIC_URL: 'http://photos.example.fr' },
    { STORAGE_FORCE_PATH_STYLE: 'oui' },
    { STORAGE_FORCE_PATH_STYLE: 'TRUE' },
    { FROM_NAME: '', COMPANY_PHONE: '', STORAGE_REGION: '' },
  ];
  for (const change of cases) {
    const values = { ...VALID, ...change };
    const page = L.validate(values).errors.length > 0;
    const script = validateInstanceEnv(parseEnvFile(L.buildInstanceEnv(values)).values).errors.length > 0;
    assert.equal(page, script, JSON.stringify(change));
  }
  assert.ok(L.validate({ ...VALID, SUPABASE_ACCESS_TOKEN: '' }).errors.some((e) => e.key === 'SUPABASE_ACCESS_TOKEN'));
});

test('aucun secret n\'est mémorisé dans le stockage du navigateur', () => {
  const writes = [];
  const storage = {
    setItem: (key, value) => writes.push([key, value]),
    getItem: () => (writes.length ? writes.at(-1)[1] : null),
    removeItem: () => {},
  };
  const fields = { ...VALID };
  assert.equal(L.saveState(storage, { os: 'mac', done: { outils: true, code: false }, fields, cfAccount: 'abc' }), true);
  assert.equal(writes.length, 1);
  const [key, raw] = writes[0];
  assert.equal(key, L.STORAGE_KEY);
  const stored = JSON.parse(raw);
  for (const secret of L.SECRET_KEYS) {
    assert.ok(!(secret in stored.fields), `${secret} mémorisé`);
    assert.ok(!raw.includes(VALID[secret]), `valeur de ${secret} mémorisée`);
  }
  assert.equal(stored.fields.APP_URL, VALID.APP_URL);
  assert.deepEqual(stored.done, { outils: true });
  // Un ancien enregistrement contenant un secret est nettoyé à la lecture.
  writes.push([L.STORAGE_KEY, JSON.stringify({ fields: { SMTP_PASSWORD: 'x', COMPANY_NAME: 'A' } })]);
  assert.deepEqual({ ...L.loadState(storage).fields }, { COMPANY_NAME: 'A' });
  // Stockage indisponible : pas d'exception.
  assert.equal(L.saveState({ setItem: () => { throw new Error('quota'); } }, {}), false);
});

test('la page n\'écrit dans le stockage du navigateur que par saveState', () => {
  const calls = html.match(/\.setItem\s*\(/g) || [];
  assert.equal(calls.length, 1, 'un seul appel à setItem attendu');
  assert.match(extractLib(), /function saveState\(storage, state\) \{\s*try \{\s*storage\.setItem\(STORAGE_KEY, JSON\.stringify\(persistable\(state\)\)\)/);
  assert.doesNotMatch(html, /sessionStorage|indexedDB|document\.cookie/);
});

test('les liens et commandes ne reprennent aucun secret', () => {
  const vars = L.templateVars(VALID, { cfAccount: '0123456789ABCDEF0123456789abcdef', saasDir: 'C:\\polabooth\\saas' });
  assert.equal(vars.REF, 'abcdefghijklmnopqrst');
  assert.equal(vars.APP_URL, 'https://photobooth.example.fr');
  assert.equal(vars.APP_HOST, 'photobooth.example.fr');
  assert.equal(vars.CF_ACCOUNT, '0123456789abcdef0123456789abcdef');
  for (const secret of L.SECRET_KEYS) {
    assert.ok(!Object.values(vars).includes(VALID[secret]), secret);
  }
  assert.equal(L.fill('https://supabase.com/dashboard/project/{REF}/settings/api-keys', vars, true),
    'https://supabase.com/dashboard/project/abcdefghijklmnopqrst/settings/api-keys');
  assert.equal(L.fill('{APP_URL}/admin/login', {}, true), null);
  assert.equal(L.fill('cd "{SAAS_DIR}"', {}), 'cd "<dossier saas>"');
});

test('identifiant du projet extrait d\'une adresse collée', () => {
  assert.equal(L.extractRef('https://abcdefghijklmnopqrst.supabase.co'), 'abcdefghijklmnopqrst');
  assert.equal(L.extractRef('https://supabase.com/dashboard/project/abcdefghijklmnopqrst/settings/general'), 'abcdefghijklmnopqrst');
  assert.equal(L.extractRef('https://supabase.com/dashboard/project/abcdefghijklmnopqrst'), 'abcdefghijklmnopqrst');
  assert.equal(L.extractRef('  abcdefghijklmnopqrst '), 'abcdefghijklmnopqrst');
  assert.equal(L.extractRef('autre chose'), 'autre chose');
});

test('dossier saas déduit de l\'adresse de la page', () => {
  assert.equal(L.saasDirFromHref('file:///C:/Users/Jean%20Dupont/polabooth/docs/guide-installation.html'), 'C:\\Users\\Jean Dupont\\polabooth\\saas');
  assert.equal(L.saasDirFromHref('file:///home/jean/polabooth/docs/guide-installation.html#etape-code'), '/home/jean/polabooth/saas');
  assert.equal(L.saasDirFromHref('file:///home/jean/Téléchargements/guide-installation.html'), null);
  assert.equal(L.saasDirFromHref('https://example.fr/docs/guide-installation.html'), null);
});

test('chaque étape a sa case « Fait » et chaque commande un bloc copiable', () => {
  const steps = [...html.matchAll(/data-step="([a-z-]+)"/g)].map((m) => m[1]);
  const boxes = [...html.matchAll(/data-done="([a-z-]+)"/g)].map((m) => m[1]);
  assert.ok(steps.length >= 10);
  assert.deepEqual(boxes, steps);
  assert.match(html, /winget install OpenJS\.NodeJS\.LTS Git\.Git/);
  assert.match(html, /installer\.cmd/);
  assert.match(html, /installer\.sh/);
  assert.match(html, /navigator\.clipboard/);
  assert.match(html, /execCommand\('copy'\)/);
  // Hors ligne : aucun script externe (seule la police est facultative).
  assert.doesNotMatch(html, /<script[^>]+src=/);
});
