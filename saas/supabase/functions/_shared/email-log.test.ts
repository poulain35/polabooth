// Tests de la journalisation des emails clients (LAB-123).
// Exécution : `npm test` (runner natif Node, strip-types — aucune dépendance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emailLogRow, recordEmailLog } from './email-log.ts';

test('emailLogRow : lead, message-id, type et objet tracés, statut sent', () => {
  assert.deepEqual(emailLogRow({
    scope: { leadId: 'lead-1' }, recipient: 'c@x.fr', type: 'booking_recap_link',
    subject: 'Votre réservation', messageId: '<1@relay>',
  }), {
    lead_id: 'lead-1', event_id: null, prospect_id: null, recipient: 'c@x.fr', type: 'booking_recap_link',
    subject: 'Votre réservation', provider_message_id: '<1@relay>', status: 'sent', error_reason: null,
  });
});

test('emailLogRow : rattachement événement, exclusif du lead (email_logs_scope_chk)', () => {
  const row = emailLogRow({ scope: { eventId: 'ev-1' }, recipient: 'c@x.fr', type: 'access_code', subject: null, messageId: null });
  assert.equal(row.event_id, 'ev-1');
  assert.equal(row.lead_id, null);
  assert.equal(row.prospect_id, null);
});

test('emailLogRow : rattachement prospect du salon, ni lead ni événement', () => {
  const row = emailLogRow({ scope: { prospectId: 'pr-1' }, recipient: 'c@x.fr', type: 'prospect_follow_up', subject: 's', messageId: '<2@relay>' });
  assert.equal(row.prospect_id, 'pr-1');
  assert.equal(row.lead_id, null);
  assert.equal(row.event_id, null);
});

test('emailLogRow : refus Brevo → statut error avec motif, objet tronqué à 500 caractères', () => {
  const row = emailLogRow({
    scope: { eventId: 'ev-1' }, recipient: 'c@x.fr', type: 'delivery',
    subject: 'x'.repeat(600), messageId: null, error: 'Brevo 400 : invalid email',
  });
  assert.equal(row.status, 'error');
  assert.equal(row.error_reason, 'Brevo 400 : invalid email');
  assert.equal(row.subject?.length, 500);
});

test('recordEmailLog : insère dans email_logs, une erreur d\'écriture ne lève pas', async () => {
  const inserted: unknown[] = [];
  const ok = { from: (t: string) => ({ insert: (r: unknown) => { inserted.push([t, r]); return Promise.resolve({ error: null }); } }) };
  await recordEmailLog(ok, { scope: { leadId: 'l' }, recipient: 'c@x.fr', type: 't', subject: 's', messageId: 'm' });
  assert.equal(inserted.length, 1);
  assert.equal((inserted[0] as [string])[0], 'email_logs');

  const ko = { from: () => ({ insert: () => Promise.resolve({ error: { message: 'boom' } }) }) };
  const orig = console.error;
  console.error = () => {};
  try {
    await recordEmailLog(ko, { scope: { leadId: 'l' }, recipient: 'c@x.fr', type: 't', subject: 's', messageId: 'm' });
  } finally {
    console.error = orig;
  }
});
