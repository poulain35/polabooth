// Tests de la logique pure d'évaluation des alertes.
// Exécution : `npm test` (runner natif Node, strip-types — aucune dépendance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAlerts, heldAlertTypes, RESOLVE } from './evaluate.ts';

const NOW = Date.parse('2026-06-07T12:00:00Z');
const minsAgo = (n: number) => new Date(NOW - n * 60_000).toISOString();

const base = {
  cfg: {} as Record<string, any>,
  eventName: 'Mariage',
  machineName: 'Booth 1',
  lastSeenAt: minsAgo(1),
  printerStatus: 'ready' as string | null,
  maxPrints: null as number | null,
  printsUsed: 0,
  paperCapacity: null as number | null,
  paperUsed: 0,
  now: NOW,
};

const typesOf = (cands: { type: string }[]) => cands.map((c) => c.type).sort();

test('aucune alerte quand tout est désactivé', () => {
  assert.deepEqual(evaluateAlerts(base), []);
});

test('machine_offline : pas d\'alerte si vue récemment', () => {
  const r = evaluateAlerts({ ...base, cfg: { machine_offline: { enabled: true, after_minutes: 10 } }, lastSeenAt: minsAgo(3) });
  assert.equal(r.length, 0);
});

test('machine_offline : alerte au-delà du seuil', () => {
  const r = evaluateAlerts({ ...base, cfg: { machine_offline: { enabled: true, after_minutes: 10 } }, lastSeenAt: minsAgo(25) });
  assert.deepEqual(typesOf(r), ['machine_offline']);
});

test('machine_offline : alerte si jamais vue', () => {
  const r = evaluateAlerts({ ...base, cfg: { machine_offline: { enabled: true, after_minutes: 10 } }, lastSeenAt: null });
  assert.deepEqual(typesOf(r), ['machine_offline']);
  assert.match(r[0].detail, /jamais vue/);
});

test('printer_problem : alerte pour un statut en défaut', () => {
  for (const status of ['paper_out', 'paper_jam', 'error', 'offline', 'not_found']) {
    const r = evaluateAlerts({ ...base, cfg: { printer_problem: { enabled: true } }, printerStatus: status });
    assert.deepEqual(typesOf(r), ['printer_problem'], `statut ${status}`);
  }
});

test('printer_problem : pas d\'alerte si imprimante prête', () => {
  const r = evaluateAlerts({ ...base, cfg: { printer_problem: { enabled: true } }, printerStatus: 'ready' });
  assert.equal(r.length, 0);
});

test('print_quota_near : alerte au-dessus du seuil, pas en dessous', () => {
  const cfg = { print_quota_near: { enabled: true, threshold_pct: 90 } };
  assert.deepEqual(typesOf(evaluateAlerts({ ...base, cfg, maxPrints: 100, printsUsed: 95 })), ['print_quota_near']);
  assert.equal(evaluateAlerts({ ...base, cfg, maxPrints: 100, printsUsed: 50 }).length, 0);
});

test('print_quota_near : ignoré sans quota défini', () => {
  const r = evaluateAlerts({ ...base, cfg: { print_quota_near: { enabled: true, threshold_pct: 90 } }, maxPrints: null, printsUsed: 9999 });
  assert.equal(r.length, 0);
});

test('paper_low : alerte quand le stock restant passe sous le seuil', () => {
  const cfg = { paper_low: { enabled: true, threshold_pct: 10 } };
  // 700 − 650 = 50 restants → 7 % ≤ 10 %
  assert.deepEqual(typesOf(evaluateAlerts({ ...base, cfg, paperCapacity: 700, paperUsed: 650 })), ['paper_low']);
  // 700 − 100 = 600 restants → 86 % > 10 %
  assert.equal(evaluateAlerts({ ...base, cfg, paperCapacity: 700, paperUsed: 100 }).length, 0);
});

test('plusieurs alertes simultanées', () => {
  const r = evaluateAlerts({
    ...base,
    cfg: {
      machine_offline: { enabled: true, after_minutes: 10 },
      printer_problem: { enabled: true },
      paper_low:       { enabled: true, threshold_pct: 10 },
    },
    lastSeenAt: minsAgo(30),
    printerStatus: 'paper_out',
    paperCapacity: 700, paperUsed: 690,
  });
  assert.deepEqual(typesOf(r), ['machine_offline', 'paper_low', 'printer_problem']);
});

test('RESOLVE couvre les 5 types et produit un message', () => {
  for (const type of ['machine_offline', 'printer_problem', 'print_quota_near', 'paper_low', 'camera_problem'] as const) {
    assert.ok(RESOLVE[type], `RESOLVE manque ${type}`);
    assert.match(RESOLVE[type].detail('Booth 1'), /Booth 1/);
  }
});

// ── LAB-263 : appareil photo débranché ──────────────────────────────────────────

const camCfg = { camera_problem: { enabled: true } };

test('camera_problem : alerte si appareil débranché et machine vue récemment', () => {
  const r = evaluateAlerts({ ...base, cfg: camCfg, cameraStatus: 'disconnected', lastSeenAt: minsAgo(2) });
  assert.deepEqual(typesOf(r), ['camera_problem']);
  assert.match(r[0].subject, /Appareil photo débranché — Mariage/);
  assert.match(r[0].detail, /Booth 1/);
  assert.deepEqual(heldAlertTypes({ ...base, cfg: camCfg, cameraStatus: 'disconnected', lastSeenAt: minsAgo(2) }), []);
});

test('camera_problem : rien si appareil ok, inconnu (null) ou statut absent', () => {
  for (const cameraStatus of ['ok', null, undefined]) {
    assert.equal(evaluateAlerts({ ...base, cfg: camCfg, cameraStatus }).length, 0, String(cameraStatus));
    assert.deepEqual(heldAlertTypes({ ...base, cfg: camCfg, cameraStatus }), [], String(cameraStatus));
  }
});

test('camera_problem : désactivé par son interrupteur', () => {
  const cfg = { camera_problem: { enabled: false }, printer_problem: { enabled: true } };
  assert.equal(evaluateAlerts({ ...base, cfg, cameraStatus: 'disconnected' }).length, 0);
  assert.equal(evaluateAlerts({ ...base, cfg: {}, cameraStatus: 'disconnected' }).length, 0);
  assert.deepEqual(heldAlertTypes({ ...base, cfg, cameraStatus: 'disconnected', lastSeenAt: minsAgo(60) }), []);
});

test('camera_problem : machine hors ligne → pas de doublon avec machine_offline, alerte ouverte gardée', () => {
  const cfg = { ...camCfg, machine_offline: { enabled: true, after_minutes: 10 } };
  const inp = { ...base, cfg, cameraStatus: 'disconnected', lastSeenAt: minsAgo(25) };
  assert.deepEqual(typesOf(evaluateAlerts(inp)), ['machine_offline']);
  assert.deepEqual(heldAlertTypes(inp), ['camera_problem']);
  // jamais vue : même chose
  assert.deepEqual(heldAlertTypes({ ...inp, lastSeenAt: null }), ['camera_problem']);
});

test('camera_problem : le délai « vue récemment » suit le réglage de machine_offline', () => {
  const cfg = { ...camCfg, machine_offline: { enabled: false, after_minutes: 30 } };
  assert.deepEqual(typesOf(evaluateAlerts({ ...base, cfg, cameraStatus: 'disconnected', lastSeenAt: minsAgo(20) })), ['camera_problem']);
  // sans réglage : 10 min par défaut
  assert.equal(evaluateAlerts({ ...base, cfg: camCfg, cameraStatus: 'disconnected', lastSeenAt: minsAgo(20) }).length, 0);
});

test('camera_problem : résolu quand l’appareil revient (ok)', () => {
  const inp = { ...base, cfg: camCfg, cameraStatus: 'ok' };
  assert.equal(evaluateAlerts(inp).length, 0);
  assert.deepEqual(heldAlertTypes(inp), []); // ni déclenché ni gardé → index.ts résout
  assert.match(RESOLVE.camera_problem.subject, /Appareil photo OK/);
});
