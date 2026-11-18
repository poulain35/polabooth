// Recherche Ctrl+K de l'admin (LAB-339) : normalisation sans accents, score, regroupement, ordre,
// pages et actions proposées, filtre de recherche des requêtes. Logique pure, testée dans
// commandSearch.test.js. Le composant est components/CommandPalette.jsx.
//
// Un résultat : { id, group, groupLabel?, title, subtitle?, keywords?, badge?, code?, href?, action?,
// external?, suggested?, remote? }.
//   group     : identifiant du groupe (COMMAND_GROUPS, ou un groupe fourni par un module) ;
//   code      : code d'accès d'un événement ; égal au texte cherché, le résultat passe en premier ;
//   href      : adresse ouverte ; action : identifiant passé au composant (ex. 'create:devis') ;
//   suggested : proposé quand rien n'est encore tapé ;
//   remote    : trouvé par une requête, gardé même si le texte ne contient pas les mots cherchés.

import { navItemAvailable } from '../features/featureGate.js';
import { BORNES_TABS, EVENT_TABS, SETTINGS_SECTIONS } from '../features/adminRoutes.js';
import { EVENT_STAGES } from './eventStages.js';
import { formatShortDate, PARIS_TIME_ZONE } from './dates.js';

/** Groupes du code ouvert, dans l'ordre par défaut. Les groupes des modules se placent avant « Bornes ». */
const COMMAND_GROUPS = [
  { id: 'events', label: 'Événements' },
  { id: 'clients', label: 'Clients' },
  { id: 'bornes', label: 'Bornes' },
  { id: 'actions', label: 'Actions' },
  { id: 'pages', label: 'Pages' },
];

/** Délai avant les requêtes (ms) et longueur minimale du texte cherché. */
export const SEARCH_DELAY_MS = 200;
export const MIN_REMOTE_LENGTH = 2;

/** Texte en minuscules, sans accents ni espaces superflus (« Élodie  Durand » → « elodie durand »). */
export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Six lettres ou chiffres, sans espace : peut-être un code d'accès d'événement. */
export function isAccessCodeQuery(query) {
  return /^[a-z0-9]{6}$/i.test(String(query ?? '').trim());
}

/** Code d'accès tel qu'il est enregistré (majuscules), ou null. */
export function accessCodeOf(query) {
  return isAccessCodeQuery(query) ? String(query).trim().toUpperCase() : null;
}

/**
 * Score d'un texte pour la recherche `query` (tous deux non normalisés) : 100 identique, 80 début du
 * texte, 60 début d'un mot, 40 contenu, 30 chaque mot cherché commence un mot du texte, 20 chaque mot
 * cherché est contenu, sinon 0.
 */
export function textScore(query, text) {
  const q = normalizeText(query);
  const t = normalizeText(text);
  if (!q || !t) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  const words = t.split(/[\s\-/·.,()@]+/).filter(Boolean);
  if (words.some((w) => w.startsWith(q))) return 60;
  if (t.includes(q)) return 40;
  const tokens = q.split(' ');
  if (tokens.length < 2) return 0;
  if (tokens.every((tok) => words.some((w) => w.startsWith(tok)))) return 30;
  if (tokens.every((tok) => t.includes(tok))) return 20;
  return 0;
}

/** Score d'un résultat : titre plein, mots-clés à 90 %, sous-titre à 70 %. Code d'accès exact : 1000. */
export function itemScore(query, item) {
  const code = accessCodeOf(query);
  if (code && item.code && String(item.code).toUpperCase() === code) return 1000;
  const scores = [
    textScore(query, item.title),
    ...(item.keywords ?? []).map((k) => Math.round(textScore(query, k) * 0.9)),
    Math.round(textScore(query, item.subtitle) * 0.7),
  ];
  const best = Math.max(0, ...scores);
  return item.remote ? Math.max(best, 1) : best;
}

/** Garde le premier résultat de chaque identifiant (les résultats épinglés passent devant). */
export function mergeResults(items) {
  const seen = new Map();
  for (const item of items) {
    if (!item?.id) continue;
    const prev = seen.get(item.id);
    if (!prev || (item.code && !prev.code)) seen.set(item.id, prev ? { ...prev, ...item } : item);
  }
  return [...seen.values()];
}

function groupRank(id) {
  const i = COMMAND_GROUPS.findIndex((g) => g.id === id);
  // Groupes des modules (devis, prospects…) : après Clients, avant Bornes.
  return i === -1 ? 1.5 : i;
}

/**
 * Résultats classés et regroupés : [{ id, label, items }].
 * Texte vide : résultats `suggested`, dans l'ordre donné. Sinon : score > 0 seulement, triés par score
 * (ordre d'origine à égalité), `perGroup` au plus par groupe (`pagesPerGroup` pour Pages) ; les groupes
 * suivent leur meilleur score, puis l'ordre de COMMAND_GROUPS. Un code d'accès exact passe en premier.
 */
export function rankCommands(query, items, { perGroup = 5, pagesPerGroup = 6 } = {}) {
  const empty = !normalizeText(query);
  const scored = items
    .map((item, order) => ({ item, order, score: empty ? (item.suggested ? 1 : 0) : itemScore(query, item) }))
    .filter((entry) => entry.score > 0);

  const groups = new Map();
  for (const entry of scored) {
    const id = entry.item.group ?? 'pages';
    if (!groups.has(id)) {
      const known = COMMAND_GROUPS.find((g) => g.id === id);
      groups.set(id, { id, label: entry.item.groupLabel ?? known?.label ?? id, entries: [] });
    }
    groups.get(id).entries.push(entry);
  }

  return [...groups.values()]
    .map((group) => {
      const entries = group.entries.sort((a, b) => (empty ? 0 : b.score - a.score) || a.order - b.order);
      const max = group.id === 'pages' ? pagesPerGroup : perGroup;
      return { ...group, best: entries[0].score, entries: empty ? entries : entries.slice(0, max) };
    })
    .sort((a, b) => (empty ? 0 : b.best - a.best) || groupRank(a.id) - groupRank(b.id))
    .map(({ id, label, entries }) => ({ id, label, items: entries.map((entry) => entry.item) }));
}

/** Liste à plat des résultats affichés, dans l'ordre du clavier. */
export function flattenGroups(groups) {
  return groups.flatMap((group) => group.items);
}

/** Index suivant au clavier (flèches), en boucle ; -1 si la liste est vide. */
export function moveActive(index, delta, length) {
  if (!length) return -1;
  if (index < 0) return delta > 0 ? 0 : length - 1;
  return (index + delta + length) % length;
}

// ── Requêtes ──────────────────────────────────────────────────────────────────

/**
 * Mot cherché en base, sans caractère qui pourrait élargir le filtre PostgREST (virgule, parenthèse,
 * guillemet, joker…). Plusieurs mots : le plus long, les autres départagent les résultats au score.
 */
export function searchTerm(query) {
  const tokens = String(query ?? '')
    .replace(/[^\p{L}\p{N}@.\-+' ]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return '';
  const term = tokens.length === 1 ? tokens[0] : tokens.reduce((a, b) => (b.length > a.length ? b : a));
  return term.length >= MIN_REMOTE_LENGTH ? term : '';
}

/** Filtre `or` PostgREST « une des colonnes contient le mot », ou null si le texte ne suffit pas. */
export function ilikeAny(columns, query) {
  const term = searchTerm(query);
  if (!term || !columns.length) return null;
  return columns.map((col) => `${col}.ilike."%${term}%"`).join(',');
}

// ── Résultats des requêtes du code ouvert ─────────────────────────────────────

/** Événement (search_events ou recherche par code) → résultat. */
export function eventCommand(ev) {
  return {
    id: `event:${ev.id}`,
    group: 'events',
    title: ev.name || 'Sans nom',
    subtitle: [ev.client_name, formatShortDate(ev.start_date, { timeZone: PARIS_TIME_ZONE })].filter(Boolean).join(' · ') || null,
    keywords: [ev.client_name, ev.access_code].filter(Boolean),
    badge: ev.access_code || null,
    code: ev.access_code || null,
    href: `/admin/events/${ev.id}`,
    remote: true,
  };
}

/**
 * Événements → clients (un par nom, ou par email sans nom), ceux dont le nom ou l'email contient le
 * texte. Le client ouvre son événement le plus récent.
 */
export function clientCommands(events, query) {
  const byClient = new Map();
  for (const ev of events ?? []) {
    const name = String(ev.client_name ?? '').trim();
    const email = String(ev.client_email ?? '').trim();
    if (!name && !email) continue;
    if (!textScore(query, name) && !textScore(query, email)) continue;
    const key = normalizeText(name || email);
    const entry = byClient.get(key) ?? { name, email, events: [] };
    if (!entry.email && email) entry.email = email;
    entry.events.push(ev);
    byClient.set(key, entry);
  }
  const time = (ev) => (ev.start_date ? new Date(ev.start_date).getTime() : 0);
  return [...byClient.entries()].map(([key, client]) => {
    const latest = [...client.events].sort((a, b) => time(b) - time(a))[0];
    const count = client.events.length;
    return {
      id: `client:${key}`,
      group: 'clients',
      title: client.name || client.email,
      subtitle: [client.name ? client.email : null, `${count} événement${count > 1 ? 's' : ''}`, latest.name]
        .filter(Boolean).join(' · '),
      keywords: [client.email].filter(Boolean),
      href: `/admin/events/${latest.id}`,
      remote: true,
    };
  });
}

/** Borne (kiosk_licenses) → résultat, vers sa carte dans Bornes > État. */
export function licenseCommand(lic) {
  const title = lic.label || lic.machine_name || lic.machine_id;
  return {
    id: `borne:${lic.id}`,
    group: 'bornes',
    title,
    subtitle: [lic.machine_name && lic.machine_name !== title ? lic.machine_name : null, lic.machine_id !== title ? lic.machine_id : null]
      .filter(Boolean).join(' · ') || null,
    keywords: [lic.machine_id, lic.machine_name].filter(Boolean),
    href: `/admin/bornes?tab=etat#envoyer-${lic.id}`,
    remote: true,
  };
}

// ── Pages et actions ──────────────────────────────────────────────────────────

const BORNES_TAB_DEFS = {
  etat: { label: 'État des bornes', keywords: ['licences', 'en ligne', 'association'] },
  materiel: { label: 'Matériel', keywords: ['stock', 'parc', 'matériel', 'disponible', 'indisponible', 'réparation', 'vidéobooth', 'livre d’or audio'] },
  ecrans: { label: 'Écrans de la borne', keywords: ['accueil par défaut', 'écran de partage'] },
  alertes: { label: 'Alertes des bornes', keywords: ['imprimante', 'papier'], feature: 'kiosk_alerts' },
  code: { label: 'Écran du code', keywords: ['saisie du code'], appAdminOnly: true },
  versions: { label: 'Versions de la borne', keywords: ['mise à jour'] },
};

const EVENT_TAB_DEFS = {
  resume: { label: 'Résumé' },
  creation: { label: 'Création du client', keywords: ['cadres', 'cadre photo', 'validation'] },
  borne: { label: 'Réglages de la borne', keywords: ['prise de vue', 'impression', 'partage'] },
  'jour-j': { label: 'Jour J', keywords: ['impressions', 'journal', '.pola'] },
  livraison: { label: 'Photos et livraison', keywords: ['galerie', 'photos', 'livre d’or', 'questionnaire'] },
};

const BORNE_SECTIONS = [
  { id: 'accueil', label: 'Écran d’accueil' },
  { id: 'capture', label: 'Prise de vue' },
  { id: 'effets', label: 'Effets photo' },
  { id: 'questionnaire', label: 'Questionnaire et RGPD' },
  { id: 'impression', label: 'Impression' },
  { id: 'partage', label: 'Écran de partage' },
];

const SETTINGS_KEYWORDS = {
  entreprise: ['logo', 'contact', 'mot de passe', 'nom'],
  offres: ['catalogue', 'acompte', 'retrait', 'retour'],
  emails: ['relances', 'emails envoyés'],
  editeur: ['formulaire', 'zones perdues'],
  galerie: ['bilan client', 'bandeau'],
  fonctionnalites: ['modules', 'activer'],
  services: ['clés', 'api'],
};

const page = (id, title, href, extra = {}) => ({ id: `page:${id}`, group: 'pages', title, href, ...extra });

/**
 * Pages et actions proposées, filtrées comme le menu et les onglets.
 * ctx : {
 *   isAvailable(feature), isAppAdmin,
 *   salesTabs : [{ id, label }] onglets de « Demandes et devis » fournis par les modules,
 *   createActions : [{ id, label }] créations fournies par les modules (ex. « Nouveau devis »),
 *   hiddenSettings : sections des Réglages cachées (ex. ['offres']),
 *   event : { id, name, tabs: ['resume', …] } fiche ouverte, ou null.
 * }
 */
export function buildPageCommands(ctx = {}) {
  const isAvailable = ctx.isAvailable ?? (() => true);
  const navOk = (to) => navItemAvailable(to, isAvailable);
  const salesTabs = ctx.salesTabs ?? [];
  const items = [];

  // Actions
  for (const action of ctx.createActions ?? []) {
    items.push({ id: `create:${action.id}`, group: 'actions', title: action.label, action: `create:${action.id}`, keywords: ['créer', 'ajouter'], suggested: true });
  }
  items.push({ id: 'action:new-event', group: 'actions', title: 'Nouvel événement', href: '/admin/events/new', keywords: ['créer', 'ajouter'], suggested: true });

  // Fiche ouverte : ses onglets et les sections des réglages de la borne.
  if (ctx.event?.id) {
    const base = `/admin/events/${ctx.event.id}`;
    const subtitle = ctx.event.name || 'Cet événement';
    for (const tab of (ctx.event.tabs ?? EVENT_TABS).filter((id) => EVENT_TAB_DEFS[id])) {
      const def = EVENT_TAB_DEFS[tab];
      items.push({ id: `event-tab:${tab}`, group: 'pages', title: def.label, subtitle, keywords: def.keywords, href: `${base}?tab=${tab}`, suggested: true });
    }
    if ((ctx.event.tabs ?? EVENT_TABS).includes('borne')) {
      for (const section of BORNE_SECTIONS) {
        const label = section.id === 'questionnaire' && !isAvailable('guest_form') ? 'Consentement RGPD' : section.label;
        items.push({ id: `event-borne:${section.id}`, group: 'pages', title: label, subtitle: `Réglages de la borne · ${subtitle}`, href: `${base}?tab=borne#${section.id}` });
      }
    }
  }

  // Menu
  if (navOk('aujourdhui')) items.push(page('aujourdhui', 'Aujourd’hui', '/admin/aujourdhui', { keywords: ['à faire', 'accueil', 'tableau de bord'], suggested: true }));
  if (navOk('ventes') && salesTabs.length) {
    items.push(page('ventes', 'Demandes et devis', '/admin/ventes', { suggested: true }));
    for (const tab of salesTabs) items.push(page(`ventes:${tab.id}`, tab.label, `/admin/ventes?tab=${tab.id}`, { subtitle: 'Demandes et devis' }));
  }
  if (navOk('events')) {
    items.push(page('events', 'Événements', '/admin/events', { keywords: ['liste'], suggested: true }));
    if (isAvailable('planning')) items.push(page('events:calendrier', 'Calendrier', '/admin/events?vue=calendrier', { subtitle: 'Événements', keywords: ['planning', 'agenda'] }));
    for (const stage of EVENT_STAGES) items.push(page(`events:${stage.id}`, stage.label, `/admin/events?etape=${stage.id}`, { subtitle: 'Événements' }));
  }
  if (navOk('bornes')) {
    items.push(page('bornes', 'Bornes', '/admin/bornes', { keywords: ['mes bornes'], suggested: true }));
    for (const tab of BORNES_TABS) {
      const def = BORNES_TAB_DEFS[tab];
      if (!def || (def.feature && !isAvailable(def.feature)) || (def.appAdminOnly && !ctx.isAppAdmin)) continue;
      items.push(page(`bornes:${tab}`, def.label, `/admin/bornes?tab=${tab}`, { subtitle: 'Bornes', keywords: def.keywords }));
    }
  }
  if (navOk('reglages')) {
    items.push(page('reglages', 'Réglages', '/admin/reglages', { keywords: ['paramètres'], suggested: true }));
    const hidden = ctx.hiddenSettings ?? [];
    for (const section of SETTINGS_SECTIONS.filter((s) => !hidden.includes(s.id))) {
      items.push(page(`reglages:${section.id}`, section.label, `/admin/reglages#${section.id}`, { subtitle: 'Réglages', keywords: SETTINGS_KEYWORDS[section.id] }));
    }
  }
  if (navOk('templates') && ctx.isAppAdmin) {
    items.push(page('templates', 'Cadres photo', '/admin/templates', { subtitle: 'Bibliothèque', keywords: ['bibliothèque', 'modèles', 'templates'] }));
    items.push(page('decorations', 'Décorations', '/admin/decorations', { subtitle: 'Bibliothèque', keywords: ['stickers'] }));
    items.push(page('fonts', 'Polices', '/admin/fonts', { subtitle: 'Bibliothèque' }));
  }
  if (navOk('aide')) items.push(page('aide', 'Aide', '/aide', { external: true, keywords: ['support', 'guide'] }));

  return items;
}

// ── Raccourci ─────────────────────────────────────────────────────────────────

/** Mac (ou iPad, iPhone) : ⌘K ; sinon Ctrl K. */
function isMacPlatform(platform) {
  return /mac|iphone|ipad|ipod/i.test(String(platform ?? ''));
}

export function shortcutLabel(platform) {
  return isMacPlatform(platform) ? '⌘K' : 'Ctrl K';
}

/** Ctrl+K ou Cmd+K, sans Alt ni Maj. */
export function isPaletteShortcut(e) {
  return Boolean(e && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && String(e.key).toLowerCase() === 'k');
}
