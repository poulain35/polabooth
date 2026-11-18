// LAB-312 : la relance d'avant part si aucun cadre du modèle photo n'est envoyé ou validé.
// LAB-322 : elle part aussi tant qu'un cadre créé reste à envoyer (même rythme, mêmes jalons).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

test('send-design-reminders : tous les cadres print sont lus, reminderFramesLeft décide', () => {
  assert.match(src, /\.select\('id, slot, status'\)\s+\.eq\('event_id', ev\.id\)\s+\.eq\('kind', 'print'\);/);
  assert.match(src, /if \(framesErr\) \{ console\.error\('Lecture des cadres', ev\.id, framesErr\.message\); continue; \}/);
  assert.match(src, /const framesLeft = reminderFramesLeft\(frames, ev\.form_config\);\s+if \(framesLeft === null\) continue;/);
  assert.match(src, /\.select\('id, name, status, end_date, client_name, client_email, access_code, form_config'\)/);
  assert.doesNotMatch(src, /\.maybeSingle\(\)/, 'plus de lecture à une ligne du modèle photo');
});

test('send-design-reminders : relance partielle avec le nombre de cadres, jalons et journal inchangés', () => {
  assert.match(src, /framesLeft: framesLeft \|\| undefined,/);
  assert.match(src, /type: `design_reminder_j\$\{toSend\}`/);
  assert.match(src, /\.like\('type', 'design_reminder_j%'\)/);
  // end_date est un timestamptz : jours restants calculés par reminderDaysLeft (LAB-322).
  assert.match(src, /const daysLeft = reminderDaysLeft\(ev\.end_date, now\);/);
  assert.match(src, /if \(!Number\.isFinite\(daysLeft\) \|\| daysLeft < 0\) continue;/);
  assert.doesNotMatch(src, /T00:00:00Z`\)/, 'plus de date construite à la main');
});

test('sendDesignReminderEmail : la relance partielle prend toujours le HTML de l\'app (pas le modèle Brevo)', () => {
  const email = readFileSync(new URL('../_shared/email.ts', import.meta.url), 'utf8');
  assert.match(email, /const templateId = framesLeft \? undefined : params\.templateId;/);
  assert.match(email, /renderDesignReminderEmail\(\{ clientName, eventName, accessCode, editorUrl, daysLeft, framesLeft, trackingUrl \}\)/);
});
