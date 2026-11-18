// Liens venus d'une donnée (LAB-393) : seul le http(s) devient cliquable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { httpUrlInput, safeHttpsUrl, safeHttpUrl } from './urls.js';
import { safeHttpUrl as emailSafeHttpUrl } from './emailTracking.js';

const DANGEROUS = [
  'javascript:alert(1)', ' JavaScript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<script>alert(1)</script>',
  'vbscript:msgbox(1)', 'file:///etc/passwd', '//evil.example', '/admin', 'galerie', '', null, undefined, 42,
];

test('safeHttpUrl : http(s) seulement', () => {
  assert.equal(safeHttpUrl('https://galerie.example.com/abc'), 'https://galerie.example.com/abc');
  assert.equal(safeHttpUrl('  http://exemple.fr  '), 'http://exemple.fr/');
  for (const url of DANGEROUS) assert.equal(safeHttpUrl(url), null, JSON.stringify(url));
});

test('safeHttpsUrl : https seulement', () => {
  assert.equal(safeHttpsUrl('https://cdn.example.com/p.jpg'), 'https://cdn.example.com/p.jpg');
  assert.equal(safeHttpsUrl('http://cdn.example.com/p.jpg'), null);
  for (const url of DANGEROUS) assert.equal(safeHttpsUrl(url), null, JSON.stringify(url));
});

test('httpUrlInput : un lien javascript: saisi par l’admin est refusé', () => {
  assert.deepEqual(httpUrlInput(''), { url: null });
  assert.deepEqual(httpUrlInput('   '), { url: null });
  assert.deepEqual(httpUrlInput(null), { url: null });
  assert.deepEqual(httpUrlInput(' https://galerie.example.com/x '), { url: 'https://galerie.example.com/x' });
  for (const value of ['javascript:alert(1)', 'data:text/html,x', 'galerie.example.com']) {
    const result = httpUrlInput(value);
    assert.equal(result.url, undefined, value);
    assert.match(result.error, /https:\/\//, value);
  }
});

test('emailTracking réexporte le même safeHttpUrl', () => {
  assert.equal(emailSafeHttpUrl, safeHttpUrl);
});
