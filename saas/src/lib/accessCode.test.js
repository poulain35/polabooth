// Code d'accès d'un événement (LAB-393) : 6 caractères, tirage sûr et sans biais.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACCESS_CODE_ALPHABET, ACCESS_CODE_LENGTH, generateAccessCode, isUniqueViolation, randomString } from './accessCode.js';

const CODE_RE = new RegExp(`^[${ACCESS_CODE_ALPHABET}]{${ACCESS_CODE_LENGTH}}$`);

test('toujours 6 caractères de l’alphabet sans signe ambigu', () => {
  assert.equal(ACCESS_CODE_ALPHABET, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
  for (let i = 0; i < 2000; i++) assert.match(generateAccessCode(), CODE_RE);
});

test('tiré par crypto.getRandomValues', () => {
  let calls = 0;
  const fixed = (bytes) => { calls++; return bytes.fill(0); };
  assert.equal(generateAccessCode(fixed), 'AAAAAA');
  assert.equal(calls, 1);
});

test('alphabet de 32 signes : 31 → 9, 32 → A, 255 → 9', () => {
  const seq = [31, 32, 63, 255, 0, 1];
  assert.equal(generateAccessCode((bytes) => { bytes.set(seq); return bytes; }), '9A99AB');
});

test('rejet du biais modulo : octets au-delà du dernier multiple rejetés puis retirés', () => {
  // Alphabet de 30 signes : limite 240, les octets 240 à 255 sont rejetés.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123';
  let round = 0;
  const source = (bytes) => {
    round++;
    if (round === 1) return bytes.fill(240).fill(255, 4); // tout rejeté
    bytes.set([250, 239, 0, 241, 29, 30, 31, 59]); // 239 % 30 = 29 → '3'
    return bytes;
  };
  assert.equal(randomString(alphabet, 6, source), '3A3AB3');
  assert.equal(round, 2);
});

test('répartition uniforme (aucun signe ne domine)', () => {
  const counts = Object.fromEntries([...ACCESS_CODE_ALPHABET].map((c) => [c, 0]));
  for (let i = 0; i < 4000; i++) for (const c of generateAccessCode()) counts[c]++;
  const expected = (4000 * ACCESS_CODE_LENGTH) / ACCESS_CODE_ALPHABET.length;
  for (const [c, n] of Object.entries(counts)) assert.ok(Math.abs(n - expected) < expected * 0.25, `${c} : ${n}`);
});

test('isUniqueViolation : code Postgres 23505', () => {
  assert.equal(isUniqueViolation({ code: '23505' }), true);
  assert.equal(isUniqueViolation({ code: '42501' }), false);
  assert.equal(isUniqueViolation(null), false);
});

test('création et duplication passent par generateAccessCode', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const newEvent = read('../pages/admin/AdminNewEvent.jsx');
  assert.match(newEvent, /generateAccessCode\(\)/);
  assert.doesNotMatch(newEvent, /Math\.random/);
  const supa = read('./api/events.js');
  const start = supa.indexOf('export async function duplicateEvent');
  assert.ok(start >= 0);
  const duplicate = supa.slice(start, supa.indexOf('\n}\n', start));
  assert.match(duplicate, /access_code:\s+generateAccessCode\(\)/);
  assert.doesNotMatch(duplicate, /Math\.random/);
});
