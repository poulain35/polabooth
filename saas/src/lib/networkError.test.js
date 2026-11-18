import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NETWORK_ERROR_MESSAGE, isFetchFailure, userErrorMessage } from './networkError.js';

test('échec réseau reconnu : navigateurs et erreurs de supabase-js', () => {
  for (const error of [
    new TypeError('Failed to fetch'),
    { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' },
    { name: 'StorageUnknownError', message: 'Failed to fetch' },
    new TypeError('NetworkError when attempting to fetch resource.'),
    new TypeError('Load failed'),
    'Failed to fetch',
  ]) {
    assert.equal(isFetchFailure(error), true, JSON.stringify(error?.message ?? error));
    assert.equal(userErrorMessage(error, 'Repli'), NETWORK_ERROR_MESSAGE);
  }
});

test('autre erreur : son message, sinon le message de repli', () => {
  assert.equal(isFetchFailure({ message: 'new row violates row-level security policy' }), false);
  assert.equal(userErrorMessage(new Error('Brouillon trop lourd.'), 'Repli'), 'Brouillon trop lourd.');
  assert.equal(userErrorMessage(new Error('Échec : Failed to fetch le logo'), 'Repli'), 'Échec : Failed to fetch le logo');
  assert.equal(userErrorMessage({ message: '' }, 'Repli'), 'Repli');
  assert.equal(userErrorMessage(null, 'Repli'), 'Repli');
});
