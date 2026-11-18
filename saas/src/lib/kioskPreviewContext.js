// Valeurs de l'aperçu sur la borne (LAB-308, spec docs/specs/apercu-borne.md D6 et D9) : réelles
// quand un événement est connu, d'exemple sinon. Module pur.
//
// kioskPreviewBlock est le miroir de supabase/functions/get-event/kiosk-preview.ts : le client reçoit
// ce bloc de get-event, l'admin le calcule ici depuis form_config. Garder les deux identiques (test de
// parité dans get-event/kiosk-preview.test.ts).
import { VARIABLE_SAMPLES } from './kioskScreenLayout.js';
import { homeTexts } from './kioskScreenState.js';

// HomeScreen.SupportedFormats : formats que la borne sait réaliser. GIF et boomerang s'ajoutent ici
// quand la borne les gère ; l'aperçu passe alors de lui-même aux tuiles.
export const KIOSK_SUPPORTED_FORMATS = Object.freeze(['photo']);

const HOME_FORMATS = [
  { id: 'photo', fallback: 'Photo', subtitle: 'Imprimée et partagée', enabledByDefault: true },
  { id: 'gif', fallback: 'GIF', subtitle: 'Animé, à partager', enabledByDefault: false },
  { id: 'boomerang', fallback: 'Boomerang', subtitle: 'Joué en boucle', enabledByDefault: false },
];

/** Tirages restants affichés avec les valeurs d'exemple (VARIABLE_SAMPLES.prints_remaining). */
const SAMPLE_REMAINING_PRINTS = 120;

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const obj = (v) => (isObject(v) ? v : {});
const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);
const trimmed = (v) => (typeof v === 'string' ? v.trim() : '');

function limit(src, key, fallback) {
  if (!(key in src)) return fallback;
  const v = src[key];
  if (v === null) return null;
  return Number.isInteger(v) ? v : fallback;
}

function homeFormats(home) {
  const buttons = obj(home.buttons);
  return HOME_FORMATS.flatMap(({ id, fallback, enabledByDefault }) => {
    const raw = buttons[id];
    const enabled = isObject(raw) ? bool(raw.enabled, true) : enabledByDefault;
    if (!enabled) return [];
    return [{ id, label: (isObject(raw) ? trimmed(raw.label) : '') || fallback }];
  });
}

/** Bloc `kiosk_preview` de get-event, calculé depuis form_config (fiche de l'événement). */
export function kioskPreviewBlock(formConfig, resultScreen = null) {
  const kiosk = obj(obj(formConfig).kiosk);
  const home = obj(kiosk.home);
  const result = obj(kiosk.result);
  const buttons = obj(result.buttons);
  const button = (key) => bool(obj(buttons[key]).enabled, true);
  const autoReturn = limit(result, 'auto_return_seconds', 30);

  return {
    display_name: trimmed(home.display_name) || null,
    formats: homeFormats(home),
    result_screen: isObject(resultScreen) ? resultScreen : null,
    result: {
      print_enabled: button('print'),
      max_prints_per_event: limit(result, 'max_prints_per_event', null),
      max_prints_per_photo: limit(result, 'max_prints_per_photo', 2),
      show_remaining_prints: bool(result.show_remaining_prints, true),
      auto_return_seconds: autoReturn ?? 30,
      email_enabled: button('email') && obj(kiosk.email).enabled === true,
      qr_enabled: button('qr'),
      retake_enabled: button('retake'),
      finish_enabled: button('home'),
    },
  };
}

/**
 * Tuiles de l'accueil (HomeScreen.EnabledFormats puis Tiles) : formats activés que la borne sait
 * réaliser, jamais vide (la photo reste proposée). Une seule tuile = pastille dans l'aperçu.
 */
export function homeTiles(formats, supported = KIOSK_SUPPORTED_FORMATS) {
  const usable = (formats ?? []).filter((f) => supported.includes(f?.id));
  const list = usable.length ? usable : [{ id: 'photo', label: 'Photo' }];
  return list.map((f, i) => {
    const def = HOME_FORMATS.find((h) => h.id === f.id);
    return { format: f.id, title: trimmed(f.label) || def.fallback, subtitle: def.subtitle, isPrimary: i === 0 };
  });
}

/**
 * PrintService.GetRemainingPrintsAsync pour le premier invité (aucun tirage fait) : le plus petit
 * des deux plafonds, null sans limite.
 */
export function firstGuestRemainingPrints(maxPerEvent, maxPerPhoto) {
  const limits = [maxPerEvent, maxPerPhoto].filter((v) => Number.isInteger(v));
  return limits.length ? Math.max(0, Math.min(...limits)) : null;
}

/**
 * Contexte de l'aperçu : `event` (id, name, start_date, end_date) et `block` (kiosk_preview).
 * Sans événement : valeurs d'exemple (modèles de l'admin). Sans bloc (get-event plus ancien) :
 * nom et date réels, réglages par défaut de la borne.
 *   tiles          vue « Écran d'accueil » (HomePreview)
 *   texts          event_name, event_date (écrans composés)
 *   share          options de shareInputsForState (écran de partage)
 *   resultScreen   écran de partage publié par l'organisation, ou null
 */
export function previewContext({ event = null, block = null } = {}) {
  if (!event) {
    return {
      tiles: homeTiles([{ id: 'photo', label: 'Photo' }]),
      texts: { event_name: VARIABLE_SAMPLES.event_name, event_date: VARIABLE_SAMPLES.event_date },
      share: { remainingPrints: SAMPLE_REMAINING_PRINTS },
      resultScreen: null,
      sample: true,
    };
  }
  const b = block ?? kioskPreviewBlock(null);
  const r = b.result;
  return {
    tiles: homeTiles(b.formats),
    texts: homeTexts({
      displayName: b.display_name,
      eventName: event.name ?? '',
      startDate: event.start_date ?? null,
      endDate: event.end_date ?? null,
    }),
    share: {
      printEnabled: r.print_enabled,
      remainingPrints: firstGuestRemainingPrints(r.max_prints_per_event, r.max_prints_per_photo),
      showRemainingPrints: r.show_remaining_prints,
      autoReturnSeconds: r.auto_return_seconds,
      emailEnabled: r.email_enabled,
      qrEnabled: r.qr_enabled,
      retakeEnabled: r.retake_enabled,
      finishEnabled: r.finish_enabled,
    },
    resultScreen: b.result_screen ?? null,
    sample: false,
  };
}

/** Valeurs d'exemple (D6), contexte par défaut de la fenêtre. */
export const SAMPLE_PREVIEW_CONTEXT = Object.freeze(previewContext());
