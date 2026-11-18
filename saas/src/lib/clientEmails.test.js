import { test } from 'node:test';
import assert from 'node:assert/strict';
import { businessProfileForm, mergeBusinessProfile } from './businessProfile.js';
import {
  brevoTemplateId, cleanMilestones, clientEmailsSave, clientEmailsSummary, designRemindersForm, designRemindersPatch,
} from './clientEmails.js';

const STORED_PROFILE = {
  company_name: 'Studio Exemple',
  access_email_auto: { enabled: false, days_before: 30, note: 'à la main' },
  delivery_auto: { enabled: true, days_after: 2 },
  balance_window_days: 10,
};

test('numéro de modèle Brevo : entier positif, sinon null', () => {
  for (const [raw, expected] of [['17', 17], [17, 17], [' 20 ', 20], ['', null], [null, null], [undefined, null], ['0', null], ['-3', null], ['1.5', null], ['abc', null]]) {
    assert.equal(brevoTemplateId(raw), expected, JSON.stringify(raw));
  }
});

test('jalons : entiers > 0, sans doublon, du plus lointain au plus proche, défaut si vide', () => {
  assert.deepEqual(cleanMilestones(['10', 20, 10, '5.4', 0, -2, 'x']), [20, 10, 5]);
  assert.deepEqual(cleanMilestones([]), [20, 10]);
  assert.deepEqual(cleanMilestones(null), [20, 10]);
});

test('relances : formulaire puis valeur écrite, sous-clé inconnue gardée', () => {
  const form = designRemindersForm({ enabled: true, milestones: [10, 20], brevo_template_id: 20, extra: 1 });
  assert.equal(form.brevo_template_id, 20);
  assert.deepEqual(designRemindersPatch(form), { extra: 1, enabled: true, milestones: [20, 10], brevo_template_id: 20 });
  const empty = designRemindersForm(null);
  assert.deepEqual(designRemindersPatch(empty), { enabled: false, milestones: [20, 10], brevo_template_id: null });
});

test('enregistrement de la carte : seulement ses clés de business_profile + ses colonnes', () => {
  const profile = { ...businessProfileForm(STORED_PROFILE), access_email_auto: { enabled: true, days_before: '21' }, company_name: 'ne doit pas partir' };
  const { businessPatch, columns } = clientEmailsSave({
    profile, accessTemplateId: '17', reminders: designRemindersForm({ enabled: true, milestones: [20, 10], brevo_template_id: 20 }),
  });
  assert.deepEqual(Object.keys(businessPatch).sort(), ['access_email_auto', 'delivery_auto']);
  assert.deepEqual(columns, {
    brevo_access_template_id: 17,
    design_reminders: { enabled: true, milestones: [20, 10], brevo_template_id: 20 },
  });
  const out = mergeBusinessProfile(STORED_PROFILE, businessPatch);
  assert.deepEqual(out.access_email_auto, { enabled: true, days_before: 21, note: 'à la main' });
  assert.equal(out.company_name, 'Studio Exemple');
  assert.equal(out.balance_window_days, 10);
});

test('résumé : ce qui part et quand, dans l\'ordre du parcours', () => {
  const profile = { ...businessProfileForm(STORED_PROFILE), access_email_auto: { enabled: true, days_before: 30 } };
  assert.deepEqual(clientEmailsSummary({ profile, reminders: { enabled: true, milestones: [10, 20] } }), [
    'J-30 : lien de l\'éditeur', 'J-20, J-10 : relances si le cadre photo n\'est pas soumis', 'J+2 : lien des photos',
  ]);
  assert.deepEqual(clientEmailsSummary({ profile: businessProfileForm(null), reminders: { enabled: true, milestones: [7] } }), [
    'J-7 : relance si le cadre photo n\'est pas soumis',
  ]);
  assert.deepEqual(clientEmailsSummary({ profile: businessProfileForm(null), reminders: designRemindersForm(null) }), []);
});
