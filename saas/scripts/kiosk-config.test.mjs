import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isJwt, kioskConfigJson, resolveKioskConfig } from './kiosk-config.mjs';

const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJl';
const otherJwt = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoia2lvc2sifQ.c2lnbg';
const url = 'https://abcdefghijklmnopqrst.supabase.co';

test('kioskConfigJson : format lu par la borne (2 espaces, saut de ligne final)', () => {
  assert.equal(
    kioskConfigJson({ supabaseUrl: url, anonKey: jwt }),
    `{\n  "supabaseUrl": "${url}",\n  "supabaseAnonKey": "${jwt}"\n}\n`,
  );
});

test('KIOSK_SUPABASE_* prioritaires sur VITE_SUPABASE_*', () => {
  const { content, warning } = resolveKioskConfig({
    VITE_SUPABASE_URL: 'https://autre.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'sb_publishable_abc',
    KIOSK_SUPABASE_URL: ` ${url}/ `,
    KIOSK_SUPABASE_ANON_KEY: otherJwt,
  });
  assert.equal(warning, null);
  assert.deepEqual(JSON.parse(content), { supabaseUrl: url, supabaseAnonKey: otherJwt });
});

test('repli sur VITE_SUPABASE_* quand la clé du site est un JWT', () => {
  const { content } = resolveKioskConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: jwt });
  assert.deepEqual(JSON.parse(content), { supabaseUrl: url, supabaseAnonKey: jwt });
});

test('clé publishable sans KIOSK_SUPABASE_ANON_KEY : pas de fichier, avertissement', () => {
  const { content, warning } = resolveKioskConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: 'sb_publishable_abc' });
  assert.equal(content, null);
  assert.match(warning, /N'EST PAS GÉNÉRÉ/);
  assert.match(warning, /VITE_SUPABASE_ANON_KEY n'est pas une clé au format JWT/);
  assert.match(warning, /Legacy API Keys/);
});

test('KIOSK_SUPABASE_ANON_KEY non JWT : refusée, sans repli', () => {
  const { content, warning } = resolveKioskConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: jwt, KIOSK_SUPABASE_ANON_KEY: 'sb_publishable_abc' });
  assert.equal(content, null);
  assert.match(warning, /KIOSK_SUPABASE_ANON_KEY n'est pas une clé au format JWT/);
});

test('rien de défini, ou adresse invalide : avertissement', () => {
  const empty = resolveKioskConfig({});
  assert.equal(empty.content, null);
  assert.match(empty.warning, /KIOSK_SUPABASE_URL et VITE_SUPABASE_URL sont absentes/);
  assert.match(empty.warning, /KIOSK_SUPABASE_ANON_KEY et VITE_SUPABASE_ANON_KEY sont absentes/);
  const bad = resolveKioskConfig({ KIOSK_SUPABASE_URL: 'abc.supabase.co', KIOSK_SUPABASE_ANON_KEY: jwt });
  assert.equal(bad.content, null);
  assert.match(bad.warning, /Adresse Supabase invalide/);
});

test('isJwt', () => {
  assert.equal(isJwt(jwt), true);
  assert.equal(isJwt('sb_publishable_abc'), false);
  assert.equal(isJwt('eyJabc'), false);
  assert.equal(isJwt(undefined), false);
});
