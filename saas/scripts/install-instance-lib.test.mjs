import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEATURES } from '../src/features/catalog.js';
import {
  parseEnvFile, validateInstanceEnv, openFunctions, privateCrons, functionSecrets, secretsToSet,
  sha256Hex, parseSecretsList, secretsEnvFile, pickJwtKeys, MissingJwtKeysError, envProductionContent,
  buildVercelJson, vaultUpsertSql, unscheduleSql, sqlLiteral, majorVersion,
  queryRows, parseCliJson, supabaseUrlOf, storageReady, STORAGE_READY_SQL,
} from './install-instance-lib.mjs';
import { resolveKioskConfig } from './kiosk-config.mjs';

const saasDir = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(join(saasDir, 'supabase', 'features.json'), 'utf8'));
// Dépôt public (export open core) : fonctionnalités privées absentes du manifeste et du disque.
const PRIVATE_INSTALLED = existsSync(join(saasDir, 'supabase', 'functions', '_shared', 'modules'));
const functionDirs = readdirSync(join(saasDir, 'supabase', 'functions'))
  .filter((n) => !n.startsWith('_') && !n.startsWith('.') && statSync(join(saasDir, 'supabase', 'functions', n)).isDirectory());

const jwt = (role) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.c2lnbmF0dXJl`;

const validEnv = {
  SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst',
  SUPABASE_DB_PASSWORD: 'motdepasse',
  APP_URL: 'https://photobooth.exemple.fr/',
  COMPANY_NAME: 'Studio Exemple',
  ADMIN_EMAIL: 'Admin@Exemple.fr',
  FROM_EMAIL: 'contact@exemple.fr',
  SMTP_HOST: 'smtp.exemple.fr',
  SMTP_USER: 'contact@exemple.fr',
  SMTP_PASSWORD: 'secret',
  STORAGE_ENDPOINT: 'https://s3.fr-par.scw.cloud/',
  STORAGE_REGION: 'fr-par',
  STORAGE_ACCESS_KEY_ID: 'AK',
  STORAGE_SECRET_ACCESS_KEY: 'SK',
  STORAGE_BUCKET: 'medias',
  STORAGE_PUBLIC_URL: 'https://medias.s3.fr-par.scw.cloud/',
};

test('parseEnvFile : commentaires, export, guillemets, BOM, lignes illisibles', () => {
  const { values, errors } = parseEnvFile([
    '﻿# commentaire',
    '',
    'A=simple # fin de ligne',
    'export B = avec espace',
    "C='litt$ral # pas un commentaire'",
    'D="ligne\\nsuivante \\"citée\\""',
    'E=',
    'ceci est faux',
    "F='non fermé",
    "G='d''apostrophe'",
    "H='ok' # commentaire",
  ].join('\r\n'));
  assert.deepEqual(values, { A: 'simple', B: 'avec espace', C: 'litt$ral # pas un commentaire', D: 'ligne\nsuivante "citée"', E: '', H: 'ok' });
  assert.equal(errors.length, 3);
  assert.match(errors[0], /ligne 8 illisible/);
  assert.match(errors[1], /ligne 9 .*non fermé.*F/);
  assert.match(errors[2], /ligne 10 .*après le guillemet fermant pour G.*guillemets doubles/);
});

test('parseEnvFile lit instance.env.example sans erreur', () => {
  const { values, errors } = parseEnvFile(readFileSync(join(saasDir, 'instance.env.example'), 'utf8'));
  assert.deepEqual(errors, []);
  for (const name of Object.keys(validEnv)) assert.ok(name in values, `${name} absent de instance.env.example`);
  assert.ok('COMPANY_PHONE' in values && 'SMTP_PORT' in values && 'FROM_NAME' in values);
});

test('validateInstanceEnv : configuration valide normalisée', () => {
  const { config, errors } = validateInstanceEnv(validEnv);
  assert.deepEqual(errors, []);
  assert.equal(config.appUrl, 'https://photobooth.exemple.fr');
  assert.equal(config.adminEmail, 'admin@exemple.fr');
  assert.equal(config.smtpPort, '465');
  assert.equal(config.fromName, 'Studio Exemple');
  assert.equal(config.companyPhone, null);
  assert.equal(config.storage.STORAGE_ENDPOINT, 'https://s3.fr-par.scw.cloud');
  assert.equal(config.storage.STORAGE_PUBLIC_URL, 'https://medias.s3.fr-par.scw.cloud');
});

test('validateInstanceEnv : messages clairs pour chaque erreur', () => {
  const { errors } = validateInstanceEnv({
    ...validEnv,
    SUPABASE_PROJECT_REF: 'https://abc.supabase.co',
    SUPABASE_DB_PASSWORD: '',
    APP_URL: 'http://photobooth.exemple.fr',
    ADMIN_EMAIL: 'pas-un-email',
    SMTP_PORT: '587',
    STORAGE_FORCE_PATH_STYLE: 'oui',
    STORAGE_BUCKET: ' ',
  });
  const text = errors.join('\n');
  assert.match(text, /SUPABASE_PROJECT_REF invalide/);
  assert.match(text, /SUPABASE_DB_PASSWORD est vide/);
  assert.match(text, /APP_URL invalide/);
  assert.match(text, /ADMIN_EMAIL invalide/);
  assert.match(text, /SMTP_PORT 587 impossible.*465/);
  assert.match(text, /STORAGE_FORCE_PATH_STYLE invalide/);
  assert.match(text, /STORAGE_BUCKET est vide/);
  assert.equal(errors.length, 7);
});

test('validateInstanceEnv : APP_URL avec un chemin refusée ; mode local sans projet, http accepté', () => {
  assert.match(validateInstanceEnv({ ...validEnv, APP_URL: 'https://x.fr/admin' }).errors.join(), /sans chemin/);
  const local = { ...validEnv, SUPABASE_PROJECT_REF: '', SUPABASE_DB_PASSWORD: '', APP_URL: 'http://localhost:5173' };
  const { config, errors } = validateInstanceEnv(local, { local: true });
  assert.deepEqual(errors, []);
  assert.equal(config.appUrl, 'http://localhost:5173');
  assert.equal(config.projectRef, undefined);
  // Adresse publique du stockage : https hors essai local (kiosk_record_photo refuse une photo en http).
  const httpPublic = { ...validEnv, STORAGE_PUBLIC_URL: 'http://medias.exemple.fr' };
  assert.match(validateInstanceEnv(httpPublic).errors.join(), /STORAGE_PUBLIC_URL invalide.*https/);
  assert.deepEqual(validateInstanceEnv({ ...local, STORAGE_PUBLIC_URL: 'http://127.0.0.1:54321/x' }, { local: true }).errors, []);
});

test('openFunctions : ouvertes du manifeste présentes sur le disque, jamais une privée', () => {
  const { deploy, privateFns, unknown } = openFunctions(manifest, FEATURES, functionDirs);
  assert.deepEqual(unknown, [], 'dossier de fonction absent du manifeste');
  const priv = new Set(FEATURES.filter((f) => f.visibility === 'private').flatMap((f) => manifest.features[f.id]?.functions ?? []));
  for (const fn of deploy) assert.ok(!priv.has(fn), `${fn} est privée`);
  assert.ok(deploy.includes('get-event') && deploy.includes('get-kiosk-upload-url') && deploy.includes('send-delivery'));
  assert.ok(!deploy.includes('prospect-unsubscribe'), 'prospect-unsubscribe est du code privé');
  if (PRIVATE_INSTALLED) assert.ok(privateFns.includes('booking-request') && privateFns.includes('pennylane-sync'));
  else assert.deepEqual(privateFns, []);
  assert.equal(deploy.length + privateFns.length, functionDirs.length);
});

test('openFunctions : dossier inconnu signalé, pas déployé', () => {
  const r = openFunctions(
    { features: { core: { functions: ['a'] }, booking: { functions: ['b'] } } },
    [{ id: 'core', visibility: 'open' }, { id: 'booking', visibility: 'private' }],
    ['b', 'a', 'z'],
  );
  assert.deepEqual(r, { deploy: ['a'], privateFns: ['b'], unknown: ['z'] });
});

test('privateCrons : crons des fonctions privées, sans les purges SQL toujours actives', () => {
  const jobs = privateCrons(manifest, FEATURES);
  assert.deepEqual(jobs, PRIVATE_INSTALLED ? [
    'booking-reminders', 'booking-slot-reminders', 'payment-reconcile', 'pennylane-sync',
    'prospect-follow-up', 'send-balance-invoices',
  ] : []);
  for (const kept of manifest.always_on.crons) assert.ok(!jobs.includes(kept));
});

test('functionSecrets : APP_URL, SMTP, expéditeur, stockage ; variables vides omises', () => {
  const { config } = validateInstanceEnv(validEnv);
  const s = functionSecrets(config);
  assert.equal(s.APP_URL, 'https://photobooth.exemple.fr');
  assert.equal(s.PUBLIC_APP_URL, s.APP_URL);
  assert.equal(s.EMAIL_PROVIDER, 'smtp');
  assert.equal(s.SMTP_PORT, '465');
  assert.equal(s.FROM_NAME, 'Studio Exemple');
  assert.equal(s.STORAGE_BUCKET, 'medias');
  assert.ok(!('STORAGE_PHOTOS_BUCKET' in s) && !('STORAGE_FORCE_PATH_STYLE' in s));
  assert.ok(!Object.keys(s).some((k) => k.startsWith('R2_') || k.startsWith('BREVO')));
});

test('secretsToSet : seuls les secrets absents ou modifiés', () => {
  const desired = { A: '1', B: '2', C: '3' };
  const existing = parseSecretsList([
    { name: 'A', value: sha256Hex('1') },
    { name: 'B', value: sha256Hex('autre').toUpperCase() },
    { name: 'Z', value: 'x' },
  ]);
  assert.deepEqual(secretsToSet(desired, existing), ['B', 'C']);
  assert.deepEqual(secretsToSet(desired, parseSecretsList([{ name: 'A', digest: sha256Hex('1') }])), ['B', 'C']);
  assert.deepEqual(parseSecretsList(null), new Map());
});

test('secretsEnvFile : guillemets simples, $ préservé, refus des valeurs impossibles', () => {
  assert.equal(secretsEnvFile({ A: 'p$ss #1', B: "l'été" }), "A='p$ss #1'\nB=\"l'été\"\n");
  assert.throws(() => secretsEnvFile({ A: "a'$b" }), /à la fois/);
  assert.throws(() => secretsEnvFile({ A: 'a\nb' }), /plusieurs lignes/);
});

test('pickJwtKeys : clés JWT du projet ou du Supabase local, sinon erreur explicite', () => {
  const anon = jwt('anon');
  const sr = jwt('service_role');
  assert.deepEqual(pickJwtKeys([
    { name: 'anon', api_key: anon },
    { name: 'service_role', api_key: sr },
    { name: 'default', api_key: 'sb_publishable_x' },
  ]), { anon, serviceRole: sr });
  assert.deepEqual(pickJwtKeys({ ANON_KEY: anon, SERVICE_ROLE_KEY: sr, PUBLISHABLE_KEY: 'sb_publishable_x' }), { anon, serviceRole: sr });
  assert.throws(
    () => pickJwtKeys([{ name: 'default', api_key: 'sb_publishable_x' }, { name: 'service_role', api_key: sr }]),
    (e) => e instanceof MissingJwtKeysError && /\(anon\)/.test(e.message) && /Legacy API Keys/.test(e.message),
  );
  assert.throws(() => pickJwtKeys([{ name: 'anon', api_key: '' }]), MissingJwtKeysError);
});

test('fichier généré : .env.production (et kiosk-config.json qui en découle)', () => {
  const env = envProductionContent({ supabaseUrl: supabaseUrlOf('abcdefghijklmnopqrst'), anonKey: 'eyJa.b.c', appUrl: 'https://x.fr' });
  assert.match(env, /^VITE_SUPABASE_URL=https:\/\/abcdefghijklmnopqrst\.supabase\.co$/m);
  assert.match(env, /^VITE_SUPABASE_ANON_KEY=eyJa\.b\.c$/m);
  assert.match(env, /^VITE_APP_URL=https:\/\/x\.fr$/m);
  assert.match(env, /^VITE_EMAIL_PROVIDER=smtp$/m);
  assert.match(env, /^VITE_GOOGLE_CLIENT_ID=$/m, 'jamais l’identifiant Google d’un .env resté dans le dossier');
  assert.match(env, /^KIOSK_SUPABASE_URL=https:\/\/abcdefghijklmnopqrst\.supabase\.co$/m);
  assert.match(env, /^KIOSK_SUPABASE_ANON_KEY=eyJa\.b\.c$/m);
  const anon = jwt('anon');
  const parsed = parseEnvFile(envProductionContent({ supabaseUrl: 'https://r.supabase.co', anonKey: anon, appUrl: 'https://x.fr' }));
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(JSON.parse(resolveKioskConfig(parsed.values).content), { supabaseUrl: 'https://r.supabase.co', supabaseAnonKey: anon });
});

test('buildVercelJson : CSP pointée sur le projet et le stockage de l\'instance', () => {
  const base = JSON.parse(readFileSync(join(saasDir, 'vercel.json'), 'utf8'));
  const out = JSON.parse(buildVercelJson(base, {
    supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
    mediaUrls: ['https://medias.s3.fr-par.scw.cloud/x', 'https://s3.fr-par.scw.cloud', 'https://medias.s3.fr-par.scw.cloud'],
  }));
  assert.deepEqual(out.rewrites, base.rewrites);
  const csp = out.headers.flatMap((b) => b.headers).find((h) => /content-security-policy-report-only/i.test(h.key)).value;
  // Aucun autre projet Supabase (ref de 20 lettres ou joker) ni stockage R2 que ceux de l'instance.
  assert.doesNotMatch(csp, /\/\/(?!abcdefghijklmnopqrst\.)[\w*-]+\.supabase\.co|r2\.dev|r2\.cloudflarestorage/);
  assert.match(csp, /connect-src[^;]*https:\/\/abcdefghijklmnopqrst\.supabase\.co[^;]*wss:\/\/abcdefghijklmnopqrst\.supabase\.co/);
  assert.match(csp, /img-src[^;]*https:\/\/medias\.s3\.fr-par\.scw\.cloud/);
  const connect = csp.split(';').find((d) => d.trim().startsWith('connect-src'));
  assert.equal(connect.split('abcdefghijklmnopqrst.supabase.co').length - 1, 2, 'origines dédoublonnées');
});

test('buildVercelJson : joker *.supabase.co (vercel.json du dépôt public) remplacé par le projet', () => {
  const base = { headers: [{ source: '/(.*)', headers: [{
    key: 'Content-Security-Policy-Report-Only',
    value: "default-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co; img-src 'self' https://*.supabase.co",
  }] }] };
  const out = JSON.parse(buildVercelJson(base, { supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co', mediaUrls: [] }));
  assert.equal(out.headers[0].headers[0].value,
    "default-src 'self'; connect-src 'self' https://abcdefghijklmnopqrst.supabase.co wss://abcdefghijklmnopqrst.supabase.co; img-src 'self' https://abcdefghijklmnopqrst.supabase.co");
});

test('SQL : littéraux échappés, Vault en une requête, unschedule relançable', () => {
  assert.equal(sqlLiteral("l'été"), "'l''été'");
  const vault = vaultUpsertSql({ project_url: 'https://r.supabase.co', service_role_key: "k'ey" });
  assert.match(vault, /\('project_url', 'https:\/\/r\.supabase\.co'\), \('service_role_key', 'k''ey'\)/);
  assert.match(vault, /vault\.create_secret\(w\.value, w\.name\)/);
  assert.match(vault, /vault\.update_secret\(e\.id, w\.value\)/);
  assert.doesNotMatch(vault, /;/);
  const unschedule = unscheduleSql(['a', 'b']);
  assert.match(unschedule, /from cron\.job where jobname in \('a', 'b'\)/);
  assert.doesNotMatch(unschedule, /;/);
  assert.equal(unscheduleSql([]), null, 'dépôt public : aucune tâche privée, pas de « in () »');
});

test('divers : versions, sorties JSON de la CLI', () => {
  assert.equal(majorVersion('3.0.0'), 3);
  assert.equal(majorVersion('v20.11.1'), 20);
  assert.equal(majorVersion('supabase version 3.1.2\n'), 3);
  assert.equal(majorVersion('?'), null);
  assert.deepEqual(queryRows([{ a: 1 }]), [{ a: 1 }]);
  assert.deepEqual(queryRows({ boundary: 'x', rows: [{ a: 1 }] }), [{ a: 1 }]);
  assert.deepEqual(queryRows(null), []);
  assert.deepEqual(parseCliJson('Connecting...\n[{"a":1}]'), [{ a: 1 }]);
  assert.throws(() => parseCliJson('rien'), /JSON attendue/);
});

test('storageReady : tables du service Storage créées ou pas encore (projet neuf)', () => {
  assert.match(STORAGE_READY_SQL, /to_regclass\('storage\.objects'\)/);
  assert.equal(storageReady([{ ready: true }]), true);
  assert.equal(storageReady([{ ready: 't' }]), true);
  assert.equal(storageReady([{ ready: false }]), false);
  assert.equal(storageReady([{ ready: null }]), false);
  assert.equal(storageReady([]), false);
  assert.equal(storageReady(undefined), false);
});
