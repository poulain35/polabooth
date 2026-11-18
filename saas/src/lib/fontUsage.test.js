import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flattenObjects, fontDescriptorsOf } from './fontUsage.js';

test('fontDescriptorsOf : textes simples, graisse et italique', () => {
  const objects = [
    { type: 'i-text', fontFamily: 'Pacifico', fontWeight: 400 },
    { type: 'text', fontFamily: 'Lato', fontWeight: 'bold', fontStyle: 'italic' },
    { type: 'textbox', fontFamily: 'Ma Police', fontWeight: 700 },
  ];
  assert.deepEqual(fontDescriptorsOf(objects), [
    '400 16px "Pacifico"',
    'italic bold 16px "Lato"',
    '700 16px "Ma Police"',
  ]);
});

test('fontDescriptorsOf : textes rangés dans des groupes, même imbriqués', () => {
  const objects = [
    { type: 'group', objects: [
      { type: 'rect' },
      { type: 'textbox', fontFamily: 'Bouton' },
      { type: 'group', objects: [{ type: 'i-text', fontFamily: 'Profond', fontWeight: 300 }] },
    ] },
  ];
  assert.deepEqual(fontDescriptorsOf(objects), ['400 16px "Bouton"', '300 16px "Profond"']);
});

test('fontDescriptorsOf : sans doublon, ignore les objets sans police et les autres types', () => {
  const objects = [
    { type: 'i-text', fontFamily: 'Lato' },
    { type: 'i-text', fontFamily: 'Lato', fontWeight: 400 },
    { type: 'i-text' },
    { type: 'image', fontFamily: 'Lato' },
    null,
  ];
  assert.deepEqual(fontDescriptorsOf(objects), ['400 16px "Lato"']);
});

test('flattenObjects : entrée absente ou invalide', () => {
  assert.deepEqual(flattenObjects(undefined), []);
  assert.deepEqual(fontDescriptorsOf(null), []);
  assert.equal(flattenObjects([{ type: 'group', objects: [{ type: 'rect' }] }]).length, 2);
});
