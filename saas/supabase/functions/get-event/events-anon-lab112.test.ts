// LAB-112 : la clé anon ne lit plus la table events (codes d'accès, coordonnées clients).
// Règles toujours vraies (migrations à venir, borne). Les migrations LAB-112 elles-mêmes, de l'historique
// privé, sont vérifiées par events-anon-lab112-history.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { PRIVATE_HISTORY } from '../../../scripts/private-history.mjs';

const DIR = new URL('../../migrations/', import.meta.url);
// Dernière migration LAB-112 : absente du dépôt public (base figée), la comparaison par nom vaut toujours.
const FINAL = '20261103000002_events_drop_anon_read.sql';
const strip = (s: string) => s.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
const read = (f: string) => strip(readFileSync(new URL(f, DIR), 'utf8'));
const all = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

test('aucune migration postérieure ne rouvre events à anon', () => {
  if (!PRIVATE_HISTORY) assert.ok(all.includes(FINAL), 'migration LAB-112 finale présente');
  const offenders: string[] = [];
  for (const f of all.filter((x) => x > FINAL)) {
    const s = read(f);
    for (const m of s.matchAll(/CREATE POLICY[^;]*?ON public\.events\b[^;]*;/g)) {
      const toAnon = /\bTO\s+[^;]*\banon\b/i.test(m[0]);
      // Sans TO (ou TO public), la policy vaut aussi pour anon : tolérée seulement si liée à auth.uid().
      const toPublic = !/\bTO\b/i.test(m[0]) || /\bTO\s+public\b/i.test(m[0]);
      if (toAnon || (toPublic && !/auth\.uid\(\)/.test(m[0]))) offenders.push(`${f} : ${m[0].split('\n')[0]}`);
    }
    if (/GRANT[^;]*ON (TABLE )?public\.events\b[^;]*TO[^;]*\b(anon|public)\b/i.test(s)) offenders.push(`${f} : GRANT`);
  }
  assert.deepEqual(offenders, []);
});

test('kiosk : plus de lecture REST directe de events, passage par kiosk_get_event', () => {
  const svc = new URL('../../../../kiosk/PolaKiosk/Services/SupabaseService.cs', import.meta.url);
  if (!existsSync(svc)) return; // saas/ isolé du monorepo
  const src = readFileSync(svc, 'utf8');
  assert.doesNotMatch(src, /rest\/v1\/events/);
  assert.match(src, /(?:Post|Call)RpcAsync\("kiosk_get_event"/);
});
