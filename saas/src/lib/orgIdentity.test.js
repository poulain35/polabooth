import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IDENTITY_COLUMNS, IDENTITY_PROFILE_KEYS, identityErrors, identityForm, identitySave } from './orgIdentity.js';
import { businessProfileForm, mergeBusinessProfile, profilePatch } from './businessProfile.js';

const ORG = {
  id: 'org-1',
  name: 'Org',
  contact_company: 'Photobooth Martin',
  contact_phone: '06 12 34 56 78',
  contact_email: 'contact@martin.test',
  contact_address: null,
  logo_url: 'https://cdn.test/logo.png',
  business_profile: { company_name: 'Martin Events', google_review_url: 'https://g.page/r/m/review', balance_window_days: 10 },
};

test('formulaire : colonnes et clés du profil, absentes ou NULL → chaîne vide', () => {
  assert.deepEqual(identityForm(ORG), {
    contact_company: 'Photobooth Martin', contact_phone: '06 12 34 56 78', contact_email: 'contact@martin.test',
    contact_address: '', email_sender_name: '', email_sender_email: '',
    company_name: 'Martin Events', google_review_url: 'https://g.page/r/m/review',
    email_logo_url: '', website_url: '', email_reviews_text: '',
    social_facebook_url: '', social_instagram_url: '', social_linkedin_url: '', email_legal_footer: '',
  });
  for (const org of [null, undefined, {}, { business_profile: 'x' }]) {
    const form = identityForm(org);
    assert.equal(Object.values(form).every((v) => v === ''), true, JSON.stringify(org));
  }
});

test('enregistrement : espaces retirés, colonne vide → NULL, clé du profil vide → \'\'', () => {
  const form = {
    ...identityForm(ORG), contact_company: '  Martin  ', contact_phone: '   ', contact_address: ' 1 rue des Lilas\n35000 Rennes ',
    email_sender_name: ' Martin ', email_sender_email: 'bonjour@martin.test', google_review_url: ' ',
  };
  const { columns, businessPatch } = identitySave(form);
  assert.deepEqual(columns, {
    contact_company: 'Martin', contact_phone: null, contact_email: 'contact@martin.test',
    contact_address: '1 rue des Lilas\n35000 Rennes', email_sender_name: 'Martin', email_sender_email: 'bonjour@martin.test',
  });
  assert.deepEqual(businessPatch, {
    company_name: 'Martin Events', google_review_url: '',
    email_logo_url: '', website_url: '', email_reviews_text: '',
    social_facebook_url: '', social_instagram_url: '', social_linkedin_url: '', email_legal_footer: '',
  });
  assert.deepEqual(Object.keys(columns), IDENTITY_COLUMNS);
  assert.deepEqual(Object.keys(businessPatch), IDENTITY_PROFILE_KEYS);
});

test('rien de saisi : expéditeur NULL (les emails gardent FROM_NAME / FROM_EMAIL)', () => {
  const { columns } = identitySave(identityForm({}));
  assert.equal(columns.email_sender_name, null);
  assert.equal(columns.email_sender_email, null);
});

test('validation : adresse de l\'expéditeur et email de contact', () => {
  assert.deepEqual(identityErrors(identityForm(ORG)), {});
  assert.deepEqual(identityErrors({ email_sender_email: '' }), {});
  assert.ok(identityErrors({ email_sender_email: 'pas une adresse' }).email_sender_email);
  assert.ok(identityErrors({ contact_email: 'contact@' }).contact_email);
  assert.ok(identityErrors({ website_url: 'www.exemple.fr' }).website_url);
  assert.ok(identityErrors({ social_instagram_url: 'javascript:alert(1)' }).social_instagram_url);
  assert.deepEqual(identityErrors({ email_logo_url: 'https://cdn.test/l.png', website_url: '' }), {});
});

test('marque des emails : clés lues par _shared/email-brand.ts (mêmes noms des deux côtés)', () => {
  const src = readFileSync(new URL('../../supabase/functions/_shared/email-brand.ts', import.meta.url), 'utf8');
  for (const k of ['email_logo_url', 'website_url', 'email_reviews_text', 'email_legal_footer', 'social_facebook_url', 'social_instagram_url', 'social_linkedin_url']) {
    assert.ok(IDENTITY_PROFILE_KEYS.includes(k), k);
    assert.ok(src.includes(k), k);
  }
});

test('les deux cartes se partagent business_profile sans s\'écraser', () => {
  // La carte Entreprise écrit la signature et le lien d'avis ; « Profil » (formulaire ouvert avant) n'y touche plus.
  const afterIdentity = mergeBusinessProfile(ORG.business_profile, identitySave({ ...identityForm(ORG), company_name: 'Nouveau' }).businessPatch);
  assert.equal(afterIdentity.company_name, 'Nouveau');
  assert.equal(afterIdentity.balance_window_days, 10);
  const stalePatch = profilePatch(businessProfileForm(ORG.business_profile));
  for (const k of IDENTITY_PROFILE_KEYS) assert.equal(k in stalePatch, false, k);
  const out = mergeBusinessProfile(afterIdentity, stalePatch);
  assert.equal(out.company_name, 'Nouveau');
  assert.equal(out.google_review_url, ORG.business_profile.google_review_url);
});

test('AdminSettings : carte Entreprise enregistrée par saveBusinessProfile (fusion), aide Brevo sous l\'expéditeur', () => {
  const src = readFileSync(new URL('../pages/admin/AdminSettings.jsx', import.meta.url), 'utf8');
  assert.match(src, /saveBusinessProfile\(org\.id, businessPatch, columns\)/);
  assert.match(src, /expéditeur validé dans Brevo/);
  assert.doesNotMatch(src, /function ContactSection/);
  // Une seule saisie de la signature et du lien d'avis.
  assert.equal(src.match(/google_review_url/g).length, 1);
});
