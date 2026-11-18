// LAB-420 : somme des copies imprimées.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sumCopies } from './printCopies.js';

test('additionne les copies des impressions', () => {
  assert.equal(sumCopies([{ copies: 2 }, { copies: 1 }, { copies: 3 }]), 6);
});

test('copies vides comptées 0, liste absente ou vide = 0', () => {
  assert.equal(sumCopies([{ copies: null }, {}, { copies: 4 }]), 4);
  assert.equal(sumCopies([]), 0);
  assert.equal(sumCopies(null), 0);
  assert.equal(sumCopies(undefined), 0);
});
