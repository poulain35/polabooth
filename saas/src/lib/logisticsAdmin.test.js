import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, isoToParisLocal, kindLabel, mondayOf, parisLocalToIso, slotsByDay, weekTitle } from './logisticsAdmin.js';

test('heure de Paris ↔ UTC (été, hiver, changement d’heure)', () => {
  assert.equal(parisLocalToIso('2027-06-10T18:30'), '2027-06-10T16:30:00.000Z');
  assert.equal(parisLocalToIso('2027-01-10T18:30'), '2027-01-10T17:30:00.000Z');
  assert.equal(parisLocalToIso('2027-03-28T03:30'), '2027-03-28T01:30:00.000Z');
  assert.equal(parisLocalToIso('2027-10-31T12:00'), '2027-10-31T11:00:00.000Z');
  assert.equal(parisLocalToIso('demain'), null);
  assert.equal(isoToParisLocal('2027-06-10T16:30:00Z'), '2027-06-10T18:30');
});

test('semaines : lundi, titre, rangement par jour de Paris', () => {
  assert.equal(mondayOf('2027-06-13'), '2027-06-07');
  assert.equal(mondayOf('2027-06-07'), '2027-06-07');
  assert.equal(addDays('2027-06-28', 6), '2027-07-04');
  assert.equal(weekTitle('2027-06-07'), '7 – 13 juin 2027');
  assert.equal(weekTitle('2027-06-28'), '28 juin – 4 juillet 2027');
  // 23:30 UTC le dimanche = lundi 01:30 à Paris : hors de la semaine précédente.
  const days = slotsByDay('2027-06-07', [
    { id: 'b', starts_at: '2027-06-10T17:00:00Z' }, { id: 'a', starts_at: '2027-06-10T16:00:00Z' }, { id: 'x', starts_at: '2027-06-13T23:30:00Z' },
  ]);
  assert.equal(days.length, 7);
  assert.deepEqual(days[3].slots.map((s) => s.id), ['a', 'b']);
  assert.equal(days.flatMap((d) => d.slots).length, 2);
  assert.equal(kindLabel('retour', 'delivery'), 'Reprise');
  assert.equal(kindLabel('retrait', 'pickup'), 'Retrait');
});
