// LAB-127 : event_form_responses, support_messages, planning_entries, gallery_analytics et print_logs
// réservées au propriétaire de l'organisation ; insertions anonymes (formulaire, aide, galerie,
// kiosk) conservées. Contrôles statiques de la migration, du script de vérification, du front, des
// edge functions et du kiosk (lecture seule).
// Exécution : `npm test` (runner natif Node, strip-types — aucune dépendance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRIVATE_HISTORY, readPrivateHistory } from '../../../scripts/private-history.mjs';

const DIR = new URL('../../migrations/', import.meta.url);
const MIGRATION = '20261113000000_saas_tables_owner_rls.sql';
const CHECK = fileURLToPath(new URL('../../tests/lab127_saas_tables_rls_check.sql', import.meta.url));
const FUNCTIONS = fileURLToPath(new URL('../', import.meta.url));
const SRC = fileURLToPath(new URL('../../../src/', import.meta.url));
const KIOSK = fileURLToPath(new URL('../../../../kiosk/', import.meta.url));

const strip = (s: string) => s.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
const norm = (s: string) => flat(s).replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');
const read = (f: string) => strip(readFileSync(new URL(f, DIR), 'utf8'));
const sql = strip(readPrivateHistory(new URL(MIGRATION, DIR)));
const all = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

const TABLES = ['event_form_responses', 'support_messages', 'planning_entries', 'gallery_analytics', 'print_logs'];
// Policies authenticated en true retirées (inventaire pg_policies du 2026-10-27, prod et dev).
const PERMISSIVE: Record<string, string> = {
  event_form_responses: 'auth_read_form_responses',
  support_messages: 'admin_full_access_support_messages',
  planning_entries: 'admin_full_access_planning',
  gallery_analytics: 'admin_full_access_gallery_analytics',
  print_logs: 'admin_full_access_print_logs',
};
// Policies anon à garder (dont la policy partagée anon + authenticated de la prod).
const ANON_POLICIES: Record<string, string[]> = {
  event_form_responses: ['anon_insert_form_response', 'anon_insert_form_responses', 'anon peut soumettre une réponse au formulaire'],
  support_messages: ['anon_insert_support_messages'],
  gallery_analytics: ['anon_insert_gallery_analytics'],
  print_logs: ['anon_insert_print_logs'],
};
// Droits authenticated attendus : ceux du front (support_messages : lecture propriétaire seule).
const GRANTS: Record<string, string[]> = {
  event_form_responses: ['SELECT', 'INSERT'],
  support_messages: ['SELECT'],
  planning_entries: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  gallery_analytics: ['SELECT', 'INSERT'],
  print_logs: ['SELECT'],
};
// Droits utilisés aujourd'hui par le front : depuis LAB-227 (20261128000000), la galerie écrit
// gallery_analytics par la RPC track_gallery_event ; depuis LAB-277 (20261216000002), le formulaire
// client passe par la RPC submit_form_response. Plus aucun INSERT direct.
const FRONT_GRANTS: Record<string, string[]> = { ...GRANTS, gallery_analytics: ['SELECT'], event_form_responses: ['SELECT'] };
const OWNER_ORGS = 'IN (SELECT o.id FROM public.organizations o WHERE o.owner_id = auth.uid())';

const policies = () => [...sql.matchAll(/CREATE POLICY (\w+)\s+ON public\.(\w+) FOR (\w+) TO (\w+)([\s\S]*?);/g)]
  .map((m) => ({ name: m[1], table: m[2], cmd: m[3], role: m[4], body: norm(m[5]) }));

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === 'bin' || name === 'obj') return [];
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p, ext);
    return ext.test(p) && !/\.test\.[jt]sx?$/.test(p) ? [p] : [];
  });
}

// Opérations du front par table : from('<table>') suivi de la chaîne d'appels jusqu'au ; ou à la ,
// de fin d'élément de Promise.all.
function frontOps() {
  const ops: Record<string, Set<string>> = Object.fromEntries(TABLES.map((t) => [t, new Set<string>()]));
  const chains: { table: string; chain: string; file: string }[] = [];
  for (const file of files(SRC, /\.(jsx?|tsx?)$/)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/from\(\s*['"`](\w+)['"`]\s*\)((?:\s*\.\w+\((?:[^()]|\([^()]*\))*\))*)/g)) {
      if (!TABLES.includes(m[1])) continue;
      chains.push({ table: m[1], chain: m[2], file });
      for (const op of m[2].matchAll(/\.(select|insert|update|upsert|delete)\(/g)) ops[m[1]].add(op[1].toUpperCase());
    }
  }
  return { ops, chains };
}

test('migration : présente, après LAB-125, timestamp unique', { skip: PRIVATE_HISTORY }, () => {
  assert.ok(all.includes(MIGRATION));
  assert.ok(MIGRATION > '20261112000000_email_logs_rls.sql');
  assert.equal(new Set(all.map((f) => f.split('_')[0])).size, all.length, 'timestamps uniques');
});

test('migration : les cinq policies authenticated en true sont supprimées, sans recréation', { skip: PRIVATE_HISTORY }, () => {
  for (const [table, name] of Object.entries(PERMISSIVE)) {
    assert.match(sql, new RegExp(`DROP POLICY IF EXISTS "${name}"\\s+ON public\\.${table};`), name);
    // La policy existait bien dans les migrations précédentes.
    const before = all.filter((f) => f < MIGRATION).map(read).join('\n');
    assert.ok(before.includes(`"${name}"`), `${name} créée auparavant`);
    assert.doesNotMatch(sql, new RegExp(`CREATE POLICY "?${name}"?\\s`));
  }
  assert.doesNotMatch(sql, /USING \(\s*true\s*\)|WITH CHECK \(\s*true\s*\)/i);
});

test('migration : la boucle de nettoyage ne vise que les policies réservées à authenticated', { skip: PRIVATE_HISTORY }, () => {
  const loop = sql.slice(sql.indexOf('FOR p IN'), sql.indexOf('END LOOP;'));
  assert.match(loop, /AND roles = ARRAY\['authenticated'\]::name\[\]/);
  for (const t of TABLES) assert.ok(loop.includes(`'${t}'`), t);
  // Les policies créées par la migration sont exclues de la boucle.
  for (const p of policies()) assert.ok(loop.includes(`'${p.name}'`), `${p.name} exclue`);
  assert.match(sql, /EXECUTE format\('DROP POLICY IF EXISTS %I ON public\.%I', p\.policyname, p\.tablename\)/);
});

test('migration : aucune policy anon touchée, aucune policy anon supprimée par une migration', { skip: PRIVATE_HISTORY }, () => {
  for (const names of Object.values(ANON_POLICIES)) {
    for (const name of names) assert.ok(!sql.includes(`"${name}"`) && !sql.includes(` ${name} `), `${name} intacte`);
  }
  // Les policies anon d'insertion du dépôt n'ont jamais été supprimées, sauf par LAB-227
  // (20261128000000) pour print_logs et gallery_analytics, désormais écrites par RPC, et par LAB-128 :
  // support_messages (LAB-276, edge function) et event_form_responses (LAB-277, RPC submit_form_response).
  const ALLOWED_DROPS: Record<string, string[]> = {
    '20261128000000_report_reliable_sources.sql': ['print_logs', 'gallery_analytics'],
    '20261216000000_lab128_cleanup_grants.sql': ['support_messages'],
    '20261216000004_lab128_form_responses_lockdown.sql': ['event_form_responses'],
  };
  for (const f of all) {
    for (const [t, names] of Object.entries(ANON_POLICIES)) {
      if (ALLOWED_DROPS[f]?.includes(t)) continue;
      for (const name of names) assert.doesNotMatch(read(f), new RegExp(`DROP POLICY[^;]*"${name}"`), `${f} : ${name}`);
    }
  }
  for (const p of policies()) assert.equal(p.role, 'authenticated', `${p.name} : TO ${p.role}`);
});

test('migration : anon garde INSERT sur les quatre tables à insertion anonyme, rien d\'autre', { skip: PRIVATE_HISTORY }, () => {
  for (const t of Object.keys(ANON_POLICIES)) {
    assert.match(sql, new RegExp(`REVOKE SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public\\.${t}\\s+FROM anon;`), t);
    assert.match(sql, new RegExp(`GRANT INSERT ON public\\.${t}\\s+TO anon;`), t);
    // Jamais REVOKE ALL ni REVOKE INSERT à anon : la policy anon d'insertion en dépend.
    assert.doesNotMatch(sql, new RegExp(`REVOKE (ALL|[^;]*\\bINSERT\\b)[^;]*ON public\\.${t}\\s+FROM anon`), t);
  }
  assert.match(sql, /REVOKE ALL ON public\.planning_entries FROM anon;/);
  for (const g of sql.matchAll(/GRANT ([^;]*?) ON (?:TABLE )?public\.(\w+)\s+TO anon;/g)) {
    assert.equal(g[1], 'INSERT', `GRANT ${g[1]} à anon sur ${g[2]}`);
    assert.notEqual(g[2], 'planning_entries');
  }
});

test('migration : droits authenticated = usages du front, REVOKE ALL d\'abord', { skip: PRIVATE_HISTORY }, () => {
  for (const t of TABLES) {
    const revoke = sql.indexOf(`REVOKE ALL ON public.${t}`);
    const grant = [...sql.matchAll(new RegExp(`GRANT ([A-Z, ]+?)\\s+ON public\\.${t}\\s+TO authenticated;`, 'g'))];
    assert.equal(grant.length, 1, t);
    assert.ok(revoke >= 0 && revoke < grant[0].index!, `${t} : REVOKE puis GRANT`);
    assert.deepEqual(grant[0][1].split(',').map((s) => s.trim()), GRANTS[t], t);
    assert.match(sql, new RegExp(`GRANT ALL ON public\\.${t}\\s+TO service_role;`), t);
  }
  assert.doesNotMatch(sql, /GRANT[^;]*\(\s*\w+[^;]*ON public\.(event_form_responses|support_messages|planning_entries|gallery_analytics|print_logs)/i, 'aucun droit de colonne');

  const { ops } = frontOps();
  for (const t of TABLES) {
    const used = [...ops[t]];
    assert.ok(!used.includes('UPSERT'), `${t} : upsert`);
    for (const op of used) assert.ok(FRONT_GRANTS[t].includes(op), `${t} : le front fait ${op} sans droit`);
    // Pas de droit inutilisé, hormis la lecture propriétaire de support_messages.
    for (const op of FRONT_GRANTS[t]) {
      if (t === 'support_messages' && op === 'SELECT') continue;
      assert.ok(used.includes(op), `${t} : ${op} accordé mais inutilisé par le front`);
    }
  }
  assert.equal(ops.support_messages.size, 0, 'support_messages : aucun accès front (edge function)');
});

test('migration : une policy propriétaire par commande accordée, appartenance organisations.owner_id', { skip: PRIVATE_HISTORY }, () => {
  const ps = policies();
  const byTable = (t: string) => ps.filter((p) => p.table === t).map((p) => p.cmd).sort();
  for (const t of TABLES) assert.deepEqual(byTable(t), [...GRANTS[t]].sort(), t);
  for (const p of ps) {
    assert.ok(p.body.includes(OWNER_ORGS), `${p.name} : appartenance`);
    assert.doesNotMatch(p.body, /\bOR\b|IS NULL/i, `${p.name} : aucune branche qui rouvre l'accès`);
    // Aucune lecture de la table dans sa propre policy (récursion RLS).
    assert.doesNotMatch(p.body, new RegExp(`FROM public\\.${p.table}\\b`), p.name);
    if (p.cmd === 'INSERT') assert.match(p.body, /^WITH CHECK/, p.name);
    else assert.match(p.body, /^USING/, p.name);
    if (p.cmd === 'UPDATE') assert.match(p.body, /WITH CHECK/, p.name);
  }
  // Tables rattachées par l'événement : même jointure events.org_id.
  for (const t of ['event_form_responses', 'gallery_analytics', 'print_logs']) {
    for (const p of ps.filter((x) => x.table === t)) {
      assert.ok(p.body.includes(`FROM public.events ev WHERE ev.id = ${t}.event_id AND ev.org_id ${OWNER_ORGS}`), p.name);
    }
  }
  const support = ps.find((p) => p.name === 'support_messages_owner_select')!;
  assert.ok(support.body.includes('FROM (VALUES (support_messages.org_id, support_messages.event_id)) AS m (org_id, event_id) LEFT JOIN public.events ev ON ev.id = m.event_id WHERE coalesce(m.org_id, ev.org_id) IN'));
  for (const p of ps.filter((x) => x.table === 'planning_entries')) {
    assert.ok(p.body.includes(`org_id ${OWNER_ORGS}`), p.name);
  }
});

test('migration : même expression d\'appartenance que email_events_owner_select (LAB-123)', { skip: PRIVATE_HISTORY }, () => {
  const ref = norm(read('20261111000000_email_tracking.sql'));
  assert.ok(ref.includes(`coalesce(ld.org_id, ev.org_id) ${OWNER_ORGS}`));
});

test('migration : planning_entries.org_id, défaut organisation de l\'utilisateur, reprise, NOT NULL', { skip: PRIVATE_HISTORY }, () => {
  assert.match(sql, /ALTER TABLE public\.planning_entries\s+ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES public\.organizations\(id\) ON DELETE CASCADE;/);
  assert.match(sql, /ALTER COLUMN org_id SET DEFAULT public\.current_owner_org_id\(\);/);
  const fn = flat(sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.current_owner_org_id()'), sql.indexOf('$$;') + 3));
  assert.match(fn, /LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public/);
  assert.match(fn, /WHERE o\.owner_id = auth\.uid\(\) ORDER BY o\.created_at, o\.id LIMIT 1;/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.current_owner_org_id\(\) FROM public;/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.current_owner_org_id\(\) FROM anon;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.current_owner_org_id\(\) TO authenticated;/);
  // Reprise uniquement des lignes sans organisation, NOT NULL seulement s'il n'en reste aucune.
  assert.match(sql, /UPDATE public\.planning_entries SET org_id = target WHERE org_id IS NULL;/);
  assert.match(sql, /IF orphans = 0 THEN\s+ALTER TABLE public\.planning_entries ALTER COLUMN org_id SET NOT NULL;/);
  // Aucune autre modification de données.
  assert.equal([...sql.matchAll(/\bUPDATE public\./g)].length, 1);
  assert.doesNotMatch(sql, /DELETE FROM|TRUNCATE (TABLE )?public|DROP TABLE|DROP COLUMN/i);
});

test('front : la page Planning n\'envoie pas org_id (défaut de colonne) et ne filtre pas par organisation', () => {
  const src = readFileSync(join(SRC, 'lib', 'supabase.js'), 'utf8');
  const create = src.slice(src.indexOf('export async function createPlanningEntry'), src.indexOf('export async function updatePlanningEntry'));
  assert.match(create, /\.from\('planning_entries'\)\s*\.insert\(\{/);
  assert.doesNotMatch(create, /org_id/);
  const update = src.slice(src.indexOf('export async function updatePlanningEntry'), src.indexOf('export async function deletePlanningEntry'));
  assert.doesNotMatch(update, /org_id/, 'org_id jamais modifié par le front');
  const { chains } = frontOps();
  for (const c of chains) assert.doesNotMatch(c.chain, /org_id/, `${c.file} : ${c.table}`);
});

test('front : plus aucune insertion anonyme directe (formulaire par RPC depuis LAB-277)', () => {
  const { chains } = frontOps();
  const anonInserts = chains.filter((c) => /\.insert\(/.test(c.chain) && c.table !== 'planning_entries');
  assert.deepEqual(anonInserts.map((c) => `${c.file} : ${c.table}`), []);
});

test('front : aucun embed de ces tables depuis une autre table', () => {
  const embeds: string[] = [];
  for (const file of files(SRC, /\.(jsx?|tsx?)$/)) {
    const code = readFileSync(file, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\/?\*)/.test(l)).join('\n');
    for (const t of TABLES) if (new RegExp(`['"\`,(\\s]${t}\\s*(!\\w+)?\\s*\\(`).test(code)) embeds.push(`${file}: ${t}`);
  }
  assert.deepEqual(embeds, []);
});

test('edge functions : ces tables ne sont lues ou écrites qu\'en service_role (adminClient)', () => {
  const offenders: string[] = [];
  const users: string[] = [];
  for (const file of files(FUNCTIONS, /\.ts$/)) {
    const rel = file.slice(FUNCTIONS.length).replace(/\\/g, '/');
    const src = readFileSync(file, 'utf8');
    if (!TABLES.some((t) => new RegExp(`from\\(\\s*['"\`]${t}['"\`]\\s*\\)`).test(src))) continue;
    users.push(rel);
    if (/\bcreateClient\(/.test(src)) offenders.push(`${rel} : createClient`);
    if (rel.endsWith('/index.ts') && !/\bconst db\s*=\s*adminClient\(\)/.test(src)) offenders.push(`${rel} : sans adminClient`);
  }
  assert.deepEqual(offenders, []);
  assert.deepEqual(users.sort(), ['check-kiosk-alerts/index.ts', 'get-event/index.ts', 'submit-support-message/index.ts']);
});

test('kiosk (lecture seule) : clé anon, au plus un POST en return=minimal sur print_logs (consentement photo par RPC depuis LAB-223, impressions par RPC depuis LAB-230)', { skip: !existsSync(KIOSK) }, () => {
  const hits: string[] = [];
  for (const file of files(KIOSK, /\.cs$/)) {
    const src = readFileSync(file, 'utf8');
    for (const t of TABLES) {
      for (const m of src.matchAll(new RegExp(`/rest/v1/${t}\\b([^"]*)"`, 'g'))) {
        hits.push(t);
        assert.equal(m[1], '', `${file} : ${t} sans filtre (pas de lecture ni de PATCH)`);
        const after = src.slice(m.index!, m.index! + 1500);
        assert.match(after, /PostAsync|HttpMethod\.Post/, `${file} : ${t} en POST`);
        assert.doesNotMatch(after.slice(0, after.search(/IsSuccessStatusCode/)), /return=representation/, `${file} : ${t}`);
      }
    }
  }
  // LAB-227 retire l'INSERT anon sur print_logs ; LAB-230 (livré avec) passe la borne sur
  // kiosk_record_print. Une fois les deux fusionnés, hits doit être vide.
  assert.ok(hits.every((t) => t === 'print_logs'), hits.join(', '));
});

test('migration : rejouable (IF EXISTS / IF NOT EXISTS / OR REPLACE)', { skip: PRIVATE_HISTORY }, () => {
  for (const m of sql.matchAll(/CREATE POLICY (\w+)\s+ON public\.(\w+)/g)) {
    const drop = sql.indexOf(`DROP POLICY IF EXISTS ${m[1]} ON public.${m[2]};`);
    assert.ok(drop >= 0 && drop < m.index!, `DROP POLICY IF EXISTS ${m[1]} avant CREATE`);
  }
  assert.doesNotMatch(sql, /DROP POLICY (?!IF EXISTS)/);
  assert.doesNotMatch(sql, /CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/);
  assert.doesNotMatch(sql, /CREATE FUNCTION/);
  assert.doesNotMatch(sql, /ADD COLUMN (?!IF NOT EXISTS)/);
  assert.doesNotMatch(sql, /CREATE TABLE|ADD CONSTRAINT/i);
});

test('migration : index des sous-requêtes d\'appartenance', { skip: PRIVATE_HISTORY }, () => {
  assert.match(sql, /CREATE INDEX IF NOT EXISTS event_form_responses_event_id_idx\s+ON public\.event_form_responses \(event_id, submitted_at DESC\);/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS support_messages_org_id_idx\s+ON public\.support_messages \(org_id\);/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS planning_entries_org_id_idx\s+ON public\.planning_entries \(org_id\);/);
  const before = all.filter((f) => f < MIGRATION).map(read).join('\n');
  assert.match(before, /idx_print_logs_event_id\s+ON public\.print_logs\(event_id\)/);
  assert.match(before, /idx_gallery_analytics_event_id ON public\.gallery_analytics\(event_id\)/);
  assert.match(before, /idx_support_messages_event\s+ON public\.support_messages\(event_id\)/);
  assert.match(before, /idx_events_org_id\s+ON public\.events\(org_id\)/);
  assert.match(before, /organizations_owner_id_idx\s+ON public\.organizations \(owner_id\)/);
});

const SECRETS = [/eyJ[A-Za-z0-9_-]{10,}/, /\b[a-z]{20}\b(?=\.supabase)/, /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, /service_role_key|sk_live_/i];

test('migration et script de vérification : aucun secret, identifiant de projet ni adresse email', { skip: PRIVATE_HISTORY }, () => {
  for (const src of [readPrivateHistory(new URL(MIGRATION, DIR)), readPrivateHistory(CHECK)]) {
    for (const re of SECRETS) assert.doesNotMatch(src, re);
  }
});

test('script de vérification : transaction annulée, anon, inconnu puis propriétaire, lignes de test', { skip: PRIVATE_HISTORY }, () => {
  const body = strip(readPrivateHistory(CHECK));
  assert.match(body, /^\s*BEGIN;/);
  assert.match(body, /ROLLBACK;\s*$/);
  assert.doesNotMatch(body, /\bCOMMIT\b/i);
  const anon = body.indexOf('SET LOCAL ROLE anon;');
  const stranger = body.indexOf("set_config('request.jwt.claim.sub', current_setting('lab127.stranger')");
  const owner = body.indexOf("set_config('request.jwt.claim.sub', current_setting('lab127.owner')");
  assert.ok(anon > 0 && stranger > anon && owner > stranger, 'anon, inconnu, propriétaire');
  assert.match(body, /set_config\('request\.jwt\.claims'/);
  assert.match(body, /set_config\('lab127\.stranger', gen_random_uuid\(\)::text, true\)/);
  assert.doesNotMatch(body, /'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/i);
  // Une ligne de test par table, insérée avant les contrôles (table vide possible).
  const setup = body.slice(0, anon);
  for (const t of TABLES) assert.ok(setup.includes(`INSERT INTO public.${t}`), `ligne de test ${t}`);
  // Chaque table est contrôlée en lecture, UPDATE, DELETE et INSERT pour l'inconnu.
  const strangerPart = body.slice(stranger, owner);
  assert.match(strangerPart, /FOREACH t IN ARRAY ARRAY\['event_form_responses', 'support_messages', 'planning_entries',\s+'gallery_analytics', 'print_logs'\]/);
  for (const stmt of ["EXECUTE format('UPDATE public.%I SET id = id', t)", "EXECUTE format('DELETE FROM public.%I', t)", "EXECUTE format('TRUNCATE public.%I', t)"]) {
    assert.ok(strangerPart.includes(stmt), stmt);
  }
  for (const t of TABLES) assert.ok(strangerPart.includes(`INSERT INTO public.${t}`), `INSERT inconnu ${t}`);
  // Insertions anonymes contrôlées (refusées depuis LAB-128).
  const anonPart = body.slice(anon, stranger);
  for (const t of Object.keys(ANON_POLICIES)) assert.ok(anonPart.includes(`INSERT INTO public.${t}`), `INSERT anon ${t}`);
  // « LAB-127 OK » est le dernier SELECT, juste avant le ROLLBACK.
  const selects = [...body.matchAll(/^SELECT .*$/gm)];
  assert.match(selects[selects.length - 1][0], /^SELECT 'LAB-127 OK' AS resultat,/);
  assert.equal(body.slice(selects[selects.length - 1].index!).match(/;/g)!.length, 2, 'puis ROLLBACK seul');
  for (const m of body.matchAll(/RAISE EXCEPTION '([^']*)/g)) assert.match(m[1], /^LAB-127 KO : /);
});

// ── Revue test LAB-127 : cas limites non couverts ci-dessus ────────────────────────────────────

const before = all.filter((f) => f < MIGRATION).map(read).join('\n');
const tableDef = (t: string) => {
  const m = before.match(new RegExp(`CREATE TABLE IF NOT EXISTS (?:public\\.)?${t} \\(([\\s\\S]*?)\\n\\);`));
  assert.ok(m, `CREATE TABLE ${t}`);
  return m![1];
};

test('tables : clés uuid gen_random_uuid(), aucune séquence (un INSERT anon n\'a pas besoin de USAGE)', { skip: PRIVATE_HISTORY }, () => {
  for (const t of TABLES) {
    assert.match(tableDef(t), /\bid\s+UUID\s+PRIMARY KEY DEFAULT gen_random_uuid\(\)/i, t);
    assert.doesNotMatch(tableDef(t), /\b(big|small)?serial\b|GENERATED .*AS IDENTITY|nextval\(/i, t);
  }
  // Aucune colonne à séquence ajoutée ensuite (ALTER TABLE … ADD COLUMN), migration LAB-127 comprise.
  for (const f of all) {
    for (const m of read(f).matchAll(/ALTER TABLE (?:public\.)?(\w+)([^;]*);/g)) {
      if (!TABLES.includes(m[1])) continue;
      assert.doesNotMatch(m[2], /\b(big|small)?serial\b|AS IDENTITY|nextval\(/i, `${f} : ${m[1]}`);
    }
  }
  assert.doesNotMatch(sql, /SEQUENCE/i, 'aucun droit de séquence à reprendre');
});

test('current_owner_org_id : INVOKER, jamais anon, seulement en défaut de colonne (pas dans les policies)', { skip: PRIVATE_HISTORY }, () => {
  const fn = flat(sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.current_owner_org_id()'), sql.indexOf('$$;') + 3));
  assert.doesNotMatch(fn, /SECURITY DEFINER/);
  // Lecture de organizations sous la RLS de l'appelant : auth.uid() NULL (service_role) → NULL.
  assert.match(fn, /FROM public\.organizations o WHERE o\.owner_id = auth\.uid\(\)/);
  assert.doesNotMatch(sql, /GRANT[^;]*current_owner_org_id[^;]*TO[^;]*\banon\b/);
  assert.doesNotMatch(sql, /GRANT[^;]*current_owner_org_id[^;]*TO[^;]*\bpublic\b/i);
  // Les policies acceptent toute organisation possédée (multi-organisations), pas seulement le défaut.
  for (const p of policies()) assert.doesNotMatch(p.body, /current_owner_org_id/, p.name);
  // CREATE, REVOKE x2, GRANT x2, DEFAULT : rien d'autre.
  assert.equal([...sql.matchAll(/current_owner_org_id\(\)/g)].length, 6, 'current_owner_org_id utilisée ailleurs que dans son défaut');
});

test('front : organisation par défaut = la plus ancienne, comme current_owner_org_id', { skip: PRIVATE_HISTORY }, () => {
  const src = readFileSync(join(SRC, 'lib', 'supabase.js'), 'utf8');
  assert.match(src, /\.from\('organizations'\)[\s\S]{0,120}\.eq\('owner_id', session\.user\.id\)\s*\.order\('created_at'\)\s*\.limit\(1\)/);
  assert.match(sql, /ORDER BY o\.created_at, o\.id\s+LIMIT 1;/);
});

test('migration : ordre colonne → défaut → reprise → NOT NULL, reprise limitée aux lignes sans organisation', { skip: PRIVATE_HISTORY }, () => {
  const add = sql.indexOf('ADD COLUMN IF NOT EXISTS org_id');
  const def = sql.indexOf('ALTER COLUMN org_id SET DEFAULT');
  const upd = sql.indexOf('UPDATE public.planning_entries SET org_id = target WHERE org_id IS NULL;');
  const nn = sql.indexOf('ALTER COLUMN org_id SET NOT NULL');
  assert.ok(add >= 0 && add < def && def < upd && upd < nn, 'ordre des étapes');
  assert.equal([...sql.matchAll(/SET NOT NULL/g)].length, 1, 'NOT NULL posé une seule fois, sous condition');
  // Rejeu : la reprise ne touche jamais une ligne déjà rattachée ; elle ne tourne que s'il en reste.
  const block = sql.slice(sql.indexOf('DO $$', add), sql.indexOf('END $$;', add));
  assert.match(block, /IF EXISTS \(SELECT 1 FROM public\.planning_entries WHERE org_id IS NULL\) THEN/);
  assert.match(block, /IF target IS NOT NULL THEN/);
  // Aucune organisation en base : simple notice, la migration ne casse pas.
  assert.match(block, /ELSE\s+RAISE NOTICE/);
  assert.doesNotMatch(block, /RAISE EXCEPTION/);
});

test('planning : WITH CHECK de l\'UPDATE identique à son USING (pas de déplacement vers une autre organisation)', { skip: PRIVATE_HISTORY }, () => {
  const upd = policies().find((p) => p.name === 'planning_entries_owner_update')!;
  const m = upd.body.match(/^USING \((.*)\) WITH CHECK \((.*)\)$/);
  assert.ok(m, upd.body);
  assert.equal(m![1], m![2]);
  assert.equal(m![1], `org_id ${OWNER_ORGS}`);
});

test('front : createPlanningEntry relit la ligne créée (SELECT accordé, défaut = organisation possédée)', () => {
  const src = readFileSync(join(SRC, 'lib', 'supabase.js'), 'utf8');
  const create = src.slice(src.indexOf('export async function createPlanningEntry'), src.indexOf('export async function updatePlanningEntry'));
  assert.match(create, /\.insert\(\{[\s\S]*?\}\)\s*\.select\(\)\s*\.single\(\)/);
  assert.ok(GRANTS.planning_entries.includes('SELECT'));
});

test('front : trackGalleryEvent ignore un refus, la galerie reste utilisable (RPC track_gallery_event depuis LAB-227)', () => {
  const src = readFileSync(join(SRC, 'lib', 'supabase.js'), 'utf8');
  const fn = src.slice(src.indexOf('export function trackGalleryEvent'), src.indexOf('export async function fetchGalleryStats'));
  assert.match(fn, /supabase\.rpc\('track_gallery_event', \{ p_code: code, p_type: type, p_count: count \}\)\.then\(\(\) => \{\}, \(\) => \{\}\);/);
  assert.doesNotMatch(fn, /\bawait\b|throw/);
});

test('migration : l\'INSERT d\'un connecté non propriétaire sur event_form_responses n\'est pas ouvert par LAB-127', { skip: PRIVATE_HISTORY }, () => {
  // Avant LAB-127, le dépôt ne donnait à authenticated aucun INSERT sur event_form_responses : en dev,
  // un connecté non propriétaire était déjà refusé. En prod, seule la policy partagée
  // anon_insert_form_responses (hors dépôt, conservée) l'autorise.
  const roles = [...before.matchAll(/CREATE POLICY "[^"]+"\s+ON (?:public\.)?event_form_responses\s+FOR INSERT\s+TO (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(roles, ['anon', 'anon']);
  const own = policies().filter((p) => p.table === 'event_form_responses' && p.cmd === 'INSERT');
  assert.equal(own.length, 1);
  assert.ok(own[0].body.includes(`ev.org_id ${OWNER_ORGS}`));
});

test('script de vérification : défaut sans utilisateur, organisation étrangère existante, organisation la plus ancienne', { skip: PRIVATE_HISTORY }, () => {
  const body = strip(readPrivateHistory(CHECK));
  assert.match(body, /has_function_privilege\('anon', 'public\.current_owner_org_id\(\)', 'EXECUTE'\)/);
  assert.match(body, /proconfig @> ARRAY\['search_path=public'\]/);
  assert.match(body, /a\.attidentity IN \('a', 'd'\) OR pg_get_expr\(d\.adbin, d\.adrelid\) LIKE 'nextval\(%'/);
  // Déplacement vers une organisation réelle : seule l'erreur RLS est acceptée (pas la clé étrangère).
  const start = body.indexOf("IF current_setting('lab127.foreign_org') <> '' THEN");
  assert.ok(start > 0);
  const foreign = body.slice(start, body.indexOf('END IF;', start));
  assert.deepEqual(foreign.match(/EXCEPTION WHEN [^;]*/g), ['EXCEPTION WHEN insufficient_privilege THEN NULL', 'EXCEPTION WHEN insufficient_privilege THEN NULL']);
  assert.match(body, /current_owner_org_id\(\)::text IS DISTINCT FROM current_setting\('lab127\.default_org'\)/);
  // Section 5 : après le propriétaire, avant le résultat final.
  const none = body.indexOf(`set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
  const owner = body.indexOf("set_config('request.jwt.claim.sub', current_setting('lab127.owner')");
  assert.ok(none > owner && none < body.indexOf("SELECT 'LAB-127 OK'"));
  assert.match(body.slice(none), /EXCEPTION WHEN not_null_violation THEN NULL;/);
});
