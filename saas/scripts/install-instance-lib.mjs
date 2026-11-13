// Partie pure du script d'installation d'une instance (open core étape 2, lot I2).
// Aucun appel réseau ni à la CLI ici : lecture de instance.env, listes des fonctions et des tâches
// planifiées, secrets à poser, contenu des fichiers générés. Testé par install-instance-lib.test.mjs.
import { createHash } from 'node:crypto';
import { isJwt } from './kiosk-config.mjs';

export { isJwt };

export const MIN_NODE_MAJOR = 20;
export const CLI_MAJOR = 3;

// ── instance.env ────────────────────────────────────────────────────────────────────────────

/**
 * Lit un fichier .env simple : `NOM=valeur`, lignes vides et `#` ignorées, préfixe `export ` toléré,
 * valeur entre guillemets simples (littérale) ou doubles (`\n`, `\"`, `\\`). Sans guillemets, un
 * ` #` commence un commentaire. Pas de substitution de variables.
 */
export function parseEnvFile(text) {
  const values = {};
  const errors = [];
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) {
      errors.push(`ligne ${i + 1} illisible : « ${line} » (format attendu : NOM=valeur)`);
      return;
    }
    const [, name, rest] = m;
    let value;
    let after = '';
    if (rest.startsWith("'")) {
      const end = rest.indexOf("'", 1);
      if (end < 0) { errors.push(`ligne ${i + 1} : guillemet simple non fermé pour ${name}`); return; }
      value = rest.slice(1, end);
      after = rest.slice(end + 1);
    } else if (rest.startsWith('"')) {
      let out = '';
      let j = 1;
      for (; j < rest.length && rest[j] !== '"'; j++) {
        if (rest[j] === '\\' && j + 1 < rest.length) {
          j++;
          out += rest[j] === 'n' ? '\n' : rest[j];
        } else out += rest[j];
      }
      if (j >= rest.length) { errors.push(`ligne ${i + 1} : guillemet double non fermé pour ${name}`); return; }
      value = out;
      after = rest.slice(j + 1);
    } else {
      value = rest.replace(/\s+#.*$/, '').trim();
    }
    if (after.trim() && !/^\s+#/.test(after)) {
      errors.push(`ligne ${i + 1} : texte après le guillemet fermant pour ${name} (pour une apostrophe, entourez la valeur de guillemets doubles)`);
      return;
    }
    values[name] = value;
  });
  return { values, errors };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REF_RE = /^[a-z]{20}$/;

function httpUrl(value, { allowHttp }) {
  try {
    const u = new URL(value);
    if (u.protocol === 'https:' || (allowHttp && u.protocol === 'http:')) return u;
  } catch { /* invalide */ }
  return null;
}

/**
 * Valide instance.env. `local` : Supabase local (tests), sans projet hébergé ni mot de passe, http accepté.
 * Renvoie `{ config, errors }` ; `errors` en français, une ligne par problème.
 */
export function validateInstanceEnv(values, { local = false } = {}) {
  const v = (name) => (values[name] ?? '').trim();
  const errors = [];
  const required = (name, label) => {
    if (!v(name)) errors.push(`${name} est vide : indiquez ${label}.`);
    return v(name);
  };

  const config = {};
  if (!local) {
    config.projectRef = required('SUPABASE_PROJECT_REF', 'l\'identifiant du projet Supabase (20 lettres minuscules)');
    if (config.projectRef && !REF_RE.test(config.projectRef)) {
      errors.push(`SUPABASE_PROJECT_REF invalide (« ${config.projectRef} ») : 20 lettres minuscules, visibles dans l'adresse du projet (https://<ref>.supabase.co).`);
    }
    config.dbPassword = required('SUPABASE_DB_PASSWORD', 'le mot de passe de la base (choisi à la création du projet)');
  }

  const appUrlRaw = required('APP_URL', 'l\'adresse publique du SaaS (ex. https://photobooth.mon-entreprise.fr)');
  if (appUrlRaw) {
    const u = httpUrl(appUrlRaw, { allowHttp: local });
    if (!u) errors.push(`APP_URL invalide (« ${appUrlRaw} ») : adresse complète en https://, ex. https://photobooth.mon-entreprise.fr.`);
    else if (u.pathname !== '/' || u.search || u.hash) errors.push(`APP_URL doit être l'adresse du site seule, sans chemin (« ${appUrlRaw} »).`);
    else config.appUrl = u.origin;
  }

  config.companyName = required('COMPANY_NAME', 'le nom de votre entreprise');
  config.companyPhone = v('COMPANY_PHONE') || null;
  config.adminEmail = required('ADMIN_EMAIL', 'l\'email du compte administrateur').toLowerCase();
  if (config.adminEmail && !EMAIL_RE.test(config.adminEmail)) errors.push(`ADMIN_EMAIL invalide (« ${config.adminEmail} »).`);

  config.fromEmail = required('FROM_EMAIL', 'l\'adresse d\'expédition des emails');
  if (config.fromEmail && !EMAIL_RE.test(config.fromEmail)) errors.push(`FROM_EMAIL invalide (« ${config.fromEmail} »).`);
  config.fromName = v('FROM_NAME') || config.companyName;

  config.smtpHost = required('SMTP_HOST', 'le serveur SMTP (ex. smtp.mon-hebergeur.fr)');
  const port = v('SMTP_PORT') || '465';
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    errors.push(`SMTP_PORT invalide (« ${port} ») : un numéro de port, 465 en général.`);
  } else if (port === '25' || port === '587') {
    errors.push(`SMTP_PORT ${port} impossible : Supabase bloque les ports 25 et 587 en sortie. Utilisez le port 465 (SSL/TLS).`);
  }
  config.smtpPort = port;
  config.smtpUser = required('SMTP_USER', 'l\'identifiant SMTP');
  config.smtpPassword = required('SMTP_PASSWORD', 'le mot de passe SMTP');

  const endpoint = required('STORAGE_ENDPOINT', 'l\'adresse S3 de votre fournisseur (ex. https://s3.fr-par.scw.cloud)');
  if (endpoint && !httpUrl(endpoint, { allowHttp: true })) errors.push(`STORAGE_ENDPOINT invalide (« ${endpoint} ») : adresse en https://.`);
  config.storage = {
    STORAGE_ENDPOINT: endpoint.replace(/\/+$/, ''),
    STORAGE_REGION: v('STORAGE_REGION'),
    STORAGE_ACCESS_KEY_ID: required('STORAGE_ACCESS_KEY_ID', 'la clé d\'accès S3'),
    STORAGE_SECRET_ACCESS_KEY: required('STORAGE_SECRET_ACCESS_KEY', 'la clé secrète S3'),
    STORAGE_BUCKET: required('STORAGE_BUCKET', 'le nom du bucket'),
    STORAGE_PUBLIC_URL: required('STORAGE_PUBLIC_URL', 'l\'adresse publique de lecture du bucket').replace(/\/+$/, ''),
    STORAGE_PHOTOS_BUCKET: v('STORAGE_PHOTOS_BUCKET'),
    STORAGE_PHOTOS_PUBLIC_URL: v('STORAGE_PHOTOS_PUBLIC_URL').replace(/\/+$/, ''),
    STORAGE_FORCE_PATH_STYLE: v('STORAGE_FORCE_PATH_STYLE').toLowerCase(),
  };
  for (const name of ['STORAGE_PUBLIC_URL', 'STORAGE_PHOTOS_PUBLIC_URL']) {
    const url = config.storage[name];
    // https obligatoire hors essai local : la base refuse d'enregistrer une photo de la borne dont l'adresse
    // n'est pas en https (kiosk_record_photo).
    if (url && !httpUrl(url, { allowHttp: local })) errors.push(`${name} invalide (« ${url} ») : adresse en https:// (la borne n'enregistre que des photos en https).`);
  }
  if (config.storage.STORAGE_FORCE_PATH_STYLE && !['true', 'false'].includes(config.storage.STORAGE_FORCE_PATH_STYLE)) {
    errors.push(`STORAGE_FORCE_PATH_STYLE invalide (« ${v('STORAGE_FORCE_PATH_STYLE')} ») : true ou false (ou laissez vide).`);
  }

  return { config, errors };
}

// ── Fonctions et tâches planifiées ──────────────────────────────────────────────────────────

const privateIds = (catalog) => catalog.filter((f) => f.visibility === 'private').map((f) => f.id);

/**
 * Fonctions à déployer : celles des fonctionnalités ouvertes du manifeste présentes sur le disque.
 * `unknown` : dossiers absents du manifeste (non déployés, à signaler).
 */
export function openFunctions(manifest, catalog, dirNames) {
  const priv = new Set(privateIds(catalog));
  const open = new Set();
  const privateFns = new Set();
  for (const [id, entry] of Object.entries(manifest.features)) {
    for (const fn of entry.functions) (priv.has(id) ? privateFns : open).add(fn);
  }
  const onDisk = [...dirNames].sort();
  return {
    deploy: onDisk.filter((n) => open.has(n) && !privateFns.has(n)),
    privateFns: onDisk.filter((n) => privateFns.has(n)),
    unknown: onDisk.filter((n) => !open.has(n) && !privateFns.has(n)),
  };
}

/**
 * Tâches pg_cron des fonctionnalités privées qui appellent une fonction : à retirer d'une instance
 * ouverte (la fonction n'y est pas déployée). Les purges SQL toujours actives restent (`always_on`).
 */
export function privateCrons(manifest, catalog) {
  const keep = new Set(manifest.always_on?.crons ?? []);
  return privateIds(catalog)
    .flatMap((id) => manifest.features[id]?.crons ?? [])
    .filter((job) => !keep.has(job))
    .sort();
}

// ── Secrets des fonctions ───────────────────────────────────────────────────────────────────

/** Secrets des fonctions ouvertes tirés de instance.env (variables vides omises). */
export function functionSecrets(config) {
  const out = {
    APP_URL: config.appUrl,
    PUBLIC_APP_URL: config.appUrl,
    EMAIL_PROVIDER: 'smtp',
    SMTP_HOST: config.smtpHost,
    SMTP_PORT: config.smtpPort,
    SMTP_USER: config.smtpUser,
    SMTP_PASSWORD: config.smtpPassword,
    FROM_EMAIL: config.fromEmail,
    FROM_NAME: config.fromName,
    ...config.storage,
  };
  return Object.fromEntries(Object.entries(out).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

/** Secrets posés une seule fois (valeur aléatoire), jamais remplacés ensuite. */
export const GENERATED_ONCE = ['RATE_LIMIT_SALT'];

export const sha256Hex = (value) => createHash('sha256').update(String(value), 'utf8').digest('hex');

/**
 * `supabase secrets list -o json` → Map nom → empreinte. Accepte `[{ name, value }]` ou
 * `[{ name, digest }]` (l'API renvoie l'empreinte SHA-256 de la valeur, jamais la valeur).
 */
export function parseSecretsList(json) {
  const list = Array.isArray(json) ? json : (json?.secrets ?? json?.rows ?? []);
  return new Map(list.filter((s) => s?.name).map((s) => [s.name, String(s.digest ?? s.value ?? '').toLowerCase()]));
}

/**
 * Noms des secrets à (re)poser : absents, ou dont l'empreinte diffère de celle de la valeur voulue.
 * Une empreinte illisible compte comme différente (le secret est reposé, sans risque).
 */
export function secretsToSet(desired, existing) {
  return Object.keys(desired).filter((name) => existing.get(name) !== sha256Hex(desired[name]));
}

/** Contenu d'un fichier --env-file pour `supabase secrets set` (valeurs entre guillemets simples). */
export function secretsEnvFile(entries) {
  return Object.entries(entries).map(([name, value]) => {
    const s = String(value);
    if (/[\r\n]/.test(s)) throw new Error(`${name} : une valeur sur plusieurs lignes n'est pas acceptée.`);
    if (!s.includes("'")) return `${name}='${s}'`;
    if (/[$`]/.test(s)) throw new Error(`${name} : une valeur contenant à la fois ' et $ n'est pas acceptée.`);
    return `${name}="${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }).join('\n') + '\n';
}

// ── Clés du projet ──────────────────────────────────────────────────────────────────────────

export class MissingJwtKeysError extends Error {}

/**
 * Clés anon et service_role au format JWT dans `supabase projects api-keys -o json`, ou les champs
 * ANON_KEY / SERVICE_ROLE_KEY de `supabase status -o json` (Supabase local).
 * Les clés `sb_publishable_…` / `sb_secret_…` ne conviennent pas : la passerelle des fonctions
 * vérifiées (verify_jwt) et les tâches planifiées exigent un JWT.
 */
export function pickJwtKeys(json) {
  let anon;
  let serviceRole;
  if (Array.isArray(json)) {
    const find = (name) => json.find((k) => (k?.name ?? k?.id) === name && isJwt(k?.api_key))?.api_key;
    anon = find('anon');
    serviceRole = find('service_role');
  } else if (json && typeof json === 'object') {
    anon = isJwt(json.ANON_KEY) ? json.ANON_KEY : undefined;
    serviceRole = isJwt(json.SERVICE_ROLE_KEY) ? json.SERVICE_ROLE_KEY : undefined;
  }
  const missing = [!anon && 'anon', !serviceRole && 'service_role'].filter(Boolean);
  if (missing.length) {
    throw new MissingJwtKeysError(
      `Clés au format JWT introuvables (${missing.join(', ')}). Le projet n'a que les nouvelles clés `
      + '(sb_publishable_… / sb_secret_…), que la borne et les tâches planifiées ne peuvent pas utiliser. '
      + 'Activez les anciennes clés : tableau de bord Supabase > Project Settings > API Keys > onglet '
      + '« Legacy API Keys » > « Enable legacy API keys », puis relancez le script.',
    );
  }
  return { anon, serviceRole };
}

// ── Fichiers générés ────────────────────────────────────────────────────────────────────────

/**
 * saas/.env.production (lu par `vite build`). KIOSK_SUPABASE_ANON_KEY : clé anon JWT du
 * kiosk-config.json généré au build (scripts/kiosk-config.mjs).
 */
export function envProductionContent({ supabaseUrl, anonKey, appUrl }) {
  return [
    '# Généré par npm run install-instance : ne pas modifier à la main, relancer le script.',
    `VITE_SUPABASE_URL=${supabaseUrl}`,
    `VITE_SUPABASE_ANON_KEY=${anonKey}`,
    `VITE_APP_URL=${appUrl}`,
    'VITE_EMAIL_PROVIDER=smtp',
    'VITE_GOOGLE_CLIENT_ID=',
    `KIOSK_SUPABASE_URL=${supabaseUrl}`,
    `KIOSK_SUPABASE_ANON_KEY=${anonKey}`,
    '',
  ].join('\n');
}

export const supabaseUrlOf = (ref) => `https://${ref}.supabase.co`;

/**
 * vercel.json pour héberger dist/ : celui du SaaS, la CSP (Report-Only) pointant sur le projet
 * Supabase de l'instance et sur son stockage S3 au lieu des projets et du R2 d'origine.
 */
export function buildVercelJson(base, { supabaseUrl, mediaUrls }) {
  const sb = new URL(supabaseUrl);
  const wss = `${sb.protocol === 'http:' ? 'ws' : 'wss'}://${sb.host}`;
  const media = [...new Set(mediaUrls.filter(Boolean).map((u) => new URL(u).origin))];
  const mapToken = (token) => {
    // Ref d'un projet (vercel.json du dépôt privé) ou joker « * » (vercel.json du dépôt public).
    if (/^https:\/\/(\*|[a-z0-9]+)\.supabase\.co$/.test(token)) return [sb.origin];
    if (/^wss:\/\/(\*|[a-z0-9]+)\.supabase\.co$/.test(token)) return [wss];
    if (/^https:\/\/\*\.r2\.(dev|cloudflarestorage\.com)$/.test(token)) return media;
    return [token];
  };
  const csp = (value) => value.split(';').map((directive) => {
    const tokens = directive.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return '';
    const [name, ...sources] = tokens;
    return [name, ...new Set(sources.flatMap(mapToken))].join(' ');
  }).filter(Boolean).join('; ');
  const copy = JSON.parse(JSON.stringify(base));
  for (const block of copy.headers ?? []) {
    for (const h of block.headers ?? []) {
      if (/^content-security-policy/i.test(h.key)) h.value = csp(h.value);
    }
  }
  return `${JSON.stringify(copy, null, 2)}\n`;
}

// ── SQL ─────────────────────────────────────────────────────────────────────────────────────

export const sqlLiteral = (value) => `'${String(value).replace(/'/g, "''")}'`;

/**
 * Secrets du Vault lus par les tâches planifiées (project_url, service_role_key) : créés s'ils manquent,
 * mis à jour s'ils diffèrent, inchangés sinon. Une seule requête (la CLI n'en accepte qu'une).
 * Renvoie les lignes `{ name, action }` des secrets créés ou modifiés.
 */
export function vaultUpsertSql(secrets) {
  const wanted = Object.entries(secrets).map(([name, value]) => `(${sqlLiteral(name)}, ${sqlLiteral(value)})`).join(', ');
  return `with wanted(name, value) as (values ${wanted}),
existing as (select d.id, d.name, d.decrypted_secret from vault.decrypted_secrets d where d.name in (select name from wanted)),
created as (select w.name, vault.create_secret(w.value, w.name) from wanted w where not exists (select 1 from existing e where e.name = w.name)),
updated as (select e.name, vault.update_secret(e.id, w.value) from wanted w join existing e on e.name = w.name where e.decrypted_secret is distinct from w.value)
select name, 'cree' as action from created
union all
select name, 'mis_a_jour' as action from updated`;
}

/**
 * Retire les tâches pg_cron nommées si elles existent (relançable). Lignes `{ jobname }` retirées.
 * Liste vide (dépôt public : aucune fonctionnalité privée) : null, rien à exécuter (« in () » est invalide).
 */
export function unscheduleSql(jobs) {
  if (!jobs.length) return null;
  const list = jobs.map(sqlLiteral).join(', ');
  return `select jobname, cron.unschedule(jobname) as removed from cron.job where jobname in (${list}) order by jobname`;
}

// ── Divers ──────────────────────────────────────────────────────────────────────────────────

/** Version majeure dans « 3.0.0 », « v20.11.1 », « supabase 3.1.0 »… ; null si illisible. */
export function majorVersion(text) {
  const m = String(text ?? '').match(/(\d+)\.\d+\.\d+/);
  return m ? Number(m[1]) : null;
}

/** Lignes JSON de `supabase db query -o json` : tableau direct ou `{ rows }`. */
export function queryRows(json) {
  if (Array.isArray(json)) return json;
  return Array.isArray(json?.rows) ? json.rows : [];
}

/** Document JSON d'une sortie de la CLI (au besoin à partir de la première ligne qui commence par [ ou {). */
export function parseCliJson(stdout) {
  const text = String(stdout ?? '').trim();
  try {
    return JSON.parse(text);
  } catch { /* texte avant le JSON */ }
  const start = text.search(/^[[{]/m);
  if (start < 0) throw new Error('réponse JSON attendue de la CLI supabase, reçu : ' + text.slice(0, 200));
  return JSON.parse(text.slice(start));
}

/** Requête qui dit si le service Storage a créé ses tables (projet neuf : la base répond avant). */
export const STORAGE_READY_SQL = "select to_regclass('storage.objects') is not null as ready";

/** Lecture tolérante de la réponse à STORAGE_READY_SQL (booléen JSON ou texte « t » / « true »). */
export function storageReady(rows) {
  const value = rows?.[0]?.ready;
  return value === true || value === 't' || value === 'true';
}
