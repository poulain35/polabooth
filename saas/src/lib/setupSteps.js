// Mise en route de l'admin (LAB-344, spec docs/specs/mise-en-route.md). Module pur, testé dans
// setupSteps.test.js : étapes de la carte « Mise en route » de la page Aujourd'hui, cochées d'après
// les vraies données (jamais à la main), et leur report dans « À faire » quand la carte est masquée.
//
// Étape : { id, n, label, help, context, href, actionLabel, done, essential, todoTitle, unknown? }
// `help` : une ligne sous le libellé ; `context` : deuxième ligne de la ligne « À faire » ; `unknown` :
// état des services illisible (étapes 2 et 5), jamais reporté. Les modules ajoutent leurs étapes par le
// crochet `setup.steps` ({ id, order, feature, label, help, href, actionLabel, done, essential }).

import { isFeatureEnabled, FEATURES } from '../features/catalog.js';
import { featureInstalled } from '../features/featureGate.js';
import { getServiceKey } from '../features/serviceKeys.js';

/** Clé de today_dismissals qui masque la carte (pour l'organisation). */
export const SETUP_CARD_KEY = 'setup:card';

/**
 * Vrai si la carte est masquée : ligne `setup:card` de today_dismissals sans date (« Masquer », « Fermer »)
 * ou reportée à une date encore à venir. `dismissals` : lignes { item_key, until } (fetchTodayDismissals).
 */
export function isSetupCardHidden(dismissals, now = Date.now()) {
  const d = (dismissals ?? []).find((x) => x?.item_key === SETUP_CARD_KEY);
  if (!d) return false;
  if (d.until == null) return true;
  const until = new Date(d.until).getTime();
  return Number.isFinite(until) && until > now;
}

/**
 * « Garder ces choix » (Fonctionnalités, compte neuf) : l'état effectif de chaque fonctionnalité hors
 * socle, à enregistrer tel quel. Rien ne change à l'écran ; l'étape « Vos fonctionnalités » se coche.
 */
export function keptFeatureChoices(features) {
  return Object.fromEntries(FEATURES.filter((f) => !f.core).map((f) => [f.id, isFeatureEnabled(features, f.id)]));
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const filled = (v) => typeof v === 'string' && v.trim() !== '';
const isEmail = (v) => filled(v) && EMAIL_RE.test(v.trim());
const UNKNOWN_HELP = 'État inconnu, ouvrez Services connectés.';
const SERVICES_HREF = '/admin/reglages#services';
const COMPANY_HREF = '/admin/reglages#entreprise';

const available = (org, installed, id) => isFeatureEnabled(org.features, id) && featureInstalled(id, installed);

function companyStep(org) {
  const missing = [
    filled(org.contact_company) ? null : 'nom',
    isEmail(org.contact_email) ? null : 'email',
    filled(org.logo_url) ? null : 'logo',
    filled(org.contact_phone) ? null : 'téléphone',
  ].filter(Boolean);
  const context = missing.length ? `Il manque : ${missing.join(', ')}` : '';
  return {
    id: 'company',
    order: 1,
    label: 'Votre entreprise',
    help: `Nom, email, téléphone et logo, repris sur la borne et dans les emails.${context ? ` ${context}.` : ''}`,
    context: context || 'Nom, email, téléphone et logo, repris sur la borne et dans les emails',
    href: COMPANY_HREF,
    actionLabel: 'Compléter',
    done: missing.length === 0,
    essential: true,
    todoTitle: 'Compléter votre entreprise',
  };
}

function emailHelp(email) {
  if (email.ready) {
    return email.provider === 'smtp' ? 'Les emails partent par votre serveur SMTP.' : 'Les emails partent par Brevo.';
  }
  const missing = email.missing ?? [];
  const transport = missing.filter((name) => name !== 'FROM_EMAIL');
  const parts = [];
  if (email.provider === 'smtp' && transport.length) {
    parts.push(`Réglez le SMTP à l’installation, il manque : ${transport.join(', ')}.`);
  } else if (transport.length) {
    parts.push('Saisissez votre clé Brevo ou réglez le SMTP à l’installation.');
  }
  if (missing.includes('FROM_EMAIL')) parts.push('Adresse d’expédition absente (FROM_EMAIL).');
  return parts.join(' ') || UNKNOWN_HELP;
}

function emailsStep(serviceStatus) {
  const email = serviceStatus?.email;
  const unknown = !email;
  const help = unknown ? UNKNOWN_HELP : emailHelp(email);
  return {
    id: 'emails',
    order: 2,
    label: 'Envoi des emails',
    help,
    context: help.replace(/\.$/, ''),
    href: SERVICES_HREF,
    actionLabel: 'Configurer',
    done: email?.ready === true,
    essential: true,
    todoTitle: 'Régler l’envoi des emails',
    ...(unknown ? { unknown: true } : {}),
  };
}

function notifyStep(org) {
  const help = 'Reçoit les cadres photo à valider et les alertes de vos bornes.';
  return {
    id: 'notify',
    order: 3,
    label: 'Email de notification',
    help,
    context: help.replace(/\.$/, ''),
    href: COMPANY_HREF,
    actionLabel: 'Renseigner',
    done: isEmail(org.notify_email),
    essential: true,
    todoTitle: 'Renseigner l’email de notification',
  };
}

function featuresStep(org) {
  const help = 'Choisissez ce que vous proposez : la suite de la liste s’adapte.';
  const features = org.features && typeof org.features === 'object' ? org.features : {};
  return {
    id: 'features',
    order: 4,
    label: 'Vos fonctionnalités',
    help,
    context: help.replace(/\.$/, ''),
    href: '/admin/reglages#fonctionnalites',
    actionLabel: 'Choisir',
    done: Object.keys(features).length > 0,
    essential: true,
    todoTitle: 'Choisir vos fonctionnalités',
  };
}

/** Clés requises par les fonctionnalités actives et installées, dans l'ordre du catalogue, sans doublon. */
export function requiredServiceKeys(org, installed) {
  const names = FEATURES
    .filter((f) => f.requiredKeys.length && available(org, installed, f.id))
    .flatMap((f) => f.requiredKeys);
  return [...new Set(names)];
}

function keysStep(org, installed, serviceStatus) {
  const required = requiredServiceKeys(org, installed);
  if (!required.length) return null;
  const keys = serviceStatus?.keys;
  const unknown = !keys;
  const missing = unknown ? required : required.filter((name) => (keys[name] ?? 'none') === 'none');
  const help = unknown
    ? UNKNOWN_HELP
    : missing.length
      ? `À connecter : ${missing.map((name) => getServiceKey(name)?.label ?? name).join(', ')}.`
      : 'Les services de vos fonctionnalités sont connectés.';
  return {
    id: 'keys',
    order: 5,
    label: 'Services connectés',
    help,
    context: help.replace(/\.$/, ''),
    href: SERVICES_HREF,
    actionLabel: 'Connecter',
    done: !unknown && missing.length === 0,
    essential: false,
    todoTitle: 'Connecter vos services',
    ...(unknown ? { unknown: true } : {}),
  };
}

function templateStep(activeTemplates) {
  const help = 'Créez au moins un cadre photo dans la Bibliothèque : vos clients partent de vos cadres.';
  return {
    id: 'template',
    order: 7,
    label: 'Un cadre photo',
    help,
    context: help.replace(/\.$/, ''),
    href: '/admin/templates',
    actionLabel: 'Créer un cadre',
    done: Number(activeTemplates) > 0,
    essential: false,
    todoTitle: 'Créer un cadre photo',
  };
}

function kioskStep(orgLicenses) {
  const help = 'Installez le logiciel sur le PC de la borne, puis saisissez le code qu’elle affiche.';
  return {
    id: 'kiosk',
    order: 8,
    label: 'Associer une borne',
    help,
    context: help.replace(/\.$/, ''),
    href: '/associer',
    actionLabel: 'Associer',
    done: orgLicenses.some((l) => !l.retired_at),
    essential: false,
    todoTitle: 'Associer une borne',
  };
}

function testEventStep(orgLicenses, kioskPhotos, eventCount) {
  const help = 'Envoyez un événement sur la borne et vérifiez qu’il s’affiche.';
  const firstActive = orgLicenses.find((l) => !l.retired_at);
  const noEvent = !(Number(eventCount) > 0);
  let href = '/admin/bornes';
  if (noEvent) href = '/admin/events/new';
  else if (firstActive?.id) href = `/admin/bornes#envoyer-${firstActive.id}`;
  return {
    id: 'test_event',
    order: 9,
    label: 'Événement d’essai',
    help,
    context: help.replace(/\.$/, ''),
    href,
    actionLabel: noEvent ? 'Créer un événement' : 'Envoyer',
    done: orgLicenses.some((l) => l.event_push_applied_at) || Number(kioskPhotos) > 0,
    essential: false,
    todoTitle: 'Faire un événement d’essai',
  };
}

/** Étape fournie par un module, complétée ; null si sa fonctionnalité n'est pas disponible ou si elle est mal formée. */
function moduleStep(step, org, installed) {
  if (!step?.id || !step.label || !step.href) return null;
  if (step.feature && !available(org, installed, step.feature)) return null;
  const help = step.help ?? '';
  return {
    order: 100,
    actionLabel: 'Ouvrir',
    essential: false,
    context: help.replace(/\.$/, ''),
    todoTitle: step.label,
    ...step,
    help,
    done: step.done === true,
  };
}

/**
 * Étapes de la mise en route, numérotées dans l'ordre (`n`), avec `done` (étapes faites), `total` et
 * `complete`. null sans organisation à soi (pas de carte). Voir la spec pour les entrées.
 */
export function buildSetupSteps({
  org,
  installed = new Set(),
  isAppAdmin = false,
  serviceStatus = null,
  activeTemplates = 0,
  licenses = [],
  kioskPhotos = 0,
  eventCount = 0,
  moduleSteps = [],
} = {}) {
  if (!org?.id) return null;
  const orgLicenses = (licenses ?? []).filter((l) => l && l.org_id === org.id);
  const candidates = [
    companyStep(org),
    isAppAdmin ? emailsStep(serviceStatus) : null,
    available(org, installed, 'client_design') ? notifyStep(org) : null,
    featuresStep(org),
    isAppAdmin ? keysStep(org, installed, serviceStatus) : null,
    isAppAdmin ? templateStep(activeTemplates) : null,
    kioskStep(orgLicenses),
    testEventStep(orgLicenses, kioskPhotos, eventCount),
    ...(moduleSteps ?? []).map((step) => moduleStep(step, org, installed)),
  ].filter(Boolean);
  const seen = new Set();
  const steps = candidates
    .filter((step) => !seen.has(step.id) && seen.add(step.id))
    .map((step, i) => ({ step, i }))
    .sort((a, b) => (a.step.order - b.step.order) || (a.i - b.i))
    .map(({ step }, i) => {
      const { order: _order, feature: _feature, ...rest } = step;
      return { ...rest, n: i + 1 };
    });
  const done = steps.filter((s) => s.done).length;
  return { steps, done, total: steps.length, complete: done === steps.length };
}

/**
 * Lignes « À faire » des étapes indispensables non faites (à n'ajouter que si la carte est masquée).
 * Une étape dont l'état est inconnu (services illisibles) n'est jamais reportée.
 */
export function setupTodayItems(result) {
  return (result?.steps ?? [])
    .filter((step) => step.essential && !step.done && !step.unknown)
    .map((step) => ({
      id: `setup:${step.id}`,
      kind: 'setup',
      label: 'Mise en route',
      urgency: 'high',
      title: step.todoTitle,
      context: step.context,
      date: null,
      dateLabel: null,
      href: step.href,
      actionLabel: step.actionLabel,
      dismissKey: `setup:${step.id}`,
    }));
}
