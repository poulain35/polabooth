import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BRAND_MARKS, layout } from './email-layout.ts';
import { applyEmailBrand, emailBrandFromOrg, instanceBrandLoader } from './email-brand.ts';

const FULL_ROW = {
  name: 'org',
  contact_company: 'Studio Exemple',
  logo_url: 'https://cdn.test/logo-org.png',
  contact_address: '1 rue de la Paix\n\n75000 Paris ',
  business_profile: {
    company_name: '',
    email_logo_url: 'https://cdn.test/logo-mail.png',
    website_url: 'https://studio.test/',
    email_legal_footer: 'Studio Exemple SAS – SIREN 000 000 000',
    email_reviews_text: '**120 avis** · note 4,9/5',
    social_facebook_url: 'https://facebook.com/studio',
    social_instagram_url: 'javascript:alert(1)',
    social_linkedin_url: '',
  },
};

test('emailBrandFromOrg : nom, logo, adresse, réseaux (http(s) seulement)', () => {
  const b = emailBrandFromOrg(FULL_ROW);
  assert.equal(b.name, 'Studio Exemple');
  assert.equal(b.logoUrl, 'https://cdn.test/logo-mail.png');
  assert.equal(b.siteUrl, 'https://studio.test/');
  assert.equal(b.address, '1 rue de la Paix, 75000 Paris');
  assert.deepEqual(b.socials.map((s) => s.name), ['Facebook']);
});

test('emailBrandFromOrg : ordre des noms et repli', () => {
  assert.equal(emailBrandFromOrg({ name: 'org', business_profile: { company_name: 'Profil' }, contact_company: 'Contact' }).name, 'Profil');
  assert.equal(emailBrandFromOrg({ name: 'org' }).name, 'org');
  assert.equal(emailBrandFromOrg(null, 'Expéditeur').name, 'Expéditeur');
  assert.equal(emailBrandFromOrg({ logo_url: 'https://cdn.test/l.png' }).logoUrl, 'https://cdn.test/l.png');
});

test('applyEmailBrand : marque complète (email client)', () => {
  const html = applyEmailBrand(layout('Titre', '<p>Corps</p>'), emailBrandFromOrg(FULL_ROW));
  assert.doesNotMatch(html, /<!--brand:|%%BRAND_/);
  assert.match(html, /<a href="https:\/\/studio\.test\/" target="_blank"><img src="https:\/\/cdn\.test\/logo-mail\.png" width="300"/);
  assert.match(html, /<strong>120 avis<\/strong> · note 4,9\/5/);
  assert.match(html, /facebook\.com\/studio/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, /<strong>Studio Exemple<\/strong><br>1 rue de la Paix, 75000 Paris/);
  assert.match(html, /Studio Exemple SAS – SIREN 000 000 000/);
});

test('applyEmailBrand : email admin sans pied de page marketing', () => {
  const html = applyEmailBrand(layout('Titre', '<p>Corps</p>', { audience: 'admin' }), emailBrandFromOrg(FULL_ROW));
  assert.doesNotMatch(html, /120 avis|facebook|75000 Paris/);
  assert.match(html, /Studio Exemple SAS/);
});

test('applyEmailBrand : marque minimale (nom seul) — nom en texte, pas de pied vide', () => {
  const html = applyEmailBrand(layout('Titre', '<p>Corps</p>'), emailBrandFromOrg({ contact_company: 'A & B' }));
  assert.doesNotMatch(html, /<img[^>]+width="300"/);
  assert.match(html, /<span style="font-family:[^"]*">A &amp; B<\/span>/);
  assert.doesNotMatch(html, /★/);
  assert.ok(!html.includes('A & B'));
});

test('applyEmailBrand : marque vide — aucun marqueur restant', () => {
  const html = applyEmailBrand(layout('Titre', '<p>Corps</p>'), emailBrandFromOrg(null));
  assert.doesNotMatch(html, /<!--brand:|%%BRAND_/);
});

test('applyEmailBrand : nom de l\'entreprise dans le texte, échappé', () => {
  const brand = emailBrandFromOrg({ contact_company: '<Studio>' });
  assert.equal(applyEmailBrand(`Merci, ${BRAND_MARKS.name}`, brand), 'Merci, &lt;Studio&gt;');
});

test('instanceBrandLoader : lit la première organisation, met en cache', async () => {
  const calls: string[] = [];
  const env = (k: string) => ({ SUPABASE_URL: 'https://x.supabase.co/', SUPABASE_SERVICE_ROLE_KEY: 'k', FROM_NAME: 'Repli' } as Record<string, string>)[k];
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify([{ contact_company: 'Studio' }]), { status: 200 });
  }) as unknown as typeof fetch;
  const load = instanceBrandLoader(env, fetchImpl);
  assert.equal((await load()).name, 'Studio');
  assert.equal((await load()).name, 'Studio');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^https:\/\/x\.supabase\.co\/rest\/v1\/organizations\?select=\*&order=created_at\.asc&limit=1$/);
});

test('instanceBrandLoader : échec de lecture — FROM_NAME, sans cache', async () => {
  let n = 0;
  const env = (k: string) => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', FROM_NAME: 'Repli' } as Record<string, string>)[k];
  const fetchImpl = (async () => { n++; return new Response('err', { status: 500 }); }) as unknown as typeof fetch;
  const load = instanceBrandLoader(env, fetchImpl);
  assert.equal((await load()).name, 'Repli');
  await load();
  assert.equal(n, 2);
});
