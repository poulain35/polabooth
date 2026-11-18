// Tests de l'alerte kiosk_errors (LAB-329) : erreurs graves de la borne pendant un événement.
// Exécution : `npm test` (runner natif Node, strip-types — aucune dépendance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RESOLVE } from './evaluate.ts';
import {
  isEventInProgress, cameraErrorThreshold, evaluateKioskErrors, planKioskErrors, detailText,
  isCrashLog, isCameraErrorLog, kioskLogsUrl, type KioskLogRow,
} from './kiosk-errors.ts';

// 2026-06-07 12:00 UTC = 14:00 à Paris (heure d'été).
const NOW = Date.parse('2026-06-07T12:00:00Z');
const minsAgo = (n: number) => new Date(NOW - n * 60_000).toISOString();

const ORG = 'org-1';
const LIC = { id: 'lic-1', machine_id: 'M1', label: 'Booth 1', last_seen_at: minsAgo(1) };
const EVENT = {
  id: 'ev-1', name: 'Mariage', org_id: ORG, photobooth_id: 'lic-1', status: 'active',
  start_date: '2026-06-07T12:00:00Z', end_date: '2026-06-07T12:00:00Z',
};
const ON = { kiosk_errors: { enabled: true } };

const log = (context: string, min: number, extra: Partial<KioskLogRow> = {}): KioskLogRow => ({
  machine_id: 'M1', event_id: 'ev-1', level: 'error', context, message: `erreur ${context}`,
  occurred_at: minsAgo(min), ...extra,
});
const cameraBurst = (n: number, from = 1) => Array.from({ length: n }, (_, i) => log('camera', from + i));

const plan = (over: Partial<Parameters<typeof planKioskErrors>[0]> = {}) => planKioskErrors({
  cfg: ON, orgId: ORG, licenses: [LIC], events: [EVENT], logs: [], openAlerts: [], now: NOW, ...over,
});

// ── Événement en cours ───────────────────────────────────────────────────────

test('isEventInProgress : le jour même, même si début = fin à midi', () => {
  assert.equal(isEventInProgress(EVENT, NOW), true);
  assert.equal(isEventInProgress(EVENT, Date.parse('2026-06-06T22:30:00Z')), true); // 00:30 Paris le 7
});

test('isEventInProgress : la nuit continue jusqu\'à 6 h (Paris) le lendemain de la fin', () => {
  assert.equal(isEventInProgress(EVENT, Date.parse('2026-06-08T03:59:00Z')), true);  // 05:59 Paris
  assert.equal(isEventInProgress(EVENT, Date.parse('2026-06-08T04:00:00Z')), false); // 06:00 Paris
});

test('isEventInProgress : la veille et le surlendemain, non', () => {
  assert.equal(isEventInProgress(EVENT, Date.parse('2026-06-06T21:00:00Z')), false); // 23:00 Paris le 6
  assert.equal(isEventInProgress(EVENT, Date.parse('2026-06-09T01:00:00Z')), false);
});

test('isEventInProgress : plusieurs jours, une seule date, sans date, archivé', () => {
  const multi = { ...EVENT, start_date: '2026-06-05T10:00:00Z', end_date: '2026-06-08T10:00:00Z' };
  assert.equal(isEventInProgress(multi, NOW), true);
  assert.equal(isEventInProgress({ ...EVENT, end_date: null }, NOW), true);
  assert.equal(isEventInProgress({ ...EVENT, start_date: null }, NOW), true);
  assert.equal(isEventInProgress({ ...EVENT, start_date: null, end_date: null }, NOW), false);
  assert.equal(isEventInProgress({ ...EVENT, status: 'archived' }, NOW), false);
});

// ── Règle de déclenchement ───────────────────────────────────────────────────

test('contextes : plantage (ui, task, app) et appareil photo (camera, camera-evt)', () => {
  assert.equal(isCrashLog(log('ui', 1)), true);
  assert.equal(isCrashLog(log('task', 1)), true);
  assert.equal(isCrashLog(log('app', 1)), true);
  assert.equal(isCrashLog(log('ui', 1, { level: 'warning' })), false);
  assert.equal(isCrashLog(log('print', 1)), false);
  assert.equal(isCameraErrorLog(log('camera', 1)), true);
  assert.equal(isCameraErrorLog(log('camera-evt', 1)), true);
  assert.equal(isCameraErrorLog(log('camera-evt', 1, { level: 'info' })), false);
  assert.equal(isCameraErrorLog(log('cameraman', 1)), false);
});

test('seuil d\'erreurs d\'appareil photo : 5 par défaut, réglable de 1 à 50', () => {
  assert.equal(cameraErrorThreshold({}), 5);
  assert.equal(cameraErrorThreshold({ kiosk_errors: { camera_errors: 3 } }), 3);
  assert.equal(cameraErrorThreshold({ kiosk_errors: { camera_errors: 0 } }), 5);
  assert.equal(cameraErrorThreshold({ kiosk_errors: { camera_errors: 'x' } }), 5);
  assert.equal(cameraErrorThreshold({ kiosk_errors: { camera_errors: 500 } }), 50);
});

const ev = (logs: KioskLogRow[], cfg: Record<string, any> = ON) =>
  evaluateKioskErrors({ cfg, eventName: 'Mariage', machineName: 'Booth 1', logs, now: NOW });

test('un plantage dans les 30 dernières minutes déclenche', () => {
  const c = ev([log('ui', 20)]);
  assert.ok(c);
  assert.equal(c.type, 'kiosk_errors');
  assert.match(c.subject, /Plantage de la borne — Mariage/);
  assert.match(c.detail, /a planté/);
  assert.equal(ev([log('ui', 31)]), null);
});

test('appareil photo : 5 erreurs en 15 min déclenchent, 4 non, hors fenêtre non', () => {
  assert.equal(ev(cameraBurst(4)), null);
  const c = ev(cameraBurst(5));
  assert.ok(c);
  assert.match(c.subject, /Erreurs d'appareil photo — Mariage/);
  assert.match(c.detail, /5 erreurs d'appareil photo/);
  assert.equal(ev(cameraBurst(5, 12)), null); // 12..16 min : seulement 4 dans les 15 min
});

test('appareil photo : le seuil réglé est suivi', () => {
  assert.ok(ev(cameraBurst(2), { kiosk_errors: { enabled: true, camera_errors: 2 } }));
  assert.equal(ev(cameraBurst(5), { kiosk_errors: { enabled: true, camera_errors: 6 } }), null);
});

test('le message de la borne est échappé dans l\'email et rendu en texte pour la base', () => {
  const c = ev([log('ui', 1, { message: '<script>x</script> & "y"' })]);
  assert.ok(c);
  assert.ok(!c.detail.includes('<script>'));
  assert.match(c.detail, /&lt;script&gt;/);
  const text = detailText(c.detail);
  assert.match(text, /<script>x<\/script> & "y"/);
  assert.ok(!text.includes('<strong>'));
});

// ── Plan : ouverture, doublons, résolution ───────────────────────────────────

test('plantage pendant l\'événement, alertes activées : une alerte à ouvrir', () => {
  const p = plan({ logs: [log('ui', 2), log('task', 3)] });
  assert.equal(p.open.length, 1);
  assert.equal(p.open[0].eventId, 'ev-1');
  assert.equal(p.open[0].machineId, 'M1');
  assert.equal(p.open[0].machineName, 'Booth 1');
  assert.deepEqual(p.resolve, []);
});

test('type désactivé : aucune alerte', () => {
  assert.deepEqual(plan({ cfg: {}, logs: [log('ui', 2)] }), { open: [], resolve: [] });
  assert.deepEqual(plan({ cfg: { kiosk_errors: { enabled: false } }, logs: [log('ui', 2)] }).open, []);
});

test('hors événement : aucune alerte', () => {
  // Événement d'hier (fini avant 6 h ce matin) : rien.
  const past = { ...EVENT, start_date: '2026-06-05T12:00:00Z', end_date: '2026-06-05T12:00:00Z' };
  assert.deepEqual(plan({ events: [past], logs: [log('ui', 2)] }).open, []);
  // Journal sans event_id, borne sans événement en cours : rien.
  assert.deepEqual(plan({ events: [past], logs: [log('ui', 2, { event_id: null })] }).open, []);
  // Événement inconnu (non chargé) : rien.
  assert.deepEqual(plan({ events: [], logs: [log('ui', 2)] }).open, []);
});

test('journal sans event_id : rattaché à l\'événement en cours assigné à la borne', () => {
  const p = plan({ logs: [log('ui', 2, { event_id: null })] });
  assert.equal(p.open.length, 1);
  assert.equal(p.open[0].eventId, 'ev-1');
});

test('événement d\'un autre compte non assigné à la borne : refusé', () => {
  const other = { ...EVENT, id: 'ev-x', org_id: 'org-2', photobooth_id: 'lic-other' };
  assert.deepEqual(plan({ events: [other], logs: [log('ui', 2, { event_id: 'ev-x' })] }).open, []);
  // Assigné à la borne (LAB-242) : accepté, même d'un autre compte.
  const lent = { ...other, photobooth_id: 'lic-1' };
  assert.equal(plan({ events: [lent], logs: [log('ui', 2, { event_id: 'ev-x' })] }).open.length, 1);
});

test('borne inconnue du compte : ignorée', () => {
  assert.deepEqual(plan({ logs: [log('ui', 2, { machine_id: 'M9' })] }).open, []);
});

test('pas de doublon : alerte déjà ouverte pour (événement, borne)', () => {
  const p = plan({ logs: [log('ui', 2)], openAlerts: [{ id: 'a1', event_id: 'ev-1', machine_id: 'M1' }] });
  assert.deepEqual(p, { open: [], resolve: [] });
});

test('une alerte par borne : deux bornes en erreur sur le même événement → deux alertes', () => {
  const lic2 = { id: 'lic-2', machine_id: 'M2', label: 'Booth 2', last_seen_at: minsAgo(1) };
  const p = plan({ licenses: [LIC, lic2], logs: [log('ui', 2), log('ui', 3, { machine_id: 'M2' })] });
  assert.deepEqual(p.open.map((o) => o.machineId).sort(), ['M1', 'M2']);
});

test('erreurs ordinaires (warning, impression) : ni ouverture ni maintien', () => {
  const logs = [log('print', 1), log('ui', 1, { level: 'warning' })];
  assert.deepEqual(plan({ logs }).open, []);
  const p = plan({ logs, openAlerts: [{ id: 'a1', event_id: 'ev-1', machine_id: 'M1' }] });
  assert.deepEqual(p.resolve.map((r) => r.alertId), ['a1']);
});

test('résolution après 30 minutes sans nouvelle erreur', () => {
  const open = [{ id: 'a1', event_id: 'ev-1', machine_id: 'M1' }];
  assert.deepEqual(plan({ logs: [log('camera', 29)], openAlerts: open }).resolve, []);
  const p = plan({ logs: [], openAlerts: open });
  assert.deepEqual(p.resolve, [{ alertId: 'a1', eventId: 'ev-1', eventName: 'Mariage', machineId: 'M1', machineName: 'Booth 1' }]);
});

test('hystérésis : 1 erreur photo récente garde l\'alerte ouverte sans en rouvrir', () => {
  const open = [{ id: 'a1', event_id: 'ev-1', machine_id: 'M1' }];
  assert.deepEqual(plan({ logs: [log('camera', 1)], openAlerts: open }), { open: [], resolve: [] });
});

test('borne silencieuse pendant l\'événement : alerte gardée (son silence ne dit pas qu\'elle va bien)', () => {
  const open = [{ id: 'a1', event_id: 'ev-1', machine_id: 'M1' }];
  const silent = { ...LIC, last_seen_at: minsAgo(20) };
  assert.deepEqual(plan({ licenses: [silent], openAlerts: open }).resolve, []);
  // Événement fini : résolue même si la borne est éteinte.
  const later = Date.parse('2026-06-09T10:00:00Z');
  assert.equal(plan({ licenses: [silent], openAlerts: open, now: later }).resolve.length, 1);
});

test('alerte ouverte d\'un événement supprimé (event_id null) : résolue', () => {
  const p = plan({ openAlerts: [{ id: 'a1', event_id: null, machine_id: 'M1' }] });
  assert.equal(p.resolve.length, 1);
  assert.equal(p.resolve[0].eventName, '—');
});

test('alerte ouverte même si le type a été désactivé depuis : résolue au retour au calme', () => {
  const p = plan({ cfg: {}, openAlerts: [{ id: 'a1', event_id: 'ev-1', machine_id: 'M1' }] });
  assert.equal(p.resolve.length, 1);
});

test('RESOLVE couvre kiosk_errors', () => {
  const r = RESOLVE.kiosk_errors;
  assert.ok(r.subject && r.heading);
  assert.match(r.detail('Booth 1'), /Booth 1/);
  assert.match(r.detail('Booth 1'), /30 minutes/);
});

// ── Garde-fou sur index.ts ───────────────────────────────────────────────────

test('index.ts : la boucle par événement ne résout pas les alertes kiosk_errors', () => {
  const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  assert.match(src, /\.neq\('alert_type', 'kiosk_errors'\)/);
  assert.match(src, /reconcileKioskErrors\(/);
});

test('kioskLogsUrl : page Bornes filtrée sur l’événement, sinon page Bornes seule', () => {
  assert.equal(kioskLogsUrl('https://app.test', 'ev 1'), 'https://app.test/admin/bornes?event=ev%201');
  assert.equal(kioskLogsUrl('https://app.test', null), 'https://app.test/admin/bornes');
  const src = readFileSync(new URL('./reconcile-errors.ts', import.meta.url), 'utf8');
  assert.equal(src.match(/adminUrl: kioskLogsUrl\(p\.appUrl, [oa]\.eventId\)/g)?.length, 2);
});
