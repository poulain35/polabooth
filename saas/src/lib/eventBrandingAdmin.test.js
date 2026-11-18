// Réglages de l'habillage et de l'email de la borne dans la fiche de l'événement (LAB-302).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_LOGO_MAX_BYTES, brandingDraftFrom, brandingErrors, cleanKioskEmail, colorStatus, emailWarnings,
  eventLogoPath, eventLogoPaths, eventLogoProblem, kioskFormConfigForSave, mergeBranding, previewDraft, withBranding,
} from './eventBrandingAdmin.js';
import { COLOR_REFUSED_MESSAGE } from './eventBranding.js';

const EVENT_ID = '11111111-2222-3333-4444-555555555555';

// form_config d'un événement réglé avant LAB-302 (email tel que l'écrivait la fiche).
const legacyEmail = {
  enabled: true, sender_name: 'Loueur', sender_email: '', subject: 'Vos photos — {event_name}',
  message: 'Bonjour,\n\nRetrouvez votre photo en cliquant sur le lien ci-dessous.\n\nBonne fête !\nLoueur',
};
const legacyFormConfig = () => ({
  enabled: true,
  gallery: { enabled: true },
  kiosk: { home: { personalized: false }, result: { share: { qr: true } }, email: { ...legacyEmail } },
});

test('sans réglage : la fiche enregistre la même config qu\'avant (ni branding vide, ni champs email vides)', () => {
  const stored = legacyFormConfig();
  const kiosk = structuredClone(stored.kiosk);
  const draft = brandingDraftFrom(stored);
  assert.deepEqual(draft, { color: '', logo_url: null, gallery_text: '' });
  const saved = kioskFormConfigForSave(stored, kiosk, { color: draft.color, gallery_text: draft.gallery_text });
  // Ancien saveKioskConfig : { ...form_config, kiosk }.
  assert.deepEqual(saved, { ...stored, kiosk });
  assert.equal('branding' in saved, false);
  assert.deepEqual(Object.keys(saved.kiosk.email).sort(), Object.keys(legacyEmail).sort());
  // Titre et bouton laissés vides (ou blancs) dans la fiche : non écrits.
  const touched = { ...kiosk, email: { ...kiosk.email, title: '', button_label: '   ' } };
  assert.deepEqual(kioskFormConfigForSave(stored, touched, { color: '', gallery_text: '' }), { ...stored, kiosk });
});

test('sans patch de branding : form_config.branding inchangé', () => {
  const stored = { ...legacyFormConfig(), branding: { color: '#1F4E79', extra: 1 } };
  assert.deepEqual(kioskFormConfigForSave(stored, stored.kiosk).branding, { color: '#1F4E79', extra: 1 });
});

test('enregistrement : couleur et texte de la galerie fusionnés, logo enregistré gardé, clés inconnues retirées', () => {
  const stored = { ...legacyFormConfig(), branding: { logo_url: 'https://cdn/logo.png?v=1', junk: 'x' } };
  const kiosk = { ...stored.kiosk, email: { ...stored.kiosk.email, title: 'Merci {client_name} !', button_label: 'Voir ma photo' } };
  const saved = kioskFormConfigForSave(stored, kiosk, { color: '#1f4e79', gallery_text: 'Bienvenue !' });
  assert.deepEqual(saved.branding, { color: '#1F4E79', logo_url: 'https://cdn/logo.png?v=1', gallery_text: 'Bienvenue !' });
  assert.equal(saved.kiosk.email.title, 'Merci {client_name} !');
  assert.equal(saved.kiosk.email.button_label, 'Voir ma photo');
  // Tout vidé : la clé branding disparaît.
  const cleared = kioskFormConfigForSave({ ...stored, branding: { color: '#1F4E79', gallery_text: 'x' } }, kiosk, { color: '', gallery_text: '  ' });
  assert.equal('branding' in cleared, false);
});

test('logo : fusion, suppression et branding vide retiré', () => {
  assert.deepEqual(mergeBranding(undefined, { logo_url: 'https://x/l.png' }), { logo_url: 'https://x/l.png' });
  assert.equal(mergeBranding({ logo_url: 'https://x/l.png' }, { logo_url: null }), null);
  assert.deepEqual(mergeBranding({ color: '#000000', logo_url: 'https://x' }, { logo_url: null }), { color: '#000000' });
  assert.deepEqual(withBranding({ a: 1, branding: { color: '#000000' } }, null), { a: 1 });
  assert.deepEqual(withBranding({ a: 1 }, { color: '#000000' }), { a: 1, branding: { color: '#000000' } });
  assert.deepEqual(cleanKioskEmail({ subject: 'x', title: 'T' }), { subject: 'x', title: 'T' });
});

test('logo : PNG ou JPG de 2 Mo au plus, rangé dans le dossier de l\'événement', () => {
  const file = (over = {}) => ({ name: 'logo.png', type: 'image/png', size: 500_000, ...over });
  assert.equal(eventLogoProblem(file()), null);
  assert.equal(eventLogoProblem(file({ name: 'logo.jpg', type: 'image/jpeg' })), null);
  assert.match(eventLogoProblem(file({ name: 'logo.svg', type: 'image/svg+xml' })), /PNG ou JPG/);
  assert.match(eventLogoProblem(file({ size: EVENT_LOGO_MAX_BYTES + 1 })), /2 Mo au maximum/);
  assert.match(eventLogoProblem(null), /Aucun fichier/);
  assert.equal(eventLogoPath(EVENT_ID, 'png'), `${EVENT_ID}/brand-logo.png`);
  assert.deepEqual(eventLogoPaths(EVENT_ID), [`${EVENT_ID}/brand-logo.png`, `${EVENT_ID}/brand-logo.jpg`]);
});

test('couleur trop peu lisible : refusée avec le message de contraste (D7)', () => {
  assert.deepEqual(brandingErrors({ color: '#7A7A7A' }), [COLOR_REFUSED_MESSAGE]);
  assert.deepEqual(brandingErrors({ color: '#12345' }), ['Couleur au format #RRGGBB attendue']);
  assert.deepEqual(brandingErrors({ color: '' }), []);
  assert.deepEqual(brandingErrors({ color: ' #1f4e79 ' }), []);
  assert.equal(colorStatus('#7A7A7A').tone, 'error');
  assert.equal(colorStatus('').tone, 'empty');
  assert.match(colorStatus('#1F4E79').text, /texte blanc, titre en couleur/);
  assert.match(colorStatus('#FFE600').text, /texte foncé, titre en texte foncé/);
});

test('longueurs : texte de la galerie toujours, textes de l\'email seulement si l\'envoi est activé', () => {
  assert.deepEqual(brandingErrors({ gallery_text: 'x'.repeat(301) }), ['Texte de la galerie : 300 caractères au maximum']);
  assert.deepEqual(brandingErrors({ gallery_text: '🎉'.repeat(300) }), []);
  const email = { subject: 'x'.repeat(121), button_label: 'x'.repeat(31), message: 'ok' };
  assert.deepEqual(brandingErrors({}, { emailEnabled: false, email }), []);
  assert.deepEqual(brandingErrors({}, { emailEnabled: true, email }), [
    'Email, objet : 120 caractères au maximum', 'Email, bouton : 30 caractères au maximum',
  ]);
});

test('variable inconnue, date et nom du client absents : signalés', () => {
  const email = { subject: '{event_nom} — {event_name}', title: 'Merci {client_name}', message: 'Le {event_date} {foo} {foo}', button_label: '' };
  assert.deepEqual(emailWarnings(email, { start_date: null, client_name: '' }), [
    "Objet : variable inconnue {event_nom}, elle restera telle quelle dans l'email.",
    "Message : variable inconnue {foo}, elle restera telle quelle dans l'email.",
    "La date de l'événement n'est pas renseignée : {event_date} sera vide.",
    "Le nom du client n'est pas renseigné : {client_name} sera vide.",
  ]);
  assert.deepEqual(emailWarnings({ ...email, subject: '{event_name}', message: '{event_date}' }, { start_date: '2026-06-13', client_name: 'Marie' }), []);
  assert.deepEqual(emailWarnings({}, {}), []);
});

test('brouillon de l\'aperçu : valeurs de la fiche, couleur normalisée', () => {
  const draft = previewDraft({ ...legacyEmail, title: 'T', extra: 1 }, { color: '#1f4e79 ', logo_url: null, gallery_text: 'G' });
  assert.deepEqual(draft, {
    email: { subject: legacyEmail.subject, title: 'T', message: legacyEmail.message, button_label: '', sender_name: 'Loueur', sender_email: '' },
    branding: { color: '#1F4E79', logo_url: '', gallery_text: 'G' },
  });
});
