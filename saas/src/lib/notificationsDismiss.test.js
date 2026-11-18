// Croix de la cloche : masquer (dismissed_at), jamais supprimer, et ne cacher les alertes qu'à la cloche.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const notifications = readFileSync(new URL('./api/notifications.js', import.meta.url), 'utf8');
const kiosks = readFileSync(new URL('./api/kiosks.js', import.meta.url), 'utf8');
const apiDir = new URL('./api/', import.meta.url);
const allApi = readdirSync(apiDir).map((f) => readFileSync(new URL(f, apiDir), 'utf8')).join('\n');
const bell = readFileSync(new URL('../components/NotificationsBell.jsx', import.meta.url), 'utf8');
const fnBody = (name, src = notifications) => {
  const start = src.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, `${name} absente`);
  const next = src.indexOf('\nexport ', start + 1);
  return src.slice(start, next < 0 ? undefined : next);
};

test('notifications : masquées par dismissed_at, jamais supprimées', () => {
  assert.match(fnBody('fetchNotifications'), /\.is\('dismissed_at', null\)/);
  const dismiss = fnBody('dismissNotification');
  assert.match(dismiss, /dismissed_at: now/);
  assert.doesNotMatch(dismiss, /\.delete\(/);
  assert.doesNotMatch(allApi, /from\('notifications'\)\s*\.delete\(/);
});

test('alertes : RPC dismiss_kiosk_alert, masquées seulement dans la cloche', () => {
  assert.match(fnBody('dismissKioskAlert', kiosks), /rpc\('dismiss_kiosk_alert', \{ p_alert_id: alertId \}\)/);
  assert.match(fnBody('fetchKioskAlerts', kiosks), /if \(hideDismissed\) query = query\.is\('dismissed_at', null\)/);
  assert.match(bell, /fetchKioskAlerts\(20, \{ hideDismissed: true \}\)/);
  const tab = readFileSync(new URL('../pages/admin/bornes/AlertsTab.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(tab, /hideDismissed/, "l'onglet Alertes garde les alertes retirées de la cloche");
});

test('cloche : une croix par ligne, hors du bouton de la ligne', () => {
  assert.match(bell, /onClick=\{\(\) => handleDismiss\(item\)\}/);
  assert.match(bell, /aria-label=\{`Supprimer la notification/);
  assert.match(bell, /size="icon-sm"/);
});
