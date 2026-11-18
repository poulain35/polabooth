// Installe (ou met à jour) une instance du SaaS sur un projet Supabase vide (open core étape 2, lot I2).
// Usage : npm run install-instance [-- --dry-run] — guide : docs/installation-instance.md.
// Relançable : chaque étape vérifie l'existant (Auth, migrations, secrets, Vault, crons, compte, organisation).
// CLI Supabase lancée par npx (version épinglée) ; jeton SUPABASE_ACCESS_TOKEN de instance.env passé à la CLI
// et à l'API de gestion (réglages Auth, anciennes clés), jamais affiché. --local : jamais d'API de gestion.
// Aucun secret en argument de commande : mot de passe par variable d'environnement, secrets et SQL par
// fichiers temporaires effacés à la fin. La clé service_role ne sert qu'ici, jamais dans un fichier du front.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { FEATURES } from '../src/features/catalog.js';
import {
  CLI_VERSION, GENERATED_ONCE, MIN_NODE_MAJOR, ManagementApiError, MissingJwtKeysError, REDIRECTS_CONTENT,
  buildVercelJson, cliCommand, configureAuth, createManagementApi, describeAuthPatch, ensureLegacyKeys,
  envProductionContent, functionSecrets, majorVersion, openFunctions, parseCliJson, parseEnvFile,
  parseSecretsList, pickJwtKeys, privateCrons, queryRows, secretsEnvFile, secretsToSet, STORAGE_READY_SQL,
  stepLabel, storageReady, supabaseUrlOf, unscheduleSql, validateInstanceEnv, vaultUpsertSql,
} from './install-instance-lib.mjs';
import { CHECK_SYMBOLS, checksSummaryLine, checksVerdict, runChecks } from './install-instance-checks.mjs';

const SAAS_DIR = fileURLToPath(new URL('..', import.meta.url));
const isWindows = process.platform === 'win32';

class InstallError extends Error {}

const USAGE = `Installation d'une instance du SaaS photobooth.

  npm run install-instance [-- options]

Options :
  --dry-run              Affiche ce qui serait fait, sans rien modifier (ni Supabase, ni fichiers) ;
                         les vérifications envoient quand même l'email et le fichier de test.
  --config <fichier>     Fichier de configuration (défaut : saas/instance.env).
  --skip-build           Ne construit pas le site (dossier dist/).
  --skip-email-test      Vérifications : connexion à la messagerie sans envoyer l'email de test.
  --skip-checks          Saute les vérifications de la messagerie et du stockage (déconseillé).
  --new-admin-password   Donne un nouveau mot de passe au compte administrateur et l'affiche.
  --local                Supabase local (tests) : clés lues par « supabase status », secrets et fonctions
                         seulement affichés, réglages Auth de supabase/config.toml (pas d'API de gestion).
  --workdir <dossier>    Dossier contenant supabase/ pour la CLI (défaut : saas/).
  --help                 Cette aide.

Guide : docs/installation-instance.md`;

// ── Affichage ───────────────────────────────────────────────────────────────────────────────

const warnings = [];
const color = (code) => (text) => (process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text);
const bold = color('1');
const green = color('32');
const yellow = color('33');
const red = color('31');
const step = (id) => console.log(`\n${bold(stepLabel(id))}`);
const ok = (text) => console.log(`   ${green('✓')} ${text}`);
const info = (text) => console.log(`   ${text}`);
const warn = (text) => { warnings.push(text); console.log(`   ${yellow('!')} ${text}`); };
const plan = (text) => console.log(`   ${yellow('[simulation]')} ${text}`);

// ── CLI supabase (par npx, version épinglée) ────────────────────────────────────────────────

const quoteArg = (arg) => (/[\s"&|<>^()%!]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg);

function makeCli({ workdir, env }) {
  return function cli(args, { json = false, inherit = false, allowFail = false, extraEnv = {} } = {}) {
    const fullArgs = [...args, '--workdir', workdir, '--agent', 'no', ...(json ? ['-o', 'json'] : [])];
    const options = {
      cwd: SAAS_DIR,
      env: { ...env, ...extraEnv },
      encoding: 'utf8',
      stdio: inherit ? ['ignore', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    };
    const { command, args: commandArgs } = cliCommand(fullArgs);
    const res = isWindows
      ? spawnSync([command, ...commandArgs.map(quoteArg)].join(' '), { ...options, shell: true })
      : spawnSync(command, commandArgs, options);
    if (res.error) {
      throw new InstallError(res.error.code === 'ENOENT'
        ? 'npx est introuvable : installez Node.js (npm et npx sont inclus) depuis https://nodejs.org, puis relancez.'
        : `supabase ${args[0]} : ${res.error.message}`);
    }
    if (res.status !== 0) {
      if (allowFail) return null;
      const detail = inherit ? '(voir les messages ci-dessus)' : (res.stderr || res.stdout || '').trim().split('\n').slice(-6).join('\n   ');
      throw new InstallError(`La commande « supabase ${args.slice(0, 2).join(' ')} » a échoué :\n   ${detail}`);
    }
    return json ? parseCliJson(res.stdout) : res.stdout;
  };
}

// ── API Supabase (Auth admin, REST) avec la clé service_role ──────────────────────────────────

function makeApi(baseUrl, serviceKey) {
  return async function api(method, path, body, extraHeaders = {}) {
    let res;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          ...extraHeaders,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new InstallError(`Supabase injoignable (${baseUrl}) : ${e.message}`);
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const message = data?.msg || data?.message || data?.error_description || data?.error || text;
      const err = new InstallError(`${method} ${path.split('?')[0]} : ${res.status} ${message}`);
      err.status = res.status;
      throw err;
    }
    return data;
  };
}

// ── Étapes ──────────────────────────────────────────────────────────────────────────────────

function checkPrerequisites(cli) {
  step('prerequisites');
  const nodeMajor = majorVersion(process.version);
  if (nodeMajor < MIN_NODE_MAJOR) {
    throw new InstallError(`Node.js ${MIN_NODE_MAJOR} ou plus récent est nécessaire (installé : ${process.version}). Téléchargez la version LTS sur https://nodejs.org.`);
  }
  ok(`Node.js ${process.version}`);
  info(`CLI Supabase ${CLI_VERSION} par npx (téléchargée la première fois, une minute environ)…`);
  let version;
  try {
    version = cli(['--version']).trim();
  } catch (e) {
    throw new InstallError(`La CLI Supabase n'a pas pu être lancée par npx (supabase@${CLI_VERSION}). Vérifiez la connexion Internet, puis relancez.\n   ${e.message}`);
  }
  ok(`CLI Supabase ${version}`);
}

function readConfig(opts) {
  step('config');
  if (!existsSync(opts.envFile)) {
    throw new InstallError(`Fichier introuvable : ${opts.envFile}\n   Copiez saas/instance.env.example en saas/instance.env, remplissez-le, puis relancez.`);
  }
  const { values, errors: parseErrors } = parseEnvFile(readFileSync(opts.envFile, 'utf8'));
  const { values: known } = parseEnvFile(readFileSync(join(SAAS_DIR, 'instance.env.example'), 'utf8'));
  for (const name of Object.keys(values)) {
    if (!(name in known)) warn(`${name} n'est pas une variable connue (faute de frappe ?) : elle est ignorée.`);
  }
  const { config, errors } = validateInstanceEnv(values, { local: opts.local, fallbackToken: process.env.SUPABASE_ACCESS_TOKEN });
  const all = [...parseErrors, ...errors];
  if (all.length) {
    throw new InstallError(`${opts.envFile} contient ${all.length} erreur(s) :\n${all.map((e) => `   - ${e}`).join('\n')}`);
  }
  ok(`${opts.envFile} lu`);
  info(`SaaS : ${config.appUrl} · entreprise : ${config.companyName} · administrateur : ${config.adminEmail}`);
  if (!opts.local) {
    info(`Projet Supabase : ${config.projectRef}`);
    info(`Jeton Supabase : ${values.SUPABASE_ACCESS_TOKEN?.trim() ? 'lu dans instance.env' : 'variable d\'environnement SUPABASE_ACCESS_TOKEN'} (masqué)`);
  }
  return config;
}

async function setupAuth(api, config, opts) {
  step('auth');
  if (opts.local) {
    info('Supabase local : réglages lus dans supabase/config.toml, API de gestion non utilisée.');
    return;
  }
  const { body, changed, keptTemplates } = await configureAuth(api, config, { dryRun: opts.dryRun });
  ok(`Jeton accepté, projet ${config.projectRef} trouvé`);
  const lines = describeAuthPatch(body, { keptTemplates });
  if (!changed.length) {
    ok('Réglages déjà à jour :');
    lines.forEach((line) => info(`  ${line}`));
  } else if (opts.dryRun) {
    plan(`Réglages à poser (${changed.length} champ(s) à modifier) :`);
    lines.forEach((line) => plan(`  ${line}`));
  } else {
    ok(`Réglages posés (${changed.length} champ(s) modifié(s)) :`);
    lines.forEach((line) => info(`  ${line}`));
  }
}

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const STORAGE_WAIT_MS = 20 * 60 * 1000;
const STORAGE_POLL_MS = 20 * 1000;

/**
 * Projet neuf : la base répond plusieurs minutes avant que le service Storage ait créé ses tables
 * (jusqu'à un quart d'heure constaté). Les migrations touchent storage.objects : on attend.
 */
function waitForStorage(cli, config, opts, tmp) {
  const isReady = () => storageReady(runSql(cli, config, opts, tmp, STORAGE_READY_SQL));
  if (isReady()) return;
  info("Le service Storage du projet démarre encore (projet tout neuf) : attente, jusqu'à 20 minutes…");
  const start = Date.now();
  while (Date.now() - start < STORAGE_WAIT_MS) {
    sleepSync(STORAGE_POLL_MS);
    if (isReady()) {
      ok(`Storage prêt (après ${Math.round((Date.now() - start) / 60000)} min)`);
      return;
    }
  }
  throw new InstallError("Le service Storage du projet Supabase n'est toujours pas prêt. Attendez quelques minutes puis relancez le script ; si ça dure, relancez le projet (Project Settings > General > Restart project).");
}

function pushDatabase(cli, config, opts, tmp) {
  step('database');
  const remote = opts.local ? [] : [`--remote=${config.projectRef}`, '--yes'];
  const passwordEnv = opts.local ? {} : { SUPABASE_DB_PASSWORD: config.dbPassword };
  if (opts.dryRun) {
    if (!opts.local) {
      plan(`supabase link --project-ref ${config.projectRef}`);
      plan("attente du service Storage si le projet vient d'être créé");
    }
    plan(`supabase db push ${remote.join(' ')}`.trim());
    return;
  }
  if (!opts.local) {
    cli(['link', '--project-ref', config.projectRef], { inherit: true, extraEnv: passwordEnv });
    ok(`Dossier lié au projet ${config.projectRef}`);
    waitForStorage(cli, config, opts, tmp);
  }
  cli(['db', 'push', ...remote], { inherit: true, extraEnv: passwordEnv });
  ok('Migrations appliquées');
}

async function enableLegacyKeys(api, opts) {
  const state = await ensureLegacyKeys(api, { dryRun: opts.dryRun });
  if (state === 'enabled') ok('Anciennes clés API (anon, service_role) déjà actives');
  else if (state === 'would-enable') plan('activation des anciennes clés API (anon, service_role)');
  else if (state === 'enabled-now') ok('Anciennes clés API (anon, service_role) activées');
  else info('Activation automatique des anciennes clés indisponible : si elles manquent, le message suivant explique quoi faire.');
}

async function fetchKeys(cli, api, config, opts) {
  step('keys');
  if (!opts.local) await enableLegacyKeys(api, opts);
  if (opts.dryRun) {
    plan(opts.local ? 'supabase status (clés anon et service_role)' : `supabase projects api-keys --remote=${config.projectRef} --reveal`);
    return { supabaseUrl: opts.local ? 'http://127.0.0.1:54321' : supabaseUrlOf(config.projectRef), anon: 'eyJ…', serviceRole: 'eyJ…' };
  }
  let supabaseUrl;
  let json;
  if (opts.local) {
    json = cli(['status'], { json: true, allowFail: true });
    if (!json?.API_URL) throw new InstallError(`Supabase local non démarré : lancez « npx supabase@${CLI_VERSION} start --workdir ${opts.workdir} » (Docker nécessaire).`);
    supabaseUrl = json.API_URL;
  } else {
    json = cli(['projects', 'api-keys', `--remote=${config.projectRef}`, '--reveal'], { json: true });
    supabaseUrl = supabaseUrlOf(config.projectRef);
  }
  try {
    const keys = pickJwtKeys(json);
    ok(`Clés anon et service_role (JWT) récupérées pour ${supabaseUrl}`);
    return { supabaseUrl, ...keys };
  } catch (e) {
    if (e instanceof MissingJwtKeysError) throw new InstallError(e.message);
    throw e;
  }
}

function setFunctionSecrets(cli, config, keys, opts, tmp) {
  step('secrets');
  const desired = functionSecrets(config);
  if (opts.local || opts.dryRun) {
    plan(`supabase secrets set (${Object.keys(desired).length} secrets) : ${Object.keys(desired).join(', ')}`);
    plan(`${GENERATED_ONCE.join(', ')} : valeur aléatoire posée une seule fois`);
  } else {
    const existing = parseSecretsList(cli(['secrets', 'list', `--remote=${config.projectRef}`], { json: true }));
    for (const name of GENERATED_ONCE) {
      if (!existing.has(name)) desired[name] = randomBytes(32).toString('hex');
    }
    const names = secretsToSet(desired, existing);
    if (!names.length) {
      ok('Secrets des fonctions déjà à jour');
    } else {
      const file = join(tmp, 'secrets.env');
      writeFileSync(file, secretsEnvFile(Object.fromEntries(names.map((n) => [n, desired[n]]))), { mode: 0o600 });
      cli(['secrets', 'set', `--remote=${config.projectRef}`, '--env-file', file, '--yes']);
      rmSync(file, { force: true });
      ok(`Secrets posés : ${names.join(', ')}`);
    }
  }

  const vault = { project_url: keys.supabaseUrl, service_role_key: keys.serviceRole };
  if (opts.dryRun) {
    plan(`Vault : project_url = ${vault.project_url}, service_role_key = clé service_role (créés ou mis à jour)`);
    return;
  }
  const rows = runSql(cli, config, opts, tmp, vaultUpsertSql(vault));
  if (!rows.length) ok('Vault : project_url et service_role_key déjà à jour');
  for (const row of rows) ok(`Vault : ${row.name} ${row.action === 'cree' ? 'créé' : 'mis à jour'}`);
}

function runSql(cli, config, opts, tmp, sql) {
  const file = join(tmp, `query-${randomBytes(4).toString('hex')}.sql`);
  writeFileSync(file, sql, { mode: 0o600 });
  try {
    const remote = opts.local ? [] : [`--remote=${config.projectRef}`, '--yes'];
    return queryRows(cli(['db', 'query', '-f', file, ...remote], { json: true, extraEnv: opts.local ? {} : { SUPABASE_DB_PASSWORD: config.dbPassword } }));
  } finally {
    rmSync(file, { force: true });
  }
}

function deployFunctions(cli, config, opts) {
  step('functions');
  const manifest = JSON.parse(readFileSync(join(SAAS_DIR, 'supabase', 'features.json'), 'utf8'));
  const functionsDir = join(SAAS_DIR, 'supabase', 'functions');
  const dirs = readdirSync(functionsDir).filter((n) => !n.startsWith('_') && !n.startsWith('.') && statSync(join(functionsDir, n)).isDirectory());
  const { deploy, privateFns, unknown } = openFunctions(manifest, FEATURES, dirs);
  for (const name of unknown) warn(`Fonction ${name} absente de supabase/features.json : non déployée.`);
  info(`${deploy.length} fonctions ouvertes ; ${privateFns.length} fonctions privées ignorées.`);
  const args = ['functions', 'deploy', ...deploy, `--remote=${opts.local ? '<projet>' : config.projectRef}`, '--use-api', '--yes'];
  if (opts.local || opts.dryRun) {
    plan(`supabase ${args.join(' ')}`);
    return;
  }
  cli(args, { inherit: true });
  ok(`${deploy.length} fonctions déployées (vérification JWT selon supabase/config.toml)`);
}

function unscheduleCrons(cli, config, opts, tmp) {
  step('crons');
  const manifest = JSON.parse(readFileSync(join(SAAS_DIR, 'supabase', 'features.json'), 'utf8'));
  const jobs = privateCrons(manifest, FEATURES);
  const sql = unscheduleSql(jobs);
  if (!sql) {
    ok('Aucune (pas de fonctionnalité privée)');
    return;
  }
  if (opts.dryRun) {
    plan(`cron.unschedule : ${jobs.join(', ')}`);
    return;
  }
  const removed = runSql(cli, config, opts, tmp, sql).map((r) => r.jobname);
  if (removed.length) ok(`Retirées : ${removed.join(', ')}`);
  else ok('Déjà retirées');
}

async function findUserByEmail(api, email) {
  for (let page = 1; page < 100; page++) {
    const data = await api('GET', `/auth/v1/admin/users?page=${page}&per_page=200`);
    const users = data?.users ?? [];
    const found = users.find((u) => (u.email ?? '').toLowerCase() === email);
    if (found) return found;
    if (users.length < 200) return null;
  }
  return null;
}

const newPassword = () => randomBytes(12).toString('base64url');

async function createAdmin(config, keys, opts) {
  step('admin');
  if (opts.dryRun) {
    plan(`Compte ${config.adminEmail} : invitation par email + mot de passe généré (invitation renvoyée si elle n'est pas encore acceptée, rien si le compte est confirmé)`);
    plan(`Organisation « ${config.companyName} » dont il est propriétaire (rien si elle existe) ; administrateur de l'application`);
    return null;
  }
  const api = makeApi(keys.supabaseUrl, keys.serviceRole);
  let user = await findUserByEmail(api, config.adminEmail);
  let password = null;
  let invited = false;

  if (!user) {
    // Mot de passe posé à la création, avant l'invitation : le modifier ensuite effacerait le lien de l'email.
    password = newPassword();
    user = await api('POST', '/auth/v1/admin/users', { email: config.adminEmail, password });
    ok(`Compte ${config.adminEmail} créé`);
  } else if (opts.newAdminPassword) {
    password = newPassword();
    user = await api('PUT', `/auth/v1/admin/users/${user.id}`, { password, email_confirm: true });
    ok(`Compte ${config.adminEmail} : nouveau mot de passe, adresse confirmée`);
  }

  if (user.email_confirmed_at) {
    if (!password) ok(`Compte ${config.adminEmail} déjà créé (mot de passe oublié : relancez avec --new-admin-password)`);
  } else {
    // Invitation pas encore acceptée (email perdu, mauvais réglage SMTP corrigé depuis) : chaque relance la
    // renvoie, avec le mot de passe déjà donné. Supabase accepte de réinviter une adresse non confirmée.
    const resend = Boolean(user.invited_at);
    try {
      await api('POST', `/auth/v1/invite?redirect_to=${encodeURIComponent(`${config.appUrl}/admin`)}`, { email: config.adminEmail });
      invited = true;
      ok(resend
        ? `Invitation renvoyée à ${config.adminEmail} (pas encore acceptée ; mot de passe inchangé, affiché à la première installation)`
        : `Invitation envoyée à ${config.adminEmail}`);
    } catch (e) {
      warn(`Invitation non envoyée (${e.message}). Adresse confirmée sans email : vérifiez les réglages SMTP de instance.env (voir le guide), puis relancez.`);
      await api('PUT', `/auth/v1/admin/users/${user.id}`, { email_confirm: true });
    }
  }

  const mine = await api('GET', `/rest/v1/organizations?owner_id=eq.${user.id}&select=id,name`);
  if (mine.length) {
    ok(`Organisation « ${mine[0].name} » déjà créée`);
  } else {
    const others = await api('GET', '/rest/v1/organizations?select=id,name&limit=1');
    if (others.length) {
      warn(`Une organisation existe déjà (« ${others[0].name} ») avec un autre propriétaire : aucune nouvelle organisation créée. ADMIN_EMAIL a-t-il changé ?`);
    } else {
      const [org] = await api('POST', '/rest/v1/organizations', {
        owner_id: user.id,
        name: config.companyName,
        notify_email: config.adminEmail,
        contact_company: config.companyName,
        contact_email: config.adminEmail,
        contact_phone: config.companyPhone,
      }, { Prefer: 'return=representation' });
      ok(`Organisation « ${org.name} » créée`);
    }
  }

  await api('POST', '/rest/v1/app_admins?on_conflict=user_id', { user_id: user.id }, { Prefer: 'resolution=ignore-duplicates,return=minimal' });
  ok('Administrateur de l\'application (licences des bornes, clés des services)');
  return { password, invited };
}

function writeFrontFiles(config, keys, opts) {
  step('front');
  const envFile = join(SAAS_DIR, '.env.production');
  if (opts.dryRun) {
    plan(`${envFile} (adresse Supabase, clé anon, adresse du SaaS ; clé anon JWT de kiosk-config.json)`);
    return;
  }
  writeFileSync(envFile, envProductionContent({ supabaseUrl: keys.supabaseUrl, anonKey: keys.anon, appUrl: config.appUrl }));
  ok(envFile);
}

function buildSite(config, keys, opts) {
  step('build');
  if (opts.skipBuild) { info('Ignorée (--skip-build).'); return; }
  if (opts.dryRun) { plan('VITE_PRIVATE_MODULES=none npm run build → dist/ (+ dist/kiosk-config.json, dist/vercel.json, dist/_redirects)'); return; }
  for (const name of ['.env.local', '.env.production.local']) {
    if (existsSync(join(SAAS_DIR, name))) warn(`${name} existe et remplace les valeurs de .env.production : vérifiez son contenu.`);
  }
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(VITE|KIOSK)_/.test(name)));
  const options = { cwd: SAAS_DIR, env: { ...env, VITE_PRIVATE_MODULES: 'none' }, stdio: 'inherit' };
  const res = isWindows ? spawnSync('npm run build', { ...options, shell: true }) : spawnSync('npm', ['run', 'build'], options);
  if (res.status !== 0) {
    throw new InstallError('La construction du site a échoué (voir ci-dessus). Si des modules manquent, lancez « npm ci » dans saas/ puis relancez.');
  }
  if (!existsSync(join(SAAS_DIR, 'dist', 'kiosk-config.json'))) {
    throw new InstallError('dist/kiosk-config.json n\'a pas été généré (voir l\'avertissement ci-dessus) : les bornes ne pourraient pas se connecter.');
  }
  const base = JSON.parse(readFileSync(join(SAAS_DIR, 'vercel.json'), 'utf8'));
  const mediaUrls = [config.storage.STORAGE_ENDPOINT, config.storage.STORAGE_PUBLIC_URL, config.storage.STORAGE_PHOTOS_PUBLIC_URL];
  writeFileSync(join(SAAS_DIR, 'dist', 'vercel.json'), buildVercelJson(base, { supabaseUrl: keys.supabaseUrl, mediaUrls }));
  writeFileSync(join(SAAS_DIR, 'dist', '_redirects'), REDIRECTS_CONTENT);
  ok(`Site construit dans ${join(SAAS_DIR, 'dist')}`);
}

function printNextSteps(config, keys, admin, opts) {
  step('next');
  const storageOrigin = new URL(config.storage.STORAGE_PUBLIC_URL).origin;
  const lines = [
    `Hébergez le dossier saas/dist/ à l'adresse ${config.appUrl}. Toute adresse inconnue doit renvoyer index.html`
      + ' (Vercel : dist/vercel.json le fait ; Netlify : dist/_redirects le fait ; Nginx : try_files $uri /index.html).',
    `CORS du bucket ${config.storage.STORAGE_BUCKET}${config.storage.STORAGE_PHOTOS_BUCKET ? ` et ${config.storage.STORAGE_PHOTOS_BUCKET}` : ''} :`
      + ` origine ${config.appUrl}, méthodes GET et PUT, en-têtes autorisés *, en-tête exposé ETag`
      + ' (vérifié, et posé si possible, à l\'étape « Vérifications » ; à poser à la main s\'il y est signalé ⚠).',
    `Sécurité du site (CSP, en observation) : dist/vercel.json autorise ${keys.supabaseUrl} et ${storageOrigin}.`
      + ' Autre hébergeur : reprenez ses en-têtes.',
    `Sur la borne, au premier démarrage, saisissez l'adresse ${config.appUrl} (elle lit ${config.appUrl}/kiosk-config.json).`,
  ];
  lines.forEach((line, i) => info(`${i + 1}. ${line}`));
  if (admin?.password) {
    console.log();
    info(bold(`Mot de passe de ${config.adminEmail} : ${admin.password}`));
    info('Notez-le maintenant : il ne sera plus affiché.');
    if (admin.invited) info('Cliquez d\'abord sur le lien de l\'email d\'invitation (il confirme l\'adresse), puis connectez-vous.');
  } else if (admin?.invited) {
    console.log();
    info('Cliquez d\'abord sur le lien du nouvel email d\'invitation, puis connectez-vous avec le mot de passe de la'
      + ' première installation (perdu : relancez avec --new-admin-password).');
  }
  info(`Connexion : ${config.appUrl}/admin/login`);
  if (opts.local) info(`Mode local : emails visibles dans Mailpit (voir « npx supabase@${CLI_VERSION} status »). Projet : ${keys.supabaseUrl}`);
}

// ── Vérifications : messagerie et stockage (LAB-376) ──────────────────────────────────────────

async function runChecksStep(config, opts) {
  step('checks');
  if (opts.skipChecks) {
    warn('Vérifications de la messagerie et du stockage ignorées (--skip-checks) : une erreur SMTP, de lecture publique ou de CORS ne se verra qu\'à l\'usage.');
    return;
  }
  info(opts.dryRun
    ? 'Simulation : l\'email de test part et le fichier de test est envoyé puis supprimé ; la règle CORS n\'est pas posée.'
    : 'Messagerie (connexion, email de test), puis chaque bucket (envoi, lecture publique, CORS, suppression).');
  const paint = { ok: green, warn: yellow, error: red, skip: (t) => t };
  const items = await runChecks(config, {
    fetch,
    dryRun: opts.dryRun,
    skipEmailTest: opts.skipEmailTest,
    local: opts.local,
    onItem: (item) => {
      console.log(`   ${paint[item.status](CHECK_SYMBOLS[item.status])} ${item.message}`);
      if (item.hint) info(`  → ${item.hint}`);
      for (const line of item.details ?? []) info(`     ${line}`);
    },
  });
  for (const item of items) if (item.status === 'warn') warnings.push(item.message);
  console.log();
  info(bold(checksSummaryLine(items)));
  const { counts, blocking } = checksVerdict(items);
  if (blocking) {
    throw new InstallError(`${counts.error} vérification(s) en échec (✗ ci-dessus) : rien n'a été modifié. Corrigez instance.env ou le réglage indiqué, puis relancez.`);
  }
}

// ── Programme ───────────────────────────────────────────────────────────────────────────────

async function main() {
  const { values: args } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      local: { type: 'boolean', default: false },
      'skip-build': { type: 'boolean', default: false },
      'skip-email-test': { type: 'boolean', default: false },
      'skip-checks': { type: 'boolean', default: false },
      'new-admin-password': { type: 'boolean', default: false },
      config: { type: 'string' },
      workdir: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (args.help) { console.log(USAGE); return; }
  const opts = {
    dryRun: args['dry-run'],
    local: args.local,
    skipBuild: args['skip-build'],
    skipEmailTest: args['skip-email-test'],
    skipChecks: args['skip-checks'],
    newAdminPassword: args['new-admin-password'],
    envFile: resolve(args.config ?? join(SAAS_DIR, 'instance.env')),
    workdir: resolve(args.workdir ?? SAAS_DIR),
  };
  console.log(bold(`Installation d'une instance${opts.dryRun ? ' (simulation : rien n\'est modifié)' : ''}${opts.local ? ' — Supabase local' : ''}`));

  const cliEnv = { ...process.env };
  delete cliEnv.SUPABASE_DB_PASSWORD;
  const cli = makeCli({ workdir: opts.workdir, env: cliEnv });
  const tmp = mkdtempSync(join(tmpdir(), 'pola-install-'));
  try {
    checkPrerequisites(cli);
    const config = readConfig(opts);
    await runChecksStep(config, opts);
    // Jeton lu nativement par la CLI : « supabase login » inutile. Supabase local : ni jeton ni API de gestion.
    if (!opts.local) cliEnv.SUPABASE_ACCESS_TOKEN = config.accessToken;
    const api = opts.local ? null : createManagementApi({ fetch, token: config.accessToken, ref: config.projectRef });
    await setupAuth(api, config, opts);
    pushDatabase(cli, config, opts, tmp);
    const keys = await fetchKeys(cli, api, config, opts);
    setFunctionSecrets(cli, config, keys, opts, tmp);
    deployFunctions(cli, config, opts);
    unscheduleCrons(cli, config, opts, tmp);
    const admin = await createAdmin(config, keys, opts);
    writeFrontFiles(config, keys, opts);
    buildSite(config, keys, opts);
    printNextSteps(config, keys, admin, opts);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log();
  if (warnings.length) {
    console.log(yellow(`Terminé avec ${warnings.length} point(s) à vérifier :`));
    warnings.forEach((w) => console.log(`   - ${w}`));
  } else {
    console.log(green(opts.dryRun ? 'Simulation terminée.' : 'Installation terminée. Relancer le script ne crée aucun doublon.'));
  }
}

main().catch((e) => {
  const known = e instanceof InstallError || e instanceof ManagementApiError;
  console.error(`\n${red('Erreur :')} ${known ? e.message : (e?.stack ?? e)}`);
  console.error('Corrigez le problème puis relancez : les étapes déjà faites ne sont pas refaites.');
  process.exit(1);
});
