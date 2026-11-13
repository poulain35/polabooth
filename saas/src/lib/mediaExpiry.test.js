// Affichage de la purge des fichiers dans la fiche événement (LAB-212).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mediaPurgeInfo } from './mediaExpiry.js';

test('mediaPurgeInfo : jamais purgé', () => {
  assert.deepEqual(mediaPurgeInfo({ expires_at: '2026-09-01T00:00:00Z', media_purged_at: null }), { purgedAt: null, extendedAfterPurge: false });
  assert.deepEqual(mediaPurgeInfo(null), { purgedAt: null, extendedAfterPurge: false });
});

test('mediaPurgeInfo : purgé, expiration inchangée', () => {
  const ev = { expires_at: '2026-09-01T00:00:00Z', media_purged_at: '2026-10-02T09:15:00Z' };
  assert.deepEqual(mediaPurgeInfo(ev), { purgedAt: ev.media_purged_at, extendedAfterPurge: false });
});

test('mediaPurgeInfo : lien prolongé ou expiration retirée après la purge', () => {
  assert.equal(mediaPurgeInfo({ expires_at: '2027-01-01T00:00:00Z', media_purged_at: '2026-10-02T09:15:00Z' }).extendedAfterPurge, true);
  assert.equal(mediaPurgeInfo({ expires_at: null, media_purged_at: '2026-10-02T09:15:00Z' }).extendedAfterPurge, true);
});
