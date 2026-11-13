// Tests des pièces jointes Brevo (LAB-88, LAB-90) : URL Pennylane sans extension → contenu base64 ; « .pdf » non PDF écarté.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inlineAttachments, isPdf, toBase64 } from './email-attachments.ts';

const PDF = new TextEncoder().encode('%PDF-1.4 devis');
const PENNYLANE_URL = 'https://app.pennylane.com/public/invoice/pdf?encrypted_id=abc';

const fetchOf = (routes: Record<string, Response | Error>) => (async (url: string | URL) => {
  const r = routes[String(url)];
  if (r instanceof Error) throw r;
  return r ?? new Response('absent', { status: 404 });
}) as typeof fetch;

test('toBase64 : identique à Buffer, y compris au-delà d\'un bloc', () => {
  const big = new Uint8Array(100_000).map((_, i) => i % 256);
  assert.equal(toBase64(PDF), Buffer.from(PDF).toString('base64'));
  assert.equal(toBase64(big), Buffer.from(big).toString('base64'));
});

test('inlineAttachments : URL Pennylane téléchargée et envoyée en base64 avec son nom', async () => {
  const out = await inlineAttachments(
    [{ url: PENNYLANE_URL, name: 'Devis D-2026-196.pdf' }],
    fetchOf({ [PENNYLANE_URL]: new Response(PDF) }),
  );
  assert.deepEqual(out, [{ content: Buffer.from(PDF).toString('base64'), name: 'Devis D-2026-196.pdf' }]);
});

test('inlineAttachments : contenu déjà inline conservé, nom par défaut tiré de l\'URL', async () => {
  const cgl = 'https://x.supabase.co/storage/v1/object/public/legal/CGL-v3.pdf';
  const out = await inlineAttachments(
    [{ content: 'QUJD', name: 'a.txt' }, { url: cgl }],
    fetchOf({ [cgl]: new Response(PDF) }),
  );
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { content: 'QUJD', name: 'a.txt' });
  assert.equal((out[1] as { name: string }).name, 'CGL-v3.pdf');
});

test('inlineAttachments : téléchargement en échec (HTTP ou réseau) → pièce jointe retirée, avertissement', async () => {
  const warnings: string[] = [];
  const out = await inlineAttachments(
    [{ url: PENNYLANE_URL, name: 'Facture.pdf' }, { url: 'https://down.example/f.pdf', name: 'CGL.pdf' }],
    fetchOf({ [PENNYLANE_URL]: new Response('expiré', { status: 403 }), 'https://down.example/f.pdf': new Error('ECONNRESET') }),
    (m) => warnings.push(m),
  );
  assert.deepEqual(out, []);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /Facture\.pdf.*HTTP 403/);
  assert.match(warnings[1], /CGL\.pdf.*ECONNRESET/);
});

test('inlineAttachments : page HTML servie sous un nom .pdf (URL non déployée) → retirée, le reste part', async () => {
  const cgl = 'https://photobooth.exemple.fr/legal/cgl.pdf';
  const spa = new Response('<!doctype html><html lang="en">', { headers: { 'content-type': 'text/html; charset=utf-8' } });
  const warnings: string[] = [];
  const out = await inlineAttachments(
    [{ url: PENNYLANE_URL, name: 'Facture-F-2026-144.pdf' }, { url: cgl, name: 'CGL-Studio-Exemple.pdf' }],
    fetchOf({ [PENNYLANE_URL]: new Response(PDF), [cgl]: spa }),
    (m) => warnings.push(m),
  );
  assert.deepEqual(out.map((a) => a.name), ['Facture-F-2026-144.pdf']);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /CGL-Studio-Exemple\.pdf.*contenu non PDF \(text\/html/);
});

test('isPdf : signature %PDF- exigée', () => {
  assert.equal(isPdf(PDF), true);
  assert.equal(isPdf(new TextEncoder().encode('<!doctype html>')), false);
  assert.equal(isPdf(new Uint8Array()), false);
});

test('inlineAttachments : un fichier qui n\'est pas nommé .pdf n\'est pas contrôlé', async () => {
  const url = 'https://x.example/photo.jpg';
  const out = await inlineAttachments([{ url, name: 'photo.jpg' }], fetchOf({ [url]: new Response('JPEG') }));
  assert.equal(out.length, 1);
});

// ── Câblage dans _shared/email.ts (postBrevo) ────────────────────────────────

// deno-lint-ignore no-explicit-any
(globalThis as any).Deno = { env: { get: (k: string) => ({ BREVO_API_KEY: 'brevo-factice' } as Record<string, string>)[k] } };
const { sendBookingEmail } = await import('./email.ts');

function stubBrevo(files: Record<string, Response>) {
  const posted: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    if (String(url) === 'https://api.brevo.com/v3/smtp/email') {
      posted.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ messageId: '<m@brevo>' }), { status: 201 });
    }
    return files[String(url)] ?? new Response('absent', { status: 404 });
  }) as typeof fetch;
  return posted;
}

const rendered = { subject: 'Votre devis', html: '<p>x</p>', params: {} };

test('postBrevo : la pièce jointe Pennylane part en base64, plus jamais en URL', async () => {
  const posted = stubBrevo({ [PENNYLANE_URL]: new Response(PDF) });
  await sendBookingEmail({ to: 'client@exemple.fr', rendered, templateId: null, attachment: [{ url: PENNYLANE_URL, name: 'Devis.pdf' }] });
  assert.equal(posted.length, 1);
  assert.deepEqual(posted[0].attachment, [{ content: Buffer.from(PDF).toString('base64'), name: 'Devis.pdf' }]);
});

test('postBrevo : PDF indisponible → email envoyé sans champ attachment', async () => {
  const posted = stubBrevo({});
  await sendBookingEmail({ to: 'client@exemple.fr', rendered, templateId: null, attachment: [{ url: PENNYLANE_URL, name: 'Devis.pdf' }] });
  assert.equal(posted.length, 1);
  assert.equal('attachment' in posted[0], false);
});
