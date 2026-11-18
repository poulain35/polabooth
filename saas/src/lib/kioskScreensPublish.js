// Écrans de la borne composés par l'admin (LAB-298) : brouillon, publication et nettoyage des
// fichiers. Règles pures (pas de réseau ni de DOM), testées dans kioskScreensPublish.test.js.
// Le plan publié est celui de buildScreenLayout (kioskScreenLayout.js), avec les adresses
// complètes des images et des polices : la borne (ScreenLayout.Parse, ScreenCache) en garde le
// dernier segment.

import { FALLBACK_FONT, SCREEN_KINDS, liveFont } from './kioskScreenLayout.js';

/**
 * Taille maximale d'un brouillon enregistré (JSON). Les images importées partent dans Storage
 * avant l'enregistrement : au-delà, ce sont des formes trop lourdes (un canvas_json de 26 Mo a
 * déjà bloqué la synchro des bornes).
 */
export const SCREEN_DRAFT_MAX_BYTES = 2 * 1024 * 1024;

/** Taille maximale d'un plan publié (JSON), lu par chaque borne à chaque synchro. */
const SCREEN_PLAN_MAX_BYTES = 64 * 1024;

export const SCREEN_TITLES = Object.freeze({ home: 'Accueil', result: 'Partage' });

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Chemin d'un fichier de l'organisation dans le bucket kiosk-backgrounds. */
export function screenStoragePath(orgId, name) {
  return `org/${orgId}/${name}`;
}

/** Dossier de l'organisation dans le bucket kiosk-backgrounds. */
export function screenStorageFolder(orgId) {
  return `org/${orgId}`;
}

/**
 * Version à publier : toujours la précédente + 1, même après une dépublication. La borne range
 * ses images par version : deux plans différents ne doivent jamais porter le même numéro.
 */
export function nextScreenVersion(row) {
  const current = Number(row?.published_version);
  return (Number.isInteger(current) && current > 0 ? current : 0) + 1;
}

/** Images d'un plan (fond, fond neutre, boutons) : noms ou adresses, sans doublon. */
export function planImages(layout) {
  const names = [layout?.background, layout?.background_neutral, ...(layout?.buttons ?? []).map((b) => b?.image)];
  return [...new Set(names.filter((n) => typeof n === 'string' && n !== ''))];
}

/** Fichiers de police d'un plan (`texts[].font_file`) : noms ou adresses, sans doublon (LAB-331). */
export function planFonts(layout) {
  const names = (layout?.texts ?? []).map((t) => t?.font_file);
  return [...new Set(names.filter((n) => typeof n === 'string' && n !== ''))];
}

/**
 * Plan publié : le plan de buildScreenLayout, avec l'adresse complète de chaque image et de chaque
 * police (`fontUrlFor`, par défaut `urlFor`).
 */
export function publishedPlan(layout, urlFor, fontUrlFor = urlFor) {
  const url = (name) => (typeof name === 'string' && name !== '' ? urlFor(name) : null);
  const fontUrl = (name) => (typeof name === 'string' && name !== '' ? fontUrlFor(name) : null);
  return {
    ...layout,
    background: url(layout.background),
    background_neutral: url(layout.background_neutral),
    buttons: (layout.buttons ?? []).map((b) => ({ ...b, image: url(b.image) })),
    texts: (layout.texts ?? []).map((t) => ({ ...t, font_file: fontUrl(t.font_file) })),
  };
}

/**
 * Plan sans les polices `names` (fichier introuvable à la publication) : leurs textes passent en
 * DM Sans à la graisse la plus proche, comme la borne le ferait sans le fichier.
 */
export function withoutFonts(layout, names) {
  const dropped = new Set(names ?? []);
  if (dropped.size === 0) return layout;
  return {
    ...layout,
    texts: (layout.texts ?? []).map((t) =>
      (dropped.has(t.font_file) ? { ...t, ...liveFont(FALLBACK_FONT, t.weight, null) } : t)),
  };
}

/** Avertissement d'une police non récupérée à la publication. */
export function fontFetchWarning(font) {
  return {
    code: 'live_font_missing',
    message: `La police ${font.family} n'a pas pu être récupérée : la borne écrira ses textes en DM Sans.`,
  };
}

/** Taille maximale d'un fichier de police publié (limite du bucket kiosk-backgrounds). */
export const SCREEN_FONT_MAX_BYTES = 10 * 1024 * 1024;

/** Type MIME d'un fichier de police du plan ('font/ttf' | 'font/otf'). */
export function screenFontContentType(name) {
  return /\.otf$/i.test(name) ? 'font/otf' : 'font/ttf';
}

/** Dernier segment d'une adresse, comme la borne (ScreenCache.LastSegment) : nom de l'asset .pola. */
export function urlLastSegment(url) {
  const path = String(url ?? '').split(/[?#]/)[0];
  const segment = path.slice(path.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Fichiers d'un écran à supprimer après la publication de `version` : ceux des autres versions
 * (la précédente, et les essais qui ont échoué). Les autres fichiers du dossier sont ignorés.
 */
export function staleScreenFiles(names, kind, version) {
  const pattern = new RegExp(`^screen-${kind}-v(\\d+)-[a-z0-9_-]+\\.(png|ttf|otf)$`);
  return (names ?? []).filter((name) => {
    const m = typeof name === 'string' ? name.match(pattern) : null;
    return !!m && Number(m[1]) !== version;
  });
}

/** Taille en octets d'une chaîne une fois encodée en UTF-8. */
function utf8Bytes(str) {
  return new TextEncoder().encode(str).length;
}

const megabytes = (bytes) => (bytes / (1024 * 1024)).toLocaleString('fr-FR', { maximumFractionDigits: 1 });

/** Message si le brouillon (JSON) est trop lourd pour être enregistré, sinon null. */
export function draftSizeProblem(json) {
  const bytes = utf8Bytes(typeof json === 'string' ? json : JSON.stringify(json));
  if (bytes <= SCREEN_DRAFT_MAX_BYTES) return null;
  return `L'écran est trop lourd (${megabytes(bytes)} Mo, ${megabytes(SCREEN_DRAFT_MAX_BYTES)} Mo au maximum) : `
    + 'retirez des formes complexes ou des stickers, puis réessayez.';
}

/** Message si le plan publié est trop lourd pour les bornes, sinon null. */
export function planSizeProblem(plan) {
  const bytes = utf8Bytes(JSON.stringify(plan));
  if (bytes <= SCREEN_PLAN_MAX_BYTES) return null;
  return `Le plan de l'écran est trop lourd (${Math.ceil(bytes / 1024)} Ko, ${SCREEN_PLAN_MAX_BYTES / 1024} Ko au maximum) : `
    + 'retirez des textes vivants ou des boutons.';
}

// ── Images importées dans le brouillon ──────────────────────────────────────────────────────
// L'éditeur range une image importée en data URL dans le JSON : avant l'enregistrement, elle part
// dans Storage (org/{org_id}/screen-asset-{empreinte}.png|jpg) et le brouillon garde son adresse.

const isDataImage = (src) => typeof src === 'string' && /^data:image\//i.test(src);

function walkObjects(objects, visit) {
  for (const o of Array.isArray(objects) ? objects : []) {
    if (!isObject(o)) continue;
    visit(o);
    walkObjects(o.objects, visit);
    if (isObject(o.clipPath)) walkObjects([o.clipPath], visit);
  }
}

/** Data URLs d'images du brouillon (groupes et masques compris), sans doublon. */
export function inlineImageSources(state) {
  const found = new Set();
  walkObjects(state?.objects, (o) => {
    if (isDataImage(o.src)) found.add(o.src);
  });
  return [...found];
}

/** Copie du brouillon où chaque data URL de `map` (Map ou objet) est remplacée par son adresse. */
export function replaceImageSources(state, map) {
  const get = (src) => (map instanceof Map ? map.get(src) : map?.[src]);
  const copy = (o) => {
    if (!isObject(o)) return o;
    const next = { ...o };
    if (isDataImage(o.src) && get(o.src)) {
      next.src = get(o.src);
      next.crossOrigin = 'anonymous';
    }
    if (Array.isArray(o.objects)) next.objects = o.objects.map(copy);
    if (isObject(o.clipPath)) next.clipPath = copy(o.clipPath);
    return next;
  };
  return { ...state, objects: (state?.objects ?? []).map(copy) };
}

/** Type d'une data URL (« image/png »…), en minuscules. */
export function dataUrlMime(dataUrl) {
  const m = String(dataUrl ?? '').match(/^data:([^;,]+)/i);
  return m ? m[1].toLowerCase() : null;
}

/** Nom du fichier d'une image importée : PNG et JPEG gardés, le reste converti en PNG. */
export function screenAssetName(hash, mime) {
  return `screen-asset-${hash}.${mime === 'image/jpeg' ? 'jpg' : 'png'}`;
}

const SCREEN_ASSET_PATTERN = /^screen-asset-[0-9a-f]+\.(png|jpg)$/;

/** Noms des images importées (screen-asset-*) qu'un brouillon référence, groupes et masques compris. */
export function screenAssetNames(state) {
  const found = new Set();
  walkObjects(state?.objects, (o) => {
    if (typeof o.src !== 'string' || isDataImage(o.src)) return;
    const name = urlLastSegment(o.src);
    if (SCREEN_ASSET_PATTERN.test(name)) found.add(name);
  });
  return found;
}

/**
 * Images importées du dossier à supprimer : celles qu'aucun brouillon ni aucun plan publié de
 * l'organisation ne référence (`keep` : noms ou adresses, Set ou tableau). Les autres fichiers
 * du dossier (versions publiées, aperçus, fonds des événements) ne sont jamais concernés.
 */
export function unusedScreenAssets(names, keep) {
  const kept = new Set([...(keep ?? [])].map(urlLastSegment));
  return (names ?? []).filter((name) => typeof name === 'string' && SCREEN_ASSET_PATTERN.test(name) && !kept.has(name));
}

/** Tout ce que les lignes kiosk_screens référencent encore (brouillons et plans publiés). */
export function referencedScreenFiles(rows) {
  const names = new Set();
  for (const row of rows ?? []) {
    for (const name of screenAssetNames(row?.draft_json)) names.add(name);
    for (const url of [...planImages(row?.published), ...planFonts(row?.published)]) names.add(urlLastSegment(url));
  }
  return names;
}

// ── État affiché sur les cartes ─────────────────────────────────────────────────────────────

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

/**
 * État d'un écran : `{ published, version, label, unpublishedChanges }`. La version affichée est
 * celle du plan publié, pas la colonne (qui garde le dernier numéro même après une dépublication).
 */
export function screenStatus(row) {
  const plan = isObject(row?.published) ? row.published : null;
  if (!plan) {
    return {
      published: false,
      version: null,
      label: row?.draft_json ? 'Brouillon' : "Modèle d'origine, pas encore modifié",
      unpublishedChanges: false,
    };
  }
  const version = Number.isInteger(plan.version) ? plan.version : row.published_version;
  const at = row.published_at ? new Date(row.published_at) : null;
  const when = at && !Number.isNaN(at.getTime()) ? ` le ${DATE_FORMAT.format(at)}` : '';
  const draftAt = row.draft_updated_at ? new Date(row.draft_updated_at).getTime() : NaN;
  return {
    published: true,
    version,
    label: `Publié v${version}${when}`,
    unpublishedChanges: !!at && Number.isFinite(draftAt) && draftAt > at.getTime(),
  };
}

/** Lignes kiosk_screens → `{ home, result }` (null pour un écran sans ligne). */
export function screensByKind(rows) {
  const out = Object.fromEntries(SCREEN_KINDS.map((k) => [k, null]));
  for (const row of rows ?? []) if (row && SCREEN_KINDS.includes(row.kind)) out[row.kind] = row;
  return out;
}
