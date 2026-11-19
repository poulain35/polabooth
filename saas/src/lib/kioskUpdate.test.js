// LAB-200 : mise à jour d'une borne uniquement sur demande depuis la page Licences.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, kioskUpdateStatus, latestRelease, pendingKioskUpdate } from './kioskUpdate.js';

const REQ = '2026-11-03T10:00:00.123456+00:00';
const lic = (over = {}) => ({
  app_version: '1.0.15',
  update_requested_version: '1.0.16',
  update_requested_at: REQ,
  update_received_at: null,
  update_failed_at: null,
  update_error: null,
  ...over,
});

test('compareVersions : ordre numérique, pas alphabétique', () => {
  assert.ok(compareVersions('1.0.10', '1.0.9') > 0);
  assert.ok(compareVersions('1.2.0', '1.10.0') < 0);
  assert.equal(compareVersions('1.0.15', '1.0.15'), 0);
  assert.equal(compareVersions('1.0', '1.0.0'), 0);
});

test('latestRelease : version la plus élevée, quel que soit l\'ordre de publication', () => {
  const releases = [{ version: '1.0.9' }, { version: '1.0.16' }, { version: '1.0.10' }];
  assert.equal(latestRelease(releases).version, '1.0.16');
  assert.equal(latestRelease([]), null);
  assert.equal(latestRelease(undefined), null);
});

test('kioskUpdateStatus : aucune demande', () => {
  assert.equal(kioskUpdateStatus(lic({ update_requested_version: null, update_requested_at: null })).state, 'none');
  assert.equal(kioskUpdateStatus(lic({ update_requested_at: null })).state, 'none');
  assert.equal(kioskUpdateStatus(null).state, 'none');
});

test('kioskUpdateStatus : demandée, pas encore reçue par la borne', () => {
  const s = kioskUpdateStatus(lic());
  assert.equal(s.state, 'requested');
  assert.equal(s.version, '1.0.16');
  assert.equal(s.requestedAt, REQ);
});

test('kioskUpdateStatus : reçue par la borne', () => {
  const s = kioskUpdateStatus(lic({ update_received_at: '2026-11-03T10:02:00+00:00' }));
  assert.equal(s.state, 'received');
  assert.equal(s.receivedAt, '2026-11-03T10:02:00+00:00');
});

test('kioskUpdateStatus : installée dès que la borne tourne sur la version demandée', () => {
  const s = kioskUpdateStatus(lic({ app_version: '1.0.16', update_received_at: '2026-11-03T10:02:00+00:00' }));
  assert.equal(s.state, 'installed');
});

test('kioskUpdateStatus : échec avec son message', () => {
  const s = kioskUpdateStatus(lic({
    update_received_at: '2026-11-03T10:02:00+00:00',
    update_failed_at: '2026-11-03T10:05:00+00:00',
    update_error: 'Installeur refusé : son empreinte SHA-256 ne correspond pas à celle publiée.',
  }));
  assert.equal(s.state, 'failed');
  assert.match(s.error, /SHA-256/);
});

test('kioskUpdateStatus : un échec ou une réception antérieurs à la demande ne comptent pas', () => {
  const s = kioskUpdateStatus(lic({
    update_received_at: '2026-11-02T09:00:00+00:00',
    update_failed_at: '2026-11-02T09:05:00+00:00',
    update_error: 'ancien échec',
  }));
  assert.equal(s.state, 'requested');
  assert.equal(s.error, null);
});

test('pendingKioskUpdate : bornes du compte en retard sur la dernière version', () => {
  const releases = [{ version: '1.0.18' }, { version: '1.0.19' }];
  const base = { org_id: 'o1', retired_at: null, update_requested_version: null, update_requested_at: null };
  const licenses = [
    { ...base, id: 'a', app_version: '1.0.18' },
    { ...base, id: 'b', app_version: '1.0.19' },
    { ...base, id: 'c', app_version: '1.0.17' },
    { ...base, id: 'd', app_version: null },
    { ...base, id: 'e', app_version: '1.0.10', retired_at: '2026-10-01T00:00:00Z' },
    { ...base, id: 'f', app_version: '1.0.10', org_id: 'o2' },
    { ...base, id: 'g', app_version: '1.0.18', update_requested_version: '1.0.19', update_requested_at: REQ },
  ];
  assert.deepEqual(pendingKioskUpdate(licenses, releases, 'o1'), { version: '1.0.19', count: 2 });
  assert.equal(pendingKioskUpdate(licenses.slice(1, 2), releases, 'o1'), null);
  assert.equal(pendingKioskUpdate(licenses, [], 'o1'), null);
  assert.equal(pendingKioskUpdate(licenses, releases, null), null);
});

test('pendingKioskUpdate : une demande échouée laisse la borne comptée', () => {
  const releases = [{ version: '1.0.19' }];
  const failed = {
    org_id: 'o1', retired_at: null, app_version: '1.0.18', update_requested_version: '1.0.19',
    update_requested_at: REQ, update_failed_at: '2026-11-03T11:00:00Z', update_error: 'x',
  };
  assert.deepEqual(pendingKioskUpdate([failed], releases, 'o1'), { version: '1.0.19', count: 1 });
});
