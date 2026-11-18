// LAB-213 : URL d'envoi R2 des montages PolaKiosk. Autorisation identique à kiosk_record_photo,
// chemin stable par séance, et migration qui fait de storage_path un argument obligatoire.
// LAB-229 : animations MP4 (60 Mo), affiche (kind "poster"), images limitées à 25 Mo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import {
  kioskStoragePath, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, maxUploadBytes, montageContentType, resolveKioskUpload,
} from './kioskUpload.ts';
import { PRIVATE_HISTORY, readPrivateHistory } from '../../../scripts/private-history.mjs';

const EVENT = '3f2b8c1e-0000-4000-8000-000000000001';
const OTHER_EVENT = '7c1d2e3f-0000-4000-8000-000000000002';
const SESSION = '9a7d6e5f-1111-4222-8333-444455556666';
const FILE = 'composite_20261025_213000.jpg';

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

function baseTables(): Tables {
  return {
    kiosk_licenses: [
      { id: 'l1', machine_id: 'PC-1', secret: 's3cr3t', is_active: true },
      { id: 'l2', machine_id: 'PC-OFF', secret: 'off', is_active: false },
      { id: 'l3', machine_id: 'PC-EMPTY', secret: '', is_active: true },
    ],
    events: [
      { id: EVENT, name: 'Mariage Léa & Tom', access_code: 'ABC123', status: 'active' },
      { id: OTHER_EVENT, name: 'Archivé', access_code: 'OLD999', status: 'archived' },
    ],
    photos: [],
  };
}

// Client Supabase factice : select / eq / in / like / limit / maybeSingle / await.
function fakeDb(tables: Tables, failOn?: string) {
  return {
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      const run = () => (failOn === table
        ? { data: null, error: { message: 'timeout' } }
        : { data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null });
      const q = {
        select() { return q; },
        eq(col: string, v: unknown) { filters.push((r) => r[col] === v); return q; },
        in(col: string, vs: unknown[]) { filters.push((r) => vs.includes(r[col])); return q; },
        like(col: string, pattern: string) {
          const re = new RegExp('^' + pattern.split('%').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
          filters.push((r) => typeof r[col] === 'string' && re.test(r[col] as string));
          return q;
        },
        limit() { return q; },
        maybeSingle() {
          const res = run();
          return Promise.resolve(res.error ? res : { data: res.data![0] ?? null, error: null });
        },
        then(resolve: (v: unknown) => void) { resolve(run()); },
      };
      return q;
    },
  };
}

const valid = () => ({
  access_code: 'abc123', event_id: EVENT, machine_id: 'PC-1', secret: 's3cr3t',
  session_id: SESSION, filename: FILE, content_length: 1_234_567,
});

test('valide : chemin photos/{slug-event}-{8 car. id}/{séance}/{fichier}, type JPEG lié', async () => {
  const res = await resolveKioskUpload(fakeDb(baseTables()), valid());
  assert.deepEqual(res, {
    ok: true,
    storagePath: `photos/mariage-lea-tom-3f2b8c1e/${SESSION}/${FILE}`,
    contentType: 'image/jpeg',
    contentLength: 1_234_567,
  });
});

test('refus : code d’accès invalide, d’un autre événement ou événement clôturé → 404', async () => {
  for (const patch of [{ access_code: 'NOPE00' }, { access_code: 'OLD999' }, { event_id: OTHER_EVENT, access_code: 'OLD999' }]) {
    const res = await resolveKioskUpload(fakeDb(baseTables()), { ...valid(), ...patch });
    assert.deepEqual(res, { ok: false, status: 404, error: 'Événement introuvable ou clôturé' }, JSON.stringify(patch));
  }
});

test('refus : machine inconnue, secret faux ou vide, licence inactive → 403', async () => {
  const patches = [
    { machine_id: 'PC-INCONNU' },
    { secret: 'mauvais' },
    { secret: '' },
    { secret: undefined },
    { machine_id: 'PC-OFF', secret: 'off' },
    { machine_id: 'PC-EMPTY', secret: '' },
  ];
  for (const patch of patches) {
    const res = await resolveKioskUpload(fakeDb(baseTables()), { ...valid(), ...patch });
    assert.deepEqual(res, { ok: false, status: 403, error: 'Licence kiosk invalide ou inactive' }, JSON.stringify(patch));
  }
});

test('licence vérifiée avant le code : pas d’oracle sur les codes sans secret valide', async () => {
  const res = await resolveKioskUpload(fakeDb(baseTables()), { ...valid(), access_code: 'NOPE00', secret: 'mauvais' });
  assert.equal(res.ok ? 0 : res.status, 403);
});

test('refus : séance ou fichier invalide (traversée, sous-dossier, extension) → 400', async () => {
  const patches = [
    { session_id: '../autre' },
    { session_id: 'pas-un-uuid' },
    { event_id: 'x' },
    { filename: '../composite.jpg' },
    { filename: 'a/b.jpg' },
    { filename: 'a\\b.jpg' },
    { filename: 'composite..jpg' },
    { filename: '.hidden.jpg' },
    { filename: 'composite.exe' },
    { filename: 'composite.jpg.svg' },
    { filename: 'composite' },
    { filename: '' },
    { content_length: 0 },
    { content_length: '123' },
    { content_length: 1.5 },
    { access_code: '' },
    { machine_id: '' },
  ];
  for (const patch of patches) {
    const res = await resolveKioskUpload(fakeDb(baseTables()), { ...valid(), ...patch });
    assert.equal(res.ok ? 0 : res.status, 400, JSON.stringify(patch));
  }
});

test('refus : fichier trop lourd → 413', async () => {
  const res = await resolveKioskUpload(fakeDb(baseTables()), { ...valid(), content_length: MAX_IMAGE_BYTES + 1 });
  assert.equal(res.ok ? 0 : res.status, 413);
});

// ─── LAB-229 : animations et affiche ─────────────────────────────────────────────

const CLIP = 'clip.mp4';
const MB = 1024 * 1024;

test('LAB-229 : limites 60 Mo pour un MP4, 25 Mo pour un JPEG (413 au-delà)', async () => {
  assert.equal(MAX_VIDEO_BYTES, 60 * MB);
  assert.equal(MAX_IMAGE_BYTES, 25 * MB);
  const cases: [Record<string, unknown>, number | true][] = [
    [{ filename: CLIP, content_length: 60 * MB }, true],
    [{ filename: CLIP, content_length: 60 * MB + 1 }, 413],
    [{ filename: 'composite.jpg', content_length: 25 * MB }, true],
    [{ filename: 'composite.jpg', content_length: 25 * MB + 1 }, 413],
    [{ filename: 'composite.png', content_length: 30 * MB }, 413],
    [{ kind: 'poster', content_length: 25 * MB + 1 }, 413],
  ];
  for (const [patch, expected] of cases) {
    const res = await resolveKioskUpload(fakeDb(baseTables()), { ...valid(), ...patch });
    assert.equal(res.ok ? true : res.status, expected, JSON.stringify(patch));
  }
});

test('LAB-229 : 413 avant toute lecture en base (même sans licence valide)', async () => {
  const res = await resolveKioskUpload(fakeDb(baseTables(), 'kiosk_licenses'), { ...valid(), secret: 'mauvais', filename: CLIP, content_length: 61 * MB });
  assert.equal(res.ok ? 0 : res.status, 413);
});

test('LAB-229 : MP4 de séance → video/mp4, même dossier que le montage', async () => {
  const res = await resolveKioskUpload(fakeDb(baseTables()), { ...valid(), filename: CLIP, kind: 'media', content_length: 4 * MB });
  assert.deepEqual(res, {
    ok: true,
    storagePath: `photos/mariage-lea-tom-3f2b8c1e/${SESSION}/${CLIP}`,
    contentType: 'video/mp4',
    contentLength: 4 * MB,
  });
});

test('LAB-229 : kind "poster" → {séance}/poster.jpg en image/jpeg, filename ignoré', async () => {
  for (const filename of [undefined, 'poster.jpg', 'clip.mp4', '../autre.png']) {
    const res = await resolveKioskUpload(fakeDb(baseTables()), { ...valid(), kind: 'poster', filename, content_length: 300_000 });
    assert.deepEqual(res, {
      ok: true,
      storagePath: `photos/mariage-lea-tom-3f2b8c1e/${SESSION}/poster.jpg`,
      contentType: 'image/jpeg',
      contentLength: 300_000,
    }, String(filename));
  }
});

test('LAB-229 : séance déjà enregistrée → l’affiche garde son nom (jamais le chemin du MP4)', async () => {
  const tables = baseTables();
  const previous = `photos/ancien-nom-3f2b8c1e/${SESSION}/${CLIP}`;
  tables.photos.push({ event_id: EVENT, source: 'kiosk', storage_path: previous });
  const poster = await resolveKioskUpload(fakeDb(tables), { ...valid(), kind: 'poster', content_length: 300_000 });
  assert.deepEqual(poster, {
    ok: true,
    storagePath: `photos/ancien-nom-3f2b8c1e/${SESSION}/poster.jpg`,
    contentType: 'image/jpeg',
    contentLength: 300_000,
  });
  const media = await resolveKioskUpload(fakeDb(tables), { ...valid(), filename: CLIP, content_length: 4 * MB });
  assert.deepEqual(media, { ok: true, storagePath: previous, contentType: 'video/mp4', contentLength: 4 * MB });
});

test('LAB-229 : chemin repris d’une séance photo → limite de l’image (413 pour 30 Mo)', async () => {
  const tables = baseTables();
  tables.photos.push({ event_id: EVENT, source: 'kiosk', storage_path: `photos/x-3f2b8c1e/${SESSION}/${FILE}` });
  const res = await resolveKioskUpload(fakeDb(tables), { ...valid(), filename: CLIP, content_length: 30 * MB });
  assert.equal(res.ok ? 0 : res.status, 413);
});

test('LAB-229 : kind inconnu → 400 ; l’affiche suit les mêmes contrôles d’accès', async () => {
  for (const kind of ['gif', 'POSTER', 1, true]) {
    const res = await resolveKioskUpload(fakeDb(baseTables()), { ...valid(), kind });
    assert.equal(res.ok ? 0 : res.status, 400, String(kind));
  }
  const noLicence = await resolveKioskUpload(fakeDb(baseTables()), { ...valid(), kind: 'poster', secret: 'mauvais' });
  assert.equal(noLicence.ok ? 0 : noLicence.status, 403);
  const closed = await resolveKioskUpload(fakeDb(baseTables()), { ...valid(), kind: 'poster', access_code: 'NOPE00' });
  assert.equal(closed.ok ? 0 : closed.status, 404);
  const badSession = await resolveKioskUpload(fakeDb(baseTables()), { ...valid(), kind: 'poster', session_id: '../x' });
  assert.equal(badSession.ok ? 0 : badSession.status, 400);
});

test('erreurs base → 500, sans URL', async () => {
  for (const table of ['kiosk_licenses', 'events', 'photos']) {
    const res = await resolveKioskUpload(fakeDb(baseTables(), table), valid());
    assert.equal(res.ok ? 0 : res.status, 500, table);
  }
});

test('même séance → même chemin (renvoi après coupure)', async () => {
  const db = fakeDb(baseTables());
  const first = await resolveKioskUpload(db, valid());
  const again = await resolveKioskUpload(db, { ...valid(), session_id: SESSION.toUpperCase() });
  assert.ok(first.ok && again.ok);
  assert.equal(again.storagePath, first.storagePath);
});

test('séance déjà enregistrée : chemin existant réutilisé même si l’événement a été renommé', async () => {
  const tables = baseTables();
  const previous = `photos/ancien-nom-3f2b8c1e/${SESSION}/composite_20261025_212959.png`;
  tables.photos.push({ event_id: EVENT, source: 'kiosk', storage_path: previous });
  tables.photos.push({ event_id: EVENT, source: 'guest', storage_path: `photos/x-3f2b8c1e/${SESSION}/autre.jpg` });
  const res = await resolveKioskUpload(fakeDb(tables), valid());
  assert.deepEqual(res, { ok: true, storagePath: previous, contentType: 'image/png', contentLength: 1_234_567 });
});

test('helpers : type MIME et chemin', () => {
  assert.equal(montageContentType('composite_1.JPG'), 'image/jpeg');
  assert.equal(montageContentType('composite_1.png'), 'image/png');
  assert.equal(montageContentType('composite_1.gif'), null);
  assert.equal(montageContentType('clip.MP4'), 'video/mp4');
  assert.equal(montageContentType('clip.mov'), null);
  assert.equal(maxUploadBytes('video/mp4'), MAX_VIDEO_BYTES);
  assert.equal(maxUploadBytes('image/png'), MAX_IMAGE_BYTES);
  assert.equal(kioskStoragePath({ id: EVENT, name: '' }, SESSION.toUpperCase(), FILE), `photos/event-3f2b8c1e/${SESSION}/${FILE}`);
});

// ─── Migration LAB-213 ───────────────────────────────────────────────────────────

const DIR = new URL('../../migrations/', import.meta.url);
const MIGRATION = '20261121000000_kiosk_photos_r2.sql';
const strip = (s: string) => s.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
const sql = strip(readPrivateHistory(new URL(MIGRATION, DIR)));
const NEW_SIG = 'TEXT, UUID, TEXT, TEXT, TEXT, TEXT';

const fnBody = (name: string) => {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(start >= 0, `${name} introuvable`);
  return sql.slice(start, sql.indexOf('$$;', start));
};

test('migration : après la migration LAB-197, timestamp unique', { skip: PRIVATE_HISTORY }, () => {
  const all = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  assert.ok(all.includes(MIGRATION));
  assert.ok(MIGRATION > '20261120000000_kiosk_security_admins.sql');
  assert.equal(new Set(all.map((f) => f.split('_')[0])).size, all.length);
});

test('migration : une seule signature de kiosk_record_photo, storage_path obligatoire', { skip: PRIVATE_HISTORY }, () => {
  assert.match(sql, /DROP FUNCTION IF EXISTS public\.kiosk_record_photo\(TEXT, UUID, TEXT, TEXT, TEXT\);/);
  assert.equal((sql.match(/CREATE OR REPLACE FUNCTION public\.kiosk_record_photo\(/g) ?? []).length, 1);
  const body = fnBody('kiosk_record_photo');
  assert.match(body, /p_code\s+TEXT,\s*p_event_id\s+UUID,\s*p_storage_path\s+TEXT,\s*p_photo_url\s+TEXT,\s*p_machine_id\s+TEXT,\s*p_secret\s+TEXT/);
  assert.match(body, /SECURITY DEFINER/);
  assert.match(body, /SET search_path = public, pg_temp/);
  assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.kiosk_record_photo\\(${NEW_SIG}\\) FROM PUBLIC;`));
  assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.kiosk_record_photo\\(${NEW_SIG}\\) TO anon, service_role;`));
});

test('migration : licence, événement et chemin contrôlés avant l’INSERT', { skip: PRIVATE_HISTORY }, () => {
  const body = fnBody('kiosk_record_photo');
  assert.match(body, /machine_id = p_machine_id\s+AND is_active\s+AND secret <> ''\s+AND secret = p_secret/);
  assert.match(body, /e\.id = p_event_id\s+AND e\.access_code = UPPER\(TRIM\(p_code\)\)\s+AND e\.status IN \('active', 'submitted'\)/);
  // Chemin : NULL / vide refusé, préfixe photos/{dossier}-{8 car. de l'event}/{séance}/{fichier image}, pas de « .. ».
  assert.match(body, /p_storage_path IS NULL/);
  assert.match(body, /p_storage_path !~ \('\^photos\/\[a-z0-9-\]\+-' \|\| left\(p_event_id::TEXT, 8\)/);
  assert.match(body, /p_storage_path LIKE '%\.\.%'/);
  // URL publique : https, se termine par le chemin.
  assert.match(body, /right\(p_photo_url, length\(p_storage_path\) \+ 1\) <> '\/' \|\| p_storage_path/);
  assert.doesNotMatch(body, /storage\/v1/);
  const insert = body.indexOf('INSERT INTO public.photos');
  assert.ok(insert > 0);
  assert.equal((body.slice(0, insert).match(/RAISE EXCEPTION/g) ?? []).length, 4);
  assert.match(body, /VALUES \(p_event_id, p_photo_url, p_storage_path, 'kiosk', 'approved'\)/);
});

test('migration : idempotence par storage_path (index unique + ON CONFLICT)', { skip: PRIVATE_HISTORY }, () => {
  const guard = sql.indexOf('GROUP BY storage_path');
  const index = sql.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS photos_storage_path_key');
  assert.ok(guard > 0 && guard < index, 'contrôle des doublons avant l’index');
  assert.match(sql, /ON public\.photos \(storage_path\) WHERE storage_path IS NOT NULL;/);
  const body = fnBody('kiosk_record_photo');
  assert.match(body, /ON CONFLICT \(storage_path\) WHERE storage_path IS NOT NULL DO NOTHING/);
  // Renvoi : ligne existante de la même séance kiosk, jamais celle d'un autre événement.
  assert.match(body, /WHERE p\.storage_path = p_storage_path\s+AND p\.event_id = p_event_id\s+AND p\.source = 'kiosk'/);
});

test('migration : policies du bucket Supabase photos supprimées, bucket conservé', { skip: PRIVATE_HISTORY }, () => {
  for (const p of ['photos_public_read', 'photos_anon_insert', 'photos_admin_update', 'photos_admin_delete']) {
    assert.match(sql, new RegExp(`DROP POLICY IF EXISTS "${p}" ON storage\\.objects;`), p);
  }
  assert.doesNotMatch(sql, /CREATE POLICY/);
  assert.doesNotMatch(sql, /storage\.buckets/);
  assert.doesNotMatch(sql, /DELETE FROM storage/i);
});

test('migration : SQL exécutable sans accents', { skip: PRIVATE_HISTORY }, () => {
  assert.doesNotMatch(sql, /[À-ÿ]/);
});

// ─── Kiosk : plus de Supabase Storage pour les photos ───────────────────────────

test('kiosk : URL R2 demandée à get-kiosk-upload-url, storage_path passé à kiosk_record_photo', () => {
  const svc = new URL('../../../../kiosk/PolaKiosk/Services/SupabaseService.cs', import.meta.url);
  if (!existsSync(svc)) return; // saas/ isolé du monorepo
  const src = readFileSync(svc, 'utf8');
  // Corps des RPC à part depuis LAB-405
  const bodies = readFileSync(new URL('../../../../kiosk/PolaKiosk/Services/SupabaseRpcBodies.cs', import.meta.url), 'utf8');
  for (const file of [src, bodies]) {
    assert.doesNotMatch(file, /storage\/v1/);
    assert.doesNotMatch(file, /IsStorageDuplicate|x-upsert/);
  }
  assert.match(src, /PostFunctionAsync\("get-kiosk-upload-url"|functions\/v1\/get-kiosk-upload-url/);
  assert.match(src, /(?:Post|Call)RpcAsync\("kiosk_record_photo",\s*BuildRecordPhotoBody\(/);
  const start = bodies.indexOf('BuildRecordPhotoBody(');
  assert.ok(start > 0, 'BuildRecordPhotoBody');
  assert.match(bodies.slice(start, bodies.indexOf('});', start)), /\bp_storage_path\b/);
  const record = src.search(/(?:Post|Call)RpcAsync\("kiosk_record_photo"/);
  assert.ok(record > 0 && src.indexOf('get-kiosk-upload-url') < record);
});
