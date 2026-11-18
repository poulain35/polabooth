// Tests de la logique pure du cron media-expiry (LAB-212) : sélection, purge idempotente, rappel.
// Exécution : `npm test` (runner natif Node, strip-types — aucune dépendance, aucun réseau).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deletableRowIds, deleteKeys, isPurgeDue, isReminderDue, isSafeObjectKey, keyFromPublicUrl, message,
  photoKeys, purgeCutoff, purgeEvent, remindableMedia, reminderEligible, reminderWindowEnd, remindEvent,
  type AudioRow, type MediaCount, type PhotoRow, type PurgeStore, type ReminderEvent, type ReminderStore,
} from './logic.ts';

const NOW = new Date('2026-11-23T09:15:00Z');
const BASE = 'https://pub-photos.r2.dev';
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();

// ── Sélection ───────────────────────────────────────────────────────────────

test('isPurgeDue : expiré depuis plus de 30 jours → sélectionné', () => {
  assert.equal(isPurgeDue(daysAgo(31), NOW), true);
  assert.equal(isPurgeDue(daysAgo(30), NOW), true); // exactement 30 jours
  assert.equal(isPurgeDue(daysAgo(400), NOW), true);
});

test('isPurgeDue : expiré depuis moins de 30 jours ou pas encore expiré → non', () => {
  assert.equal(isPurgeDue(daysAgo(29), NOW), false);
  assert.equal(isPurgeDue(daysAgo(0), NOW), false);
  assert.equal(isPurgeDue(inDays(10), NOW), false);
});

test('isPurgeDue : sans expires_at → jamais sélectionné', () => {
  assert.equal(isPurgeDue(null, NOW), false);
  assert.equal(isPurgeDue(undefined, NOW), false);
  assert.equal(isPurgeDue('', NOW), false);
  assert.equal(isPurgeDue('pas une date', NOW), false);
});

test('purgeCutoff / reminderWindowEnd : maintenant -30 j / +7 j', () => {
  assert.equal(purgeCutoff(NOW), '2026-10-24T09:15:00.000Z');
  assert.equal(reminderWindowEnd(NOW), '2026-11-30T09:15:00.000Z');
});

// ── Clés R2 ─────────────────────────────────────────────────────────────────

test('isSafeObjectKey : clé exacte uniquement, jamais un préfixe', () => {
  assert.equal(isSafeObjectKey('events/abc/photos/1.jpg'), true);
  for (const bad of ['', '/', 'events/abc/', '/events/abc/1.jpg', 'events/../x.jpg', '..', null, undefined, 42, 'x'.repeat(1025)]) {
    assert.equal(isSafeObjectKey(bad), false, String(bad));
  }
});

test('keyFromPublicUrl : clé de la miniature, null hors du bucket public', () => {
  assert.equal(keyFromPublicUrl(`${BASE}/events/e1/thumbs/1.jpg`, BASE), 'events/e1/thumbs/1.jpg');
  assert.equal(keyFromPublicUrl(`${BASE}/events/e1/thumbs/1.jpg?v=2`, `${BASE}/`), 'events/e1/thumbs/1.jpg');
  assert.equal(keyFromPublicUrl('https://ailleurs.example/events/e1/1.jpg', BASE), null);
  assert.equal(keyFromPublicUrl(`${BASE}/`, BASE), null);
  assert.equal(keyFromPublicUrl(`${BASE}/events/../secret`, BASE), null);
  assert.equal(keyFromPublicUrl(null, BASE), null);
  assert.equal(keyFromPublicUrl(`${BASE}/a.jpg`, ''), null);
});

test('photoKeys : original + miniature, sans doublon ni clé douteuse', () => {
  assert.deepEqual(photoKeys({ id: '1', storage_path: 'e/1.jpg', thumbnail_url: `${BASE}/e/t1.jpg` }, BASE), ['e/1.jpg', 'e/t1.jpg']);
  assert.deepEqual(photoKeys({ id: '1', storage_path: 'e/1.jpg', thumbnail_url: `${BASE}/e/1.jpg` }, BASE), ['e/1.jpg']);
  assert.deepEqual(photoKeys({ id: '1', storage_path: null, thumbnail_url: null }, BASE), []);
  assert.deepEqual(photoKeys({ id: '1', storage_path: 'e/', thumbnail_url: null }, BASE), []);
});

test('deleteKeys : lots de 1 000 max, dédoublonné, échec d\'un lot = toutes ses clés en échec', async () => {
  const keys = Array.from({ length: 2500 }, (_, i) => `k/${i}`);
  const calls: number[] = [];
  const failed = await deleteKeys([...keys, 'k/0'], async (part) => {
    calls.push(part.length);
    if (part.includes('k/1000')) throw new Error('réseau');
    return { failed: part.includes('k/0') ? ['k/0'] : [] };
  });
  assert.deepEqual(calls, [1000, 1000, 500]);
  assert.equal(failed.size, 1001); // k/0 + le 2e lot entier
  assert.ok(failed.has('k/0') && failed.has('k/1999') && !failed.has('k/2000'));
});

test('deletableRowIds : une ligne n\'est supprimée que si tous ses fichiers sont partis', () => {
  const rows: PhotoRow[] = [
    { id: 'a', storage_path: 'e/a.jpg', thumbnail_url: `${BASE}/e/ta.jpg` },
    { id: 'b', storage_path: 'e/b.jpg', thumbnail_url: `${BASE}/e/tb.jpg` },
  ];
  assert.deepEqual(deletableRowIds(rows, (r) => photoKeys(r, BASE), new Set(['e/tb.jpg'])), ['a']);
});

// ── Purge d'un événement (base + R2 en mémoire) ─────────────────────────────

function memoryStore(init: { expires_at: string | null; photos?: PhotoRow[]; audio?: AudioRow[]; failKeys?: string[] }) {
  const state = {
    event: { id: 'ev1', expires_at: init.expires_at, media_purged_at: null as string | null },
    photos: [...(init.photos ?? [])],
    audio: [...(init.audio ?? [])],
    objects: new Set<string>(),
    deleteCalls: [] as string[][],
    failKeys: new Set(init.failKeys ?? []),
  };
  for (const p of state.photos) for (const k of photoKeys(p, BASE)) state.objects.add(k);
  for (const a of state.audio) if (a.storage_path) state.objects.add(a.storage_path);

  const del = async (keys: string[]) => {
    state.deleteCalls.push(keys);
    const failed = keys.filter((k) => state.failKeys.has(k));
    for (const k of keys) if (!state.failKeys.has(k)) state.objects.delete(k);
    return { failed };
  };
  const store: PurgeStore = {
    readEvent: async () => ({ id: state.event.id, expires_at: state.event.expires_at }),
    listPhotos: async () => [...state.photos],
    listAudio: async () => [...state.audio],
    deletePhotoObjects: del,
    deleteAudioObjects: del,
    deletePhotoRows: async (ids) => { state.photos = state.photos.filter((r) => !ids.includes(r.id)); },
    deleteAudioRows: async (ids) => { state.audio = state.audio.filter((r) => !ids.includes(r.id)); },
    markPurged: async (_id, at) => { state.event.media_purged_at = at; },
  };
  return { state, store };
}

const PHOTOS: PhotoRow[] = [
  { id: 'p1', storage_path: 'events/ev1/p1.jpg', thumbnail_url: `${BASE}/events/ev1/thumbs/p1.jpg` },
  { id: 'p2', storage_path: 'events/ev1/p2.jpg', thumbnail_url: null },
];
const AUDIO: AudioRow[] = [{ id: 'a1', storage_path: 'audio/ev1/a1.webm' }];

test('purgeEvent : supprime fichiers R2 (clés des lignes uniquement), lignes, et note la date', async () => {
  const { state, store } = memoryStore({ expires_at: daysAgo(45), photos: PHOTOS, audio: AUDIO });
  const res = await purgeEvent(store, 'ev1', NOW, BASE);
  assert.deepEqual(res, { status: 'purged', photos: 2, audio: 1, failedKeys: 0 });
  assert.equal(state.objects.size, 0);
  assert.equal(state.photos.length + state.audio.length, 0);
  assert.equal(state.event.media_purged_at, NOW.toISOString());
  assert.deepEqual(state.deleteCalls.flat().sort(), [
    'audio/ev1/a1.webm', 'events/ev1/p1.jpg', 'events/ev1/p2.jpg', 'events/ev1/thumbs/p1.jpg',
  ]);
});

test('purgeEvent : relancer la purge est sans effet (idempotent)', async () => {
  const { state, store } = memoryStore({ expires_at: daysAgo(45), photos: PHOTOS, audio: AUDIO });
  await purgeEvent(store, 'ev1', NOW, BASE);
  const callsAfterFirst = state.deleteCalls.length;
  const purgedAt = state.event.media_purged_at;

  const later = new Date(NOW.getTime() + 86_400_000);
  const again = await purgeEvent(store, 'ev1', later, BASE);
  assert.equal(again.status, 'empty');
  assert.equal(state.deleteCalls.length, callsAfterFirst); // aucun nouvel appel R2
  assert.equal(state.event.media_purged_at, purgedAt);    // date de purge inchangée
});

test('purgeEvent : sans expires_at → rien n\'est touché', async () => {
  const { state, store } = memoryStore({ expires_at: null, photos: PHOTOS, audio: AUDIO });
  const res = await purgeEvent(store, 'ev1', NOW, BASE);
  assert.equal(res.status, 'not_due');
  assert.equal(state.deleteCalls.length, 0);
  assert.equal(state.photos.length, 2);
  assert.equal(state.event.media_purged_at, null);
});

test('purgeEvent : expiration repoussée (valeur actuelle) → rien n\'est touché', async () => {
  // Sélectionné sur l'ancienne date, mais l'admin a prolongé le lien entre-temps.
  const { state, store } = memoryStore({ expires_at: inDays(60), photos: PHOTOS, audio: AUDIO });
  const res = await purgeEvent(store, 'ev1', NOW, BASE);
  assert.equal(res.status, 'not_due');
  assert.equal(state.deleteCalls.length, 0);
  assert.equal(state.objects.size, 4);
});

test('purgeEvent : échec R2 → lignes concernées conservées, date non notée, nouvel essai OK', async () => {
  const { state, store } = memoryStore({
    expires_at: daysAgo(45), photos: PHOTOS, audio: AUDIO, failKeys: ['events/ev1/thumbs/p1.jpg'],
  });
  const res = await purgeEvent(store, 'ev1', NOW, BASE);
  assert.deepEqual(res, { status: 'partial', photos: 1, audio: 1, failedKeys: 1 });
  assert.deepEqual(state.photos.map((r) => r.id), ['p1']); // ligne gardée pour le passage suivant
  assert.equal(state.event.media_purged_at, null);

  state.failKeys.clear();
  const retry = await purgeEvent(store, 'ev1', NOW, BASE);
  assert.equal(retry.status, 'purged');
  assert.equal(state.photos.length, 0);
  assert.equal(state.objects.size, 0);
  assert.equal(state.event.media_purged_at, NOW.toISOString());
});

test('purgeEvent (LAB-229) : animation de la borne → MP4, affiche poster.jpg et ligne supprimés', async () => {
  const dir = 'photos/mariage-abcd1234/0b7e5c2a-0000-4000-8000-000000000001';
  const anim: PhotoRow = { id: 'g1', storage_path: `${dir}/clip.mp4`, thumbnail_url: `${BASE}/${dir}/poster.jpg` };
  const { state, store } = memoryStore({ expires_at: daysAgo(45), photos: [anim] });
  assert.equal(state.objects.size, 2);
  const res = await purgeEvent(store, 'ev1', NOW, BASE);
  assert.deepEqual(res, { status: 'purged', photos: 1, audio: 0, failedKeys: 0 });
  assert.deepEqual(state.deleteCalls.flat().sort(), [`${dir}/clip.mp4`, `${dir}/poster.jpg`]);
  assert.equal(state.objects.size, 0);
  assert.equal(state.photos.length, 0);
});

test('purgeEvent (LAB-229) : affiche non supprimée → ligne gardée pour le passage suivant', async () => {
  const dir = 'photos/mariage-abcd1234/0b7e5c2a-0000-4000-8000-000000000002';
  const anim: PhotoRow = { id: 'g2', storage_path: `${dir}/clip.mp4`, thumbnail_url: `${BASE}/${dir}/poster.jpg` };
  const { state, store } = memoryStore({ expires_at: daysAgo(45), photos: [anim], failKeys: [`${dir}/poster.jpg`] });
  const res = await purgeEvent(store, 'ev1', NOW, BASE);
  assert.equal(res.status, 'partial');
  assert.deepEqual(state.photos.map((r) => r.id), ['g2']);
  assert.deepEqual([...state.objects], [`${dir}/poster.jpg`]);
});

// ── Rappel ──────────────────────────────────────────────────────────────────

function reminderStore(media: MediaCount, opts: { sendError?: string } = {}) {
  const sent: string[] = [];
  const marks: Array<{ eventId: string; at: string; expiresAt: string }> = [];
  const store: ReminderStore = {
    countMedia: async () => media,
    send: async (ev) => {
      if (opts.sendError) return { error: opts.sendError };
      sent.push(ev.id);
      return { error: null };
    },
    markReminded: async (eventId, at, expiresAt) => { marks.push({ eventId, at, expiresAt }); },
  };
  return { store, sent, marks };
}

const baseEvent = (over: Partial<ReminderEvent> = {}): ReminderEvent => ({
  id: 'ev1', name: 'Mariage', client_name: 'Léa', client_email: 'lea@example.com',
  access_code: 'ABC123', status: 'active', expires_at: inDays(5), media_reminder_expires_at: null, ...over,
});

test('reminderEligible : fenêtre J-7 → expiration', () => {
  assert.equal(reminderEligible(baseEvent({ expires_at: inDays(7) }), NOW), true);
  assert.equal(reminderEligible(baseEvent({ expires_at: inDays(1) }), NOW), true);
  assert.equal(reminderEligible(baseEvent({ expires_at: inDays(8) }), NOW), false);
  assert.equal(reminderEligible(baseEvent({ expires_at: daysAgo(1) }), NOW), false);
  assert.equal(reminderEligible(baseEvent({ expires_at: null }), NOW), false);
});

test('remindEvent : envoyé une seule fois', async () => {
  const { store, sent, marks } = reminderStore({ photos: 12, audio: 0 });
  let ev = baseEvent();
  assert.equal(await remindEvent(store, ev, NOW), 'sent');
  assert.deepEqual(marks, [{ eventId: 'ev1', at: NOW.toISOString(), expiresAt: ev.expires_at! }]);

  ev = { ...ev, media_reminder_expires_at: marks[0].expiresAt }; // état après markReminded
  const tomorrow = new Date(NOW.getTime() + 86_400_000);
  assert.equal(await remindEvent(store, ev, tomorrow), 'skipped');
  assert.deepEqual(sent, ['ev1']);
});

test('remindEvent : pas d\'envoi sans photo ni audio', async () => {
  const { store, sent, marks } = reminderStore({ photos: 0, audio: 0 });
  assert.equal(await remindEvent(store, baseEvent(), NOW), 'skipped');
  assert.equal(sent.length + marks.length, 0);
  assert.equal(isReminderDue(baseEvent(), { photos: 0, audio: 3 }, NOW), true); // audio seul suffit
});

test('remindEvent : pas d\'envoi sans email client, sans code ou événement clôturé', async () => {
  const { store, sent } = reminderStore({ photos: 5, audio: 2 });
  for (const over of [{ client_email: null }, { client_email: '   ' }, { access_code: null }, { status: 'archived' }]) {
    assert.equal(await remindEvent(store, baseEvent(over), NOW), 'skipped', JSON.stringify(over));
  }
  assert.equal(sent.length, 0);
});

test('remindEvent : nouvel envoi si l\'expiration est repoussée après le rappel', async () => {
  const { store, sent } = reminderStore({ photos: 5, audio: 0 });
  const first = inDays(-1); // le premier rappel annonçait une date dépassée depuis hier
  const ev = baseEvent({ expires_at: inDays(6), media_reminder_expires_at: first });
  assert.equal(await remindEvent(store, ev, NOW), 'sent');
  assert.deepEqual(sent, ['ev1']);
});

test('remindEvent : pas de nouvel envoi si l\'expiration est avancée', async () => {
  const { store, sent } = reminderStore({ photos: 5, audio: 0 });
  const ev = baseEvent({ expires_at: inDays(3), media_reminder_expires_at: inDays(6) });
  assert.equal(await remindEvent(store, ev, NOW), 'skipped');
  assert.equal(sent.length, 0);
});

test('remindEvent : refus Brevo → non noté, nouvel essai au passage suivant', async () => {
  const { store, marks } = reminderStore({ photos: 5, audio: 0 }, { sendError: 'Brevo 400' });
  assert.equal(await remindEvent(store, baseEvent(), NOW), 'failed');
  assert.equal(marks.length, 0);
});

// ── Fonctionnalités (open core L3) ──────────────────────────────────────────

test('remindableMedia : galerie et livre d’or audio selon organizations.features', () => {
  assert.deepEqual(remindableMedia({}), { photos: true, audio: false }, 'défauts : galerie ouverte, audio privé');
  assert.deepEqual(remindableMedia({ gallery: true, audio_guestbook: true }), { photos: true, audio: true });
  assert.deepEqual(remindableMedia({ gallery: false, audio_guestbook: true }), { photos: false, audio: true });
  assert.deepEqual(remindableMedia(null), { photos: true, audio: false });
});

test('remindEvent : seuls les médias d’une fonctionnalité active sont annoncés', async () => {
  const media: MediaCount[] = [];
  const { store } = reminderStore({ photos: 4, audio: 2 });
  const spy: ReminderStore = { ...store, send: async (ev, m) => { media.push(m); return store.send(ev, m); } };
  assert.equal(await remindEvent(spy, baseEvent(), NOW, { photos: true, audio: false }), 'sent');
  assert.deepEqual(media, [{ photos: 4, audio: 0 }]);
});

test('remindEvent : galerie et audio désactivés → aucun rappel, aucune lecture', async () => {
  let counted = 0;
  const { store, sent } = reminderStore({ photos: 4, audio: 2 });
  const spy: ReminderStore = { ...store, countMedia: async (id) => { counted++; return store.countMedia(id); } };
  assert.equal(await remindEvent(spy, baseEvent(), NOW, { photos: false, audio: false }), 'skipped');
  assert.equal(counted + sent.length, 0);
});

test('remindEvent : audio seul désactivé et aucune photo → pas de rappel', async () => {
  const { store, sent } = reminderStore({ photos: 0, audio: 3 });
  assert.equal(await remindEvent(store, baseEvent(), NOW, { photos: true, audio: false }), 'skipped');
  assert.equal(sent.length, 0);
});

test('message : texte d’une Error, sinon valeur convertie en texte', () => {
  assert.equal(message(new Error('délai dépassé')), 'délai dépassé');
  assert.equal(message('refus'), 'refus');
  assert.equal(message(42), '42');
});
