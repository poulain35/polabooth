// Met à jour une instance du SaaS en une commande (LAB-432) : npm run update-instance — guide :
// docs/installation-instance.md, section 10.
//
// 1. Vérifie la copie locale (aucun fichier suivi modifié à la main, branche reliée au dépôt d'origine)
//    et instance.env (HOSTING).
// 2. Récupère la nouvelle version (git pull --ff-only), puis se relance : la suite tourne avec le script
//    à jour (--after-pull, option interne).
// 3. Affiche les « À faire » des versions installées (CHANGELOG.md), npm ci, npm run install-instance
//    (base, fonctions, secrets, construction de dist/), puis met le site en ligne chez l'hébergeur de
//    HOSTING (Vercel, Netlify, Cloudflare Pages ; vide = à la main).
// 4. Enregistre la version installée dans saas/.instance/version.json (seulement si tout a réussi :
//    relancer reprend une mise à jour interrompue, même sans nouveau code).
// S'arrête à la première erreur, avec un message. Aucun secret affiché ni passé en argument.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parseEnvFile } from './install-instance-lib.mjs';
import {
  deployCommand, hostingConfig, modifiedFiles, parseState, todosToShow, updateStart, versionLabel,
} from './update-instance-lib.mjs';

const SAAS_DIR = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = fileURLToPath(import.meta.url);
const STATE_DIR = join(SAAS_DIR, '.instance');
const STATE_FILE = join(STATE_DIR, 'version.json');
const VERCEL_LINK = join(STATE_DIR, 'vercel-project.json');
const isWindows = process.platform === 'win32';

class UpdateError extends Error {}

const USAGE = `Mise à jour d'une instance du SaaS photobooth.

  npm run update-instance [-- options]

Récupère la dernière version (git pull), installe les dépendances (npm ci), lance npm run install-instance
(base, fonctions, construction du site), puis met le site en ligne chez l'hébergeur de HOSTING (instance.env).

Options :
  --config <fichier>     Fichier de configuration (défaut : saas/instance.env).
  --skip-deploy          Ne met pas le site en ligne (dossier dist/ prêt, à déposer vous-même).
  --skip-email-test      Vérifications : connexion à la messagerie sans envoyer l'email de test.
  --skip-checks          Saute les vérifications de la messagerie et du stockage (déconseillé).
  --force                Relance l'installation et la mise en ligne même sans nouvelle version.
  --help                 Cette aide.

Guide : docs/installation-instance.md (section 10)`;

// ── Affichage ───────────────────────────────────────────────────────────────────────────────

const color = (code) => (text) => (process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text);
const bold = color('1');
const green = color('32');
const yellow = color('33');
const red = color('31');
const step = (text) => console.log(`\n${bold(text)}`);
const ok = (text) => console.log(`   ${green('✓')} ${text}`);
const info = (text) => console.log(`   ${text}`);
const warn = (text) => console.log(`   ${yellow('!')} ${text}`);

// ── Commandes ───────────────────────────────────────────────────────────────────────────────

const quoteArg = (arg) => (/[\s"&|<>^()%!]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg);

/** Lance une commande. `inherit` : messages affichés (et questions possibles) ; sinon sortie capturée. */
function run(command, args, { cwd = SAAS_DIR, inherit = false } = {}) {
  const options = {
    cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  };
  // npm et npx sont des scripts .cmd sous Windows : il faut passer par le shell.
  const res = isWindows && ['npm', 'npx'].includes(command)
    ? spawnSync([command, ...args.map(quoteArg)].join(' '), { ...options, shell: true })
    : spawnSync(command, args, options);
  if (res.error) {
    const missing = res.error.code === 'ENOENT';
    throw new UpdateError(missing
      ? `${command} est introuvable : ${command === 'git' ? 'installez git (https://git-scm.com)' : 'installez Node.js (https://nodejs.org)'}, puis relancez.`
      : `${command} : ${res.error.message}`);
  }
  return { ok: res.status === 0, status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

function git(args) {
  const res = run('git', args);
  if (!res.ok) throw new UpdateError(`git ${args.join(' ')} a échoué :\n   ${res.stderr.trim().split('\n').slice(-4).join('\n   ')}`);
  return res.stdout.trim();
}

const packageVersion = () => JSON.parse(readFileSync(join(SAAS_DIR, 'package.json'), 'utf8')).version ?? '';

function readState() {
  return existsSync(STATE_FILE) ? parseState(readFileSync(STATE_FILE, 'utf8')) : null;
}

// ── Étape 1 : copie locale et instance.env ──────────────────────────────────────────────────

function repoRoot() {
  const res = run('git', ['rev-parse', '--show-toplevel']);
  if (!res.ok) {
    throw new UpdateError('Ce dossier n\'est pas un clone git (dépôt téléchargé en ZIP ?) : la mise à jour automatique '
      + 'demande un « git clone » du dépôt. Voir docs/installation-instance.md, section 10.');
  }
  return res.stdout.trim();
}

function checkWorkingCopy(root) {
  step('1. Copie locale');
  const files = modifiedFiles(run('git', ['-C', root, 'status', '--porcelain', '--untracked-files=no']).stdout);
  if (files.length) {
    const list = files.slice(0, 20).map((f) => `   - ${f}`).join('\n');
    const more = files.length > 20 ? `\n   … et ${files.length - 20} autres` : '';
    throw new UpdateError(`${files.length} fichier(s) du dépôt modifié(s) à la main : la mise à jour s'arrête avant toute migration.\n${list}${more}\n`
      + '   Réglez votre instance dans instance.env seulement. Pour annuler une modification : git checkout -- <fichier> ;\n'
      + '   pour la mettre de côté : git stash. Puis relancez npm run update-instance.');
  }
  ok('Aucun fichier du dépôt modifié');
  const upstream = run('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  if (!upstream.ok) {
    throw new UpdateError('La branche actuelle n\'est pas reliée au dépôt d\'origine (git pull ne saurait pas où chercher).\n'
      + '   Revenez sur la branche principale : git checkout main, puis relancez.');
  }
  ok(`Branche reliée à ${upstream.stdout.trim()}`);
}

function readHosting(envFile) {
  if (!existsSync(envFile)) {
    throw new UpdateError(`Fichier introuvable : ${envFile}\n   La mise à jour suit l'installation : faites d'abord npm run install-instance (docs/installation-instance.md).`);
  }
  const { values } = parseEnvFile(readFileSync(envFile, 'utf8'));
  const hosting = hostingConfig(values);
  if (hosting.errors.length) {
    throw new UpdateError(`${envFile} :\n${hosting.errors.map((e) => `   - ${e}`).join('\n')}`);
  }
  ok(`${envFile} lu · mise en ligne : ${hosting.host ? deployCommand(hosting).label : 'à la main (HOSTING vide)'}`);
  return hosting;
}

// ── Étape 2 : nouvelle version ──────────────────────────────────────────────────────────────

function pull() {
  step('2. Nouvelle version');
  const fetched = run('git', ['fetch', '--quiet'], { inherit: true });
  if (!fetched.ok) throw new UpdateError('git fetch a échoué : vérifiez la connexion Internet et l\'accès au dépôt, puis relancez.');
  const pulled = run('git', ['pull', '--ff-only', '--quiet'], { inherit: true });
  if (!pulled.ok) {
    throw new UpdateError('git pull a échoué (voir le message ci-dessus). Si vous avez fait des commits sur ce dossier, '
      + 'la copie ne suit plus le dépôt d\'origine : remettez-la comme lui (git status, git log) ou recommencez par un nouveau clone.');
  }
}

// ── Étape 3 : installation et mise en ligne (après le pull, script à jour) ──────────────────

function changelogText(root) {
  const path = join(root, 'CHANGELOG.md');
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function printTodos(todos) {
  for (const { version, todo } of todos) {
    console.log(`\n   ${bold(`À faire pour la version ${version} :`)}`);
    todo.split('\n').forEach((line) => console.log(`   ${line}`));
  }
}

function installStep(forwarded) {
  step('4. Dépendances (npm ci)');
  if (!run('npm', ['ci', '--no-audit', '--no-fund'], { inherit: true }).ok) {
    throw new UpdateError('npm ci a échoué (voir ci-dessus). Vérifiez la connexion Internet et la version de Node.js, puis relancez.');
  }
  ok('Dépendances installées');
  step('5. Installation (npm run install-instance)');
  if (!run('npm', ['run', 'install-instance', ...(forwarded.length ? ['--', ...forwarded] : [])], { inherit: true }).ok) {
    throw new UpdateError('L\'installation a échoué (voir ci-dessus). Corrigez le problème, puis relancez npm run update-instance : '
      + 'le code est déjà à jour, la mise à jour reprend à l\'installation.');
  }
}

function deploy(hosting) {
  step('6. Mise en ligne');
  const command = deployCommand(hosting);
  if (!command) {
    info('HOSTING est vide : déposez le dossier saas/dist/ chez votre hébergeur, comme à l\'installation');
    info('(docs/installation-instance.md, section 6). Pour l\'automatiser : HOSTING dans instance.env.');
    return;
  }
  const distDir = join(SAAS_DIR, 'dist');
  if (!existsSync(join(distDir, 'index.html'))) throw new UpdateError('dist/ est vide : la construction du site n\'a pas eu lieu.');
  const distLink = join(distDir, '.vercel', 'project.json');
  if (hosting.host === 'vercel' && existsSync(VERCEL_LINK)) {
    // Le build vide dist/ : on y remet le lien au projet Vercel gardé à la dernière mise en ligne.
    mkdirSync(dirname(distLink), { recursive: true });
    copyFileSync(VERCEL_LINK, distLink);
  }
  info(`${command.label} : ${command.command} ${command.args.join(' ')} (la première fois, connexion au compte et choix du projet)`);
  const cwd = command.cwd === 'dist' ? distDir : SAAS_DIR;
  if (!run(command.command, command.args, { cwd, inherit: true }).ok) {
    throw new UpdateError(`La mise en ligne sur ${command.label} a échoué (voir ci-dessus). Le site construit est dans saas/dist/ : `
      + 'relancez npm run update-instance, ou déposez-le vous-même (section 6 du guide).');
  }
  if (hosting.host === 'vercel' && existsSync(distLink)) {
    mkdirSync(STATE_DIR, { recursive: true });
    copyFileSync(distLink, VERCEL_LINK);
  }
  ok(`Site mis en ligne sur ${command.label}`);
}

// ── Programme ───────────────────────────────────────────────────────────────────────────────

function forwardedArgs(args, envFile) {
  return [
    ...(args.config ? ['--config', envFile] : []),
    ...(args['skip-email-test'] ? ['--skip-email-test'] : []),
    ...(args['skip-checks'] ? ['--skip-checks'] : []),
  ];
}

function beforePull(args, envFile) {
  console.log(bold('Mise à jour de l\'instance'));
  const root = repoRoot();
  checkWorkingCopy(root);
  readHosting(envFile); // erreur de HOSTING signalée avant le pull
  const fromVersion = packageVersion();
  const fromSha = git(['rev-parse', 'HEAD']);
  info(`Version installée : ${versionLabel(fromVersion, fromSha)}`);
  pull();
  const toSha = git(['rev-parse', 'HEAD']);
  const state = readState();
  const start = updateStart({ state, before: { version: fromVersion, sha: fromSha }, afterSha: toSha });
  if (toSha === fromSha) {
    if (state?.sha === toSha && !args.force) {
      ok(`Déjà à jour : Polabooth ${versionLabel(fromVersion, fromSha)}. Rien à faire.`);
      info('(--force relance l\'installation et la mise en ligne quand même.)');
      return 0;
    }
    if (state?.sha === toSha) info('Pas de nouvelle version : installation relancée (--force).');
    else if (start.firstRun) info('Pas de nouveau code depuis votre dernier « git pull » : la version en place est installée.');
    else info('Pas de nouveau code, mais la dernière mise à jour n\'est pas allée au bout : elle reprend.');
  } else ok(`Nouvelle version récupérée : ${versionLabel(packageVersion(), toSha)}`);
  // Relance du script à jour (il a pu changer avec le pull) pour la suite.
  const res = spawnSync(process.execPath, [SCRIPT, '--after-pull', '--from-version', start.version || '0.0.0', '--from-sha', start.sha,
    ...(start.firstRun ? ['--first-run'] : []), ...forwardedArgs(args, envFile), ...(args['skip-deploy'] ? ['--skip-deploy'] : [])], { cwd: SAAS_DIR, stdio: 'inherit' });
  if (res.error) throw new UpdateError(`relance du script impossible : ${res.error.message}`);
  return res.status ?? 1;
}

function afterPull(args, envFile) {
  const root = repoRoot();
  const fromVersion = args['from-version'] ?? '';
  const fromSha = args['from-sha'] ?? '';
  const toVersion = packageVersion();
  const toSha = git(['rev-parse', 'HEAD']);
  const hosting = readHosting(envFile);
  step('3. Ce qui change');
  info(`Polabooth ${versionLabel(fromVersion, fromSha)} → ${versionLabel(toVersion, toSha)}`);
  const todos = todosToShow(changelogText(root), { from: fromVersion, to: toVersion, firstRun: args['first-run'] });
  if (todos.length) printTodos(todos);
  else info('Aucune action à la main annoncée par CHANGELOG.md.');
  info('Détail des nouveautés : CHANGELOG.md (à la racine du dépôt).');
  installStep(forwardedArgs(args, envFile));
  if (args['skip-deploy']) {
    step('6. Mise en ligne');
    info('Sautée (--skip-deploy) : déposez saas/dist/ chez votre hébergeur (section 6 du guide).');
  } else deploy(hosting);
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, `${JSON.stringify({ version: toVersion, sha: toSha, date: new Date().toISOString() }, null, 2)}\n`);
  console.log(`\n${green(`Mise à jour terminée : Polabooth ${versionLabel(fromVersion, fromSha)} → ${versionLabel(toVersion, toSha)}.`)}`);
  if (todos.length) {
    console.log(yellow('N\'oubliez pas les actions « À faire » ci-dessus (rappel) :'));
    printTodos(todos);
  }
  return 0;
}

function main() {
  const { values: args } = parseArgs({
    options: {
      config: { type: 'string' },
      'skip-deploy': { type: 'boolean', default: false },
      'skip-email-test': { type: 'boolean', default: false },
      'skip-checks': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
      // Options internes : relance du script après le pull.
      'after-pull': { type: 'boolean', default: false },
      'from-version': { type: 'string' },
      'from-sha': { type: 'string' },
      'first-run': { type: 'boolean', default: false },
    },
  });
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  const envFile = resolve(args.config ?? join(SAAS_DIR, 'instance.env'));
  return args['after-pull'] ? afterPull(args, envFile) : beforePull(args, envFile);
}

try {
  process.exitCode = main();
} catch (e) {
  const known = e instanceof UpdateError || e?.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION';
  console.error(`\n${red('Erreur :')} ${known ? e.message : (e?.stack ?? e)}`);
  console.error('Rien n\'est perdu : corrigez le problème, puis relancez npm run update-instance.');
  process.exitCode = 1;
}
