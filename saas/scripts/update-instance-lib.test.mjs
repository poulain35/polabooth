import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  isVersion, compareVersions, versionLabel, frenchDate, changelogSections, versionSections, subsection,
  todosBetween, stampChangelog, absolutizeLinks, releasePlan, githubSlug, hostingConfig, deployCommand,
  modifiedFiles, parseState, updateStart, todosToShow, NEXT_HEADING,
} from './update-instance-lib.mjs';

const CHANGELOG = `# Nouveautés de Polabooth

Intro.

---

## Comment mettre à jour

\`\`\`
## pas un titre (bloc de code)
npm run update-instance
\`\`\`

---

## ${NEXT_HEADING}

### À faire

1. Relancer la borne.

### SaaS

- Correctif.

---

## 1.1.0 (2 décembre 2026)

### À faire

1. Remplir HOSTING dans instance.env.

### Sécurité

- Faille corrigée, voir [le guide](docs/installation-instance.md#10).

---

## 1.0.0 (13 novembre 2026)

Première publication.
`;

test('versions : format, comparaison, libellé', () => {
  assert.ok(isVersion('1.0.0'));
  assert.ok(!isVersion('1.0'));
  assert.ok(!isVersion('v1.0.0'));
  assert.ok(compareVersions('1.10.0', '1.9.9') > 0);
  assert.ok(compareVersions('1.0.0', '1.0.1') < 0);
  assert.equal(compareVersions('2.0.0', '2.0.0'), 0);
  assert.ok(compareVersions('1.0.0', '') > 0, 'version illisible = 0.0.0');
  assert.equal(versionLabel('1.2.0', 'abcdef123456'), '1.2.0 (abcdef1)');
  assert.equal(versionLabel('1.2.0', ''), '1.2.0');
  assert.equal(versionLabel('', 'abcdef123456'), 'abcdef1');
  assert.equal(versionLabel('', ''), '');
});

test('frenchDate : jour sans zéro, mois en français', () => {
  assert.equal(frenchDate(new Date('2026-08-05T10:00:00Z')), '5 août 2026');
  assert.equal(frenchDate('2026-11-19T00:00:00Z'), '19 novembre 2026');
});

test('changelogSections : titres hors blocs de code, versions et dates', () => {
  const sections = changelogSections(CHANGELOG);
  assert.deepEqual(sections.map((s) => s.title), ['Comment mettre à jour', NEXT_HEADING, '1.1.0 (2 décembre 2026)', '1.0.0 (13 novembre 2026)']);
  assert.deepEqual(versionSections(CHANGELOG).map((s) => [s.version, s.date]), [['1.1.0', '2 décembre 2026'], ['1.0.0', '13 novembre 2026']]);
  assert.equal(versionSections(CHANGELOG)[1].body, 'Première publication.', 'sans « --- » ni lignes vides au bord');
});

test('subsection : texte sous un « ### », vide si absent', () => {
  const [v110] = versionSections(CHANGELOG);
  assert.equal(subsection(v110.body, 'à faire'), '1. Remplir HOSTING dans instance.env.');
  assert.equal(subsection(v110.body, 'Borne'), '');
});

test('todosBetween : versions installées seulement, de la plus ancienne à la plus récente', () => {
  assert.deepEqual(todosBetween(CHANGELOG, '1.0.0', '1.1.0'), [{ version: '1.1.0', todo: '1. Remplir HOSTING dans instance.env.' }]);
  assert.deepEqual(todosBetween(CHANGELOG, '1.1.0', '1.1.0'), []);
  assert.deepEqual(todosBetween(CHANGELOG, '', '1.0.0'), [], '1.0.0 sans « À faire »');
  const more = CHANGELOG.replace('Première publication.', '### À faire\n\n1. Tout installer.');
  assert.deepEqual(todosBetween(more, '0.0.0', '1.1.0').map((t) => t.version), ['1.0.0', '1.1.0']);
});

test('stampChangelog : numérote « Prochaine publication », refuse une version déjà passée', () => {
  const { text, error } = stampChangelog(CHANGELOG, '1.2.0', new Date('2026-12-20T12:00:00Z'));
  assert.equal(error, undefined);
  assert.match(text, /^## 1\.2\.0 \(20 décembre 2026\)$/m);
  assert.ok(!text.includes(`## ${NEXT_HEADING}`));
  assert.equal(versionSections(text)[0].version, '1.2.0');
  assert.match(stampChangelog(CHANGELOG, '1.1.0', new Date()).error, /plus récente/);
  assert.match(stampChangelog(CHANGELOG, '1.2', new Date()).error, /invalide/);
  assert.match(stampChangelog(text, '1.3.0', new Date()).error, /pas de section/);
  const empty = CHANGELOG.replace(/## Prochaine publication[\s\S]*?(?=## 1\.1\.0)/, `## ${NEXT_HEADING}\n\n---\n\n`);
  assert.match(stampChangelog(empty, '1.2.0', new Date()).error, /vide/);
  const crlf = stampChangelog(CHANGELOG.replace(/\n/g, '\r\n'), '1.2.0', new Date('2026-12-20T12:00:00Z')).text;
  assert.match(crlf, /## 1\.2\.0 \(20 décembre 2026\)\r\n/, 'fin de ligne Windows gardée');
});

test('absolutizeLinks : liens relatifs vers le tag, adresses et ancres gardées', () => {
  const base = 'https://github.com/o/r/blob/saas-v1.1.0/';
  assert.equal(absolutizeLinks('[a](docs/x.md#10) [b](./README.md)', base), `[a](${base}docs/x.md#10) [b](${base}README.md)`);
  const kept = '[c](https://ex.com) [d](#ancre) [e](mailto:a@b.c) [f](/racine)';
  assert.equal(absolutizeLinks(kept, base), kept);
});

test('releasePlan : version de package.json = dernière du CHANGELOG, sans section en attente', () => {
  const stamped = stampChangelog(CHANGELOG, '1.2.0', new Date('2026-12-20T12:00:00Z')).text;
  const plan = releasePlan({ version: '1.2.0', changelog: stamped, repoSlug: 'o/r' });
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.tag, 'saas-v1.2.0');
  assert.equal(plan.title, 'SaaS Polabooth 1.2.0');
  assert.match(plan.notes, /^### À faire\n\n1\. Relancer la borne\./);
  assert.ok(!plan.notes.includes('1.1.0'), 'notes de la seule version publiée');

  const security = releasePlan({ version: '1.1.0', changelog: CHANGELOG.replace(/## Prochaine publication[\s\S]*?(?=## 1\.1\.0)/, ''), repoSlug: 'o/r' });
  assert.deepEqual(security.errors, []);
  assert.equal(security.title, 'SaaS Polabooth 1.1.0 — correctif de sécurité');
  assert.match(security.notes, /\(https:\/\/github\.com\/o\/r\/blob\/saas-v1\.1\.0\/docs\/installation-instance\.md#10\)/);

  assert.match(releasePlan({ version: '1.1.0', changelog: CHANGELOG, repoSlug: 'o/r' }).errors.join(' '), /--set-version/);
  assert.match(releasePlan({ version: '1.0.0', changelog: stamped, repoSlug: 'o/r' }).errors.join(' '), /dernière version du CHANGELOG est 1\.2\.0/);
  assert.match(releasePlan({ version: '0.0', changelog: stamped, repoSlug: 'o/r' }).errors.join(' '), /invalide/);
  assert.match(releasePlan({ version: '1.0.0', changelog: '# Rien', repoSlug: 'o/r' }).errors.join(' '), /aucune section/);
});

test('releasePlan : « Prochaine publication » vide tolérée (rien en attente)', () => {
  const text = CHANGELOG.replace(/## Prochaine publication[\s\S]*?(?=## 1\.1\.0)/, `## ${NEXT_HEADING}\n\n---\n\n`);
  assert.deepEqual(releasePlan({ version: '1.1.0', changelog: text, repoSlug: 'o/r' }).errors, []);
});

test('githubSlug : https, ssh, .git', () => {
  assert.equal(githubSlug('https://github.com/loueur/polabooth.git'), 'loueur/polabooth');
  assert.equal(githubSlug('git@github.com:loueur/polabooth.git'), 'loueur/polabooth');
  assert.equal(githubSlug('https://github.com/o/r'), 'o/r');
  assert.equal(githubSlug('https://gitlab.com/o/r'), null);
  assert.equal(githubSlug(''), null);
});

test('hostingConfig : vide ou manual = à la main, valeurs connues, projet obligatoire pour Cloudflare', () => {
  assert.deepEqual(hostingConfig({}), { host: null, project: null, errors: [] });
  assert.deepEqual(hostingConfig({ HOSTING: 'manual' }), { host: null, project: null, errors: [] });
  assert.deepEqual(hostingConfig({ HOSTING: ' Vercel ' }), { host: 'vercel', project: null, errors: [] });
  assert.deepEqual(hostingConfig({ HOSTING: 'netlify', HOSTING_PROJECT: 'mon-site' }), { host: 'netlify', project: 'mon-site', errors: [] });
  assert.match(hostingConfig({ HOSTING: 'ovh' }).errors[0], /HOSTING invalide/);
  assert.match(hostingConfig({ HOSTING: 'cloudflare' }).errors[0], /Cloudflare Pages/);
  const bad = hostingConfig({ HOSTING: 'vercel', HOSTING_PROJECT: 'a b; rm' });
  assert.match(bad.errors[0], /HOSTING_PROJECT invalide/);
  assert.equal(bad.host, null, 'jamais de commande avec une erreur');
});

test('deployCommand : une commande par hébergeur, rien à la main', () => {
  assert.equal(deployCommand({ host: null }), null);
  assert.deepEqual(deployCommand({ host: 'vercel', project: null }), { cwd: 'dist', command: 'npx', args: ['--yes', 'vercel', 'deploy', '--prod'], label: 'Vercel' });
  assert.deepEqual(deployCommand({ host: 'vercel', project: 'p' }).args, ['--yes', 'vercel', 'deploy', '--prod'], 'projet Vercel demandé la première fois');
  assert.deepEqual(deployCommand({ host: 'netlify', project: 's' }).args, ['--yes', 'netlify-cli', 'deploy', '--prod', '--dir', 'dist', '--site', 's']);
  assert.deepEqual(deployCommand({ host: 'cloudflare', project: 'c' }).args, ['--yes', 'wrangler', 'pages', 'deploy', 'dist', '--project-name', 'c']);
});

test('modifiedFiles : chemins du statut git, renommages, migrations en premier', () => {
  const porcelain = ' M saas/src/App.jsx\nM  saas/supabase/migrations/2026_x.sql\nR  a.txt -> b.txt\n M "saas/dossier espace/f.js"\n';
  assert.deepEqual(modifiedFiles(porcelain), ['saas/supabase/migrations/2026_x.sql', 'saas/src/App.jsx', 'b.txt', 'saas/dossier espace/f.js']);
  assert.deepEqual(modifiedFiles(''), []);
});

test('updateStart : part de la dernière version installée en entier', () => {
  const before = { version: '1.1.0', sha: 'bbb' };
  assert.deepEqual(updateStart({ state: { version: '1.0.0', sha: 'aaa' }, before, afterSha: 'ccc' }),
    { version: '1.0.0', sha: 'aaa', firstRun: false }, 'tour précédent interrompu après le pull');
  assert.deepEqual(updateStart({ state: null, before, afterSha: 'ccc' }), { version: '1.1.0', sha: 'bbb', firstRun: false });
  assert.deepEqual(updateStart({ state: null, before, afterSha: 'bbb' }), { version: '1.1.0', sha: 'bbb', firstRun: true },
    'git pull fait à la main avant la première utilisation');
});

test('todosToShow : première fois, les « À faire » de la version en place', () => {
  assert.deepEqual(todosToShow(CHANGELOG, { from: '1.1.0', to: '1.1.0', firstRun: true }).map((t) => t.version), ['1.1.0']);
  assert.deepEqual(todosToShow(CHANGELOG, { from: '1.1.0', to: '1.1.0', firstRun: false }), []);
  assert.deepEqual(todosToShow(CHANGELOG, { from: '1.0.0', to: '1.1.0', firstRun: true }).map((t) => t.version), ['1.1.0']);
  assert.deepEqual(todosToShow(CHANGELOG, { from: '1.0.0', to: '1.0.0', firstRun: true }), [], '1.0.0 sans « À faire »');
});

test('parseState : état enregistré, illisible = null', () => {
  assert.deepEqual(parseState('{"version":"1.0.0","sha":"abc","date":"2026-11-19"}'), { version: '1.0.0', sha: 'abc', date: '2026-11-19' });
  assert.equal(parseState('{"version":"1.0.0"}'), null);
  assert.equal(parseState('pas du json'), null);
});

test('CHANGELOG public : dernière version lisible, titres de version au bon format', () => {
  // Dépôt privé : open-core/overrides/CHANGELOG.md ; dépôt public : CHANGELOG.md à la racine.
  const sources = ['../../open-core/overrides/CHANGELOG.md', '../../CHANGELOG.md'].map((p) => new URL(p, import.meta.url));
  const source = sources.find((url) => existsSync(url));
  assert.ok(source, 'CHANGELOG.md introuvable');
  const text = readFileSync(source, 'utf8');
  const versions = versionSections(text);
  assert.ok(versions.length > 0, 'au moins une section « ## X.Y.Z (date) »');
  for (let i = 1; i < versions.length; i++) {
    assert.ok(compareVersions(versions[i - 1].version, versions[i].version) > 0, 'versions de la plus récente à la plus ancienne');
  }
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(compareVersions(pkg.version, versions[0].version) >= 0, 'saas/package.json au moins à la dernière version publiée');
});
