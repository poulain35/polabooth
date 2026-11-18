import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import {
  BUSINESS_PROFILE_DEFAULT, CLIENT_EMAIL_KEYS, IDENTITY_KEYS, businessProfileForm, businessProfilePatch, mergeBusinessProfile, profilePatch,
} from './businessProfile.js';

const STORED = {
  company_name: 'Studio Exemple',
  google_review_url: 'https://g.page/r/abc/review',
  access_email_auto: { enabled: true, days_before: 21, note: 'clé manuelle' },
  delivery_auto: { enabled: false, days_after: 3 },
  gallery_booking_banner: true,
  balance_window_days: 10,
  custom_flag: { a: 1 },
};

const save = (stored, edit) => mergeBusinessProfile(stored, businessProfilePatch(edit(businessProfileForm(stored))));

test('clé hors formulaire (balance_window_days et autres) conservée', () => {
  const out = save(STORED, (cfg) => ({ ...cfg, gallery_booking_banner: false }));
  assert.equal(out.balance_window_days, 10);
  assert.deepEqual(out.custom_flag, { a: 1 });
  assert.equal(out.access_email_auto.note, 'clé manuelle', 'sous-clé hors formulaire conservée aussi');
});

test('clé du formulaire mise à jour', () => {
  const out = save(STORED, (cfg) => ({
    ...cfg, company_name: '  Pola Events ',
    access_email_auto: { ...cfg.access_email_auto, days_before: '14' },
    delivery_auto: { enabled: true, days_after: 5 },
  }));
  assert.equal(out.company_name, 'Pola Events');
  assert.deepEqual(out.access_email_auto, { enabled: true, days_before: 14, note: 'clé manuelle' });
  assert.deepEqual(out.delivery_auto, { enabled: true, days_after: 5 });
  assert.equal(out.google_review_url, STORED.google_review_url);
});

test('clé vidée dans le formulaire : vidée, l\'ancienne valeur ne revient pas', () => {
  const out = save(STORED, (cfg) => ({ ...cfg, company_name: '', google_review_url: '   ' }));
  assert.equal(out.company_name, '');
  assert.equal(out.google_review_url, '');
  // Patch ancien formulaire (valeur en base modifiée entre-temps) : le formulaire l'emporte sur ses clés.
  const raced = mergeBusinessProfile({ ...STORED, company_name: 'Autre onglet' }, businessProfilePatch({ ...businessProfileForm(STORED), company_name: '' }));
  assert.equal(raced.company_name, '');
});

test('gallery_booking_banner reste un vrai booléen', () => {
  for (const [value, expected] of [[false, false], [true, true], [undefined, true], [null, true], ['false', true], [0, true]]) {
    const out = save({ ...STORED, gallery_booking_banner: value }, (cfg) => cfg);
    assert.equal(out.gallery_booking_banner, expected, JSON.stringify(value));
    assert.equal(typeof out.gallery_booking_banner, 'boolean');
  }
  assert.equal(save(STORED, (cfg) => ({ ...cfg, gallery_booking_banner: false })).gallery_booking_banner, false);
});

test('base vide ou invalide : défauts du formulaire, rien d\'autre', () => {
  for (const stored of [null, undefined, {}, 'x', [1, 2]]) {
    const out = save(stored, (cfg) => cfg);
    assert.deepEqual(out, BUSINESS_PROFILE_DEFAULT, JSON.stringify(stored));
  }
  const broken = mergeBusinessProfile({ access_email_auto: 'oups', balance_window_days: 5 }, businessProfilePatch(businessProfileForm(null)));
  assert.deepEqual(broken.access_email_auto, BUSINESS_PROFILE_DEFAULT.access_email_auto);
  assert.equal(broken.balance_window_days, 5);
});

test('fusion pure : n\'altère ni la valeur en base ni le patch', () => {
  const stored = structuredClone(STORED);
  const patch = businessProfilePatch(businessProfileForm(stored));
  const snapshot = structuredClone(patch);
  mergeBusinessProfile(stored, patch);
  assert.deepEqual(stored, STORED);
  assert.deepEqual(patch, snapshot);
});

test('enregistrement : relit la valeur en base puis écrit la fusion, plus aucun remplacement direct', () => {
  const lib = readFileSync(new URL('./api/settings.js', import.meta.url), 'utf8');
  const apiDir = new URL('./api/', import.meta.url);
  const allApi = readdirSync(apiDir).map((f) => readFileSync(new URL(f, apiDir), 'utf8')).join('\n');
  const start = lib.indexOf('export async function saveBusinessProfile(');
  const body = lib.slice(start, lib.indexOf('\n}\n', start));
  assert.ok(start > 0);
  assert.ok(body.indexOf('getBusinessProfile(orgId)') < body.indexOf('mergeBusinessProfile(stored, patch)'));
  assert.ok(body.indexOf('mergeBusinessProfile(stored, patch)') < body.indexOf('.update({ business_profile: businessProfile, ...columns })'));
  assert.doesNotMatch(allApi, /updateBusinessProfile/);
  assert.equal(allApi.match(/update\(\{ business_profile/g).length, 1, 'un seul endroit écrit business_profile');
});

test('bilan client (LAB-238) : default_for enregistré, défaut professionnel, sous-clés gardées', () => {
  assert.deepEqual(businessProfileForm(null).event_report, { default_for: 'professionnel' });
  assert.equal(businessProfileForm({ event_report: { default_for: 'tous' } }).event_report.default_for, 'tous');
  assert.equal(businessProfileForm({ event_report: { default_for: 'n/a' } }).event_report.default_for, 'professionnel');
  const out = save({ ...STORED, event_report: { default_for: 'tous', note: 'à la main' } },
    (cfg) => ({ ...cfg, event_report: { ...cfg.event_report, default_for: 'aucun' } }));
  assert.deepEqual(out.event_report, { default_for: 'aucun', note: 'à la main' });
  assert.equal(save(STORED, (cfg) => ({ ...cfg, event_report: { default_for: 'faux' } })).event_report.default_for, 'professionnel');
});

test('carte du profil (LAB-262) : n\'écrit plus les réglages d\'emails au client', () => {
  const patch = profilePatch({ ...businessProfileForm(STORED), access_email_auto: { enabled: false, days_before: 1 } });
  for (const k of CLIENT_EMAIL_KEYS) assert.equal(k in patch, false, k);
  const out = mergeBusinessProfile(STORED, patch);
  assert.deepEqual(out.access_email_auto, STORED.access_email_auto);
  assert.deepEqual(out.delivery_auto, STORED.delivery_auto);
  assert.equal(out.company_name, STORED.company_name);
});

test('carte du profil (open core L5) : n\'écrit plus la signature ni le lien d\'avis (carte Entreprise)', () => {
  const patch = profilePatch({ ...businessProfileForm(STORED), company_name: '', google_review_url: '' });
  for (const k of IDENTITY_KEYS) assert.equal(k in patch, false, k);
  const out = mergeBusinessProfile(STORED, patch);
  assert.equal(out.company_name, STORED.company_name);
  assert.equal(out.google_review_url, STORED.google_review_url);
});
