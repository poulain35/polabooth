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
  accessTokenError, ACCESS_TOKEN_URL, CLI_VERSION, cliCommand, REDIRECTS_CONTENT, AUTH_EMAIL_TEMPLATES,
  mergeUriAllowList, buildAuthConfigPatch, changedAuthFields, describeAuthPatch, managementApiMessage,
  ManagementApiError, createManagementApi, configureAuth, ensureLegacyKeys, INSTALL_STEPS, stepLabel,
} from './install-instance-lib.mjs';
import { resolveKioskConfig } from './kiosk-config.mjs';

const saasDir = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(join(saasDir, 'supabase', 'features.json'), 'utf8'));
// Dépôt public (export open core) : fonctionnalités privées absentes du manifeste et du disque.
const PRIVATE_INSTALLED = existsSync(join(saasDir, 'supabase', 'functions', '_shared', 'modules'));
const functionDirs = readdirSync(join(saasDir, 'supabase', 'functions'))
  .filter((n) => !n.startsWith('_') && !n.startsWith('.') && statSync(join(saasDir, 'supabase', 'functions', n)).isDirectory());

const jwt = (role) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.c2lnbmF0dXJl`;

const TOKEN = 'sbp_' + '0123456789abcdef'.repeat(2) + '01234567';

const validEnv = {
  SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst',
  SUPABASE_DB_PASSWORD: 'motdepasse',
  SUPABASE_ACCESS_TOKEN: TOKEN,
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
  const local = { ...validEnv, SUPABASE_PROJECT_REF: '', SUPABASE_DB_PASSWORD: '', SUPABASE_ACCESS_TOKEN: '', APP_URL: 'http://localhost:5173' };
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
  if (PRIVATE_INSTALLED) assert.ok(privateFns.includes('booking-request') && privateFns.includes('prospect-follow-up'));
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
  // Crons de la facturation tirés du manifeste : le module privé les nomme (LAB-403).
  const invoicing = manifest.features.invoicing?.crons ?? [];
  assert.deepEqual(jobs, PRIVATE_INSTALLED
    ? ['booking-reminders', 'booking-slot-reminders', 'prospect-follow-up', ...invoicing].sort()
    : []);
  if (PRIVATE_INSTALLED) assert.equal(invoicing.length, 3);
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

// ── LAB-375 : jeton, Supabase Auth par l'API de gestion, CLI par npx, _redirects, étapes ──────

test('jeton Supabase : obligatoire hors --local, format sbp_, repli sur la variable d\'environnement, jamais affiché', () => {
  assert.equal(accessTokenError(TOKEN), null);
  assert.equal(accessTokenError(`sbp_oauth_${'a'.repeat(40)}`), null);
  assert.match(accessTokenError(''), /SUPABASE_ACCESS_TOKEN est vide.*dashboard\/account\/tokens/);
  const bad = 'sbp_secret-mal-copie';
  assert.match(accessTokenError(bad), /SUPABASE_ACCESS_TOKEN invalide.*sbp_/);
  assert.ok(!accessTokenError(bad).includes(bad), 'le jeton ne doit jamais apparaître');
  assert.equal(validateInstanceEnv(validEnv).config.accessToken, TOKEN);
  const without = { ...validEnv, SUPABASE_ACCESS_TOKEN: '' };
  const missing = validateInstanceEnv(without).errors.join('\n');
  assert.match(missing, /SUPABASE_ACCESS_TOKEN est vide/);
  assert.ok(missing.includes(ACCESS_TOKEN_URL));
  const other = 'sbp_' + 'f'.repeat(40);
  assert.deepEqual(validateInstanceEnv(without, { fallbackToken: other }).errors, []);
  assert.equal(validateInstanceEnv(without, { fallbackToken: other }).config.accessToken, other);
  assert.equal(validateInstanceEnv(validEnv, { fallbackToken: other }).config.accessToken, TOKEN, 'instance.env passe avant');
  const local = validateInstanceEnv({ ...without, APP_URL: 'http://localhost:5173' }, { local: true });
  assert.deepEqual(local.errors, []);
  assert.equal(local.config.accessToken, undefined);
});

test('CLI par npx à la version de la CI', () => {
  assert.deepEqual(cliCommand(['db', 'push']), { command: 'npx', args: ['--yes', `supabase@${CLI_VERSION}`, 'db', 'push'] });
  assert.match(CLI_VERSION, /^3\.\d+\.\d+$/);
  const workflow = join(saasDir, '..', '.github', 'workflows', 'deploy-edge-functions.yml');
  // Dépôt public : pas de workflow, rien à comparer.
  if (existsSync(workflow)) {
    const pinned = readFileSync(workflow, 'utf8').match(/setup-cli@v\d+\s+with:\s+version:\s*([\d.]+)/)?.[1];
    assert.equal(CLI_VERSION, pinned, 'même version de la CLI que la CI');
  }
});

test('_redirects : toute adresse renvoie index.html', () => {
  assert.equal(REDIRECTS_CONTENT, '/* /index.html 200\n');
});

test('étapes : « Étape n/N : … », identifiants uniques, Auth avant le compte administrateur', () => {
  const ids = INSTALL_STEPS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(stepLabel('prerequisites'), `Étape 1/${ids.length} : Prérequis`);
  assert.equal(stepLabel('next'), `Étape ${ids.length}/${ids.length} : Il vous reste à faire`);
  assert.ok(ids.indexOf('auth') < ids.indexOf('admin'), 'SMTP et modèles réglés avant l\'invitation');
  assert.ok(ids.indexOf('config') < ids.indexOf('auth'));
  assert.throws(() => stepLabel('inconnue'), /inconnue/);
  assert.equal(stepLabel('b', [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]), 'Étape 2/2 : B');
});

test('mergeUriAllowList : entrées existantes gardées, sans doublon', () => {
  assert.equal(mergeUriAllowList('', ['https://x.fr/**']), 'https://x.fr/**');
  assert.equal(mergeUriAllowList(null, ['https://x.fr/**']), 'https://x.fr/**');
  assert.equal(mergeUriAllowList('http://localhost:3000, https://x.fr/**', ['https://x.fr/**']), 'http://localhost:3000,https://x.fr/**');
  assert.equal(mergeUriAllowList('https://a.fr/**,,', ['https://x.fr/**']), 'https://a.fr/**,https://x.fr/**');
});

test('buildAuthConfigPatch : adresse, redirections, SMTP, mot de passe, emails en français', () => {
  const { config } = validateInstanceEnv({ ...validEnv, FROM_NAME: 'Studio', SMTP_PORT: '465' });
  const { body, keptTemplates } = buildAuthConfigPatch(config, { uri_allow_list: 'https://ancien.fr/**', password_min_length: 6 });
  assert.equal(body.site_url, 'https://photobooth.exemple.fr');
  assert.equal(body.uri_allow_list, 'https://ancien.fr/**,https://photobooth.exemple.fr/**');
  assert.equal(body.smtp_host, 'smtp.exemple.fr');
  assert.equal(body.smtp_port, '465', 'smtp_port est une chaîne dans l\'API');
  assert.equal(body.smtp_user, 'contact@exemple.fr');
  assert.equal(body.smtp_pass, 'secret');
  assert.equal(body.smtp_admin_email, 'contact@exemple.fr');
  assert.equal(body.smtp_sender_name, 'Studio');
  assert.equal(body.password_min_length, 8);
  for (const kind of ['invite', 'recovery', 'reauthentication']) {
    assert.equal(body[`mailer_subjects_${kind}`], AUTH_EMAIL_TEMPLATES[kind].subject);
    assert.equal(body[`mailer_templates_${kind}_content`], AUTH_EMAIL_TEMPLATES[kind].content);
  }
  assert.match(body.mailer_templates_invite_content, /\{\{ \.ConfirmationURL \}\}/);
  assert.match(body.mailer_templates_recovery_content, /\{\{ \.ConfirmationURL \}\}/);
  assert.match(body.mailer_templates_reauthentication_content, /\{\{ \.Token \}\}/);
  assert.deepEqual(keptTemplates, []);
  assert.equal(buildAuthConfigPatch(config, { password_min_length: 12 }).body.password_min_length, 12, 'jamais baissée');
  assert.equal(buildAuthConfigPatch(config).body.password_min_length, 8);
});

test('buildAuthConfigPatch : inscriptions fermées, même si le projet les ouvrait (LAB-392)', () => {
  const { config } = validateInstanceEnv(validEnv);
  for (const current of [{}, { disable_signup: false }, { disable_signup: true }]) {
    assert.equal(buildAuthConfigPatch(config, current).body.disable_signup, true);
  }
  assert.ok(changedAuthFields({ disable_signup: false }, { disable_signup: true }).includes('disable_signup'));
  assert.ok(!changedAuthFields({ disable_signup: true }, { disable_signup: true }).includes('disable_signup'));
  const { body } = buildAuthConfigPatch(config);
  assert.match(describeAuthPatch(body).join('\n'), /Inscriptions : fermées/);
});

test('buildAuthConfigPatch : modèle d\'origine (anglais) remplacé, modèle personnalisé gardé', () => {
  const { config } = validateInstanceEnv(validEnv);
  const { body, keptTemplates } = buildAuthConfigPatch(config, {
    mailer_subjects_invite: 'You have been invited',
    mailer_subjects_recovery: 'Mon sujet à moi',
    mailer_subjects_reauthentication: AUTH_EMAIL_TEMPLATES.reauthentication.subject,
  });
  assert.equal(body.mailer_subjects_invite, AUTH_EMAIL_TEMPLATES.invite.subject);
  assert.ok(!('mailer_subjects_recovery' in body) && !('mailer_templates_recovery_content' in body));
  assert.equal(body.mailer_subjects_reauthentication, AUTH_EMAIL_TEMPLATES.reauthentication.subject);
  assert.deepEqual(keptTemplates, ['recovery']);
  assert.match(describeAuthPatch(body, { keptTemplates }).join('\n'), /personnalisés gardés tels quels : mot de passe oublié/);
});

test('buildAuthConfigPatch : projet neuf (sujets réels de Supabase, indicateurs à false) entièrement remplacé', () => {
  const { config } = validateInstanceEnv(validEnv);
  const fresh = {
    mailer_subjects_invite: "You've been invited",
    mailer_subjects_recovery: 'Reset your password',
    mailer_subjects_reauthentication: '{{ .Token }} is your verification code',
  };
  const withFlags = {
    ...fresh,
    mailer_subjects_custom_contents: {
      MAILER_SUBJECTS_INVITE: false, MAILER_SUBJECTS_RECOVERY: false, MAILER_SUBJECTS_REAUTHENTICATION: false,
    },
  };
  for (const current of [fresh, withFlags]) {
    const { body, keptTemplates } = buildAuthConfigPatch(config, current);
    assert.deepEqual(keptTemplates, []);
    for (const kind of Object.keys(AUTH_EMAIL_TEMPLATES)) {
      assert.equal(body[`mailer_subjects_${kind}`], AUTH_EMAIL_TEMPLATES[kind].subject);
    }
  }
});

test('buildAuthConfigPatch : l\'indicateur de Supabase prime sur le sujet', () => {
  const { config } = validateInstanceEnv(validEnv);
  const { body, keptTemplates } = buildAuthConfigPatch(config, {
    mailer_subjects_invite: 'Sujet inconnu mais non personnalisé',
    mailer_subjects_recovery: 'Mon sujet à moi',
    mailer_subjects_custom_contents: { MAILER_SUBJECTS_INVITE: false, MAILER_SUBJECTS_RECOVERY: true },
  });
  assert.equal(body.mailer_subjects_invite, AUTH_EMAIL_TEMPLATES.invite.subject);
  assert.ok(!('mailer_subjects_recovery' in body));
  assert.deepEqual(keptTemplates, ['recovery']);
});

test('changedAuthFields et describeAuthPatch : différences en texte, jamais le mot de passe SMTP', () => {
  const { config } = validateInstanceEnv({ ...validEnv, SMTP_PASSWORD: 'tres-secret' });
  const { body } = buildAuthConfigPatch(config);
  assert.deepEqual(changedAuthFields({ ...body, smtp_port: 465 }, body), [], '465 et « 465 » sont égaux');
  assert.deepEqual(changedAuthFields({ ...body, site_url: 'http://localhost:3000' }, body), ['site_url']);
  assert.equal(changedAuthFields({}, body).length, Object.keys(body).length);
  const text = describeAuthPatch(body).join('\n');
  assert.ok(!text.includes('tres-secret'));
  assert.match(text, /Adresse du site : https:\/\/photobooth\.exemple\.fr/);
  assert.match(text, /smtp\.exemple\.fr:465/);
  assert.match(text, /8 caractères minimum/);
  assert.match(text, /Emails en français : invitation, mot de passe oublié, code de confirmation/);
});

/** Faux fetch : rejoue les réponses prévues dans l'ordre et note les appels. */
function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    const { status = 200, body = null } = next ?? {};
    return { ok: status >= 200 && status < 300, status, text: async () => (body === null ? '' : JSON.stringify(body)) };
  };
  return { impl, calls };
}

const REF = 'abcdefghijklmnopqrst';
const apiWith = (responses) => {
  const fake = fakeFetch(responses);
  return { api: createManagementApi({ fetch: fake.impl, token: TOKEN, ref: REF }), calls: fake.calls };
};

test('createManagementApi : adresse, jeton en en-tête, corps JSON', async () => {
  const { api, calls } = apiWith([{ body: { ok: 1 } }, { status: 204 }]);
  assert.deepEqual(await api('GET', '/config/auth'), { ok: 1 });
  assert.equal(await api('PATCH', '/config/auth', { a: 1 }), null);
  assert.equal(calls[0].url, `https://api.supabase.com/v1/projects/${REF}/config/auth`);
  assert.equal(calls[0].headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(calls[0].body, undefined);
  assert.equal(calls[1].method, 'PATCH');
  assert.equal(calls[1].headers['Content-Type'], 'application/json');
  assert.deepEqual(calls[1].body, { a: 1 });
});

test('createManagementApi : erreurs en français, jamais le jeton', async () => {
  const cases = [
    [401, /Jeton Supabase refusé.*dashboard\/account\/tokens/],
    [403, /n'a pas les droits sur le projet abcdefghijklmnopqrst/],
    [404, /Projet abcdefghijklmnopqrst introuvable.*SUPABASE_PROJECT_REF/],
    [429, /Attendez une minute/],
    [500, /GET \/config\/auth a échoué \(500 : panne\)/],
  ];
  for (const [status, re] of cases) {
    const { api } = apiWith([{ status, body: { message: 'panne' } }]);
    await assert.rejects(api('GET', '/config/auth'), (e) => e instanceof ManagementApiError && e.status === status && re.test(e.message) && !e.message.includes(TOKEN));
  }
  const { api } = apiWith([new Error('getaddrinfo ENOTFOUND')]);
  await assert.rejects(api('GET', '/config/auth'), (e) => e instanceof ManagementApiError && /injoignable.*connexion Internet/.test(e.message));
  assert.match(managementApiMessage({ status: 502, method: 'PUT', path: '/api-keys/legacy?enabled=true', ref: REF, detail: 'x'.repeat(500) }), /PUT \/api-keys\/legacy a échoué \(502 : x{300}\)/);
});

test('configureAuth : GET puis PATCH complet s\'il y a une différence', async () => {
  const { config } = validateInstanceEnv(validEnv);
  const { api, calls } = apiWith([{ body: { site_url: 'http://localhost:3000', uri_allow_list: 'http://localhost:3000' } }, { body: {} }]);
  const res = await configureAuth(api, config);
  assert.equal(res.applied, true);
  assert.deepEqual(calls.map((c) => c.method), ['GET', 'PATCH']);
  assert.deepEqual(calls[1].body, res.body);
  assert.equal(calls[1].body.uri_allow_list, 'http://localhost:3000,https://photobooth.exemple.fr/**');
});

test('configureAuth : simulation sans PATCH ; rien envoyé si déjà à jour', async () => {
  const { config } = validateInstanceEnv(validEnv);
  const dry = apiWith([{ body: {} }]);
  const res = await configureAuth(dry.api, config, { dryRun: true });
  assert.equal(res.applied, false);
  assert.ok(res.changed.length > 0);
  assert.deepEqual(dry.calls.map((c) => c.method), ['GET']);
  const upToDate = apiWith([{ body: buildAuthConfigPatch(config).body }]);
  const again = await configureAuth(upToDate.api, config);
  assert.deepEqual(again.changed, []);
  assert.equal(again.applied, false);
  assert.equal(upToDate.calls.length, 1);
});

test('configureAuth : jeton refusé, arrêt avant tout PATCH', async () => {
  const { config } = validateInstanceEnv(validEnv);
  const { api, calls } = apiWith([{ status: 401, body: { message: 'Unauthorized' } }]);
  await assert.rejects(configureAuth(api, config), /Jeton Supabase refusé/);
  assert.equal(calls.length, 1);
});

test('ensureLegacyKeys : déjà actives, activées, simulation, point d\'accès retiré', async () => {
  let t = apiWith([{ body: { enabled: true } }]);
  assert.equal(await ensureLegacyKeys(t.api), 'enabled');
  assert.equal(t.calls.length, 1);

  t = apiWith([{ body: { enabled: false } }, { body: { enabled: true } }]);
  assert.equal(await ensureLegacyKeys(t.api), 'enabled-now');
  assert.equal(t.calls[1].method, 'PUT');
  assert.equal(t.calls[1].url, `https://api.supabase.com/v1/projects/${REF}/api-keys/legacy?enabled=true`);

  t = apiWith([{ body: { enabled: false } }]);
  assert.equal(await ensureLegacyKeys(t.api, { dryRun: true }), 'would-enable');
  assert.equal(t.calls.length, 1);

  t = apiWith([{ status: 404, body: { message: 'Not Found' } }]);
  assert.equal(await ensureLegacyKeys(t.api), 'unavailable');

  t = apiWith([{ status: 401 }]);
  await assert.rejects(ensureLegacyKeys(t.api), /Jeton Supabase refusé/);
});
