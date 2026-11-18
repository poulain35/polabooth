// LAB-197 : PIN admin par machine, versions signées par hash, écritures réservées aux admins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hashPin, isValidPin, PIN_ITERATIONS } from './pinHash.ts';
import { PRIVATE_HISTORY, readPrivateHistory } from '../../../scripts/private-history.mjs';

const MIGRATION = '20261120000000_kiosk_security_admins.sql';
const strip = (s: string) => s.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
const sql = strip(readPrivateHistory(new URL(`../../migrations/${MIGRATION}`, import.meta.url)));
const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

const fnBody = (name: string) => {
  const start = sql.indexOf(`FUNCTION public.${name}(`);
  assert.ok(start >= 0, `${name} introuvable`);
  return sql.slice(start, sql.indexOf('$$;', start));
};

// Vecteur partagé avec PolaKiosk.Tests/Services/AdminPinServiceTests.cs.
const VECTOR_SALT = Uint8Array.from({ length: 16 }, (_, i) => i);
const VECTOR = 'pbkdf2$210000$AAECAwQFBgcICQoLDA0ODw==$986qxnMbMmzuHyS3MK9F7gz4EXIuhMjAubUlwLFpHTo=';

test('hashPin : vecteur PBKDF2-SHA256 commun au SaaS et au kiosk', async () => {
  assert.equal(PIN_ITERATIONS, 210_000);
  assert.equal(await hashPin('123456', VECTOR_SALT), VECTOR);
});

test('hashPin : sel aléatoire, format pbkdf2$iterations$salt$hash', async () => {
  const [a, b] = await Promise.all([hashPin('2580'), hashPin('2580')]);
  assert.notEqual(a, b);
  assert.match(a, /^pbkdf2\$210000\$[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]+={0,2}$/);
});

test('PIN : 4 à 8 chiffres uniquement', async () => {
  for (const pin of ['1234', '12345678']) assert.ok(isValidPin(pin), pin);
  for (const pin of ['123', '123456789', '12a4', '', 1234, null]) assert.ok(!isValidPin(pin), String(pin));
  await assert.rejects(hashPin('12'));
});

test('kiosk-admin-pin : session vérifiée, puis super-admin ou propriétaire de la borne avant toute écriture', () => {
  assert.match(src, /await authenticate\(req\.headers\.get\('Authorization'\), sessionUser\)/);
  // LAB-242 : organisation de la borne dont l'utilisateur est propriétaire, ou app_admins
  // (requireOrgAccess partagé depuis LAB-392, testé dans _shared/admin-guard.test.ts).
  const accessCall = "requireOrgAccess(db, userId, { kind: 'kiosk_license', id: license_id }, { allowAppAdmin: true })";
  assert.ok(src.includes(accessCall));
  // La session (401) est vérifiée avant la lecture du body ; les droits sur la borne (403/404) avant l'écriture.
  assert.ok(src.indexOf('await authenticate(') < src.indexOf('req.json()'));
  assert.ok(src.indexOf(accessCall) < src.indexOf('.update(patch)'));
  assert.ok(src.indexOf(accessCall) < src.indexOf('hashPin(body.pin)'));
  // Erreur d'écriture : message générique, détail en journal (LAB-392).
  assert.doesNotMatch(src, /error: error\.message/);
  // Une borne retirée n'est plus gérée.
  assert.match(src, /\.update\(patch\)\.eq\('id', license_id\)\.is\('retired_at', null\)/);
  // Le PIN en clair n'est ni renvoyé ni stocké : seul admin_pin_hash est écrit.
  assert.doesNotMatch(src, /admin_pin_hash: body\.pin/);
  assert.doesNotMatch(STATUS_COLUMNS_OF(src), /admin_pin_hash/);
});

function STATUS_COLUMNS_OF(s: string) {
  return /const STATUS_COLUMNS = '([^']+)'/.exec(s)?.[1] ?? '';
}

test('migration : is_app_admin SECURITY DEFINER, aucun admin ajouté', { skip: PRIVATE_HISTORY }, () => {
  const body = fnBody('is_app_admin');
  assert.match(body, /SECURITY DEFINER/);
  assert.match(body, /SET search_path = public, pg_temp/);
  assert.doesNotMatch(sql, /INSERT INTO public\.app_admins/);
  assert.doesNotMatch(sql, /@/);
  assert.match(sql, /CREATE POLICY "app_admins_read_own"[^;]*FOR SELECT TO authenticated[^;]*USING \(user_id = auth\.uid\(\)\)/);
});

test('migration : écritures releases, bucket et licences réservées à is_app_admin()', { skip: PRIVATE_HISTORY }, () => {
  for (const m of sql.matchAll(/CREATE POLICY "([^"]+)"[^;]*FOR (INSERT|UPDATE|DELETE)[^;]*;/g)) {
    assert.match(m[0], /public\.is_app_admin\(\)/, m[1]);
  }
  assert.match(sql, /REVOKE ALL ON public\.kiosk_licenses FROM anon;/);
  assert.match(sql, /ALTER COLUMN sha256 SET NOT NULL/);
});

test('migration : plus de secret NULL toléré dans les RPC kiosk', { skip: PRIVATE_HISTORY }, () => {
  for (const fn of ['kiosk_check_license', 'kiosk_heartbeat', 'kiosk_record_photo', 'kiosk_get_admin_pin']) {
    const body = fnBody(fn);
    assert.doesNotMatch(body, /secret IS NULL/, fn);
    assert.match(body, /SECURITY DEFINER/, fn);
    assert.match(body, /secret <> ''\s+AND (l\.)?secret = p_secret/, fn);
  }
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.kiosk_get_admin_pin\(text, text\)\s+TO anon;/);
});

test('migration : SQL exécutable sans accents', { skip: PRIVATE_HISTORY }, () => {
  assert.doesNotMatch(sql, /[À-ÿ]/);
});
