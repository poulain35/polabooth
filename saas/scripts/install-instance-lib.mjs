// Partie pure du script d'installation d'une instance (open core étape 2, lot I2).
// Aucun appel à la CLI ici : lecture de instance.env, listes des fonctions et des tâches planifiées,
// secrets à poser, réglages de Supabase Auth, contenu des fichiers générés. Les appels à l'API de gestion
// Supabase reçoivent fetch en paramètre (testés avec un faux fetch). Testé par install-instance-lib.test.mjs.
import { createHash } from 'node:crypto';
import { PASSWORD_MIN_LENGTH } from '../src/lib/passwordRules.js';
import { isJwt } from './kiosk-config.mjs';

export { isJwt };

export const MIN_NODE_MAJOR = 20;
// Même version que la CI (.github/workflows/deploy-edge-functions.yml) ; lancée par npx, rien à installer.
export const CLI_VERSION = '3.0.0';

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

export const ACCESS_TOKEN_URL = 'https://supabase.com/dashboard/account/tokens';

/**
 * Jeton d'accès personnel Supabase (API de gestion et CLI) : null s'il est valable, sinon le message.
 * Même format que celui exigé par la CLI. Le jeton n'apparaît jamais dans le message.
 */
export function accessTokenError(token) {
  const value = String(token ?? '').trim();
  if (!value) return `SUPABASE_ACCESS_TOKEN est vide : créez un jeton sur ${ACCESS_TOKEN_URL} et collez-le dans instance.env.`;
  if (!/^sbp_(oauth_)?[a-f0-9]{40}$/.test(value)) {
    return `SUPABASE_ACCESS_TOKEN invalide : un jeton Supabase commence par sbp_ suivi de 40 caractères. Copiez-le en entier, ou créez-en un sur ${ACCESS_TOKEN_URL}.`;
  }
  return null;
}

/**
 * Valide instance.env. `local` : Supabase local (tests), sans projet hébergé, mot de passe ni jeton,
 * http accepté. `fallbackToken` : jeton pris ailleurs (variable d'environnement SUPABASE_ACCESS_TOKEN)
 * si instance.env n'en donne pas. Renvoie `{ config, errors }` ; `errors` en français, une ligne par problème.
 */
export function validateInstanceEnv(values, { local = false, fallbackToken = '' } = {}) {
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
    const token = v('SUPABASE_ACCESS_TOKEN') || String(fallbackToken ?? '').trim();
    const tokenError = accessTokenError(token);
    if (tokenError) errors.push(tokenError);
    else config.accessToken = token;
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

/** dist/_redirects (Netlify et hébergeurs compatibles) : toute adresse inconnue renvoie index.html. */
export const REDIRECTS_CONTENT = '/* /index.html 200\n';

// ── Supabase Auth (API de gestion) ──────────────────────────────────────────────────────────

/**
 * Emails de Supabase Auth envoyés par le SaaS : invitation de l'administrateur (script), mot de passe
 * oublié (page de connexion), code exigé pour changer un mot de passe sur une session ancienne.
 * Supabase dit lui-même si un sujet a été personnalisé (`mailer_subjects_custom_contents`, relevé le
 * 2026-11-18 sur un projet neuf) : non personnalisé = remplacé. Sans cette indication, `defaultSubjects`
 * (sujets d'origine, en anglais) sert de repli : un sujet autre que ceux-là ou le nôtre est une
 * personnalisation du loueur, et le modèle est gardé.
 */
export const AUTH_EMAIL_TEMPLATES = {
  invite: {
    label: 'invitation',
    defaultSubjects: ["You've been invited",'You have been invited'],
    subject: 'Votre accès à l\'espace d\'administration',
    content: '<h2>Bienvenue</h2>'
      + '<p>Un compte administrateur a été créé pour vous sur {{ .SiteURL }}.</p>'
      + '<p><a href="{{ .ConfirmationURL }}">Confirmer mon adresse et ouvrir l\'administration</a></p>'
      + '<p>Connectez-vous ensuite avec le mot de passe qui vous a été communiqué.</p>',
  },
  recovery: {
    label: 'mot de passe oublié',
    defaultSubjects: ['Reset your password'],
    subject: 'Réinitialiser votre mot de passe',
    content: '<h2>Nouveau mot de passe</h2>'
      + '<p>Vous avez demandé à changer le mot de passe de votre compte.</p>'
      + '<p><a href="{{ .ConfirmationURL }}">Choisir un nouveau mot de passe</a></p>'
      + '<p>Vous n\'avez rien demandé ? Ignorez cet email : votre mot de passe ne change pas.</p>',
  },
  reauthentication: {
    label: 'code de confirmation',
    defaultSubjects: ['{{ .Token }} is your verification code', 'Confirm reauthentication'],
    subject: 'Votre code de confirmation',
    content: '<h2>Code de confirmation</h2>'
      + '<p>Saisissez ce code pour confirmer le changement de votre mot de passe :</p>'
      + '<p><strong>{{ .Token }}</strong></p>'
      + '<p>Vous n\'avez rien demandé ? Ignorez cet email.</p>',
  },
};

/** uri_allow_list (adresses séparées par des virgules) : entrées existantes gardées, `wanted` ajoutées. */
export function mergeUriAllowList(current, wanted) {
  const list = String(current ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const url of wanted) if (!list.includes(url)) list.push(url);
  return list.join(',');
}

const sameSubject = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/**
 * Corps du PATCH /v1/projects/{ref}/config/auth à partir de la configuration de l'instance et des
 * réglages actuels (`current`, réponse du GET) : adresse du site, adresses de redirection, SMTP,
 * longueur minimale des mots de passe (jamais baissée), inscriptions fermées (`disable_signup`, LAB-392 :
 * les comptes sont créés par l'API d'administration ou par invitation, que ce réglage ne bloque pas),
 * emails en français (sauf modèles personnalisés).
 * Renvoie `{ body, keptTemplates }` (types d'email gardés parce que personnalisés).
 */
export function buildAuthConfigPatch(config, current = {}) {
  const body = {
    site_url: config.appUrl,
    uri_allow_list: mergeUriAllowList(current?.uri_allow_list, [`${config.appUrl}/**`]),
    smtp_host: config.smtpHost,
    smtp_port: String(config.smtpPort),
    smtp_user: config.smtpUser,
    smtp_pass: config.smtpPassword,
    smtp_admin_email: config.fromEmail,
    smtp_sender_name: config.fromName,
    password_min_length: Math.max(Number(current?.password_min_length) || 0, PASSWORD_MIN_LENGTH),
    disable_signup: true,
  };
  const keptTemplates = [];
  for (const [kind, template] of Object.entries(AUTH_EMAIL_TEMPLATES)) {
    const subject = current?.[`mailer_subjects_${kind}`];
    const customFlag = current?.mailer_subjects_custom_contents?.[`MAILER_SUBJECTS_${kind.toUpperCase()}`];
    const replaceable = customFlag === false
      || !String(subject ?? '').trim()
      || sameSubject(subject, template.subject)
      || template.defaultSubjects.some((s) => sameSubject(subject, s));
    if (!replaceable) { keptTemplates.push(kind); continue; }
    body[`mailer_subjects_${kind}`] = template.subject;
    body[`mailer_templates_${kind}_content`] = template.content;
  }
  return { body, keptTemplates };
}

/** Champs du corps différents des réglages actuels (comparaison en texte : smtp_port est une chaîne). */
export function changedAuthFields(current, body) {
  return Object.keys(body).filter((key) => String(current?.[key] ?? '') !== String(body[key]));
}

/** Lignes lisibles décrivant le corps du PATCH, sans le mot de passe SMTP. */
export function describeAuthPatch(body, { keptTemplates = [] } = {}) {
  const lines = [
    `Adresse du site : ${body.site_url}`,
    `Adresses de redirection autorisées : ${body.uri_allow_list.split(',').join(', ')}`,
    `SMTP : ${body.smtp_host}:${body.smtp_port}, identifiant ${body.smtp_user}, mot de passe ${'•'.repeat(8)}`,
    `Expéditeur : ${body.smtp_sender_name} <${body.smtp_admin_email}>`,
    `Mots de passe : ${body.password_min_length} caractères minimum`,
    `Inscriptions : ${body.disable_signup ? 'fermées (comptes créés par invitation seulement)' : 'ouvertes'}`,
  ];
  const french = Object.keys(AUTH_EMAIL_TEMPLATES).filter((kind) => `mailer_subjects_${kind}` in body);
  if (french.length) lines.push(`Emails en français : ${french.map((k) => AUTH_EMAIL_TEMPLATES[k].label).join(', ')}`);
  if (keptTemplates.length) {
    lines.push(`Emails personnalisés gardés tels quels : ${keptTemplates.map((k) => AUTH_EMAIL_TEMPLATES[k].label).join(', ')}`);
  }
  return lines;
}

export const MANAGEMENT_API_URL = 'https://api.supabase.com';

/** Erreur de l'API de gestion, message en français prêt à afficher (jamais le jeton). */
export class ManagementApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** Message d'erreur en français pour une réponse non 2xx de l'API de gestion. */
export function managementApiMessage({ status, method, path, ref, detail }) {
  if (status === 401) {
    return `Jeton Supabase refusé (SUPABASE_ACCESS_TOKEN) : il est faux, expiré ou supprimé. Créez un nouveau jeton sur ${ACCESS_TOKEN_URL}, collez-le dans instance.env, puis relancez.`;
  }
  if (status === 403) {
    return `Ce jeton n'a pas les droits sur le projet ${ref}. Créez le jeton depuis le compte Supabase qui possède le projet (${ACCESS_TOKEN_URL}), puis relancez.`;
  }
  if (status === 404) {
    return `Projet ${ref} introuvable avec ce jeton. Vérifiez SUPABASE_PROJECT_REF, et que le jeton vient du compte qui possède le projet.`;
  }
  if (status === 429) return 'Trop de demandes à l\'API de gestion Supabase. Attendez une minute, puis relancez.';
  const text = String(detail ?? '').trim().slice(0, 300);
  return `API de gestion Supabase : ${method} ${path.split('?')[0]} a échoué (${status}${text ? ` : ${text}` : ''}).`;
}

/**
 * Client de l'API de gestion pour un projet : `request(method, chemin sous /v1/projects/{ref}, corps?)`.
 * `fetch` injecté (vrai fetch dans le script, faux dans les tests). Erreurs : ManagementApiError.
 */
export function createManagementApi({ fetch: fetchImpl, token, ref, baseUrl = MANAGEMENT_API_URL }) {
  return async function request(method, path, body) {
    let res;
    try {
      res = await fetchImpl(`${baseUrl}/v1/projects/${ref}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new ManagementApiError(`API de gestion Supabase injoignable (${baseUrl}) : ${e.message}. Vérifiez la connexion Internet, puis relancez.`, 0);
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const detail = data && typeof data === 'object' ? (data.message ?? data.msg ?? data.error) : text;
      throw new ManagementApiError(managementApiMessage({ status: res.status, method, path, ref, detail }), res.status);
    }
    return data;
  };
}

/**
 * Règle Supabase Auth : lit les réglages (vérifie aussi le jeton), envoie le PATCH s'il y a une
 * différence, jamais en simulation. Renvoie `{ body, changed, keptTemplates, applied }`.
 */
export async function configureAuth(api, config, { dryRun = false } = {}) {
  const current = (await api('GET', '/config/auth')) ?? {};
  const { body, keptTemplates } = buildAuthConfigPatch(config, current);
  const changed = changedAuthFields(current, body);
  const applied = !dryRun && changed.length > 0;
  if (applied) await api('PATCH', '/config/auth', body);
  return { body, changed, keptTemplates, applied };
}

/**
 * Anciennes clés API (anon / service_role au format JWT, nécessaires à la borne et aux tâches
 * planifiées) : activées si besoin. Renvoie 'enabled' (déjà actives), 'would-enable' (simulation),
 * 'enabled-now' ou 'unavailable' (point d'accès retiré par Supabase : 404, l'étape reste manuelle).
 */
export async function ensureLegacyKeys(api, { dryRun = false } = {}) {
  let status;
  try {
    status = await api('GET', '/api-keys/legacy');
  } catch (e) {
    if (e instanceof ManagementApiError && e.status === 404) return 'unavailable';
    throw e;
  }
  if (status?.enabled === true) return 'enabled';
  if (dryRun) return 'would-enable';
  await api('PUT', '/api-keys/legacy?enabled=true');
  return 'enabled-now';
}

// ── Déroulé du script ───────────────────────────────────────────────────────────────────────

/** Étapes affichées « Étape n/N : … ». Une nouvelle étape s'ajoute ici, à sa place. */
export const INSTALL_STEPS = [
  { id: 'prerequisites', title: 'Prérequis' },
  { id: 'config', title: 'Configuration' },
  { id: 'checks', title: 'Vérifications (messagerie et stockage)' },
  { id: 'auth', title: 'Connexion et emails des comptes (Supabase Auth)' },
  { id: 'database', title: 'Base de données' },
  { id: 'keys', title: 'Clés du projet' },
  { id: 'secrets', title: 'Secrets des fonctions et du Vault' },
  { id: 'functions', title: 'Fonctions serveur' },
  { id: 'crons', title: 'Tâches planifiées des fonctionnalités privées' },
  { id: 'admin', title: 'Compte administrateur et organisation' },
  { id: 'front', title: 'Fichiers du site' },
  { id: 'build', title: 'Construction du site (version ouverte)' },
  { id: 'next', title: 'Il vous reste à faire' },
];

export function stepLabel(id, steps = INSTALL_STEPS) {
  const index = steps.findIndex((s) => s.id === id);
  if (index < 0) throw new Error(`Étape inconnue : ${id}`);
  return `Étape ${index + 1}/${steps.length} : ${steps[index].title}`;
}

/**
 * Commande de la CLI Supabase lancée par npx, à la version épinglée : rien à installer.
 * Renvoie `{ command, args }` pour spawnSync.
 */
export function cliCommand(args) {
  return { command: 'npx', args: ['--yes', `supabase@${CLI_VERSION}`, ...args] };
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
