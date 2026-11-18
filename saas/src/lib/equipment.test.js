// LAB-358 : affichage du stock de matériel dans l'admin (Bornes › Matériel, fiche de l'événement).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  availabilityLabel, formatDay, groupEquipment, isDuplicateTypeLabel, itemPayload, itemStatus,
  lastUnavailabilityLabel, localDay, moveType, needsSummary, nextSortOrder, retiredToggleLabel,
  suggestItemName, uniqueTypeKey, validateItemDraft, validateTypeLabel,
} from './equipment.js';

const TODAY = '2026-11-17';

const type = (id, label, extra = {}) => ({
  id, key: label.toLowerCase().replace(/[^a-z]+/g, '-'), label, is_default: false, sort_order: 0, archived_at: null, ...extra,
});
const item = (id, typeId, extra = {}) => ({
  id, type_id: typeId, name: id, status: 'in_service', unavailable_from: null, unavailable_until: null, sort_order: 0, ...extra,
});

test('Vidéobooth avec 2 matériels : « 2 disponibles sur 2 »', () => {
  const types = [type('v', 'Vidéobooth')];
  const items = [item('Vidéobooth 1', 'v'), item('Vidéobooth 2', 'v')];
  const { active } = groupEquipment(types, items, TODAY);
  assert.equal(active.length, 1);
  assert.equal(`${active[0].type.label} · ${availabilityLabel(active[0].available, active[0].total)}`, 'Vidéobooth · 2 disponibles sur 2');
});

test('groupEquipment : ordre, retirés à part, compteurs du jour, archivés à part', () => {
  const types = [
    type('b', 'Borne photo', { sort_order: 0, is_default: true }),
    type('a', 'Ancien', { sort_order: 1, archived_at: '2026-01-01' }),
    type('l', "Livre d'or audio", { sort_order: 1 }),
  ];
  const items = [
    item('B2', 'b', { sort_order: 1 }),
    item('B1', 'b', { sort_order: 0 }),
    item('B3', 'b', { unavailable_from: '2026-11-15', unavailable_until: '2026-11-20' }),
    item('B4', 'b', { unavailable_from: '2026-12-02' }),
    item('B5', 'b', { status: 'retired' }),
    item('A1', 'a'),
  ];
  const { active, archived } = groupEquipment(types, items, TODAY);
  assert.deepEqual(active.map((b) => b.type.id), ['b', 'l']);
  assert.deepEqual(archived.map((b) => b.type.id), ['a']);
  const borne = active[0];
  assert.deepEqual(borne.active.map((i) => i.id), ['B1', 'B3', 'B4', 'B2']);
  assert.deepEqual(borne.retired.map((i) => i.id), ['B5']);
  assert.equal(borne.total, 4);
  assert.equal(borne.available, 3);
  assert.equal(borne.itemCount, 5);
  assert.equal(availabilityLabel(borne.available, borne.total), '3 disponibles sur 4');
  assert.equal(active[1].itemCount, 0);
});

test('availabilityLabel et retiredToggleLabel : accords', () => {
  assert.equal(availabilityLabel(5, 6), '5 disponibles sur 6');
  assert.equal(availabilityLabel(1, 1), '1 disponible sur 1');
  assert.equal(availabilityLabel(0, 2), '0 disponible sur 2');
  assert.equal(availabilityLabel(0, 0), 'Aucun matériel en service');
  assert.equal(retiredToggleLabel(2, false), '2 retirés · Afficher');
  assert.equal(retiredToggleLabel(1, true), '1 retiré · Masquer');
});

test('itemStatus : pastilles', () => {
  assert.deepEqual(itemStatus(item('x', 't'), TODAY), { label: 'En service', tone: 'ok' });
  assert.deepEqual(itemStatus(item('x', 't', { status: 'retired' }), TODAY), { label: 'Retiré', tone: 'retired' });
  assert.deepEqual(
    itemStatus(item('x', 't', { unavailable_from: '2026-11-17', unavailable_until: '2026-11-24' }), TODAY),
    { label: 'Indisponible du 17/11 au 24/11', tone: 'off' },
  );
  assert.deepEqual(
    itemStatus(item('x', 't', { unavailable_from: '2026-11-10' }), TODAY),
    { label: 'Indisponible depuis le 10/11, sans date de fin', tone: 'off' },
  );
  assert.deepEqual(
    itemStatus(item('x', 't', { unavailable_from: '2026-12-02' }), TODAY),
    { label: 'Indisponible à partir du 02/12', tone: 'planned' },
  );
  assert.deepEqual(
    itemStatus(item('x', 't', { unavailable_from: '2026-11-20', unavailable_until: '2026-11-24' }), TODAY),
    { label: 'Indisponible du 20/11 au 24/11', tone: 'planned' },
  );
  // Période terminée (fin passée) : de nouveau en service.
  const past = item('x', 't', { unavailable_from: '2026-11-01', unavailable_until: '2026-11-16' });
  assert.deepEqual(itemStatus(past, TODAY), { label: 'En service', tone: 'ok' });
  assert.equal(lastUnavailabilityLabel(past, TODAY), 'Dernière indisponibilité : du 01/11 au 16/11');
  assert.equal(lastUnavailabilityLabel(item('x', 't', { unavailable_from: '2026-11-01' }), TODAY), null);
  // Le dernier jour de la période est encore indisponible.
  assert.equal(itemStatus(item('x', 't', { unavailable_from: '2026-11-01', unavailable_until: TODAY }), TODAY).tone, 'off');
});

test("formatDay : année affichée seulement si ce n'est pas l'année en cours", () => {
  assert.equal(formatDay('2026-11-20', TODAY), '20/11');
  assert.equal(formatDay('2027-01-05', TODAY), '05/01/2027');
  assert.equal(formatDay(null, TODAY), '');
  assert.match(localDay(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(localDay(new Date(2026, 10, 7)), '2026-11-07');
});

test('validateItemDraft : fin avant le début refusée, fin sans début refusée', () => {
  assert.deepEqual(validateItemDraft({ name: 'Borne photo 1' }), {});
  assert.deepEqual(validateItemDraft({ name: 'B', unavailable_from: '2026-11-20' }), {});
  assert.deepEqual(validateItemDraft({ name: 'B', unavailable_from: '2026-11-20', unavailable_until: '2026-11-20' }), {});
  assert.deepEqual(
    validateItemDraft({ name: 'B', unavailable_from: '2026-11-24', unavailable_until: '2026-11-20' }),
    { unavailable_until: 'La fin doit être après le début' },
  );
  assert.deepEqual(validateItemDraft({ name: 'B', unavailable_until: '2026-11-20' }), { unavailable_from: 'Indiquez la date de début' });
  assert.deepEqual(validateItemDraft({ name: '  ' }), { name: 'Indiquez un nom' });
  assert.equal(validateItemDraft({ name: 'x'.repeat(61) }).name, '60 caractères au plus');
  assert.ok(validateItemDraft({ name: 'B', unavailable_reason: 'x'.repeat(201) }).unavailable_reason);
  assert.ok(validateItemDraft({ name: 'B', notes: 'x'.repeat(1001) }).notes);
});

test('itemPayload : textes nettoyés, sans début la période est vidée', () => {
  assert.deepEqual(
    itemPayload({ name: ' Borne 1 ', status: 'in_service', unavailable_from: '', unavailable_until: '2026-11-24', unavailable_reason: 'x', notes: '  ' }),
    { name: 'Borne 1', status: 'in_service', unavailable_from: null, unavailable_until: null, unavailable_reason: null, notes: null },
  );
  assert.deepEqual(
    itemPayload({ name: 'B', status: 'retired', unavailable_from: '2026-11-20', unavailable_until: '', unavailable_reason: ' Réparation ', notes: 'n' }),
    { name: 'B', status: 'retired', unavailable_from: '2026-11-20', unavailable_until: null, unavailable_reason: 'Réparation', notes: 'n' },
  );
});

test('types : doublon sans accents ni casse, clé unique avec suffixe', () => {
  const types = [
    type('v', 'Vidéobooth', { key: 'videobooth' }),
    type('o', 'Ancien', { key: 'cabine-photo', archived_at: '2026-01-01' }),
  ];
  assert.equal(isDuplicateTypeLabel('VIDEOBOOTH', types), true);
  assert.equal(isDuplicateTypeLabel('  vidéo  booth', types), false);
  assert.equal(isDuplicateTypeLabel('Vidéobooth', types, 'v'), false);
  assert.equal(isDuplicateTypeLabel('ancien', types), false);
  assert.equal(validateTypeLabel('videobooth', types), 'Ce type existe déjà');
  assert.equal(validateTypeLabel('  ', types), 'Indiquez un nom');
  assert.equal(validateTypeLabel('Cabine photo', types), null);
  // Clé prise par un type archivé : suffixe -2.
  assert.equal(uniqueTypeKey('Cabine photo', types), 'cabine-photo-2');
  assert.equal(uniqueTypeKey('Cabine photo', [...types, type('c2', 'X', { key: 'cabine-photo-2' })]), 'cabine-photo-3');
  assert.equal(uniqueTypeKey('Livre d’or audio', types), 'livre-d-or-audio');
  assert.equal(uniqueTypeKey('!!!', types), 'type');
  const long = 'a'.repeat(40);
  assert.equal(uniqueTypeKey(long, [type('l', 'L', { key: long })]), `${'a'.repeat(38)}-2`);
});

test('suggestItemName : « Borne photo 7 »', () => {
  const items = Array.from({ length: 6 }, (_, i) => item(`i${i}`, 'b', { name: `Borne photo ${i + 1}` }));
  assert.equal(suggestItemName('Borne photo', items), 'Borne photo 7');
  assert.equal(suggestItemName('Borne photo', []), 'Borne photo 1');
  assert.equal(suggestItemName('Borne photo', [item('a', 'b', { name: 'Borne Photo 12' })]), 'Borne photo 13');
  assert.equal(suggestItemName('Borne photo', [item('a', 'b', { name: 'La rouge' })]), 'Borne photo 2');
});

test('moveType et nextSortOrder', () => {
  const types = [type('a', 'A'), type('b', 'B'), type('c', 'C'), type('z', 'Z', { archived_at: '2026-01-01' })];
  // Ordres égaux (0) : départage par libellé, renumérotation (b reste à 0, seul ce qui change est écrit).
  assert.deepEqual(moveType(types, 'b', 'up'), [{ id: 'a', sort_order: 1 }, { id: 'c', sort_order: 2 }]);
  assert.deepEqual(moveType(types, 'a', 'up'), []);
  assert.deepEqual(moveType(types, 'c', 'down'), []);
  const ordered = [type('a', 'A', { sort_order: 0 }), type('b', 'B', { sort_order: 1 }), type('c', 'C', { sort_order: 2 })];
  assert.deepEqual(moveType(ordered, 'a', 'down'), [{ id: 'b', sort_order: 0 }, { id: 'a', sort_order: 1 }]);
  assert.equal(nextSortOrder([]), 0);
  assert.equal(nextSortOrder([{ sort_order: 3 }, { sort_order: 1 }]), 4);
});

test('needsSummary : ligne « Matériel » de la fiche', () => {
  const types = [
    type('b', 'Borne photo', { key: 'borne-photo', is_default: true, sort_order: 0 }),
    type('l', "Livre d'or audio", { key: 'livre-or-audio', sort_order: 1 }),
    type('a', 'Ancien', { key: 'ancien', archived_at: '2026-01-01' }),
  ];
  assert.equal(needsSummary(null, types), '1 Borne photo (par défaut)');
  assert.equal(needsSummary(undefined, types), '1 Borne photo (par défaut)');
  assert.equal(needsSummary({}, types), 'Aucun matériel');
  assert.equal(needsSummary({ 'livre-or-audio': 1, 'borne-photo': 1 }, types), "1 Borne photo · 1 Livre d'or audio");
  assert.equal(needsSummary({ ancien: 2, inconnu: 1 }, types), 'Aucun matériel');
  assert.equal(needsSummary(null, types.slice(1)), 'Par défaut (aucun type par défaut choisi)');
});
