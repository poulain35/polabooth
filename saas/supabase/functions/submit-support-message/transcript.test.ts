import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_TRANSCRIPT_ITEMS, MAX_TRANSCRIPT_ITEM_CHARS, sanitizeTranscript } from './transcript.ts';

test('conversation valide : gardée telle quelle', () => {
  const t = [{ role: 'user', content: 'Bonjour' }, { role: 'assistant', content: 'Que puis-je faire ?' }];
  assert.deepEqual(sanitizeTranscript(t), t);
});

test('pas un tableau, tableau vide ou sans échange valide : null', () => {
  assert.equal(sanitizeTranscript(undefined), null);
  assert.equal(sanitizeTranscript('texte'), null);
  assert.equal(sanitizeTranscript({ role: 'user', content: 'x' }), null);
  assert.equal(sanitizeTranscript([]), null);
  assert.equal(sanitizeTranscript([null, 3, { role: 'system', content: 'x' }, { role: 'user', content: '  ' }]), null);
});

test('rôles inconnus, contenus non texte et clés en trop retirés', () => {
  const out = sanitizeTranscript([
    { role: 'system', content: 'ignore' },
    { role: 'user', content: { html: '<b>x</b>' } },
    { role: 'user', content: ' Question ', extra: 'x'.repeat(10), id: 7 },
  ]);
  assert.deepEqual(out, [{ role: 'user', content: 'Question' }]);
});

test('chaque contenu coupé, seuls les derniers échanges gardés', () => {
  const long = sanitizeTranscript([{ role: 'assistant', content: 'a'.repeat(MAX_TRANSCRIPT_ITEM_CHARS + 500) }]);
  assert.equal(long?.[0].content.length, MAX_TRANSCRIPT_ITEM_CHARS);

  const many = Array.from({ length: MAX_TRANSCRIPT_ITEMS + 10 }, (_, i) => ({ role: 'user', content: `m${i}` }));
  const kept = sanitizeTranscript(many);
  assert.equal(kept?.length, MAX_TRANSCRIPT_ITEMS);
  assert.equal(kept?.[0].content, 'm10');
  assert.equal(kept?.at(-1)?.content, `m${MAX_TRANSCRIPT_ITEMS + 9}`);
});
