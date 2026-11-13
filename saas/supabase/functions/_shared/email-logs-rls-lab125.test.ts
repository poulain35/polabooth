// LAB-125 : email_logs lisible par le seul propriétaire de l'organisation du lead ou de l'événement,
// aucune écriture pour anon ni authenticated. Contrôles statiques de la migration, du script de
// vérification, du front (aucune écriture) et des edge functions qui écrivent (service_role).
// Exécution : `npm test` (runner natif Node, strip-types — aucune dépendance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emailLogSelect } from '../../../src/lib/emailTracking.js';
import { IN_PUBLIC_REPO, PRIVATE_HISTORY, readPrivateHistory } from '../../../scripts/private-history.mjs';

const DIR = new URL('../../migrations/', import.meta.url);
const MIGRATION = '20261112000000_email_logs_rls.sql';
const CHECK = fileURLToPath(new URL('../../tests/lab125_email_logs_rls_check.sql', import.meta.url));
const FUNCTIONS = fileURLToPath(new URL('../', import.meta.url));
const SRC = fileURLToPath(new URL('../../../src/', import.meta.url));

const strip = (s: string) => s.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
const read = (f: string) => strip(readPrivateHistory(new URL(f, DIR)));
const sql = read(MIGRATION);
const all = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

const policyBody = (src: string, name: string) => {
  const start = src.indexOf(`CREATE POLICY ${name}`);
  assert.ok(start >= 0, name);
  return src.slice(start, src.indexOf(';', start));
};
// Appartenance : jointures lead / événement puis coalesce(org) parmi les organisations de auth.uid().
const membership = (policy: string) => {
  const p = flat(policy);
  const joins = p.match(/LEFT JOIN public\.leads ld ON ld\.id = l\.lead_id LEFT JOIN public\.events ev ON ev\.id = l\.event_id/);
  assert.ok(joins, 'jointures lead / événement');
  const start = p.indexOf('coalesce(ld.org_id');
  assert.ok(start >= 0, 'coalesce(ld.org_id');
  return `${joins[0]} … ${p.slice(start)}`;
};

test('migration : présente, après LAB-123, timestamp unique', { skip: PRIVATE_HISTORY }, () => {
  assert.ok(all.includes(MIGRATION));
  assert.ok(MIGRATION > '20261111000000_email_tracking.sql');
  assert.equal(new Set(all.map((f) => f.split('_')[0])).size, all.length, 'timestamps uniques');
});

test('migration : la policy permissive admin_full_access_email_logs est supprimée, et toute autre', { skip: PRIVATE_HISTORY }, () => {
  assert.match(sql, /DROP POLICY IF EXISTS "admin_full_access_email_logs" ON public\.email_logs;/);
  // Boucle sur pg_policies : les policies posées à la main hors migration tombent aussi.
  assert.match(sql, /FROM pg_policies[\s\S]*?tablename = 'email_logs'[\s\S]*?policyname <> 'email_logs_owner_select'/);
  assert.match(sql, /EXECUTE format\('DROP POLICY IF EXISTS %I ON public\.email_logs', p\.policyname\)/);
  assert.doesNotMatch(sql, /USING \(\s*true\s*\)|WITH CHECK \(\s*true\s*\)/i);
  assert.doesNotMatch(sql, /CREATE POLICY "?admin_full_access_email_logs/);
});

test('migration : une seule policy, SELECT pour authenticated, propriétaire de l\'organisation', { skip: PRIVATE_HISTORY }, () => {
  const policies = [...sql.matchAll(/CREATE POLICY[\s\S]*?;/g)].map((m) => m[0]);
  assert.equal(policies.length, 1);
  const p = policyBody(sql, 'email_logs_owner_select');
  assert.match(p, /ON public\.email_logs FOR SELECT TO authenticated/);
  assert.doesNotMatch(p, /WITH CHECK/);
  assert.match(p, /email_logs\.lead_id, email_logs\.event_id/);
  // Aucune lecture de email_logs dans sa propre policy (récursion RLS).
  assert.doesNotMatch(p, /FROM public\.email_logs/);
});

test('migration : même expression d\'appartenance que email_events_owner_select (LAB-123)', { skip: PRIVATE_HISTORY }, () => {
  const ref = membership(policyBody(read('20261111000000_email_tracking.sql'), 'email_events_owner_select'));
  const mine = membership(policyBody(sql, 'email_logs_owner_select'));
  assert.match(ref, /coalesce\(ld\.org_id, ev\.org_id\) IN \( SELECT o\.id FROM public\.organizations o WHERE o\.owner_id = auth\.uid\(\) \) \) \)$/);
  assert.equal(mine, ref);
});

test('migration : RLS active, aucune écriture pour anon ni authenticated', { skip: PRIVATE_HISTORY }, () => {
  assert.match(sql, /ALTER TABLE public\.email_logs ENABLE ROW LEVEL SECURITY;/);
  const revokeAnon = sql.indexOf('REVOKE ALL ON public.email_logs FROM anon;');
  const revokeAuth = sql.indexOf('REVOKE ALL ON public.email_logs FROM authenticated;');
  const grantSelect = sql.indexOf('GRANT SELECT ON public.email_logs TO authenticated;');
  assert.ok(revokeAnon >= 0 && revokeAuth >= 0 && grantSelect > revokeAnon && grantSelect > revokeAuth, 'REVOKE puis GRANT SELECT');
  assert.match(sql, /GRANT ALL ON public\.email_logs TO service_role;/);
  for (const g of sql.matchAll(/GRANT ([^;]*?) ON (?:TABLE )?public\.email_logs TO (\w+)/gi)) {
    if (g[2] === 'service_role') continue;
    assert.equal(g[2], 'authenticated', `GRANT à ${g[2]}`);
    assert.equal(g[1].trim().toUpperCase(), 'SELECT', `GRANT ${g[1]} à authenticated`);
  }
  assert.doesNotMatch(sql, /GRANT[^;]*\(\s*\w+[^;]*ON[^;]*email_logs/i, 'aucun droit de colonne');
});

test('migration : rejouable (IF EXISTS / IF NOT EXISTS), sans changement de schéma', { skip: PRIVATE_HISTORY }, () => {
  for (const m of sql.matchAll(/CREATE POLICY (\w+)/g)) {
    const drop = sql.indexOf(`DROP POLICY IF EXISTS ${m[1]} ON public.email_logs;`);
    assert.ok(drop >= 0 && drop < m.index!, `DROP POLICY IF EXISTS ${m[1]} avant CREATE`);
  }
  assert.doesNotMatch(sql, /DROP POLICY (?!IF EXISTS)/);
  assert.doesNotMatch(sql, /CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/);
  assert.doesNotMatch(sql, /CREATE TABLE|ADD COLUMN|ADD CONSTRAINT|DROP TABLE|DROP COLUMN|UPDATE public|DELETE FROM/i);
});

test('migration : index de la policy et du tri de la page Emails', { skip: PRIVATE_HISTORY }, () => {
  assert.match(sql, /CREATE INDEX IF NOT EXISTS email_logs_sent_at_idx\s+ON public\.email_logs \(sent_at DESC, id DESC\);/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS organizations_owner_id_idx\s+ON public\.organizations \(owner_id\);/);
  // Index déjà posés par les migrations précédentes, utilisés par la policy.
  const before = all.filter((f) => f < MIGRATION).map(read).join('\n');
  assert.match(before, /email_logs_event_id_idx ON public\.email_logs \(event_id, sent_at DESC\)/);
  assert.match(before, /email_logs_lead_id_idx\s+ON public\.email_logs \(lead_id, sent_at DESC\)/);
  assert.match(before, /idx_events_org_id\s+ON public\.events\(org_id\)/);
  assert.match(before, /leads_org_status_idx\s+ON public\.leads \(org_id, quote_status\)/);
});

const SECRETS = [/eyJ[A-Za-z0-9_-]{10,}/, /\b[a-z]{20}\b(?=\.supabase)/, /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, /service_role_key|sk_live_/i];

test('migration et script de vérification : aucun secret, identifiant de projet ni adresse email', { skip: PRIVATE_HISTORY }, () => {
  for (const src of [readFileSync(new URL(MIGRATION, DIR), 'utf8'), readFileSync(CHECK, 'utf8')]) {
    for (const re of SECRETS) assert.doesNotMatch(src, re);
  }
});

test('script de vérification : transaction annulée, inconnu puis propriétaire retrouvé par requête', { skip: PRIVATE_HISTORY }, () => {
  const src = readFileSync(CHECK, 'utf8');
  const body = strip(src);
  assert.match(body, /^\s*BEGIN;/);
  assert.match(body, /ROLLBACK;\s*$/);
  assert.doesNotMatch(body, /\bCOMMIT\b/i);
  assert.match(body, /SET LOCAL ROLE authenticated;/);
  assert.match(body, /SET LOCAL ROLE anon;/);
  assert.match(body, /set_config\('request\.jwt\.claims'/);
  assert.match(body, /set_config\('lab125\.stranger', gen_random_uuid\(\)::text, true\)/);
  assert.match(body, /set_config\('lab125\.owner', coalesce\(\([\s\S]*?FROM public\.email_logs[\s\S]*?owner_id/);
  // Aucun identifiant codé en dur.
  assert.doesNotMatch(body, /'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/i);
  for (const stmt of ['UPDATE public.email_logs', 'INSERT INTO public.email_logs', 'DELETE FROM public.email_logs', 'TRUNCATE public.email_logs']) {
    assert.ok(body.includes(stmt), stmt);
  }
  assert.match(body, /n <> 0 THEN\s+RAISE EXCEPTION 'LAB-125 KO : un inconnu lit % lignes email_logs'/);
});

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p, ext);
    return ext.test(p) && !/\.test\.[jt]sx?$/.test(p) ? [p] : [];
  });
}

test('front : aucune écriture dans email_logs ni email_events', () => {
  const writes: string[] = [];
  let reads = 0;
  for (const file of files(SRC, /\.(jsx?|tsx?)$/)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/from\(\s*['"`](email_logs|email_events)['"`]\s*\)([\s\S]*?);/g)) {
      if (/\.(insert|update|upsert|delete)\(/.test(m[2])) writes.push(`${file}: ${m[1]}`);
      else reads++;
    }
  }
  assert.deepEqual(writes, []);
  // fetchEmailLogs, getEmailLog, getEmailEvents, getEmailLogs, getLeadEmailLogs : le scan voit les lectures.
  assert.ok(reads >= 5, `${reads} lectures trouvées`);
});

test('edge functions : email_logs écrit uniquement via adminClient (service_role)', () => {
  const offenders: string[] = [];
  let entryPoints = 0;
  for (const file of files(FUNCTIONS, /\.ts$/)) {
    const rel = file.slice(FUNCTIONS.length).replace(/\\/g, '/');
    const src = readFileSync(file, 'utf8');
    if (!/\b(recordEmailLog|applyBrevoEvents)\(|from\('email_logs'\)/.test(src)) continue;
    // Les modules _shared et les passes reçoivent le client de l'appelant.
    if (/\bcreateClient\(/.test(src)) offenders.push(`${rel} : createClient`);
    if (!rel.endsWith('/index.ts')) continue;
    entryPoints++;
    if (!/\bconst db\s*=\s*adminClient\(\)/.test(src)) offenders.push(`${rel} : sans adminClient`);
  }
  assert.deepEqual(offenders, []);
  assert.ok(entryPoints >= 8, `${entryPoints} fonctions qui écrivent email_logs`);
  for (const fn of ['brevo-webhook', 'email-sync']) {
    const src = readFileSync(join(FUNCTIONS, fn, 'index.ts'), 'utf8');
    assert.match(src, /import \{ adminClient[^}]*\} from '\.\.\/_shared\/auth\.ts'/, fn);
  }
  assert.match(readFileSync(join(FUNCTIONS, '_shared', 'auth.ts'), 'utf8'),
    /export function adminClient\(\) \{\s*return createClient\(supabaseUrl, serviceKey,/);
});

// ── Revue test LAB-125 : cas limites et chemins d'écriture non couverts ci-dessus ──────────────

test('migration : ligne sans lead ni événement, ou avec les deux, impossible (email_logs_scope_chk) et invisible', { skip: PRIVATE_HISTORY }, () => {
  // Les cas « deux rattachements d'organisations différentes » et « aucun » sont exclus par la
  // contrainte num_nonnulls(…) = 1 : posée par LAB-39, élargie au prospect du salon (20261210000000).
  const chk = all.filter((f) => /email_logs_scope_chk/.test(read(f)));
  assert.deepEqual(chk, ['20260910000006_email_logs_lead_id.sql', '20261210000000_email_logs_prospects.sql']);
  assert.match(read(chk[0]), /ADD CONSTRAINT email_logs_scope_chk\s+CHECK \(num_nonnulls\(event_id, lead_id\) = 1\)/);
  assert.match(read(chk[1]), /ADD CONSTRAINT email_logs_scope_chk\s+CHECK \(num_nonnulls\(event_id, lead_id, prospect_id\) = 1\)/);
  // Même sans la contrainte (dérive), coalesce(NULL, NULL) IN (…) vaut NULL : ligne invisible. Aucune
  // branche OR … IS NULL ne doit rouvrir l'accès aux lignes orphelines.
  const p = flat(policyBody(sql, 'email_logs_owner_select'));
  assert.doesNotMatch(p, /\bOR\b/i);
  assert.doesNotMatch(p, /IS NULL/i);
  assert.match(p, /WHERE coalesce\(ld\.org_id, ev\.org_id\) IN \(/);
});

test('migrations : aucune fonction SQL ni trigger n\'écrit dans email_logs (REVOKE sans effet de bord)', { skip: PRIVATE_HISTORY }, () => {
  const dml = /(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+(?:public\.)?email_logs\b/gi;
  const found: string[] = [];
  for (const f of all) {
    const src = read(f);
    for (const m of src.matchAll(dml)) {
      // Dans un corps $$ … $$ (fonction, trigger) : nombre impair de balises $…$ avant l'occurrence.
      const inBody = (src.slice(0, m.index).match(/\$\w*\$/g) ?? []).length % 2 === 1;
      found.push(`${f}:${m[1].toUpperCase().replace(/\s+/g, ' ')}${inBody ? ' (corps de fonction)' : ''}`);
    }
    assert.doesNotMatch(src, /CREATE\s+(?:CONSTRAINT\s+)?TRIGGER[^;]*ON\s+(?:public\.)?email_logs\b/i, `${f} : trigger sur email_logs`);
  }
  // Seule écriture SQL : la reprise de données de LAB-123, exécutée par la migration (rôle postgres).
  assert.deepEqual(found, ['20261111000000_email_tracking.sql:UPDATE']);
});

test('edge functions : tout client au JWT utilisateur ne sert qu\'à auth.getUser()', () => {
  // Un client anon + Authorization utilisateur subirait le REVOKE : il ne doit jamais lire ni écrire.
  // Seule exception (LAB-238) : send-event-report gèle le bilan sous le JWT de l'admin
  // (build_event_report refuse service_role, 42501) et enregistre ses photos sous ce même JWT. Ces deux
  // appels exacts, jamais email_logs (écrit par adminClient, testé dans send-event-report/logic.test.ts).
  const ALLOWED: Record<string, RegExp[]> = {
    'send-event-report/admin-jwt.ts': [/^rpc\('build_event_report',/, /^from\('event_reports'\)\.update\(/],
  };
  const offenders: string[] = [];
  let userClients = 0;
  for (const file of files(FUNCTIONS, /\.ts$/)) {
    const rel = file.slice(FUNCTIONS.length).replace(/\\/g, '/');
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*createClient\([^;]*?(?:ANON_KEY|anonKey)/g)) {
      userClients++;
      for (const use of src.matchAll(new RegExp(`\\b${m[1]}\\b\\s*\\.\\s*([\\w.]+)`, 'g'))) {
        if (use[1] === 'auth.getUser') continue;
        const rest = src.slice(use.index! + use[0].length - use[1].length);
        if ((ALLOWED[rel.replace(/^\//, '')] ?? []).some((re) => re.test(rest))) continue;
        offenders.push(`${rel} : ${m[1]}.${use[1]}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
  // Dépôt public : sans les fonctions des modules privés, moins de clients utilisateur.
  assert.ok(userClients >= (IN_PUBLIC_REPO ? 1 : 5), `${userClients} clients utilisateur trouvés`);
});

test('edge functions : logEmail et les fonctions publiques écrivent email_logs via adminClient', () => {
  // logEmail et handlePublic : module privé booking, absent du dépôt public.
  if (!IN_PUBLIC_REPO) {
    const http = readFileSync(join(FUNCTIONS, '_shared', 'modules', 'booking', 'booking-http.ts'), 'utf8');
    assert.match(http, /export type Db = ReturnType<typeof adminClient>;/);
    assert.match(http, /export function logEmail\(db: Db,[^)]*\) \{\s*return recordEmailLog\(db,/);
    const handle = http.slice(http.indexOf('export async function handlePublic('));
    assert.match(handle.slice(0, handle.indexOf('checkRateLimit(')), /const db = adminClient\(\);/);
  }

  // Point d'entrée qui journalise (directement ou via logEmail) : adminClient() ou servePublic/handlePublic.
  const offenders: string[] = [];
  let entryPoints = 0;
  for (const file of files(FUNCTIONS, /index\.ts$/)) {
    const rel = file.slice(FUNCTIONS.length).replace(/\\/g, '/');
    const src = readFileSync(file, 'utf8');
    if (!/\b(logEmail|recordEmailLog|applyBrevoEvents)\(|from\(\s*['"`]email_logs['"`]\s*\)/.test(src)) continue;
    entryPoints++;
    if (!/\badminClient\(\)|\bservePublic\(|\bhandlePublic\(/.test(src)) offenders.push(rel);
  }
  assert.deepEqual(offenders, []);
  assert.ok(entryPoints >= (IN_PUBLIC_REPO ? 1 : 15), `${entryPoints} points d'entrée qui journalisent`);
});

test('front : lectures email_logs sans filtre d\'organisation, embeds limités aux tables sous RLS propriétaire', () => {
  const src = readFileSync(join(SRC, 'lib', 'supabase.js'), 'utf8');
  // Sélection construite selon les modules privés présents (LAB-274).
  assert.match(src, /const EMAIL_LOG_SELECT = emailLogSelect\(INSTALLED_MODULES\);/);
  const embedsOf = (select: string) => [...select.matchAll(/(\w+):(\w+)\(/g)].map((m) => `${m[1]}:${m[2]}`);
  // Embeds lead / événement / prospect : filtrés par leurs propres policies propriétaire.
  assert.deepEqual(embedsOf(emailLogSelect(new Set(['booking', 'prospects']))), ['lead:leads', 'event:events', 'prospect:prospects']);
  assert.deepEqual(embedsOf(emailLogSelect(new Set())), ['event:events']);
  // Aucun embed de email_logs depuis une autre table (son contenu dépendrait silencieusement de la RLS).
  const embeds: string[] = [];
  for (const file of files(SRC, /\.(jsx?|tsx?)$/)) {
    // Commentaires retirés (« email_logs (plus récents d'abord) » n'est pas un embed).
    const code = readFileSync(file, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\/?\*)/.test(l)).join('\n');
    if (/['"`,(\s]email_logs\s*(!\w+)?\s*\(/.test(code)) embeds.push(file);
  }
  assert.deepEqual(embeds, []);
  // La policy filtre : aucune requête email_logs ne filtre org_id côté client (colonne inexistante).
  for (const m of src.matchAll(/from\(\s*['"]email_logs['"]\s*\)([\s\S]*?);/g)) {
    assert.doesNotMatch(m[1], /org_id/);
  }
});
