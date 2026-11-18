import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSetupSteps, isSetupCardHidden, keptFeatureChoices, requiredServiceKeys, setupTodayItems, SETUP_CARD_KEY,
} from './setupSteps.js';
import { buildTodayItems, splitDismissed, todayGroupOf } from './todayItems.js';
import { FEATURES, isFeatureEnabled } from '../features/catalog.js';
import { SERVICE_KEYS, SERVICE_KEY_NAMES } from '../features/serviceKeys.js';
import moduleCatalogs from '../modules/catalog.js';

const ORG = 'org-1';
// Organisation neuve créée par l'installation : sans logo, features = {}.
const freshOrg = {
  id: ORG,
  contact_company: 'Studio Photo',
  contact_email: 'contact@exemple.fr',
  contact_phone: '',
  logo_url: null,
  notify_email: 'alertes@exemple.fr',
  features: {},
};
const completeOrg = { ...freshOrg, contact_phone: '02 00 00 00 00', logo_url: 'https://cdn.exemple.fr/logo.png', features: { booking: false } };
const smtpReady = {
  email: { provider: 'smtp', ready: true, missing: [] },
  keys: Object.fromEntries(SERVICE_KEY_NAMES.map((name) => [name, 'none'])),
};
const allKeys = Object.fromEntries(Object.keys(smtpReady.keys).map((name) => [name, 'env']));
const byId = (result, id) => result.steps.find((s) => s.id === id);
const ids = (result) => result.steps.map((s) => s.id);
const bookingStep = (done) => ({
  id: 'booking', order: 6, feature: 'booking', label: 'Réservation en ligne', help: 'Aide.',
  href: '/admin/reglages#offres', actionLabel: 'Régler', done, essential: false,
});

test('sans organisation : pas de carte', () => {
  assert.equal(buildSetupSteps({}), null);
  assert.equal(buildSetupSteps({ org: null }), null);
  assert.equal(buildSetupSteps(), null);
});

test('organisation neuve, administrateur, sans module : 2 étapes sur 8', () => {
  const result = buildSetupSteps({ org: freshOrg, isAppAdmin: true, serviceStatus: smtpReady });
  assert.deepEqual(ids(result), ['company', 'emails', 'notify', 'features', 'keys', 'template', 'kiosk', 'test_event']);
  assert.deepEqual(result.steps.map((s) => s.n), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(result.done, 2);
  assert.equal(result.total, 8);
  assert.equal(result.complete, false);
  assert.deepEqual(result.steps.filter((s) => s.done).map((s) => s.id), ['emails', 'notify']);
  assert.equal(byId(result, 'company').context, 'Il manque : logo, téléphone');
  assert.match(byId(result, 'company').help, /Il manque : logo, téléphone\.$/);
  assert.equal(byId(result, 'emails').help, 'Les emails partent par votre serveur SMTP.');
  assert.equal(
    byId(result, 'keys').help,
    'À connecter : ID client Google, Secret client Google, Jeton d\'actualisation Google, Jeton API Replicate, Clé API Claude (Anthropic).',
  );
});

test('les étapes ne portent ni order ni feature, mais leur numéro', () => {
  const result = buildSetupSteps({ org: freshOrg, installed: new Set(['booking']), moduleSteps: [bookingStep(false)] });
  for (const step of result.steps) {
    assert.equal('order' in step, false);
    assert.equal('feature' in step, false);
    assert.equal(typeof step.n, 'number');
  }
});

test('étape 1 : nom, email valide, téléphone et logo', () => {
  const step = (org) => byId(buildSetupSteps({ org }), 'company');
  assert.equal(step(completeOrg).done, true);
  assert.equal(step({ ...completeOrg, contact_email: 'pas-un-email' }).done, false);
  assert.equal(step({ ...completeOrg, contact_company: '  ' }).context, 'Il manque : nom');
  assert.equal(step({ ...completeOrg, logo_url: '' }).href, '/admin/reglages#entreprise');
  assert.equal(step({ ...completeOrg, logo_url: '' }).actionLabel, 'Compléter');
});

test('étapes 2, 5 et 7 : seulement pour l\'administrateur de l\'application', () => {
  const owner = buildSetupSteps({ org: freshOrg, isAppAdmin: false, serviceStatus: smtpReady, activeTemplates: 3 });
  assert.deepEqual(ids(owner), ['company', 'notify', 'features', 'kiosk', 'test_event']);
  assert.deepEqual(owner.steps.map((s) => s.n), [1, 2, 3, 4, 5]);
});

test('étape 2 : textes selon le fournisseur et ce qui manque', () => {
  const emails = (email) => byId(buildSetupSteps({ org: freshOrg, isAppAdmin: true, serviceStatus: { email, keys: {} } }), 'emails');
  assert.equal(emails({ provider: 'brevo', ready: true, missing: [] }).help, 'Les emails partent par Brevo.');
  const brevo = emails({ provider: 'brevo', ready: false, missing: ['BREVO_API_KEY'] });
  assert.equal(brevo.done, false);
  assert.equal(brevo.help, 'Saisissez votre clé Brevo ou réglez le SMTP à l’installation.');
  assert.equal(
    emails({ provider: 'smtp', ready: false, missing: ['SMTP_USER', 'SMTP_PASSWORD'] }).help,
    'Réglez le SMTP à l’installation, il manque : SMTP_USER, SMTP_PASSWORD.',
  );
  assert.equal(emails({ provider: 'smtp', ready: false, missing: ['FROM_EMAIL'] }).help, 'Adresse d’expédition absente (FROM_EMAIL).');
  assert.equal(
    emails({ provider: 'brevo', ready: false, missing: ['BREVO_API_KEY', 'FROM_EMAIL'] }).help,
    'Saisissez votre clé Brevo ou réglez le SMTP à l’installation. Adresse d’expédition absente (FROM_EMAIL).',
  );
});

test('statut illisible : étapes 2 et 5 non faites, état inconnu', () => {
  const result = buildSetupSteps({ org: freshOrg, isAppAdmin: true, serviceStatus: null });
  for (const id of ['emails', 'keys']) {
    const step = byId(result, id);
    assert.equal(step.done, false);
    assert.equal(step.unknown, true);
    assert.equal(step.help, 'État inconnu, ouvrez Services connectés.');
  }
  assert.equal(byId(buildSetupSteps({ org: freshOrg, isAppAdmin: true, serviceStatus: smtpReady }), 'emails').unknown, undefined);
});

test('étape 3 : cachée sans « Design par le client », email valide sinon', () => {
  assert.equal(byId(buildSetupSteps({ org: { ...freshOrg, features: { client_design: false } } }), 'notify'), undefined);
  assert.equal(byId(buildSetupSteps({ org: { ...freshOrg, notify_email: 'x@' } }), 'notify').done, false);
  assert.equal(byId(buildSetupSteps({ org: freshOrg }), 'notify').done, true);
});

test('étape 4 : faite dès qu\'un choix est enregistré', () => {
  assert.equal(byId(buildSetupSteps({ org: freshOrg }), 'features').done, false);
  assert.equal(byId(buildSetupSteps({ org: { ...freshOrg, features: null } }), 'features').done, false);
  assert.equal(byId(buildSetupSteps({ org: { ...freshOrg, features: { gallery: true } } }), 'features').done, true);
});

test('étape 5 : clés des fonctionnalités actives et installées seulement', () => {
  const none = { ...freshOrg, features: { google_calendar: false, ai_visuals: false, assistant: false } };
  assert.equal(byId(buildSetupSteps({ org: none, isAppAdmin: true, serviceStatus: smtpReady }), 'keys'), undefined);

  // Facturation : module privé, invisible tant qu'il n'est pas installé (clé du module : src/modules/invoicing/).
  const invoicing = { ...none, features: { ...none.features, booking: true, invoicing: true } };
  assert.deepEqual(requiredServiceKeys(invoicing, new Set()), []);

  const all = byId(buildSetupSteps({ org: freshOrg, isAppAdmin: true, serviceStatus: { ...smtpReady, keys: allKeys } }), 'keys');
  assert.equal(all.done, true);
  assert.equal(all.help, 'Les services de vos fonctionnalités sont connectés.');
});

test('étape 6 : fournie par le module, absente sans lui ou réservation désactivée', () => {
  const withBooking = { ...freshOrg, features: { booking: true } };
  const open = buildSetupSteps({ org: withBooking, installed: new Set(), moduleSteps: [bookingStep(false)] });
  assert.equal(byId(open, 'booking'), undefined);
  const disabled = buildSetupSteps({ org: freshOrg, installed: new Set(['booking']), moduleSteps: [bookingStep(false)] });
  assert.equal(byId(disabled, 'booking'), undefined);

  const result = buildSetupSteps({
    org: withBooking, installed: new Set(['booking']), isAppAdmin: true, serviceStatus: smtpReady, moduleSteps: [bookingStep(false)],
  });
  assert.deepEqual(ids(result), ['company', 'emails', 'notify', 'features', 'keys', 'booking', 'template', 'kiosk', 'test_event']);
  assert.equal(byId(result, 'booking').n, 6);
  assert.equal(byId(result, 'booking').done, false);
});

test('étape d\'un module mal formée ou en double : ignorée', () => {
  const result = buildSetupSteps({
    org: freshOrg,
    moduleSteps: [null, { id: 'x' }, { id: 'company', label: 'Doublon', href: '/x', done: true }, { id: 'extra', label: 'Autre', href: '/y' }],
  });
  assert.equal(byId(result, 'company').label, 'Votre entreprise');
  const extra = byId(result, 'extra');
  assert.equal(extra.n, result.total);
  assert.equal(extra.done, false);
  assert.equal(extra.essential, false);
});

test('étape 7 : au moins un cadre actif avec aperçu', () => {
  const step = (activeTemplates) => byId(buildSetupSteps({ org: freshOrg, isAppAdmin: true, activeTemplates }), 'template');
  assert.equal(step(0).done, false);
  assert.equal(step(1).done, true);
});

test('étape 8 : une borne active de l\'organisation', () => {
  const step = (licenses) => byId(buildSetupSteps({ org: freshOrg, licenses }), 'kiosk');
  assert.equal(step([]).done, false);
  assert.equal(step([{ id: 'l1', org_id: 'autre', retired_at: null }]).done, false);
  assert.equal(step([{ id: 'l1', org_id: ORG, retired_at: '2026-10-01T00:00:00Z' }]).done, false);
  assert.equal(step([{ id: 'l1', org_id: ORG, retired_at: null }]).done, true);
  assert.equal(step([]).href, '/associer');
});

test('étape 9 : envoi affiché par la borne ou photo de borne, lien selon la situation', () => {
  const step = (args) => byId(buildSetupSteps({ org: freshOrg, ...args }), 'test_event');
  const active = { id: 'l2', org_id: ORG, retired_at: null, event_push_applied_at: null };
  assert.equal(step({}).done, false);
  assert.equal(step({}).href, '/admin/events/new');
  assert.equal(step({}).actionLabel, 'Créer un événement');
  assert.equal(step({ eventCount: 2 }).href, '/admin/bornes');
  assert.equal(step({ eventCount: 2, licenses: [active] }).href, '/admin/bornes#envoyer-l2');
  assert.equal(step({ eventCount: 2, licenses: [active] }).actionLabel, 'Envoyer');
  assert.equal(step({ licenses: [{ ...active, event_push_applied_at: '2026-11-15T10:00:00Z' }] }).done, true);
  assert.equal(step({ licenses: [{ ...active, org_id: 'autre', event_push_applied_at: '2026-11-15T10:00:00Z' }] }).done, false);
  assert.equal(step({ kioskPhotos: 1 }).done, true);
});

test('tout est fait : complete', () => {
  const result = buildSetupSteps({
    org: completeOrg,
    isAppAdmin: true,
    serviceStatus: { ...smtpReady, keys: allKeys },
    activeTemplates: 1,
    licenses: [{ id: 'l1', org_id: ORG, retired_at: null, event_push_applied_at: '2026-11-15T10:00:00Z' }],
    eventCount: 1,
  });
  assert.equal(result.complete, true);
  assert.equal(result.done, result.total);
  assert.deepEqual(setupTodayItems(result), []);
});

test('report dans « À faire » : étapes indispensables non faites, état inconnu exclu', () => {
  const result = buildSetupSteps({ org: freshOrg, isAppAdmin: true, serviceStatus: null });
  const items = setupTodayItems(result);
  assert.deepEqual(items.map((i) => i.id), ['setup:company', 'setup:features']);
  assert.deepEqual(items[0], {
    id: 'setup:company', kind: 'setup', label: 'Mise en route', urgency: 'high',
    title: 'Compléter votre entreprise', context: 'Il manque : logo, téléphone',
    date: null, dateLabel: null, href: '/admin/reglages#entreprise', actionLabel: 'Compléter',
    dismissKey: 'setup:company',
  });
  assert.equal(items[1].title, 'Choisir vos fonctionnalités');

  const brevo = { email: { provider: 'brevo', ready: false, missing: ['BREVO_API_KEY'] }, keys: {} };
  const known = setupTodayItems(buildSetupSteps({ org: { ...freshOrg, notify_email: '' }, isAppAdmin: true, serviceStatus: brevo }));
  assert.deepEqual(known.map((i) => i.title), [
    'Compléter votre entreprise', 'Régler l’envoi des emails', 'Renseigner l’email de notification', 'Choisir vos fonctionnalités',
  ]);
  assert.deepEqual(setupTodayItems(null), []);
});

test('clé de masquage de la carte', () => {
  assert.equal(SETUP_CARD_KEY, 'setup:card');
});

// ── Cas aux limites (LAB-346) ────────────────────────────────────────────────

// Organisation tout juste créée, rien de renseigné (installation neuve avant le script d'identité).
const emptyOrg = {
  id: ORG, contact_company: null, contact_email: null, contact_phone: null, logo_url: null, notify_email: null, features: {},
};
const NOW = new Date('2026-11-16T09:00:00Z');

test('organisation vide, statut illisible : 0 étape sur 8, les 3 indispensables connues reportées', () => {
  // Les 4 modèles « Vierge » n'ont pas d'aperçu : fetchSetupInputs les compte 0.
  const result = buildSetupSteps({ org: emptyOrg, isAppAdmin: true, serviceStatus: null, activeTemplates: 0 });
  assert.equal(result.total, 8);
  assert.equal(result.done, 0);
  assert.equal(result.complete, false);
  assert.equal(byId(result, 'company').context, 'Il manque : nom, email, logo, téléphone');
  assert.equal(byId(result, 'notify').done, false);
  assert.deepEqual(setupTodayItems(result).map((i) => i.id), ['setup:company', 'setup:notify', 'setup:features']);
});

test('organisation vide, valeurs bizarres : jamais d’exception, rien de coché', () => {
  const weird = { ...emptyOrg, contact_company: 42, contact_email: ['a@b.fr'], features: 'pas un objet', logo_url: '   ' };
  const result = buildSetupSteps({
    org: weird, licenses: null, moduleSteps: null, activeTemplates: undefined, kioskPhotos: 'x', eventCount: null,
  });
  assert.equal(result.done, 0);
  assert.equal(byId(result, 'features').done, false);
  assert.equal(byId(result, 'test_event').href, '/admin/events/new');
});

test('tout est fait, propriétaire sans droits d’application et module réservation : complete', () => {
  const result = buildSetupSteps({
    org: { ...completeOrg, features: { booking: true } },
    installed: new Set(['booking']),
    isAppAdmin: false,
    serviceStatus: null, // jamais lu pour un propriétaire : n'empêche pas la fin
    licenses: [{ id: 'l1', org_id: ORG, retired_at: null, event_push_applied_at: null }],
    kioskPhotos: 1,
    eventCount: 1,
    moduleSteps: [bookingStep(true)],
  });
  assert.deepEqual(ids(result), ['company', 'notify', 'features', 'booking', 'kiosk', 'test_event']);
  assert.equal(result.complete, true);
  assert.deepEqual(setupTodayItems(result), []);
});

test('une étape qui se défait (borne retirée) rouvre la mise en route', () => {
  const base = { org: completeOrg, kioskPhotos: 1, eventCount: 1, licenses: [{ id: 'l1', org_id: ORG, retired_at: null }] };
  assert.equal(buildSetupSteps(base).complete, true);
  const retired = buildSetupSteps({ ...base, licenses: [{ id: 'l1', org_id: ORG, retired_at: '2026-11-16T08:00:00Z' }] });
  assert.equal(retired.complete, false);
  assert.equal(byId(retired, 'kiosk').done, false);
});

test('fonctionnalités toutes coupées : ni notification, ni services ; étape 4 faite', () => {
  const off = Object.fromEntries(FEATURES.filter((f) => !f.core).map((f) => [f.id, false]));
  const result = buildSetupSteps({ org: { ...freshOrg, features: off }, isAppAdmin: true, serviceStatus: smtpReady });
  assert.deepEqual(ids(result), ['company', 'emails', 'features', 'template', 'kiosk', 'test_event']);
  assert.equal(byId(result, 'features').done, true);
  assert.deepEqual(requiredServiceKeys({ features: off }, new Set(['booking', 'invoicing'])), []);
});

test('dépendance coupée : la fonctionnalité qui en dépend ne demande pas de clé', () => {
  // Facturation dépend de la réservation : réservation coupée, pas de logiciel de facturation à connecter.
  const features = { booking: false, invoicing: true, google_calendar: false, ai_visuals: false, assistant: false };
  const installed = new Set(['booking', 'invoicing']);
  assert.equal(isFeatureEnabled(features, 'invoicing'), false);
  assert.deepEqual(requiredServiceKeys({ features }, installed), []);
});

test('construction ouverte : sans module, aucune étape réservation ni clé d’un module', () => {
  const org = { ...freshOrg, features: { booking: true, invoicing: true } };
  const result = buildSetupSteps({ org, installed: new Set(), isAppAdmin: true, serviceStatus: smtpReady, moduleSteps: [] });
  assert.equal(byId(result, 'booking'), undefined);
  assert.equal(result.total, 8);
  const moduleKeys = moduleCatalogs.flatMap((m) => m.serviceKeys ?? []);
  for (const key of moduleKeys) {
    assert.ok(!byId(result, 'keys').help.includes(key.label), key.name);
    assert.ok(!requiredServiceKeys(org, new Set()).includes(key.name), key.name);
  }
  assert.ok(SERVICE_KEYS.length > moduleKeys.length);
});

test('compte qui n’est pas administrateur de l’application : ni 2, ni 5, ni 7, même avec un statut', () => {
  const org = { ...freshOrg, features: { booking: true, invoicing: true } };
  const brevoKo = { email: { provider: 'brevo', ready: false, missing: ['BREVO_API_KEY'] }, keys: smtpReady.keys };
  const result = buildSetupSteps({
    org, installed: new Set(['booking', 'invoicing']), isAppAdmin: false, serviceStatus: brevoKo, activeTemplates: 0,
  });
  for (const id of ['emails', 'keys', 'template']) assert.equal(byId(result, id), undefined, id);
  assert.ok(setupTodayItems(result).every((i) => i.id !== 'setup:emails'));
  assert.deepEqual(result.steps.map((s) => s.n), result.steps.map((_, i) => i + 1));
});

test('statut à moitié lisible : sans email ou sans clés, l’étape concernée est inconnue', () => {
  const noKeys = buildSetupSteps({ org: freshOrg, isAppAdmin: true, serviceStatus: { email: smtpReady.email } });
  assert.equal(byId(noKeys, 'emails').done, true);
  assert.equal(byId(noKeys, 'keys').unknown, true);
  const noEmail = buildSetupSteps({ org: freshOrg, isAppAdmin: true, serviceStatus: { keys: allKeys } });
  assert.equal(byId(noEmail, 'emails').unknown, true);
  assert.equal(byId(noEmail, 'keys').done, true);
  assert.ok(setupTodayItems(noEmail).every((i) => i.id !== 'setup:emails'));
});

test('statut sans une clé attendue : comptée comme absente', () => {
  const partial = { ...smtpReady, keys: { REPLICATE_API_TOKEN: 'vault' } };
  const org = { ...freshOrg, features: { google_calendar: false, assistant: false } };
  assert.equal(byId(buildSetupSteps({ org, isAppAdmin: true, serviceStatus: partial }), 'keys').done, true);
  const missing = byId(buildSetupSteps({ org: freshOrg, isAppAdmin: true, serviceStatus: partial }), 'keys');
  assert.equal(missing.done, false);
  assert.doesNotMatch(missing.help, /Replicate/);
});

test('carte masquée : isSetupCardHidden selon la ligne setup:card', () => {
  const now = NOW.getTime();
  assert.equal(isSetupCardHidden([], now), false);
  assert.equal(isSetupCardHidden(null, now), false);
  assert.equal(isSetupCardHidden([{ item_key: 'setup:company', until: null }], now), false);
  assert.equal(isSetupCardHidden([{ item_key: SETUP_CARD_KEY, until: null }], now), true);
  assert.equal(isSetupCardHidden([{ item_key: SETUP_CARD_KEY, until: '2026-11-20T00:00:00Z' }], now), true);
  assert.equal(isSetupCardHidden([{ item_key: SETUP_CARD_KEY, until: '2026-11-10T00:00:00Z' }], now), false);
  assert.equal(isSetupCardHidden([{ item_key: SETUP_CARD_KEY, until: 'pas une date' }], now), false);
});

test('carte masquée : les indispensables passent dans « Cette semaine » et se masquent une par une', () => {
  const result = buildSetupSteps({ org: { ...freshOrg, notify_email: '' }, isAppAdmin: true, serviceStatus: smtpReady });
  const items = buildTodayItems({ setupItems: setupTodayItems(result) }, { now: NOW });
  assert.deepEqual(items.map((i) => i.id).sort(), ['setup:company', 'setup:features', 'setup:notify']);
  for (const item of items) {
    assert.equal(todayGroupOf(item, NOW), 'week');
    assert.equal(item.dismissKey, item.id);
    assert.ok(item.dismissKey.length >= 1 && item.dismissKey.length <= 200, 'clé acceptée par set_today_dismissal');
  }

  // « Ne plus afficher » sur une ligne : seule celle-ci disparaît ; la ligne setup:card ne cache aucune ligne.
  const dismissals = [{ item_key: SETUP_CARD_KEY, until: null }, { item_key: 'setup:notify', until: null }];
  const { visible, hidden } = splitDismissed(items, dismissals, NOW);
  assert.deepEqual(visible.map((i) => i.id).sort(), ['setup:company', 'setup:features']);
  assert.deepEqual(hidden.map((i) => i.id), ['setup:notify']);

  // « Me le rappeler dans 3 jours » : la ligne revient après la date.
  const snoozed = [{ item_key: 'setup:company', until: '2026-11-19T09:00:00Z' }];
  assert.equal(splitDismissed(items, snoozed, NOW).visible.length, 2);
  assert.equal(splitDismissed(items, snoozed, new Date('2026-11-20T00:00:00Z')).visible.length, 3);
});

test('étape faite : sort de « À faire » d’elle-même', () => {
  const before = setupTodayItems(buildSetupSteps({ org: freshOrg }));
  assert.ok(before.some((i) => i.id === 'setup:features'));
  const after = setupTodayItems(buildSetupSteps({ org: { ...freshOrg, features: keptFeatureChoices({}) } }));
  assert.ok(!after.some((i) => i.id === 'setup:features'));
});

test('« Garder ces choix » : toutes les fonctionnalités hors socle, sans rien changer à l’écran', () => {
  const kept = keptFeatureChoices({});
  assert.deepEqual(Object.keys(kept).sort(), FEATURES.filter((f) => !f.core).map((f) => f.id).sort());
  for (const f of FEATURES) assert.equal(isFeatureEnabled(kept, f.id), isFeatureEnabled({}, f.id), f.id);
  assert.ok(Object.values(kept).every((v) => typeof v === 'boolean'));
  assert.ok(!('core' in kept) && !('templates' in kept), 'socle jamais enregistré');

  // Mêmes étapes (sauf la 4, cochée) avant et après l'enregistrement.
  const args = { isAppAdmin: true, serviceStatus: smtpReady, installed: new Set(['booking', 'invoicing']) };
  const before = buildSetupSteps({ org: freshOrg, ...args });
  const after = buildSetupSteps({ org: { ...freshOrg, features: kept }, ...args });
  assert.deepEqual(ids(after), ids(before));
  assert.equal(byId(after, 'features').done, true);
  assert.equal(byId(after, 'keys').help, byId(before, 'keys').help);
  assert.equal(after.done, before.done + 1);
});

test('« Garder ces choix » après un réglage partiel : garde l’état effectif', () => {
  const kept = keptFeatureChoices({ gallery: false });
  assert.equal(kept.gallery, false);
  assert.equal(kept.delivery_email, false, 'dépend de la galerie');
  for (const f of FEATURES.filter((x) => !x.core)) assert.equal(kept[f.id], isFeatureEnabled({ gallery: false }, f.id), f.id);
});
