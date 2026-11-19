// Partie pure de la mise à jour d'une instance (LAB-431, LAB-432) : numéros de version, lecture du
// CHANGELOG.md, choix de l'hébergeur (HOSTING de instance.env), commande de mise en ligne, fichiers
// modifiés à la main. Aucun appel à git, npm ni au réseau ici. Testé par update-instance-lib.test.mjs.
// Aussi lu par scripts/export-open-core-lib.mjs (notes de version publiées sur GitHub).

// ── Numéros de version ──────────────────────────────────────────────────────────────────────

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

export const isVersion = (value) => SEMVER_RE.test(String(value ?? '').trim());

/** Compare deux versions X.Y.Z : négatif si a < b, 0 si égales, positif si a > b. Version illisible = 0.0.0. */
export function compareVersions(a, b) {
  const parts = (v) => (String(v ?? '').trim().match(SEMVER_RE) ?? [null, 0, 0, 0]).slice(1).map(Number);
  const [pa, pb] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** Texte affiché : « 1.2.0 (abc1234) », la version seule sans commit, le commit seul sans version. */
export function versionLabel(version, sha) {
  const v = String(version ?? '').trim();
  const s = String(sha ?? '').trim().slice(0, 7);
  if (v && s) return `${v} (${s})`;
  return v || s;
}

// ── CHANGELOG.md ────────────────────────────────────────────────────────────────────────────

export const NEXT_HEADING = 'Prochaine publication';
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const VERSION_HEADING_RE = /^##\s+(\d+\.\d+\.\d+)(?:\s+\((.*)\))?\s*$/;

/** Date en français : « 19 novembre 2026 » (jour sans zéro, comme dans le CHANGELOG). */
export function frenchDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Sections « ## … » du CHANGELOG, dans l'ordre du fichier : { title, version, date, body, line }.
 * `version` : X.Y.Z si le titre est « ## X.Y.Z (date) », sinon null. `body` : texte jusqu'à la section
 * suivante, sans les séparateurs « --- » ni les lignes vides du bord.
 */
export function changelogSections(text) {
  const lines = String(text ?? '').replace(/^﻿/, '').split(/\r?\n/);
  const sections = [];
  let current = null;
  let inCode = false;
  lines.forEach((line, i) => {
    if (/^```/.test(line)) inCode = !inCode;
    if (!inCode && /^##\s/.test(line)) {
      const m = line.match(VERSION_HEADING_RE);
      current = { title: line.replace(/^##\s+/, '').trim(), version: m ? m[1] : null, date: m?.[2] ?? null, lines: [], line: i + 1 };
      sections.push(current);
    } else if (current) current.lines.push(line);
  });
  return sections.map(({ lines: body, ...s }) => {
    const kept = [...body];
    const blank = (l) => !l.trim() || /^-{3,}\s*$/.test(l);
    while (kept.length && blank(kept[0])) kept.shift();
    while (kept.length && blank(kept[kept.length - 1])) kept.pop();
    return { ...s, body: kept.join('\n') };
  });
}

/** Sections de version (titre « X.Y.Z »), de la plus récente à la plus ancienne, comme dans le fichier. */
export const versionSections = (text) => changelogSections(text).filter((s) => s.version);

/** Sous-partie « ### <titre> » d'une section (texte jusqu'au « ### » suivant), '' si absente. */
export function subsection(body, heading) {
  const out = [];
  let inside = false;
  let inCode = false;
  for (const line of String(body ?? '').split('\n')) {
    if (/^```/.test(line)) inCode = !inCode;
    if (!inCode && /^###\s/.test(line)) {
      inside = line.replace(/^###\s+/, '').trim().toLowerCase() === heading.toLowerCase();
      continue;
    }
    if (inside) out.push(line);
  }
  return out.join('\n').trim();
}

/**
 * « À faire » des versions installées par une mise à jour : versions plus récentes que `from`, jusqu'à
 * `to` comprise, de la plus ancienne à la plus récente (ordre où les faire). Version sans « À faire » : omise.
 */
export function todosBetween(text, from, to) {
  return versionSections(text)
    .filter((s) => compareVersions(s.version, from) > 0 && compareVersions(s.version, to) <= 0)
    .map((s) => ({ version: s.version, todo: subsection(s.body, 'À faire') }))
    .filter((s) => s.todo)
    .reverse();
}

/**
 * Renomme « ## Prochaine publication » en « ## X.Y.Z (date) » (export --set-version). Erreur si la section
 * manque, si elle est vide ou si la version n'est pas plus récente que la dernière du fichier.
 */
export function stampChangelog(text, version, date) {
  if (!isVersion(version)) return { error: `version invalide : « ${version} » (format X.Y.Z, ex. 1.2.0).` };
  const sections = changelogSections(text);
  const next = sections.find((s) => s.title === NEXT_HEADING);
  if (!next) return { error: `CHANGELOG.md n'a pas de section « ## ${NEXT_HEADING} » : écrivez d'abord ce qui change.` };
  if (!next.body.trim()) return { error: `la section « ${NEXT_HEADING} » de CHANGELOG.md est vide.` };
  const latest = sections.find((s) => s.version);
  if (latest && compareVersions(version, latest.version) <= 0) {
    return { error: `la version ${version} doit être plus récente que la dernière du CHANGELOG (${latest.version}).` };
  }
  const lines = String(text).split('\n');
  const eol = lines[next.line - 1].endsWith('\r') ? '\r' : '';
  lines[next.line - 1] = `## ${version} (${frenchDate(date)})${eol}`;
  return { text: lines.join('\n') };
}

/** Liens relatifs « ](chemin) » d'un texte Markdown réécrits vers le dépôt GitHub (`base` = …/blob/<ref>/). */
export function absolutizeLinks(markdown, base) {
  const root = base.endsWith('/') ? base : `${base}/`;
  return String(markdown).replace(/\]\((?!https?:|mailto:|#|\/)([^)\s]+)\)/g, (_, path) => `](${root}${path.replace(/^\.\//, '')})`);
}

/**
 * Contrôle d'une publication du SaaS sur le dépôt public (export --publish) : la version de
 * saas/package.json doit être la dernière du CHANGELOG, sans « Prochaine publication » restante.
 * Renvoie { errors, tag, title, notes } ; `notes` = texte de la section, liens vers le tag.
 */
export function releasePlan({ version, changelog, repoSlug }) {
  const errors = [];
  const sections = changelogSections(changelog);
  const pending = sections.find((s) => s.title === NEXT_HEADING);
  if (!isVersion(version)) errors.push(`version de saas/package.json invalide : « ${version ?? ''} » (format X.Y.Z).`);
  if (pending?.body.trim()) {
    errors.push(`la section « ${NEXT_HEADING} » de CHANGELOG.md n'est pas numérotée : lancez l'export avec --set-version X.Y.Z, relisez, commitez, puis publiez.`);
  }
  const latest = sections.find((s) => s.version);
  if (!latest) errors.push('CHANGELOG.md n\'a aucune section « ## X.Y.Z (date) ».');
  else if (isVersion(version) && latest.version !== version) {
    errors.push(`saas/package.json est en ${version} mais la dernière version du CHANGELOG est ${latest.version}.`);
  } else if (!latest.body.trim()) errors.push(`la section ${latest.version} de CHANGELOG.md est vide : pas de notes de version.`);
  if (errors.length) return { errors };
  const tag = `saas-v${version}`;
  const security = Boolean(subsection(latest.body, 'Sécurité'));
  return {
    errors,
    tag,
    title: `SaaS Polabooth ${version}${security ? ' — correctif de sécurité' : ''}`,
    notes: `${absolutizeLinks(latest.body, `https://github.com/${repoSlug}/blob/${tag}/`)}\n`,
  };
}

/** « propriétaire/dépôt » d'une adresse GitHub (https ou ssh), null sinon. */
export function githubSlug(remote) {
  const m = String(remote ?? '').trim().match(/github\.com[:/]+([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

// ── Hébergement (HOSTING de instance.env) ───────────────────────────────────────────────────

export const HOSTS = ['vercel', 'netlify', 'cloudflare'];
const PROJECT_RE = /^[a-z0-9][a-z0-9-]{0,62}$/i;

/**
 * Hébergeur de la mise en ligne automatique : { host, project, errors }. `host` null = mise en ligne à la
 * main (HOSTING vide ou « manual »). HOSTING_PROJECT : nom du site Netlify (facultatif) ou du projet
 * Cloudflare Pages (obligatoire), inutile pour Vercel (projet demandé la première fois) ; lettres,
 * chiffres et tirets seulement (il est passé sur une ligne de commande).
 */
export function hostingConfig(values) {
  const v = (name) => String(values?.[name] ?? '').trim();
  const errors = [];
  const raw = v('HOSTING').toLowerCase();
  const host = raw && raw !== 'manual' ? raw : null;
  if (host && !HOSTS.includes(host)) {
    errors.push(`HOSTING invalide (« ${v('HOSTING')} ») : vercel, netlify, cloudflare, ou vide pour mettre le site en ligne vous-même.`);
  }
  const project = v('HOSTING_PROJECT') || null;
  if (project && !PROJECT_RE.test(project)) {
    errors.push(`HOSTING_PROJECT invalide (« ${project} ») : nom du projet chez l'hébergeur, lettres, chiffres et tirets.`);
  }
  if (host === 'cloudflare' && !project) {
    errors.push('HOSTING_PROJECT est vide : indiquez le nom du projet Cloudflare Pages (Workers & Pages).');
  }
  return { host: errors.length ? null : host, project: errors.length ? null : project, errors };
}

/**
 * Commande de mise en ligne du dossier dist/ : { cwd ('saas' ou 'dist'), command, args, label }, null
 * sans hébergeur. Lancée par npx (rien à installer), connexion au compte demandée la première fois.
 */
export function deployCommand({ host, project }) {
  switch (host) {
    case 'vercel':
      // Depuis dist/ (comme l'installation à la main, dist/vercel.json lu par Vercel) : projet demandé la
      // première fois, lien (.vercel/) gardé par le script dans .instance/ (le build vide dist/).
      return { cwd: 'dist', command: 'npx', args: ['--yes', 'vercel', 'deploy', '--prod'], label: 'Vercel' };
    case 'netlify':
      return { cwd: 'saas', command: 'npx', args: ['--yes', 'netlify-cli', 'deploy', '--prod', '--dir', 'dist', ...(project ? ['--site', project] : [])], label: 'Netlify' };
    case 'cloudflare':
      return { cwd: 'saas', command: 'npx', args: ['--yes', 'wrangler', 'pages', 'deploy', 'dist', '--project-name', project], label: 'Cloudflare Pages' };
    default:
      return null;
  }
}

// ── Copie locale ────────────────────────────────────────────────────────────────────────────

/**
 * Fichiers suivis modifiés à la main, d'après `git status --porcelain --untracked-files=no` : la mise à
 * jour s'arrête avant toute migration (un fichier modifié bloquerait le pull, une migration modifiée ne
 * serait jamais rejouée). Renvoie les chemins, migrations en premier.
 */
export function modifiedFiles(porcelain) {
  const paths = String(porcelain ?? '').split('\n').filter((l) => l.trim()).map((line) => {
    const path = line.slice(3).trim();
    const arrow = path.indexOf(' -> ');
    return (arrow >= 0 ? path.slice(arrow + 4) : path).replace(/^"|"$/g, '');
  });
  const isMigration = (p) => p.includes('supabase/migrations/');
  return [...paths.filter(isMigration), ...paths.filter((p) => !isMigration(p))];
}

/**
 * Point de départ d'une mise à jour : la dernière version installée en entier (état enregistré), sinon
 * le code avant le pull. `firstRun` : aucun état et rien de nouveau au pull (première fois avec la
 * commande, après un « git pull » à la main) ; les « À faire » à montrer sont alors ceux de la version
 * en place, faute de connaître la précédente.
 */
export function updateStart({ state, before, afterSha }) {
  if (state) return { version: state.version, sha: state.sha, firstRun: false };
  return { version: before.version, sha: before.sha, firstRun: before.sha === afterSha };
}

/** « À faire » à afficher : versions installées depuis `from`, ou la version en place seule (firstRun). */
export function todosToShow(text, { from, to, firstRun }) {
  if (!firstRun || compareVersions(from, to) < 0) return todosBetween(text, from, to);
  const older = versionSections(text).map((s) => s.version).find((v) => compareVersions(v, to) < 0);
  return todosBetween(text, older ?? '0.0.0', to);
}

/** État enregistré après une mise à jour complète (.instance/version.json), null s'il est illisible. */
export function parseState(text) {
  try {
    const s = JSON.parse(String(text));
    return s && typeof s.sha === 'string' && s.sha ? { version: String(s.version ?? ''), sha: s.sha, date: s.date ?? null } : null;
  } catch {
    return null;
  }
}
