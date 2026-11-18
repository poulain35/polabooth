import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeSectionId, hashSectionId, visibleSections } from './settingsToc.js';

const positions = (...tops) => tops.map((top, i) => ({ id: `s${i}`, top }));

test('visibleSections : cache les sections demandées, garde l\'ordre', () => {
  const sections = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(visibleSections(sections, ['b']).map((s) => s.id), ['a', 'c']);
  assert.deepEqual(visibleSections(sections).map((s) => s.id), ['a', 'b', 'c']);
});

test('activeSectionId : dernière section passée sous la ligne', () => {
  assert.equal(activeSectionId([], {}), null);
  assert.equal(activeSectionId(positions(40, 600, 1200), { offset: 80 }), 's0');
  assert.equal(activeSectionId(positions(200, 600, 1200), { offset: 80 }), 's0');
  assert.equal(activeSectionId(positions(-500, 60, 700), { offset: 80 }), 's1');
  assert.equal(activeSectionId(positions(-1500, -900, -10), { offset: 80 }), 's2');
});

test('activeSectionId : en bas de page, la dernière ou celle choisie si visible', () => {
  const pos = positions(-900, -300, 200, 500);
  assert.equal(activeSectionId(pos, { offset: 80, atBottom: true }), 's3');
  assert.equal(activeSectionId(pos, { offset: 80, atBottom: true, preferred: 's2', viewHeight: 800 }), 's2');
  assert.equal(activeSectionId(pos, { offset: 80, atBottom: true, preferred: 's0', viewHeight: 800 }), 's3');
  assert.equal(activeSectionId(positions(-900, -300, 900, 1000), { atBottom: true, preferred: 's2', viewHeight: 800 }), 's3');
});

test('hashSectionId', () => {
  assert.equal(hashSectionId('#services'), 'services');
  assert.equal(hashSectionId('#fonctionnalit%C3%A9s'), 'fonctionnalités');
  assert.equal(hashSectionId(''), null);
  assert.equal(hashSectionId('#%E0'), null);
  assert.equal(hashSectionId(undefined), null);
});
