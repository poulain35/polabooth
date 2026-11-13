/**
 * Formats de la borne : photo, GIF, boomerang (LAB-235, spec LAB-207).
 * Module pur : défauts de form_config.kiosk.home et .capture, fusion avec la config enregistrée,
 * nettoyage et validation à la sauvegarde. Lu par la borne (LAB-237) : garder la forme alignée.
 *
 *   home.buttons.{photo|gif|boomerang|gallery} = { enabled, label }
 *   home.personalized = bool, home.display_name = texte (vide = nom de l'événement) — LAB-250
 *   result.buttons.{retake|print|qr|email|home} = { enabled } (textes et couleurs fixes, LAB-250 et LAB-254)
 *   capture.gif       = { shots, interval_ms }
 *   capture.boomerang = { duration_ms, print_frame }
 */

export const KIOSK_FORMATS = [
  { key: 'photo',     label: 'Photo',     description: 'Une photo au flash, imprimée dans le design' },
  { key: 'gif',       label: 'GIF',       description: 'Plusieurs photos à la suite, jouées en boucle' },
  { key: 'boomerang', label: 'Boomerang', description: 'Un clip court joué à l’endroit puis à l’envers' },
];

export const FORMAT_LABEL_MAX = 20;
export const DISPLAY_NAME_MAX = 40;

export const GIF_LIMITS = {
  shots:       { min: 3, max: 6, default: 4 },
  interval_ms: { min: 500, max: 3000, default: 1000 },
};

export const BOOMERANG_LIMITS = {
  duration_ms: { min: 1000, max: 3000, default: 2000 },
};

export const NO_FORMAT_ERROR = 'Activez au moins un format : Photo, GIF ou Boomerang';

export function buildDefaultHomeButtons() {
  return {
    photo:     { enabled: true,  label: 'Photo' },
    gif:       { enabled: false, label: 'GIF' },
    boomerang: { enabled: false, label: 'Boomerang' },
    // Reste masqué tant que la galerie invité de la borne n'est pas prête (pas de réglage dans l'admin).
    gallery:   { enabled: false, label: 'Galerie' },
  };
}

export function buildDefaultHome() {
  return { background_url: null, personalized: false, display_name: '', buttons: buildDefaultHomeButtons() };
}

export function buildDefaultCapture() {
  return {
    mirror: true,
    countdown_seconds: 5,
    gif:       { shots: GIF_LIMITS.shots.default, interval_ms: GIF_LIMITS.interval_ms.default },
    boomerang: { duration_ms: BOOMERANG_LIMITS.duration_ms.default, print_frame: false },
  };
}

export function buildDefaultResultButtons() {
  return {
    retake: { enabled: true },
    print:  { enabled: true },
    qr:     { enabled: true },
    email:  { enabled: true },
    home:   { enabled: true },
  };
}

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const obj = (v) => (isObject(v) ? v : {});

// Config enregistrée + défauts. Un événement sans home.buttons garde la photo seule : l'accueil
// actuel de la borne (bouton « Commencer »). Les boutons inconnus (lot 2) sont conservés.
export function withHomeDefaults(raw) {
  const def = buildDefaultHome();
  const src = obj(raw);
  const rawButtons = obj(src.buttons);
  const buttons = { ...rawButtons };
  for (const [key, value] of Object.entries(def.buttons)) {
    buttons[key] = { ...value, ...obj(rawButtons[key]) };
  }
  return { ...def, ...src, buttons };
}

// Seul enabled est gardé : un ancien libellé ou une ancienne couleur par bouton est écarté.
export function withResultButtonsDefaults(raw) {
  const src = obj(raw);
  const buttons = {};
  for (const [key, def] of Object.entries(buildDefaultResultButtons())) {
    const b = obj(src[key]);
    buttons[key] = { enabled: typeof b.enabled === 'boolean' ? b.enabled : def.enabled };
  }
  return buttons;
}

// Écran de partage à l'enregistrement : textes et disposition fixes sur la borne (LAB-252),
// un ancien result.button_layout et les anciens result.buttons.*.label sont effacés (LAB-254).
export function cleanResultConfig(raw) {
  const { button_layout: _layout, ...result } = obj(raw);
  return { ...result, buttons: withResultButtonsDefaults(result.buttons) };
}

export function withCaptureDefaults(raw) {
  const def = buildDefaultCapture();
  const src = obj(raw);
  return {
    ...def,
    ...src,
    gif:       { ...def.gif,       ...obj(src.gif) },
    boomerang: { ...def.boomerang, ...obj(src.boomerang) },
  };
}

const toInt = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
};

// Forme écrite dans form_config : `enabled` booléen, libellés rognés (vide = libellé par défaut),
// nombres entiers. Les bornes sont contrôlées par validateKioskFormats, pas corrigées en silence.
export function cleanKioskFormats(kiosk) {
  const src = obj(kiosk);
  const home = withHomeDefaults(src.home);
  const capture = withCaptureDefaults(src.capture);
  const defaults = buildDefaultHomeButtons();

  const buttons = { ...home.buttons };
  for (const key of Object.keys(defaults)) {
    const b = home.buttons[key];
    const label = String(b.label ?? '').trim();
    buttons[key] = { ...b, enabled: b.enabled === true, label: label || defaults[key].label };
  }

  return {
    ...src,
    ...(isObject(src.result) ? { result: cleanResultConfig(src.result) } : {}),
    home: {
      ...home,
      personalized: home.personalized === true,
      display_name: String(home.display_name ?? '').trim(),
      buttons,
    },
    capture: {
      ...capture,
      gif: {
        ...capture.gif,
        shots:       toInt(capture.gif.shots, GIF_LIMITS.shots.default),
        interval_ms: toInt(capture.gif.interval_ms, GIF_LIMITS.interval_ms.default),
      },
      boomerang: {
        ...capture.boomerang,
        duration_ms: toInt(capture.boomerang.duration_ms, BOOMERANG_LIMITS.duration_ms.default),
        print_frame: capture.boomerang.print_frame === true,
      },
    },
  };
}

/** Formats actifs, dans l'ordre d'affichage (photo, GIF, boomerang). */
export function enabledFormats(kiosk) {
  const buttons = withHomeDefaults(obj(kiosk).home).buttons;
  return KIOSK_FORMATS.filter((f) => buttons[f.key]?.enabled === true).map((f) => f.key);
}

const inRange = (v, { min, max }) => Number.isInteger(v) && v >= min && v <= max;

/** Erreurs bloquantes ({ code, message, tab }), vide si les formats sont valides. `tab` : onglet à ouvrir. */
export function validateKioskFormats(kiosk) {
  const cfg = cleanKioskFormats(kiosk);
  const errors = [];
  const add = (code, message, tab = 'accueil') => errors.push({ code, message, tab });

  if (enabledFormats(cfg).length === 0) add('no_format', NO_FORMAT_ERROR);

  for (const f of KIOSK_FORMATS) {
    if (cfg.home.buttons[f.key].label.length > FORMAT_LABEL_MAX) {
      add('format_label', `Bouton « ${f.label} » : ${FORMAT_LABEL_MAX} caractères maximum`);
    }
  }

  if (cfg.home.display_name.length > DISPLAY_NAME_MAX) {
    add('display_name', `Nom affiché sur l'accueil : ${DISPLAY_NAME_MAX} caractères maximum`);
  }

  const { gif, boomerang } = cfg.capture;
  if (!inRange(gif.shots, GIF_LIMITS.shots)) {
    add('gif_shots', `GIF : de ${GIF_LIMITS.shots.min} à ${GIF_LIMITS.shots.max} photos`, 'capture');
  }
  if (!inRange(gif.interval_ms, GIF_LIMITS.interval_ms)) {
    add('gif_interval', 'GIF : délai entre deux photos de 0,5 à 3 secondes', 'capture');
  }
  if (!inRange(boomerang.duration_ms, BOOMERANG_LIMITS.duration_ms)) {
    add('boomerang_duration', 'Boomerang : durée de 1 à 3 secondes', 'capture');
  }
  return errors;
}
