// LAB-232 (spec LAB-209, SAAS-1) : e-mails de la borne et ouvertures par QR code comptés côté
// serveur dans event_activity. Logique pure (Brevo et base simulés) + contrôles statiques des
// fonctions, de la migration et du script de vérification dev.
// Exécution : `npm test` (runner natif Node, strip-types — aucune dépendance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import {
  kioskEmailActivity,
  qrOpenActivity,
  recordEventActivity,
  sendKioskEmailAndCount,
  UNIQUE_VIOLATION,
} from './event-activity.ts';
import { PRIVATE_HISTORY } from '../../../scripts/private-history.mjs';

const EVENT = '3f2b8c1e-0000-4000-8000-000000000001';
const PHOTO = '9a7d6e5f-1111-4222-8333-444455556666';
const OTHER_PHOTO = '9a7d6e5f-1111-4222-8333-444455556667';

type Row = Record<string, unknown>;

/** event_activity simulée, avec l'index unique partiel de la migration 20261130000000. */
function fakeDb(opts: { fail?: 'error' | 'throw' } = {}) {
  const rows: Row[] = [];
  const db = {
    rows,
    from(table: string) {
      assert.equal(table, 'event_activity');
      return {
        insert(row: Row) {
          if (opts.fail === 'throw') throw new Error('réseau');
          if (opts.fail === 'error') return Promise.resolve({ error: { code: '57014', message: 'timeout' } });
          const dup = row.kind === 'qr_open'
            && rows.some((r) => r.kind === 'qr_open' && r.event_id === row.event_id && r.photo_id === row.photo_id);
          if (dup) return Promise.resolve({ error: { code: UNIQUE_VIOLATION, message: 'duplicate key' } });
          rows.push(row);
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return db;
}

const qs = (s: string) => new URLSearchParams(s);
const fnSrc = (name: string) => readFileSync(new URL(`../${name}/index.ts`, import.meta.url), 'utf8');

// ── E-mails de la borne ─────────────────────────────────────────────────────────────────────

test('e-mail accepté par Brevo : une ligne kiosk_email, sans adresse ni autre donnée', async () => {
  const db = fakeDb();
  const id = await sendKioskEmailAndCount(db, EVENT, async () => 'msg-1');
  assert.equal(id, 'msg-1');
  assert.deepEqual(db.rows, [{ event_id: EVENT, kind: 'kiosk_email' }]);
  assert.doesNotMatch(JSON.stringify(db.rows), /@/);
});

test('e-mail refusé par Brevo : rien n\'est compté, l\'erreur remonte', async () => {
  const db = fakeDb();
  const refused = new Error('Brevo 400');
  await assert.rejects(sendKioskEmailAndCount(db, EVENT, async () => { throw refused; }), refused);
  assert.equal(db.rows.length, 0);
});

test('e-mail non envoyé (pas de clé Brevo, hors allowlist : messageId null) : rien n\'est compté', async () => {
  const db = fakeDb();
  assert.equal(await sendKioskEmailAndCount(db, EVENT, async () => null), null);
  assert.equal(db.rows.length, 0);
  assert.equal(kioskEmailActivity(EVENT, ''), null);
  assert.equal(kioskEmailActivity('', 'msg-1'), null);
});

test('écriture du compteur en échec : l\'envoi reste un succès', async () => {
  for (const fail of ['error', 'throw'] as const) {
    assert.equal(await sendKioskEmailAndCount(fakeDb({ fail }), EVENT, async () => 'msg-1'), 'msg-1');
  }
});

// ── Ouvertures par QR code ──────────────────────────────────────────────────────────────────

test('QR code : deux scans de la même photo comptent 1', async () => {
  const db = fakeDb();
  const scan = () => recordEventActivity(db, qrOpenActivity(EVENT, qs(`code=ABC&photo=${PHOTO}&via=qr`), [OTHER_PHOTO, PHOTO]));
  assert.equal(await scan(), 'recorded');
  assert.equal(await scan(), 'duplicate');
  assert.deepEqual(db.rows, [{ event_id: EVENT, kind: 'qr_open', photo_id: PHOTO }]);
  await recordEventActivity(db, qrOpenActivity(EVENT, qs(`photo=${OTHER_PHOTO}&via=qr`), [OTHER_PHOTO, PHOTO]));
  assert.equal(db.rows.length, 2, 'une autre photo compte à part');
});

test('QR code : identifiant en majuscules ramené à celui de la photo', () => {
  assert.deepEqual(
    qrOpenActivity(EVENT, qs(`photo=${PHOTO.toUpperCase()}&via=qr`), [PHOTO]),
    { event_id: EVENT, kind: 'qr_open', photo_id: PHOTO },
  );
});

test('rien sans via=qr (galerie, diaporama, lien partagé), ni pour une photo hors événement', () => {
  const ids = [PHOTO];
  assert.equal(qrOpenActivity(EVENT, qs(''), ids), null);
  assert.equal(qrOpenActivity(EVENT, qs(`photo=${PHOTO}`), ids), null);
  assert.equal(qrOpenActivity(EVENT, qs(`photo=${PHOTO}&via=email`), ids), null);
  assert.equal(qrOpenActivity(EVENT, qs('via=qr'), ids), null);
  assert.equal(qrOpenActivity(EVENT, qs('photo=pas-un-uuid&via=qr'), ids), null);
  assert.equal(qrOpenActivity(EVENT, qs(`photo=${OTHER_PHOTO}&via=qr`), ids), null);
  assert.equal(qrOpenActivity(EVENT, qs(`photo=${PHOTO}&via=qr`), []), null);
});

test('écriture en échec ou rien à écrire : jamais d\'exception', async () => {
  assert.equal(await recordEventActivity(fakeDb({ fail: 'error' }), { event_id: EVENT, kind: 'kiosk_email' }), 'failed');
  assert.equal(await recordEventActivity(fakeDb({ fail: 'throw' }), { event_id: EVENT, kind: 'kiosk_email' }), 'failed');
  assert.equal(await recordEventActivity(fakeDb(), null), 'skipped');
});

// ── Fonctions ───────────────────────────────────────────────────────────────────────────────

test('send-kiosk-photo : comptage par sendKioskEmailAndCount, 502 sur refus Brevo, sans le destinataire', () => {
  const src = fnSrc('send-kiosk-photo');
  assert.match(src, /import \{ sendKioskEmailAndCount \} from '\.\.\/_shared\/event-activity\.ts';/);
  const tryBlock = src.slice(src.indexOf('  try {\n    await sendKioskEmailAndCount('), src.indexOf("return corsResponse(200, { message: 'Email envoyé avec succès' })"));
  assert.match(tryBlock, /sendKioskEmailAndCount\(db, event\.id, \(\) =>\s+sendHtmlEmail\(\{ to, subject/);
  assert.match(tryBlock, /if \(e instanceof EmailSendError\) return corsResponse\(502/);
  assert.doesNotMatch(src, /event_activity'\)|kind: 'kiosk_email'/, 'aucune écriture directe hors du module partagé');
  // Sans clé Brevo : réponse « simulé » avant l'envoi, donc jamais comptée.
  assert.ok(src.indexOf('Email simulé') < src.indexOf('sendKioskEmailAndCount(db'));
});

test('get-photos : ouverture par QR comptée après le contrôle du code, attendue avant la réponse', () => {
  const src = fnSrc('get-photos');
  assert.match(src, /import \{ qrOpenActivity, recordEventActivity \} from '\.\.\/_shared\/event-activity\.ts';/);
  const call = src.indexOf('recordEventActivity(db, qrOpenActivity(event.id, params, (photos ?? []).map((p) => p.id)))');
  assert.ok(call > 0);
  assert.ok(call > src.indexOf("if (photosErr) return corsResponse(500"), 'après la lecture des photos approuvées');
  assert.ok(call > src.indexOf("event.status === 'archived'"), 'après les contrôles de l\'événement');
  assert.ok(src.indexOf('await qrOpen;') > call && src.indexOf('await qrOpen;') < src.indexOf('return corsResponse(200'));
});

test('module partagé : uniquement event_id, kind et photo_id', () => {
  const src = readFileSync(new URL('./event-activity.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^import /m, 'sans import : testable sous node');
  for (const banned of ['email', 'to', 'ip', 'user_agent', 'uploader']) {
    const types = src.slice(src.indexOf('export type EventActivity'), src.indexOf('export type ActivityResult'));
    assert.doesNotMatch(types, new RegExp(`\\b${banned}\\b`), banned);
  }
});

// ── Migration et script de vérification ─────────────────────────────────────────────────────

const DIR = new URL('../../migrations/', import.meta.url);
const MIGRATION = '20261130000000_event_activity_qr_unique.sql';
const strip = (s: string) => s.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
const flat = (s: string) => s.replace(/\s+/g, ' ').trim();

test('migration : horodatage unique, index unique partiel qr_open, photo obligatoire, idempotente', { skip: PRIVATE_HISTORY }, () => {
  const all = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  const stamps = all.map((f) => f.slice(0, 14));
  assert.equal(stamps.filter((s) => s === '20261130000000').length, 1);
  assert.equal(new Set(stamps).size, stamps.length, 'horodatages uniques');
  const sql = strip(readFileSync(new URL(MIGRATION, DIR), 'utf8'));
  const one = flat(sql);
  assert.doesNotMatch(sql, /[À-ÿ]/);
  assert.match(one, /CREATE UNIQUE INDEX IF NOT EXISTS event_activity_qr_open_photo_key ON public\.event_activity \(event_id, photo_id\) WHERE kind = 'qr_open';/);
  assert.match(one, /ADD CONSTRAINT event_activity_qr_open_photo_chk CHECK \(kind <> 'qr_open' OR photo_id IS NOT NULL\);/);
  assert.match(one, /DROP CONSTRAINT IF EXISTS event_activity_qr_open_photo_chk;/);
  // Doublons supprimés avant l'index (fonction déployée avant la migration).
  assert.ok(one.indexOf('DELETE FROM public.event_activity a USING') < one.indexOf('CREATE UNIQUE INDEX'));
  assert.doesNotMatch(one, /\b(GRANT|POLICY|DISABLE ROW LEVEL)\b/, 'droits et RLS de LAB-227 inchangés');
  assert.match(sql, /NOTIFY pgrst, 'reload schema';\s*$/);
});

test('script de vérification dev : transaction annulée, deux scans = 1, droits inchangés', { skip: PRIVATE_HISTORY }, () => {
  const check = readFileSync(new URL('../../tests/lab232_event_activity_check.sql', import.meta.url), 'utf8');
  assert.match(check, /^BEGIN;$/m);
  assert.match(check, /ROLLBACK;\s*$/);
  assert.doesNotMatch(strip(check), /\bCOMMIT\b/i);
  assert.match(check, /SELECT 'LAB-232 OK' AS result;/);
  assert.match(check, /23505|unique_violation/);
  assert.match(check, /deux scans comptés/);
  assert.doesNotMatch(check, /'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/i, 'aucun identifiant réel');
});

test('saas/CLAUDE.md documente LAB-232', { skip: PRIVATE_HISTORY }, () => {
  const doc = readFileSync(new URL('../../../CLAUDE.md', import.meta.url), 'utf8');
  assert.match(doc, /LAB-232/);
  assert.match(doc, /event_activity_qr_open_photo_key/);
});
