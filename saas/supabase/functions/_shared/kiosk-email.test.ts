// Email de la borne (LAB-300) : sans réglage, HTML identique octet pour octet à celui d'avant
// (kiosk-email.fixture.json, capturé avant toute modification) ; critères serveur de la spec.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildKioskEmail, DEFAULT_KIOSK_SUBJECT, defaultKioskMessage, mergeDraft, parsePreviewRequest,
  PREVIEW_PLACEHOLDER, previewSample, testSubject, type KioskEmailInput,
} from './kiosk-email.ts';
import { applyEmailBrand, emailBrandFromOrg } from './email-brand.ts';
import { BRAND, BRAND_MARKS } from './email-layout.ts';
import { DARK_TEXT, WHITE } from './event-branding.ts';

const fixture = JSON.parse(readFileSync(new URL('./kiosk-email.fixture.json', import.meta.url), 'utf8'));
const brand = emailBrandFromOrg(fixture.brandRow);

// deno-lint-ignore no-explicit-any
const inputOf = (c: any, extra: Partial<KioskEmailInput> = {}): KioskEmailInput => ({
  event: c.event, email: c.emailCfg, branding: undefined, identity: c.identity,
  photo: c.photo, photoUrl: c.photoUrl, appUrl: c.appUrl, ...extra,
});

const PHOTO = fixture.cases.find((c: { id: string }) => c.id === 'photo-defaut');
const GIF = fixture.cases.find((c: { id: string }) => c.id === 'gif-defaut');
const build = (email: Record<string, unknown>, branding?: unknown, c = PHOTO) =>
  buildKioskEmail(inputOf(c, { email, branding }));

// ── Sans réglage : rien ne change ────────────────────────────────────────────────────────────

test('instantanés : objet, HTML et expéditeur identiques à avant LAB-300 (photo, GIF, boomerang, vidéo, texte admin)', () => {
  assert.equal(fixture.cases.length, 5);
  for (const c of fixture.cases) {
    const email = buildKioskEmail(inputOf(c));
    assert.equal(email.subject, c.expected.subject, c.id);
    assert.equal(email.html, c.expected.html, c.id);
    assert.deepEqual(email.sender, c.expected.sender, c.id);
    if (c.expected.brandedHtml) assert.equal(applyEmailBrand(email.html, brand), c.expected.brandedHtml, `${c.id} (marque)`);
  }
});

test('instantanés : branding vide, invalide ou sans effet, titre et bouton vides → HTML inchangé', () => {
  const noop = [
    {}, { color: null, logo_url: null, gallery_text: 'Bienvenue' }, { color: 'red' }, { color: '#7A7A7A' },
    { logo_url: 'javascript:alert(1)' }, { logo_url: 'http://cdn.example.com/a.png' }, null, 'x',
  ];
  for (const c of fixture.cases) {
    for (const branding of noop) {
      const email = buildKioskEmail(inputOf(c, { branding, email: { ...c.emailCfg, title: '', button_label: '  ' } }));
      assert.equal(email.html, c.expected.html, `${c.id} ${JSON.stringify(branding)}`);
    }
  }
});

test('défauts de la spec (D5)', () => {
  assert.equal(DEFAULT_KIOSK_SUBJECT, 'Vos photos — {event_name}');
  assert.equal(defaultKioskMessage('Studio'), 'Bonjour,\n\nRetrouvez votre photo en cliquant sur le lien ci-dessous.\n\nBonne fête !\nStudio');
  assert.equal(defaultKioskMessage(''), 'Bonjour,\n\nRetrouvez votre photo en cliquant sur le lien ci-dessous.\n\nBonne fête !');
  // Champ blanc = vide : défaut.
  const blank = build({ subject: '   ', message: '\n  ', title: ' ', button_label: '' });
  assert.equal(blank.html, PHOTO.expected.html);
  assert.equal(blank.subject, PHOTO.expected.subject);
});

// ── Textes de l'admin ────────────────────────────────────────────────────────────────────────

const DATED = { ...PHOTO, event: { ...PHOTO.event, name: 'Mariage', client_name: 'Marie & Pierre', start_date: '2026-06-13T18:00:00+02:00' } };

test('variables : toutes les occurrences, date à l’heure de Paris, dans objet, titre, message et bouton', () => {
  const email = build({
    subject: '{event_name} · {event_name}',
    title: 'Merci {client_name} !',
    message: 'Merci {client_name}, {event_name} le {event_date} ! {event_name}\n{company_name} — {photo_url}',
    button_label: 'Voir {event_name}',
  }, undefined, DATED);
  assert.equal(email.subject, 'Mariage · Mariage');
  assert.match(email.html, /<title>Merci Marie &amp; Pierre !<\/title>/);
  assert.match(email.html, />Merci Marie &amp; Pierre !<\/h1>/);
  assert.ok(email.html.includes('Merci Marie &amp; Pierre, Mariage le samedi 13 juin 2026 ! Mariage<br>Studio Exemple — https://photos.example.com/photos/mariage/seance/composite.jpg'));
  assert.ok(email.html.includes('>Voir Mariage</a>'));
});

test('variable inconnue laissée telle quelle ; {event_date} sans date et {client_name} sans nom : vides', () => {
  const email = build({ message: 'Le {event_date}, {client_name}, {prenom}.' },
    undefined, { ...PHOTO, event: { ...PHOTO.event, start_date: null, client_name: null } });
  assert.ok(email.html.includes('<p style="margin:0;">Le , , {prenom}.</p>'));
});

test('message en texte brut : HTML affiché en texte, **gras** en gras, retours à la ligne gardés', () => {
  const email = build({ message: 'Un <a href="x">lien</a> et <b>ça</b>\n**merci** et **à bientôt**' });
  assert.ok(email.html.includes('Un &lt;a href=&quot;x&quot;&gt;lien&lt;/a&gt; et &lt;b&gt;ça&lt;/b&gt;<br><strong>merci</strong> et <strong>à bientôt</strong>'));
  assert.doesNotMatch(email.html, /<a href="x">|<b>/);
  // Titre et bouton : texte échappé, sans gras.
  const other = build({ title: '<i>**T**</i>', button_label: '<b>Go</b>' });
  assert.ok(other.html.includes('>&lt;i&gt;**T**&lt;/i&gt;</h1>'));
  assert.ok(other.html.includes('>&lt;b&gt;Go&lt;/b&gt;</a>'));
});

test('longueurs coupées par le serveur après remplacement (150, 100, 2000, 40)', () => {
  const email = build({
    subject: `${'a'.repeat(140)} {event_name}`,
    title: 't'.repeat(120),
    message: 'm'.repeat(2500),
    button_label: 'b'.repeat(60),
  });
  assert.equal(Array.from(email.subject).length, 150);
  assert.ok(email.html.includes(`>${'t'.repeat(100)}</h1>`));
  assert.ok(email.html.includes(`<p style="margin:0;">${'m'.repeat(2000)}</p>`));
  assert.ok(email.html.includes(`>${'b'.repeat(40)}</a>`));
  assert.ok(!email.html.includes('t'.repeat(101)) && !email.html.includes('b'.repeat(41)));
});

test('titre et bouton saisis valent pour tous les médias', () => {
  for (const c of fixture.cases) {
    const email = buildKioskEmail(inputOf(c, { email: { title: 'Merci !', button_label: 'Ouvrir' } }));
    assert.ok(email.html.includes('>Merci !</h1>'), c.id);
    assert.ok(email.html.includes('>Ouvrir</a>'), c.id);
    assert.doesNotMatch(email.html, /📷|🎞️|Voir ma photo|Voir mon animation|Voir ma vidéo/, c.id);
  }
});

// ── Couleur et logo ──────────────────────────────────────────────────────────────────────────

test('#1F4E79 : bouton de cette couleur à texte blanc, titre en couleur, filet de 4 px en haut de la carte', () => {
  const { html } = build({}, { color: '#1F4E79' });
  assert.ok(html.includes(`<td bgcolor="#1F4E79" style="background:#1F4E79;border-radius:8px;">`));
  assert.match(html, new RegExp(`font-weight:700;line-height:1\\.2;color:${WHITE};text-decoration:none;`));
  assert.match(html, /<h1 style="[^"]*color:#1F4E79;">/);
  assert.match(html, /class="pola-card" bgcolor="#ffffff" style="background:#ffffff;border-radius:8px;border-top:4px solid #1F4E79;padding:40px 32px;/);
  // Fond de page, carte, texte courant et pied de page inchangés.
  assert.ok(html.includes(`<body style="margin:0;padding:0;background:${BRAND.bg};">`));
  assert.ok(html.includes(`line-height:1.5;color:${BRAND.text};">`));
  assert.ok(html.includes(BRAND_MARKS.footer) && html.includes(BRAND_MARKS.legal) && html.includes(BRAND_MARKS.header));
  // Même structure que sans couleur, aux couleurs près.
  const plain = PHOTO.expected.html
    .replace(`style="background:#ffffff;border-radius:8px;padding`, `style="background:#ffffff;border-radius:8px;border-top:4px solid #1F4E79;padding`)
    .replace(/color:#4f1337;">📷/, 'color:#1F4E79;">📷')
    .replace(`<td bgcolor="${BRAND.button}" style="background:${BRAND.button};`, '<td bgcolor="#1F4E79" style="background:#1F4E79;')
    .replace(`line-height:1.2;color:${BRAND.buttonText};`, `line-height:1.2;color:${WHITE};`);
  assert.equal(html, plain);
});

test('#FFE600 : texte du bouton foncé, titre dans la couleur de texte par défaut', () => {
  const { html } = build({}, { color: '#FFE600' }, GIF);
  assert.ok(html.includes('<td bgcolor="#FFE600" style="background:#FFE600;border-radius:8px;">'));
  assert.match(html, new RegExp(`line-height:1\\.2;color:${DARK_TEXT};text-decoration:none;`));
  assert.match(html, new RegExp(`<h1 style="[^"]*color:${DARK_TEXT};">🎞️`));
  assert.ok(html.includes('border-top:4px solid #FFE600;'));
});

test('couleur piégée ou trop moyenne : ignorée, couleurs actuelles', () => {
  for (const color of ['red', '#12345', '#000;background:url(x)', '#7A7A7A']) {
    assert.equal(build({}, { color }).html, PHOTO.expected.html, color);
  }
});

test('logo de l’événement : remplace le logo du loueur en tête, pied de page du loueur identique', () => {
  const logo = 'https://cdn.example.com/events/brand-logo.png?v=1763200000&x="1"';
  const c = fixture.cases.find((x: { id: string }) => x.id === 'photo-texte-admin');
  const { html } = buildKioskEmail(inputOf(c, { branding: { logo_url: logo } }));
  assert.ok(!html.includes(BRAND_MARKS.header));
  assert.ok(html.includes(`<img src="https://cdn.example.com/events/brand-logo.png?v=1763200000&amp;x=&quot;1&quot;" width="300" alt="L&#39;été &quot;chic&quot; &lt;Soirée&gt;" class="pola-logo"`));
  const branded = applyEmailBrand(html, brand);
  assert.ok(!branded.includes('https://cdn.example.com/logo.png" width="300"'), 'plus le logo du loueur en tête');
  const footerOf = (s: string) => s.slice(s.indexOf('<tr><td align="center" class="pola-pad" style="padding:32px 32px 0;'));
  assert.ok(footerOf(branded).includes('★★★★★'));
  assert.equal(footerOf(branded), footerOf(c.expected.brandedHtml));
});

// ── Aperçu (kiosk-email-preview) ─────────────────────────────────────────────────────────────

test('aperçu : photo de l’événement, sinon PNG du design validé, sinon cadre gris', () => {
  const sample = { id: 'p1', photo_url: 'https://x/a.mp4', thumbnail_url: 'https://x/a.jpg', media_type: 'boomerang' };
  assert.deepEqual(previewSample({ media: 'animation', sample, designUrl: 'https://x/d.png' }), {
    photo: { id: 'p1', media_type: 'boomerang', thumbnail_url: 'https://x/a.jpg' }, photoUrl: 'https://x/a.mp4',
  });
  assert.deepEqual(previewSample({ media: 'photo', sample: null, designUrl: 'https://x/d.png' }), {
    photo: { id: null, media_type: 'photo', thumbnail_url: null }, photoUrl: 'https://x/d.png',
  });
  assert.deepEqual(previewSample({ media: 'animation', sample: null, designUrl: null }), {
    photo: { id: null, media_type: 'gif', thumbnail_url: PREVIEW_PLACEHOLDER }, photoUrl: PREVIEW_PLACEHOLDER,
  });
  assert.match(decodeURIComponent(PREVIEW_PLACEHOLDER), /Votre photo ici/);
  // Animation d'exemple : affiche montrée, bouton « animation ».
  const { photo, photoUrl } = previewSample({ media: 'animation', sample: null, designUrl: 'https://x/d.png' });
  const html = buildKioskEmail(inputOf(PHOTO, { photo, photoUrl })).html;
  assert.ok(html.includes('▶ Voir mon animation') && html.includes('<img src="https://x/d.png" alt="Aperçu de votre animation"'));
});

test('aperçu : brouillon par-dessus les réglages enregistrés', () => {
  assert.deepEqual(mergeDraft({ subject: 'A', message: 'B', enabled: true }, { subject: 'C', title: '' }),
    { subject: 'C', message: 'B', enabled: true, title: '' });
  assert.deepEqual(mergeDraft({ logo_url: 'https://x/l.png' }, { color: '#1F4E79' }), { logo_url: 'https://x/l.png', color: '#1F4E79' });
  assert.deepEqual(mergeDraft(undefined, undefined), {});
  assert.deepEqual(mergeDraft({ a: 1 }, ['x']), { a: 1 });
});

test('aperçu : corps de la requête vérifié', () => {
  const id = '7c1d2e3f-0000-4000-8000-0000000000aa';
  assert.deepEqual(parsePreviewRequest({ event_id: id, action: 'test', media: 'animation', draft: { email: { subject: 'x' } } }),
    { eventId: id, action: 'test', media: 'animation', draft: { email: { subject: 'x' }, branding: undefined } });
  assert.deepEqual(parsePreviewRequest({ event_id: id, action: 'preview', media: 'autre' }),
    { eventId: id, action: 'preview', media: 'photo', draft: { email: undefined, branding: undefined } });
  assert.deepEqual(parsePreviewRequest({ event_id: 'x', action: 'preview' }), { error: 'event_id requis' });
  assert.ok('error' in parsePreviewRequest({ event_id: id, action: 'send' }));
  assert.ok('error' in parsePreviewRequest(null));
});

test('email de test : objet préfixé « [Test] »', () => {
  assert.equal(testSubject('Vos photos — Mariage'), '[Test] Vos photos — Mariage');
});
