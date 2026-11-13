// Email de livraison générique (open core, lot L4) : liens et pièce jointe fournis par les
// fonctionnalités, send-delivery ne connaît plus ni l'audio ni la facture.
// Exécution : `npm test` (runner natif Node, strip-types).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  deliveryAttachmentName, deliveryAttachmentUrl, deliveryLinks, MAX_DELIVERY_LINKS,
} from '../_shared/delivery-links.ts';
import { renderDeliveryEmail } from '../_shared/saas-emails.ts';
import { PRIVATE_HISTORY } from '../../../scripts/private-history.mjs';

const APP = 'https://app.test/';
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const MIGRATIONS = new URL('../../migrations/', import.meta.url);
const migration = () => readFileSync(new URL('20261214000000_delivery_generic.sql', MIGRATIONS), 'utf8');

test('deliveryLinks : chemin relatif complété, URL absolue gardée, ordre conservé', () => {
  assert.deepEqual(deliveryLinks([
    { key: 'audio_guestbook', label: "Écouter le livre d'or audio", url: '/audio/ABC123' },
    { label: ' Vidéo du jour ', url: 'https://video.example.com/x' },
  ], APP), [
    { label: "Écouter le livre d'or audio", url: 'https://app.test/audio/ABC123' },
    { label: 'Vidéo du jour', url: 'https://video.example.com/x' },
  ]);
});

test('deliveryLinks : entrées invalides ignorées, doublons retirés, nombre plafonné', () => {
  assert.deepEqual(deliveryLinks(null, APP), []);
  assert.deepEqual(deliveryLinks({ label: 'x', url: '/a' }, APP), []);
  assert.deepEqual(deliveryLinks([
    null, 'texte', { label: '', url: '/a' }, { label: 'Sans URL' }, { label: 'JS', url: 'javascript:alert(1)' },
    { label: 'Protocole relatif', url: '//evil.example.com' }, { label: 'Mail', url: 'mailto:a@b.c' },
    { label: 'A', url: '/a' }, { label: 'A bis', url: '/a' },
  ], APP), [{ label: 'A', url: 'https://app.test/a' }]);
  const many = Array.from({ length: 10 }, (_, i) => ({ label: `L${i}`, url: `/l/${i}` }));
  assert.equal(deliveryLinks(many, APP).length, MAX_DELIVERY_LINKS);
  assert.equal(deliveryLinks([{ label: 'x'.repeat(200), url: '/a' }], APP)[0].label.length, 80);
});

test('deliveryLinks : sans adresse d\'application, un chemin relatif est ignoré', () => {
  assert.deepEqual(deliveryLinks([{ label: 'A', url: '/a' }], ''), []);
});

test('pièce jointe : URL http(s) seulement, nom tiré de l\'URL si c\'est un PDF', () => {
  assert.equal(deliveryAttachmentUrl(null), null);
  assert.equal(deliveryAttachmentUrl('  '), null);
  assert.equal(deliveryAttachmentUrl('/facture.pdf'), null);
  assert.equal(deliveryAttachmentUrl('ftp://x/y.pdf'), null);
  assert.equal(deliveryAttachmentUrl('https://files.example.com/F-2026-12.pdf'), 'https://files.example.com/F-2026-12.pdf');
  assert.equal(deliveryAttachmentName('https://files.example.com/a/Facture%20n%C2%B012.pdf'), 'Facture-n-12.pdf');
  assert.equal(deliveryAttachmentName('https://files.example.com/a/F-2026-12.pdf?sig=abc'), 'F-2026-12.pdf');
  assert.equal(deliveryAttachmentName('https://app.pennylane.com/public/invoice/pdf?token=xyz'), 'document.pdf');
  assert.equal(deliveryAttachmentName('pas une url'), 'document.pdf');
});

test('gabarit : un bouton par lien, pièce jointe générique, plus de mention de facture', () => {
  const { html } = renderDeliveryEmail({
    clientName: 'Camille', eventName: 'Mariage', brand: 'Studio', photoGalleryUrl: 'https://g.example.com',
    links: [{ label: "Écouter le livre d'or audio", url: 'https://app.test/audio/ABC' }], hasAttachment: true,
  });
  assert.match(html, /https:\/\/app\.test\/audio\/ABC/);
  assert.match(html, /Écouter le livre d&#39;or audio →|Écouter le livre d'or audio →/);
  assert.match(html, /Un document est joint à cet email/);
  assert.doesNotMatch(html, /facture/i);

  const bare = renderDeliveryEmail({
    clientName: 'Camille', eventName: 'Mariage', brand: 'Studio', photoGalleryUrl: 'https://g.example.com', hasAttachment: false,
  }).html;
  assert.doesNotMatch(bare, /audio|document est joint/i);
});

test('send-delivery ne connaît ni l\'audio ni la facture', () => {
  const src = read('./index.ts').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
  assert.doesNotMatch(src, /audio|invoice|facture|form_config|access_code/i);
  assert.match(src, /delivery_links/);
  assert.match(src, /delivery_attachment_url/);
});

test('migration : renommage de invoice_url, colonne tableau, déclencheur du livre d\'or et reprise', { skip: PRIVATE_HISTORY }, () => {
  const sql = migration();
  assert.match(sql, /RENAME COLUMN invoice_url TO delivery_attachment_url/);
  assert.match(sql, /delivery_links jsonb NOT NULL DEFAULT '\[\]'::jsonb/);
  assert.match(sql, /CHECK \(jsonb_typeof\(delivery_links\) = 'array'\)/);
  assert.match(sql, /BEFORE INSERT OR UPDATE OF form_config, access_code, delivery_links ON public\.events/);
  assert.match(sql, /'url',\s+'\/audio\/' \|\| NEW\.access_code/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.events_audio_delivery_link\(\) FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /UPDATE public\.events\s+SET delivery_links = delivery_links\s+WHERE \(form_config -> 'audio_enabled'\) = 'true'::jsonb/);
});

test('plus aucune lecture de invoice_url après la migration (hors anciennes migrations et tests)', () => {
  const later = readdirSync(MIGRATIONS).filter((f) => f > '20261214000000_delivery_generic.sql');
  for (const f of later) assert.doesNotMatch(readFileSync(new URL(f, MIGRATIONS), 'utf8'), /\binvoice_url\b/, f);
  for (const rel of ['./index.ts', '../_shared/email.ts', '../_shared/saas-emails.ts', '../../../src/pages/admin/AdminEventDetail.jsx']) {
    assert.doesNotMatch(read(rel), /\binvoice_url\b|invoiceUrl|hasInvoice/, rel);
  }
});
