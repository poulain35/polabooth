import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeText, isAccessCodeQuery, accessCodeOf, textScore, itemScore, mergeResults, rankCommands,
  flattenGroups, moveActive, searchTerm, ilikeAny, eventCommand, clientCommands, licenseCommand,
  buildPageCommands, shortcutLabel, isPaletteShortcut,
} from './commandSearch.js';

test('normalizeText : minuscules, sans accents ni espaces en trop', () => {
  assert.equal(normalizeText('  Élodie   DURAND '), 'elodie durand');
  assert.equal(normalizeText('Réglages de la borne'), 'reglages de la borne');
  assert.equal(normalizeText('Livre d’or'), 'livre d or');
  assert.equal(normalizeText(null), '');
});

test('isAccessCodeQuery et accessCodeOf : six lettres ou chiffres', () => {
  assert.equal(isAccessCodeQuery('ab3k9z'), true);
  assert.equal(isAccessCodeQuery(' AB3K9Z '), true);
  assert.equal(isAccessCodeQuery('AB3K9'), false);
  assert.equal(isAccessCodeQuery('AB 3K9Z'), false);
  assert.equal(accessCodeOf('ab3k9z'), 'AB3K9Z');
  assert.equal(accessCodeOf('mariage de'), null);
});

test('textScore : identique > début > début de mot > contenu > mots séparés', () => {
  assert.equal(textScore('mariage', 'Mariage'), 100);
  assert.equal(textScore('mari', 'Mariage Durand'), 80);
  assert.equal(textScore('dur', 'Mariage Durand'), 60);
  assert.equal(textScore('rand', 'Mariage Durand'), 40);
  assert.equal(textScore('durand mar', 'Mariage Durand'), 30);
  assert.equal(textScore('rand riage', 'Mariage Durand'), 20);
  assert.equal(textScore('xyz', 'Mariage Durand'), 0);
  assert.equal(textScore('', 'Mariage'), 0);
});

test('textScore ignore les accents des deux côtés', () => {
  assert.equal(textScore('reglages', 'Réglages'), 100);
  assert.equal(textScore('Élodie', 'elodie martin'), 80);
});

test('itemScore : code d’accès exact en premier, mots-clés et sous-titre moins forts', () => {
  const ev = { title: 'Mariage', code: 'AB3K9Z' };
  assert.equal(itemScore('ab3k9z', ev), 1000);
  assert.equal(itemScore('mariage', { title: 'Mariage' }), 100);
  assert.equal(itemScore('galerie', { title: 'Photos et livraison', keywords: ['galerie'] }), 90);
  assert.equal(itemScore('durand', { title: 'Mariage', subtitle: 'Durand' }), 70);
  // Résultat d'une requête : gardé même sans mot correspondant (trouvé par l'email, par exemple).
  assert.equal(itemScore('zzz', { title: 'Mariage', remote: true }), 1);
  assert.equal(itemScore('zzz', { title: 'Mariage' }), 0);
});

test('mergeResults : un résultat par identifiant, celui avec un code est préféré', () => {
  const merged = mergeResults([
    { id: 'event:1', title: 'A' },
    { id: 'event:1', title: 'A', code: 'AB3K9Z' },
    { id: 'event:2', title: 'B' },
    { title: 'sans id' },
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].code, 'AB3K9Z');
});

test('rankCommands : texte vide → suggestions dans l’ordre donné', () => {
  const groups = rankCommands('', [
    { id: 'a', group: 'pages', title: 'Bornes', suggested: true },
    { id: 'b', group: 'pages', title: 'Calendrier' },
    { id: 'c', group: 'actions', title: 'Nouvel événement', suggested: true },
  ]);
  assert.deepEqual(groups.map((g) => g.id), ['actions', 'pages']);
  assert.deepEqual(flattenGroups(groups).map((i) => i.id), ['c', 'a']);
});

test('rankCommands : tri par score, groupes par meilleur score puis ordre fixe', () => {
  const groups = rankCommands('borne', [
    { id: 'p1', group: 'pages', title: 'Réglages de la borne' },
    { id: 'p2', group: 'pages', title: 'Bornes' },
    { id: 'e1', group: 'events', title: 'Salon', subtitle: 'Borne acajou' },
    { id: 'x', group: 'pages', title: 'Aide' },
  ]);
  assert.deepEqual(groups.map((g) => g.id), ['pages', 'events']);
  assert.deepEqual(groups[0].items.map((i) => i.id), ['p2', 'p1']);
  assert.equal(groups[0].label, 'Pages');
});

test('rankCommands : à égalité, les groupes suivent l’ordre fixe ; groupes des modules avant Bornes', () => {
  const groups = rankCommands('dupont', [
    { id: 'b', group: 'bornes', title: 'Dupont', remote: true },
    { id: 's', group: 'sales', groupLabel: 'Devis et demandes', title: 'Dupont', remote: true },
    { id: 'c', group: 'clients', title: 'Dupont', remote: true },
    { id: 'e', group: 'events', title: 'Dupont', remote: true },
  ]);
  assert.deepEqual(groups.map((g) => g.id), ['events', 'clients', 'sales', 'bornes']);
  assert.equal(groups[2].label, 'Devis et demandes');
});

test('rankCommands : un code d’accès exact met son groupe en premier', () => {
  const groups = rankCommands('AB3K9Z', [
    { id: 'p', group: 'pages', title: 'AB3K9Z' },
    { id: 'e', group: 'events', title: 'Mariage', code: 'AB3K9Z', remote: true },
  ]);
  assert.equal(flattenGroups(groups)[0].id, 'e');
});

test('rankCommands : limite par groupe', () => {
  const items = Array.from({ length: 9 }, (_, i) => ({ id: `e${i}`, group: 'events', title: `Mariage ${i}` }));
  const pages = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, group: 'pages', title: `Mariage page ${i}` }));
  const groups = rankCommands('mariage', [...items, ...pages]);
  assert.equal(groups.find((g) => g.id === 'events').items.length, 5);
  assert.equal(groups.find((g) => g.id === 'pages').items.length, 6);
});

test('moveActive : en boucle', () => {
  assert.equal(moveActive(-1, 1, 3), 0);
  assert.equal(moveActive(-1, -1, 3), 2);
  assert.equal(moveActive(2, 1, 3), 0);
  assert.equal(moveActive(0, -1, 3), 2);
  assert.equal(moveActive(0, 1, 0), -1);
});

test('searchTerm et ilikeAny : mot le plus long, sans caractère dangereux', () => {
  assert.equal(searchTerm('a'), '');
  assert.equal(searchTerm('mariage de Lucie'), 'mariage');
  assert.equal(searchTerm('a,b)(c'), '');
  assert.equal(searchTerm('du%pont'), 'pont');
  assert.equal(searchTerm('o’neil'), 'neil');
  assert.equal(searchTerm('jean@exemple.fr'), 'jean@exemple.fr');
  assert.equal(ilikeAny(['name', 'client_name'], 'Élodie'), 'name.ilike."%Élodie%",client_name.ilike."%Élodie%"');
  assert.equal(ilikeAny(['name'], ' '), null);
  assert.equal(ilikeAny([], 'test'), null);
});

test('eventCommand : vers la fiche, code d’accès en badge', () => {
  const cmd = eventCommand({ id: 'e1', name: 'Mariage', client_name: 'Lucie', access_code: 'AB3K9Z', start_date: '2026-06-20' });
  assert.equal(cmd.href, '/admin/events/e1');
  assert.equal(cmd.code, 'AB3K9Z');
  assert.equal(cmd.group, 'events');
  assert.match(cmd.subtitle, /^Lucie · 20 juin 2026$/);
});

test('clientCommands : un client par nom, vers son événement le plus récent', () => {
  const events = [
    { id: 'e1', name: 'Mariage', client_name: 'Lucie Martin', client_email: 'lucie@ex.fr', start_date: '2025-06-01' },
    { id: 'e2', name: 'Anniversaire', client_name: 'lucie martin', client_email: null, start_date: '2026-03-01' },
    { id: 'e3', name: 'Salon', client_name: 'Paul', client_email: 'paul@ex.fr', start_date: '2026-01-01' },
    { id: 'e4', name: 'Sans client', client_name: null, client_email: null },
  ];
  const clients = clientCommands(events, 'lucie');
  assert.equal(clients.length, 1);
  assert.equal(clients[0].href, '/admin/events/e2');
  assert.equal(clients[0].subtitle, 'lucie@ex.fr · 2 événements · Anniversaire');
  assert.equal(clientCommands(events, 'paul@ex').length, 1);
});

test('licenseCommand : vers la carte de la borne', () => {
  const cmd = licenseCommand({ id: 'l1', label: 'Borne 1', machine_id: 'ABC-123', machine_name: 'PC-SALON' });
  assert.equal(cmd.href, '/admin/bornes?tab=etat#envoyer-l1');
  assert.equal(cmd.subtitle, 'PC-SALON · ABC-123');
  assert.equal(licenseCommand({ id: 'l2', machine_id: 'XYZ' }).title, 'XYZ');
});

test('buildPageCommands : filtrées comme le menu', () => {
  const all = buildPageCommands({
    isAvailable: () => true, isAppAdmin: true, salesTabs: [{ id: 'devis', label: 'Devis' }],
    eventViews: [{ id: 'calendrier', label: 'Calendrier', keywords: ['planning'] }],
    bornesTabs: [{ id: 'materiel', label: 'Matériel', keywords: ['stock'] }],
  });
  const ids = all.map((i) => i.id);
  for (const id of ['action:new-event', 'page:ventes', 'page:ventes:devis', 'page:events:calendrier', 'page:bornes:materiel', 'page:bornes:alertes', 'page:bornes:code', 'page:reglages:offres', 'page:templates', 'page:aide']) {
    assert.ok(ids.includes(id), id);
  }
  assert.equal(all.find((i) => i.id === 'page:events:calendrier').href, '/admin/events?vue=calendrier');
  assert.equal(all.find((i) => i.id === 'page:bornes:materiel').href, '/admin/bornes?tab=materiel');
  // Onglets des modules juste après État, comme dans la page.
  assert.equal(ids.indexOf('page:bornes:materiel'), ids.indexOf('page:bornes:etat') + 1);

  const open = buildPageCommands({ isAvailable: (id) => id === 'core', isAppAdmin: false, salesTabs: [], hiddenSettings: ['offres'] });
  const openIds = open.map((i) => i.id);
  // Version ouverte (LAB-421) : ni Calendrier ni Matériel, fournis par le module privé « planning ».
  for (const id of ['page:ventes', 'page:events:calendrier', 'page:bornes:materiel', 'page:bornes:alertes', 'page:bornes:code', 'page:reglages:offres', 'page:templates', 'page:aide']) {
    assert.ok(!openIds.includes(id), id);
  }
  assert.ok(openIds.includes('page:bornes:etat'));
  assert.ok(openIds.includes('page:reglages:entreprise'));
});

test('buildPageCommands : actions de création des modules et onglets de la fiche ouverte', () => {
  const items = buildPageCommands({
    createActions: [{ id: 'devis', label: 'Nouveau devis' }],
    event: { id: 'e1', name: 'Mariage', tabs: ['resume', 'borne'] },
    isAvailable: (id) => id !== 'guest_form',
  });
  const quote = items.find((i) => i.id === 'create:devis');
  assert.equal(quote.action, 'create:devis');
  assert.equal(quote.group, 'actions');
  assert.equal(items.find((i) => i.id === 'event-tab:borne').href, '/admin/events/e1?tab=borne');
  assert.ok(!items.some((i) => i.id === 'event-tab:livraison'));
  assert.equal(items.find((i) => i.id === 'event-borne:impression').href, '/admin/events/e1?tab=borne#impression');
  assert.equal(items.find((i) => i.id === 'event-borne:questionnaire').title, 'Consentement RGPD');
  assert.ok(!buildPageCommands({}).some((i) => i.id === 'create:devis'));
});

test('raccourci : ⌘K sur Mac, Ctrl K ailleurs', () => {
  assert.equal(shortcutLabel('MacIntel'), '⌘K');
  assert.equal(shortcutLabel('iPhone'), '⌘K');
  assert.equal(shortcutLabel('Win32'), 'Ctrl K');
  assert.equal(isPaletteShortcut({ ctrlKey: true, key: 'k' }), true);
  assert.equal(isPaletteShortcut({ metaKey: true, key: 'K' }), true);
  assert.equal(isPaletteShortcut({ ctrlKey: true, shiftKey: true, key: 'k' }), false);
  assert.equal(isPaletteShortcut({ key: 'k' }), false);
});
