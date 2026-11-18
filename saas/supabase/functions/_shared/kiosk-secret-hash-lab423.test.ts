// LAB-423 : le secret des bornes n'est gardé qu'en empreinte SHA-256 (kiosk_licenses.secret_hash).
// Contrôles statiques ; le comportement est vérifié par supabase/tests/lab423_kiosk_secret_hash_check.sql.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { MIGRATIONS_DIR } from '../../../scripts/private-history.mjs';

const MIGRATION = '20270112000423_kiosk_secret_hash.sql';
const raw = readFileSync(new URL(MIGRATION, MIGRATIONS_DIR), 'utf8');
const sql = raw.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');

const fnBody = (name: string) => {
  const start = sql.indexOf(`FUNCTION public.${name}(`);
  assert.ok(start >= 0, `${name} introuvable`);
  return sql.slice(start, sql.indexOf('$$;', start));
};

// Les RPC de la borne qui reçoivent p_secret, plus les quatre RPC de l'association.
const KIOSK_RPCS = [
  'kiosk_check_license', 'kiosk_heartbeat', 'kiosk_get_event', 'kiosk_get_event_request', 'kiosk_ack_event_request',
  'kiosk_get_approved_design', 'kiosk_get_screens', 'kiosk_get_admin_pin', 'kiosk_get_update_request',
  'kiosk_report_update_failure', 'kiosk_record_photo', 'kiosk_record_print', 'kiosk_record_photo_consent',
  'kiosk_record_guest_response', 'kiosk_record_logs',
];
const PAIRING_RPCS = ['kiosk_pairing_start', 'kiosk_pairing_approve', 'kiosk_pairing_poll', 'kiosk_retire_license'];

test('migration : timestamp unique, après la dernière migration connue', () => {
  const all = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  assert.ok(all.includes(MIGRATION));
  assert.equal(new Set(all.map((f) => f.split('_')[0])).size, all.length);
  assert.ok(MIGRATION > '20270111000000_billing_documents_cleanup.sql');
});

test('migration : accents seulement dans les deux messages repris tels quels', () => {
  const accents = sql.split('\n').filter((l) => /[À-ÿ]/.test(l));
  assert.equal(accents.length, 2);
  assert.match(accents[0], /'Événement indisponible : archivé, ou la borne a changé de compte\.'/);
  assert.match(accents[1], /'Échec sans détail'/);
  assert.match(sql.trimEnd(), /NOTIFY pgrst, 'reload schema';$/);
});

test('helpers : SECURITY DEFINER, search_path figé, fermés à PUBLIC, anon et authenticated', () => {
  for (const [fn, sig] of [['kiosk_secret_hash', 'TEXT'], ['kiosk_secret_matches', 'TEXT, TEXT']]) {
    const body = fnBody(fn);
    assert.match(body, /SECURITY DEFINER/, fn);
    assert.match(body, /SET search_path = public, pg_temp/, fn);
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public[.]${fn}[(]${sig}[)] FROM PUBLIC, anon, authenticated;`), fn);
    assert.doesNotMatch(sql, new RegExp(`GRANT [^;]*public[.]${fn}[(]`), fn);
  }
  // SHA-256 des octets UTF-8 en hexadécimal ; vide ou NULL : pas d'empreinte, donc jamais accepté.
  assert.match(fnBody('kiosk_secret_hash'), /WHEN p_secret IS NULL OR p_secret = '' THEN NULL\s+ELSE encode\(sha256\(convert_to\(p_secret, 'UTF8'\)\), 'hex'\)/);
  assert.match(fnBody('kiosk_secret_matches'), /COALESCE\(p_secret_hash = public\.kiosk_secret_hash\(p_secret\), false\)/);
});

test('colonne : secret_hash ajoutée (64 hexadécimaux), remplie depuis le clair puis clair supprimé', () => {
  assert.match(sql, /ALTER TABLE public\.kiosk_licenses ADD COLUMN IF NOT EXISTS secret_hash TEXT;/);
  assert.match(sql, /CHECK \(secret_hash IS NULL OR secret_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  const fill = sql.indexOf('SET secret_hash = public.kiosk_secret_hash(secret)');
  const drop = sql.indexOf('ALTER TABLE public.kiosk_licenses DROP COLUMN IF EXISTS secret;');
  assert.ok(fill > 0 && drop > fill);
  assert.match(sql, /ALTER TABLE public\.kiosk_pairings DROP COLUMN IF EXISTS secret_to_deliver;/);
  // Toutes les fonctions sont redéfinies avant la suppression des colonnes.
  assert.ok(sql.lastIndexOf('CREATE OR REPLACE FUNCTION') < sql.indexOf('DROP COLUMN'));
});

test('RPC de la borne : empreinte comparée, plus jamais secret = p_secret', () => {
  for (const fn of KIOSK_RPCS) {
    const body = fnBody(fn);
    assert.match(body, /SECURITY DEFINER/, fn);
    assert.match(body, /SET search_path = public, pg_temp/, fn);
    assert.match(body, /public\.kiosk_secret_matches\((l\.)?secret_hash, p_secret\)/, fn);
  }
  const fns = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.kiosk_check_license'), sql.indexOf('DROP COLUMN'));
  assert.doesNotMatch(fns, /\bsecret\s*(=|<>)/);
  assert.doesNotMatch(fns, /secret_to_deliver/);
  assert.equal((sql.match(/CREATE OR REPLACE FUNCTION public\.kiosk_/g) ?? []).length, KIOSK_RPCS.length + PAIRING_RPCS.length + 2);
});

test('toute fonction des migrations qui reçoit p_secret est redéfinie ici', () => {
  const names = new Set<string>();
  for (const f of readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith('.sql') && n < MIGRATION)) {
    const text = readFileSync(new URL(f, MIGRATIONS_DIR), 'utf8');
    for (const m of text.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(([^)]*)\)/g)) {
      if (/\bp_secret\b/.test(m[2])) names.add(m[1]);
    }
  }
  assert.ok(names.size > 0);
  for (const n of names) assert.ok(KIOSK_RPCS.includes(n), `${n} reçoit p_secret mais n'est pas redéfinie`);
});

test('association : secret créé à la remise, seule son empreinte est écrite, rendu une fois', () => {
  const approve = fnBody('kiosk_pairing_approve');
  assert.doesNotMatch(approve, /v_secret|gen_random_uuid/);
  assert.match(approve, /is_active, secret_hash, activated_at\)/);
  assert.match(approve, /secret_hash\s+= NULL,/);

  const poll = fnBody('kiosk_pairing_poll');
  const gen = poll.indexOf("v_secret := 'ks_' || replace(gen_random_uuid()::text, '-', '');");
  const write = poll.indexOf('SET secret_hash = public.kiosk_secret_hash(v_secret)');
  const delivered = poll.indexOf("status = 'delivered'");
  assert.ok(gen > 0 && write > gen && delivered > write);
  assert.match(poll.slice(write), /WHERE id = v_row\.license_id AND retired_at IS NULL;\s+IF NOT FOUND THEN/);
  assert.match(poll, /'secret',\s+v_secret,/);
  // Le secret n'est rendu que dans la réponse « approved », juste après le passage à « delivered ».
  assert.equal((poll.match(/'secret'/g) ?? []).length, 1);

  assert.match(fnBody('kiosk_retire_license'), /is_active = false, secret_hash = NULL/);
  for (const fn of PAIRING_RPCS) {
    assert.match(fnBody(fn), /SECURITY DEFINER/, fn);
    assert.doesNotMatch(fnBody(fn), /secret_to_deliver/, fn);
  }
});
