import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KIND_LABELS, alertItems, buildTodayItems, compareTodayItems, daysFromNow, designItems,
  groupTodayItems, guestExportItems, noBorneItems, normalizeItem, ofName, shortDateLabel, snoozeUntil, sortTodayItems,
  splitDismissed, timeAgo, todayFigures, todayGroupOf, todayWhen, weekAgenda, weekEventEntries, whenLabel,
} from './todayItems.js';

// Lundi 16 novembre 2026, 10 h à Paris (9 h UTC).
const now = new Date('2026-11-16T09:00:00Z');
const at = (days, hourUtc = 9) => new Date(Date.UTC(2026, 10, 16 + days, hourUtc)).toISOString();

const alert = { id: '6f1c2a4e-1b2c-4d3e-8f90-123456789abc', alert_type: 'printer_problem', machine_id: 'PC-1', sent_at: at(0, 8), events: { name: 'Mariage', start_date: at(0) } };
const designs = [
  { id: 'd1', event_id: 'e1', kind: 'print', events: { name: 'Gala', client_name: 'ACME', start_date: at(20) } },
  { id: 'd2', event_id: 'e1', kind: 'print', events: { name: 'Gala', client_name: 'ACME', start_date: at(20) } },
  { id: 'd3', event_id: 'e1', kind: 'home', events: { name: 'Gala', start_date: at(20) } },
  { id: 'd4', event_id: 'e2', kind: 'print', events: { name: 'Anniversaire', start_date: at(3) } },
];

test('alerte ouverte de la borne : en tête, avec le bouton qui ouvre la borne', () => {
  const items = buildTodayItems({
    alerts: [alert],
    licenses: [{ machine_id: 'PC-1', label: 'Borne bleue' }],
    designs,
    moduleItems: [{ id: 'request:1', kind: 'request', label: 'Demande', urgency: 'high', title: 'Répondre à la demande', href: '/admin/ventes?tab=demandes&lead=1', date: at(1) }],
  }, { now });
  assert.equal(items[0].kind, 'alert');
  assert.equal(items[0].href, '/admin/bornes?tab=alertes&alerte=6f1c2a4e-1b2c-4d3e-8f90-123456789abc');
  assert.equal(items[0].actionLabel, 'Voir la borne');
  assert.equal(items[0].label, 'Borne');
  assert.match(items[0].context, /Borne bleue/);
  assert.match(items[0].context, /signalée il y a 1 h/);
});

test('alerte sans identifiant valable : onglet Alertes seul', () => {
  assert.equal(alertItems([{ ...alert, id: 'a2' }], [], now)[0].href, '/admin/bornes?tab=alertes');
});

test('alerte résolue ignorée', () => {
  assert.deepEqual(alertItems([{ ...alert, resolved_at: at(0) }], [], now), []);
});

test('cadres soumis regroupés par événement, bouton vers l’onglet Création', () => {
  const items = designItems(designs);
  assert.equal(items.length, 3);
  const gala = items.find((i) => i.id === 'design:e1');
  assert.equal(gala.title, 'Valider les 2 cadres photo d’ACME');
  assert.equal(gala.href, '/admin/events/e1?tab=creation');
  assert.equal(gala.actionLabel, 'Valider');
  assert.equal(gala.context, 'Envoyé par le client · Gala');
  const home = items.find((i) => i.id === 'home_design:e1');
  assert.equal(home.title, 'Valider l’écran d’accueil');
  assert.equal(home.href, '/admin/events/e1?tab=creation');
  assert.equal(items.find((i) => i.id === 'design:e2').title, 'Valider le cadre photo');
});

test('tri : urgence, puis date la plus proche, sans date en dernier', () => {
  const sorted = sortTodayItems([
    { id: 'n-late', title: 'B', href: '/b', urgency: 'normal', date: at(10) },
    { id: 'n-none', title: 'A', href: '/a', urgency: 'normal' },
    { id: 'n-soon', title: 'C', href: '/c', urgency: 'normal', date: at(2) },
    { id: 'h', title: 'D', href: '/d', urgency: 'high', date: at(30) },
    { id: 'u', title: 'E', href: '/e', urgency: 'urgent' },
    { id: 'l', title: 'F', href: '/f', urgency: 'low', date: at(0) },
  ]);
  assert.deepEqual(sorted.map((i) => i.id), ['u', 'h', 'n-soon', 'n-late', 'n-none', 'l']);
});

test('normalisation : urgence inconnue = normale, sans titre ou adresse = ignoré, doublons retirés', () => {
  assert.equal(normalizeItem({ title: 'X', href: '/x', urgency: 'bizarre' }).urgency, 'normal');
  assert.equal(normalizeItem({ title: 'X' }), null);
  assert.equal(normalizeItem({ href: '/x' }), null);
  const item = normalizeItem({ kind: 'design', title: 'X', href: '/x' });
  assert.equal(item.label, 'Cadres');
  assert.equal(item.actionLabel, 'Ouvrir');
  assert.equal(item.id, 'design:/x');
  assert.equal(sortTodayItems([{ id: 1, title: 'X', href: '/x' }, { id: 1, title: 'Y', href: '/y' }]).length, 1);
  assert.ok(compareTodayItems({ urgency: 'urgent', title: 'b' }, { urgency: 'low', title: 'a' }) < 0);
});

test('sources gardées par leur fonctionnalité', () => {
  const sources = {
    alerts: [alert], designs,
    guestReminders: [{ eventId: 'e9', eventName: 'Fête', urgent: true, responseCount: 3, purgeDate: '20 novembre', purgeAt: at(4) }],
  };
  const all = buildTodayItems(sources, { now });
  assert.equal(all.length, 5);
  const none = buildTodayItems(sources, { now, isAvailable: () => false });
  assert.deepEqual(none, []);
  const noDesign = buildTodayItems(sources, { now, isAvailable: (id) => id !== 'client_design' });
  assert.equal(noDesign.length, 2);
});

test('badge = nombre de lignes de la liste (même fonction)', () => {
  const sources = {
    alerts: [alert, { ...alert, id: 'a2' }], designs,
    eventsWithoutBorne: [{ id: 'e5', name: 'Salon', start_date: at(2) }],
    moduleItems: [
      { id: 'quote:1', kind: 'quote', label: 'Devis', title: 'Relancer le devis', href: '/admin/ventes?tab=devis&lead=1' },
      { id: 'quote:1', kind: 'quote', label: 'Devis', title: 'Relancer le devis', href: '/admin/ventes?tab=devis&lead=1' },
    ],
  };
  // 2 alertes + 3 lignes de cadres + 1 sans borne + 1 devis (le doublon est retiré).
  assert.equal(buildTodayItems(sources, { now }).length, 7);
});

test('étapes de la mise en route : ajoutées telles quelles, groupe « Cette semaine »', () => {
  const setupItems = [{
    id: 'setup:company', kind: 'setup', label: 'Mise en route', urgency: 'high',
    title: 'Compléter votre entreprise', context: 'Il manque : logo, téléphone',
    date: null, dateLabel: null, href: '/admin/reglages#entreprise', actionLabel: 'Compléter',
    dismissKey: 'setup:company',
  }];
  const items = buildTodayItems({ setupItems }, { now, isAvailable: () => false });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'setup');
  assert.equal(items[0].label, 'Mise en route');
  assert.equal(items[0].dismissKey, 'setup:company');
  assert.equal(todayGroupOf(items[0], now), 'week');
  assert.equal(KIND_LABELS.setup, 'Mise en route');
  assert.equal(buildTodayItems({ setupItems: null }, { now }).length, 0);
});

test('construction ouverte : liste sans module', () => {
  const items = buildTodayItems({ alerts: [alert], designs }, { now });
  assert.ok(items.every((i) => ['alert', 'design', 'home_design'].includes(i.kind)));
});

test('événement sans borne et contacts à exporter', () => {
  const [noBorne] = noBorneItems([{ id: 'e5', name: 'Salon', client_name: 'Expo', start_date: at(2) }]);
  assert.equal(noBorne.urgency, 'high');
  assert.equal(noBorne.href, '/admin/events/e5?tab=jour-j');
  const [guest] = guestExportItems([{ eventId: 'e9', eventName: 'Fête', urgent: false, responseCount: 1, purgeDate: '10 décembre', purgeAt: at(24) }]);
  assert.equal(guest.urgency, 'low');
  assert.equal(guest.href, '/admin/events/e9?tab=livraison');
  assert.equal(guest.context, '1 réponse au questionnaire · Fête');
  assert.equal(todayWhen(guest, now), 'suppression le jeu. 10 décembre 2026');
  assert.equal(noBorne.title, 'Assigner une borne pour Expo');
});

test('dates courtes à l’heure de Paris', () => {
  assert.equal(daysFromNow(at(0), now), 0);
  assert.equal(daysFromNow(at(1), now), 1);
  assert.equal(daysFromNow(null, now), null);
  assert.equal(shortDateLabel(at(0), now), 'Aujourd’hui');
  assert.equal(shortDateLabel(at(1), now), 'Demain');
  assert.equal(shortDateLabel(at(-1), now), 'Hier');
  assert.equal(shortDateLabel('', now), '');
  // 23 h 30 UTC le 16 = 0 h 30 le 17 à Paris : demain.
  assert.equal(shortDateLabel('2026-11-16T23:30:00Z', now), 'Demain');
  assert.equal(timeAgo(at(0, 8), now), 'il y a 1 h');
  assert.equal(timeAgo(at(-2), now), 'il y a 2 j');
});

test('« Cette semaine » : jours de Paris, en cours en tête, au-delà de 7 jours ignoré', () => {
  const entries = [
    ...weekEventEntries([
      { id: 'ongoing', name: 'Salon', start_date: at(-2), end_date: at(1), photobooth_id: 'pb1' },
      { id: 'past', name: 'Fini', start_date: at(-3), end_date: at(-1) },
      { id: 'today', name: 'Mariage', start_date: at(0, 15) },
      { id: 'later', name: 'Trop loin', start_date: at(8) },
    ], (id) => (id === 'pb1' ? 'Borne bleue' : null)),
    { id: 'slot:1', kind: 'retrait', label: 'Retrait', date: at(1, 16), title: 'Léa', href: '/admin/events/x?tab=resume' },
  ];
  const days = weekAgenda(entries, now);
  assert.deepEqual(days.map((d) => d.title), ['En cours', 'Aujourd’hui', 'Demain']);
  assert.equal(days[0].entries[0].context, 'Borne bleue');
  assert.equal(days[1].entries[0].time, '16:00');
  assert.equal(days[1].entries[0].context, 'sans borne');
  assert.equal(days[2].entries[0].label, 'Retrait');
});

test('trois chiffres : « Signé ce mois » avec le module, jamais de montant sans', () => {
  const withModule = todayFigures({
    moduleFigures: [{ id: 'signed', label: 'Signé ce mois', value: '1 200 €' }],
    upcomingEvents: 4, printsThisMonth: 120, month: 'novembre',
  });
  assert.deepEqual(withModule.map((f) => f.label), ['Signé ce mois', 'Événements à venir', 'Impressions en novembre']);
  const open = todayFigures({ upcomingEvents: 4, printsThisMonth: 120, photosThisMonth: 300, month: 'novembre' });
  assert.equal(open.length, 3);
  assert.deepEqual(open.map((f) => f.label), ['Événements à venir', 'Impressions en novembre', 'Photos en novembre']);
  assert.ok(open.every((f) => !String(f.value).includes('€')));
});

test('ofName : élision devant une voyelle, rien sans nom', () => {
  assert.equal(ofName('Léa Martin'), ' de Léa Martin');
  assert.equal(ofName('Anne'), ' d’Anne');
  assert.equal(ofName('  '), '');
  assert.equal(ofName(null), '');
});

test('échéance en clair', () => {
  assert.equal(whenLabel(at(0), now), 'aujourd’hui');
  assert.equal(whenLabel(at(1), now), 'demain');
  assert.equal(whenLabel(at(-1), now), 'hier');
  assert.equal(whenLabel(at(6), now), 'dans 6 jours');
  assert.equal(whenLabel(at(-3), now), 'il y a 3 jours');
  assert.equal(whenLabel(at(30), now), 'le mer. 16 décembre 2026');
  assert.equal(whenLabel(null, now), '');
  assert.equal(todayWhen({ date: at(6) }, now), 'événement dans 6 jours');
  assert.equal(todayWhen({ date: at(-2), dateLabel: 'fin' }, now), 'fin il y a 2 jours');
  assert.equal(todayWhen({ date: at(0), dateLabel: null }, now), '');
  assert.equal(todayWhen({}, now), '');
});

test('clé de masquage par défaut = id', () => {
  assert.equal(normalizeItem({ id: 'a', title: 'X', href: '/x' }).dismissKey, 'a');
  assert.equal(normalizeItem({ id: 'a', dismissKey: 'a:call', title: 'X', href: '/x' }).dismissKey, 'a:call');
});

test('groupes : urgent, cette semaine, plus tard', () => {
  assert.equal(todayGroupOf({ urgency: 'urgent' }, now), 'urgent');
  assert.equal(todayGroupOf({ urgency: 'normal', date: at(3) }, now), 'urgent');
  assert.equal(todayGroupOf({ urgency: 'low', date: at(1) }, now), 'week');
  assert.equal(todayGroupOf({ urgency: 'normal', date: at(5) }, now), 'week');
  assert.equal(todayGroupOf({ urgency: 'high', date: at(40) }, now), 'week');
  assert.equal(todayGroupOf({ urgency: 'high', date: at(-2) }, now), 'week');
  assert.equal(todayGroupOf({ urgency: 'normal', date: at(-2) }, now), 'later');
  assert.equal(todayGroupOf({ urgency: 'normal', date: at(20) }, now), 'later');
  assert.equal(todayGroupOf({ urgency: 'normal' }, now), 'later');
  const groups = groupTodayItems([
    { id: 'a', urgency: 'urgent' }, { id: 'b', urgency: 'normal', date: at(30) }, { id: 'c', urgency: 'high' },
  ], now);
  assert.deepEqual(groups.map((g) => [g.title, g.items.map((i) => i.id)]), [
    ['Urgent', ['a']], ['Cette semaine', ['c']], ['Plus tard', ['b']],
  ]);
  assert.deepEqual(groupTodayItems([], now), []);
});

test('actions masquées et reportées', () => {
  const items = sortTodayItems([
    { id: 'quote:1', dismissKey: 'quote:1:remind', title: 'A', href: '/a' },
    { id: 'design:e1', title: 'B', href: '/b' },
    { id: 'deposit:3', title: 'C', href: '/c' },
    { id: 'balance:4', title: 'D', href: '/d' },
  ]);
  const dismissals = [
    { item_key: 'quote:1:remind', until: null },
    { item_key: 'design:e1', until: snoozeUntil(3, now) },
    { item_key: 'deposit:3', until: at(-1) },
    { item_key: 'quote:1:call', until: null },
  ];
  const { visible, hidden } = splitDismissed(items, dismissals, now);
  assert.deepEqual(visible.map((i) => i.id).sort(), ['balance:4', 'deposit:3']);
  assert.deepEqual(hidden.map((i) => [i.id, i.dismissedUntil]).sort(), [
    ['design:e1', snoozeUntil(3, now)], ['quote:1', null],
  ]);
  const called = sortTodayItems([{ id: 'quote:1', dismissKey: 'quote:1:call', title: 'A', href: '/a' }]);
  assert.equal(splitDismissed(called, [{ item_key: 'quote:1:remind', until: null }], now).visible.length, 1);
  assert.equal(snoozeUntil(7, now), '2026-11-23T09:00:00.000Z');
});
