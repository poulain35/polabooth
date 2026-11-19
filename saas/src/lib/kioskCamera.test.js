// LAB-429 : réglages de l'appareil photo d'une borne depuis le SaaS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FLASH_WARNING, OFFLINE_HINT, WB_COLOR_TEMPERATURE,
  cameraPanel, cameraRequestStatus, changedValues, currentValues, flashWarning, initialDraft,
  lockedMessage, optionLabel, shutterDenominator, valuesSummary, visibleSettings,
} from './kioskCamera.js';

const NOW = Date.parse('2026-11-19T10:00:00Z');
const TZ = 'Europe/Paris';

const REPORT = {
  model: 'Canon EOS R100',
  mode: 'M',
  settable: true,
  values: { tv: 96, av: 48, iso: 104, wb: 1, kelvin: null },
  options: {
    tv: [{ code: 93, label: '1/100' }, { code: 96, label: '1/125' }, { code: 104, label: '1/250' }],
    av: [{ code: 45, label: '5' }, { code: 48, label: '5,6' }],
    iso: [{ code: 72, label: '100' }, { code: 104, label: '1600' }],
    wb: [{ code: 0, label: 'Auto' }, { code: 1, label: 'Lumière du jour' }, { code: 9, label: 'Température de couleur' }],
    kelvin: [{ code: 5500, label: '5500 K' }, { code: 5600, label: '5600 K' }],
  },
  at: '2026-11-19T09:58:00Z',
  received_at: '2026-11-19T09:58:01Z',
};

const lic = (over = {}) => ({
  id: 'k1',
  last_seen_at: '2026-11-19T09:58:00Z',
  camera_report: REPORT,
  camera_request: null,
  ...over,
});

test('cameraPanel : rien reçu, liste vide ou rapport illisible = none', () => {
  assert.equal(cameraPanel(lic({ camera_report: null })).kind, 'none');
  assert.equal(cameraPanel(lic({ camera_report: [] })).kind, 'none');
  assert.equal(cameraPanel(lic({ camera_report: { mode: 'M', settable: true, options: {} } })).kind, 'none');
  assert.equal(cameraPanel(null).kind, 'none');
});

test('cameraPanel : webcam ou caméra simulée = unsupported', () => {
  const p = cameraPanel(lic({ camera_report: { supported: false, model: 'Webcam' } }));
  assert.equal(p.kind, 'unsupported');
  assert.equal(p.model, 'Webcam');
});

test('cameraPanel : molette sur M = prêt, sinon verrouillé avec le mode', () => {
  const ready = cameraPanel(lic());
  assert.equal(ready.kind, 'ready');
  assert.equal(ready.locked, false);
  assert.equal(ready.mode, 'M');
  assert.equal(ready.receivedAt, REPORT.received_at);

  const av = cameraPanel(lic({ camera_report: { ...REPORT, mode: 'Av', settable: false } }));
  assert.equal(av.locked, true);
  assert.equal(av.lockedMessage, 'Molette de l\'appareil sur Av : mettez-la sur M pour changer les réglages.');

  // settable absent ou faux : verrouillé (on ne suppose jamais M).
  assert.equal(cameraPanel(lic({ camera_report: { ...REPORT, settable: undefined } })).locked, true);
  assert.match(lockedMessage(null), /sur M/);
});

test('optionLabel et currentValues', () => {
  assert.equal(optionLabel(REPORT, 'tv', 96), '1/125');
  assert.equal(optionLabel(REPORT, 'tv', 1), null);
  assert.equal(optionLabel(REPORT, 'tv', '96'), null);
  assert.deepEqual(currentValues(REPORT), { tv: 96, av: 48, iso: 104, wb: 1 });
  assert.deepEqual(currentValues({ values: { tv: 'x', flash: 1 } }), {});
});

test('visibleSettings : température seulement avec la balance « Température de couleur »', () => {
  assert.deepEqual(visibleSettings(REPORT).map(s => s.key), ['tv', 'av', 'iso', 'wb']);
  const withK = visibleSettings(REPORT, { wb: WB_COLOR_TEMPERATURE });
  assert.deepEqual(withK.map(s => s.key), ['tv', 'av', 'iso', 'wb', 'kelvin']);
  assert.equal(withK.at(-1).value, null);

  const tv = visibleSettings(REPORT)[0];
  assert.equal(tv.label, 'Vitesse');
  assert.equal(tv.valueLabel, '1/125');
  assert.equal(tv.options.length, 3);

  // Réglage sans liste : retiré ; option sans code numérique : ignorée ; sans libellé : le code.
  const partial = { ...REPORT, options: { tv: [{ code: 96 }, { code: 'x', label: 'y' }], av: [] } };
  const s = visibleSettings(partial);
  assert.deepEqual(s.map(x => x.key), ['tv']);
  assert.deepEqual(s[0].options, [{ code: 96, label: '96' }]);
});

test('valuesSummary', () => {
  assert.equal(valuesSummary(REPORT), '1/125 · 5,6 · ISO 1600 · Lumière du jour');
  assert.equal(valuesSummary(REPORT, { tv: 93, wb: 9, kelvin: 5600 }), '1/100 · Température de couleur · 5600 K');
  assert.equal(valuesSummary(REPORT, {}), '');
});

test('initialDraft : la demande en attente passe par-dessus les valeurs de l\'appareil', () => {
  assert.deepEqual(initialDraft(REPORT, null), { tv: 96, av: 48, iso: 104, wb: 1 });
  assert.deepEqual(
    initialDraft(REPORT, { status: 'pending', values: { tv: 104 } }),
    { tv: 104, av: 48, iso: 104, wb: 1 },
  );
  assert.deepEqual(
    initialDraft(REPORT, { status: 'received', values: { iso: 72 } }),
    { tv: 96, av: 48, iso: 72, wb: 1 },
  );
  // Demande close : on repart de l'appareil.
  assert.deepEqual(initialDraft(REPORT, { status: 'applied', values: { tv: 104 } }).tv, 96);
});

test('changedValues : seulement ce qui change et figure dans la liste', () => {
  assert.deepEqual(changedValues(REPORT, { tv: 96, av: 48 }), {});
  assert.deepEqual(changedValues(REPORT, { tv: 104, iso: 72 }), { tv: 104, iso: 72 });
  assert.deepEqual(changedValues(REPORT, { tv: 97 }), {}, 'hors liste');
  assert.deepEqual(changedValues(REPORT, { kelvin: 5600 }), {}, 'température sans la balance');
  assert.deepEqual(changedValues(REPORT, { wb: 9, kelvin: 5600 }), { wb: 9, kelvin: 5600 });
  assert.deepEqual(changedValues(REPORT, { tv: '104' }), {});
});

test('shutterDenominator et flashWarning (1/200 du R100)', () => {
  assert.equal(shutterDenominator('1/250'), 250);
  assert.equal(shutterDenominator(' 1 / 125 '), 125);
  assert.equal(shutterDenominator('0"5'), null);
  assert.equal(shutterDenominator('30"'), null);
  assert.equal(shutterDenominator(null), null);
  assert.equal(flashWarning('1/200'), null);
  assert.equal(flashWarning('1/125'), null);
  assert.equal(flashWarning('1/250'), FLASH_WARNING);
  assert.equal(flashWarning('1"'), null);
});

test('cameraRequestStatus : aucune demande', () => {
  assert.equal(cameraRequestStatus(lic(), { now: NOW }).state, 'none');
  assert.equal(cameraRequestStatus(lic({ camera_request: { status: 'bizarre' } }), { now: NOW }).state, 'none');
});

test('cameraRequestStatus : en attente, reçu, appliqué, refusé', () => {
  const pending = cameraRequestStatus(lic({
    camera_request: { status: 'pending', values: { tv: 104 }, requested_at: '2026-11-19T09:59:00Z' },
  }), { now: NOW, timeZone: TZ });
  assert.equal(pending.state, 'pending');
  assert.equal(pending.tone, 'amber');
  assert.equal(pending.message, 'Demandé à 10:59 : en attente de la borne');
  assert.equal(pending.hint, null);
  assert.deepEqual(pending.values, { tv: 104 });

  const received = cameraRequestStatus(lic({
    camera_request: { status: 'received', values: {}, requested_at: '2026-11-19T09:59:00Z', received_at: '2026-11-19T09:59:30Z' },
  }), { now: NOW, timeZone: TZ });
  assert.equal(received.message, 'Reçu par la borne à 10:59 : appliqué dès son retour à l\'accueil');

  const applied = cameraRequestStatus(lic({
    camera_request: { status: 'applied', values: { tv: 104 }, applied_at: '2026-11-19T09:32:00Z', result: { tv: 104, av: 48 } },
  }), { now: NOW, timeZone: TZ });
  assert.equal(applied.message, 'Appliqué à 10:32 ✓');
  assert.equal(applied.tone, 'green');
  assert.deepEqual(applied.result, { tv: 104, av: 48 });

  const refused = cameraRequestStatus(lic({
    camera_request: { status: 'refused', error: 'molette sur Av' },
  }), { now: NOW });
  assert.equal(refused.message, 'Refusé : molette sur Av');
  assert.equal(refused.tone, 'red');
  assert.equal(cameraRequestStatus(lic({ camera_request: { status: 'refused' } }), { now: NOW }).message, 'Refusé : sans détail');
});

test('cameraRequestStatus : borne hors ligne, appliqué à son retour', () => {
  const offline = { last_seen_at: '2026-11-19T09:30:00Z' };
  const s = cameraRequestStatus(lic({ ...offline, camera_request: { status: 'pending', requested_at: '2026-11-19T09:55:00Z' } }), { now: NOW });
  assert.equal(s.hint, OFFLINE_HINT);
  // Demande close : pas de précision, même hors ligne.
  const done = cameraRequestStatus(lic({ ...offline, camera_request: { status: 'applied', applied_at: '2026-11-19T09:20:00Z' } }), { now: NOW });
  assert.equal(done.hint, null);
});
