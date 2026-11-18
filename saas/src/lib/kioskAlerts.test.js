import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALERT_DEFAULT, ALERT_TYPES, alertConfigForm, alertDetailText, alertLabel, alertLinks, alertMachineName,
  alertsTabHref, parseAlertParam, splitAlerts,
} from './kioskAlerts.js';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const EVENT = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

test('alertConfigForm : valeurs par défaut sans réglage', () => {
  assert.deepEqual(alertConfigForm(null), ALERT_DEFAULT);
  assert.deepEqual(alertConfigForm(undefined), ALERT_DEFAULT);
});

test('alertConfigForm : fusion type par type, clés inconnues gardées', () => {
  const form = alertConfigForm({
    enabled: true,
    recipient_email: 'a@b.fr',
    machine_offline: { enabled: true },
    kiosk_errors: { camera_errors: 8 },
    extra: 1,
  });
  assert.equal(form.enabled, true);
  assert.equal(form.recipient_email, 'a@b.fr');
  assert.deepEqual(form.machine_offline, { enabled: true, after_minutes: 10 });
  assert.deepEqual(form.kiosk_errors, { enabled: false, camera_errors: 8 });
  assert.deepEqual(form.paper_low, ALERT_DEFAULT.paper_low);
  assert.equal(form.extra, 1);
  // Les valeurs par défaut ne sont pas modifiées.
  assert.equal(ALERT_DEFAULT.machine_offline.enabled, false);
});

test('ALERT_TYPES : un libellé par type', () => {
  for (const type of ALERT_TYPES) assert.notEqual(alertLabel(type), type);
  assert.equal(alertLabel('autre'), 'autre');
  assert.equal(alertLabel(null), 'Alerte');
});

test('parseAlertParam et alertsTabHref', () => {
  assert.equal(parseAlertParam(ID.toUpperCase()), ID);
  assert.equal(parseAlertParam(' ' + ID + ' '), ID);
  assert.equal(parseAlertParam('pas-un-id'), null);
  assert.equal(parseAlertParam(null), null);
  assert.equal(alertsTabHref(ID), `/admin/bornes?tab=alertes&alerte=${ID}`);
  assert.equal(alertsTabHref('x'), '/admin/bornes?tab=alertes');
  assert.equal(alertsTabHref(), '/admin/bornes?tab=alertes');
});

test('splitAlerts : ouvertes, puis résolues récentes, les plus récentes d\'abord', () => {
  const now = new Date('2026-11-16T12:00:00Z');
  const alerts = [
    { id: 'a', sent_at: '2026-11-10T10:00:00Z', resolved_at: null },
    { id: 'b', sent_at: '2026-11-15T10:00:00Z', resolved_at: null },
    { id: 'c', sent_at: '2026-11-14T10:00:00Z', resolved_at: '2026-11-14T11:00:00Z' },
    { id: 'd', sent_at: '2026-10-01T10:00:00Z', resolved_at: '2026-10-01T11:00:00Z' },
  ];
  const { open, resolved } = splitAlerts(alerts, { now });
  assert.deepEqual(open.map((a) => a.id), ['b', 'a']);
  assert.deepEqual(resolved.map((a) => a.id), ['c']);
  assert.deepEqual(splitAlerts(alerts, { now, keepId: 'd' }).resolved.map((a) => a.id), ['c', 'd']);
  assert.deepEqual(splitAlerts(null), { open: [], resolved: [] });
});

test('alertLinks : événement, et journaux pour les erreurs', () => {
  assert.deepEqual(alertLinks({ alert_type: 'paper_low', event_id: null }), []);
  assert.deepEqual(alertLinks({ alert_type: 'paper_low', event_id: EVENT }).map((l) => l.to),
    [`/admin/events/${EVENT}?tab=jour-j`]);
  assert.deepEqual(alertLinks({ alert_type: 'kiosk_errors', event_id: EVENT }).map((l) => l.to),
    [`/admin/events/${EVENT}?tab=jour-j`, `/admin/bornes?tab=etat&event=${EVENT}`]);
});

test('alertDetailText : HTML du serveur en texte brut', () => {
  assert.equal(alertDetailText('La machine <strong>Booth &amp; co</strong> est &lt;hors&gt; &quot;ligne&quot; l&#39;a'),
    'La machine Booth & co est <hors> "ligne" l\'a');
  assert.equal(alertDetailText(null), '');
});

test('alertMachineName : nom de la borne connue', () => {
  const licenses = [{ machine_id: 'm1', label: 'Borne noyer' }, { machine_id: 'm2', machine_name: 'PC-2' }];
  assert.equal(alertMachineName({ machine_id: 'm1' }, licenses), 'Borne noyer');
  assert.equal(alertMachineName({ machine_id: 'm2' }, licenses), 'PC-2');
  assert.equal(alertMachineName({ machine_id: 'm3' }, licenses), 'Borne inconnue');
  assert.equal(alertMachineName({}, null), 'Borne');
});

test('alertes et écran du code : dans Bornes, plus dans Réglages (LAB-338)', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
  const alerts = read('../pages/admin/bornes/AlertsTab.jsx');
  assert.match(alerts, /update\(\{ alert_config: cfg \}\)\.eq\('id', org\.id\)/);
  assert.match(read('../pages/admin/bornes/CodeScreenTab.jsx'), /saveKioskSetupConfig\(setupConfigToSave\(cfg\)\)/);
  const settings = ['../pages/admin/AdminReglages.jsx',
    ...readdirSync(new URL('../pages/admin/reglages/', import.meta.url)).map((f) => `../pages/admin/reglages/${f}`)];
  for (const file of settings) {
    const src = read(file);
    assert.doesNotMatch(src, /alert_config|saveKioskSetupConfig|SetupScreenSection/, file);
  }
});
