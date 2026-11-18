/**
 * Bloc `kiosk_preview` de get-event (LAB-308, spec docs/specs/apercu-borne.md D9) : ce dont l'aperçu
 * sur la borne a besoin, lu dans form_config.kiosk avec les règles de la borne. Construit champ par
 * champ : rien d'autre de form_config ne sort (règle de LAB-112). Miroir client :
 * src/lib/kioskPreviewContext.js (kioskPreviewBlock), même résultat (test de parité).
 *
 *   display_name  home.display_name (vide = null : nom de l'événement)
 *   formats       formats activés (home.buttons), ordre de la borne, titre de la tuile résolu
 *   result_screen écran de partage publié par l'organisation (kiosk_screens.published), ou null
 *   result        réglages de l'écran de partage (tirages, délai, tuiles)
 */

type Json = Record<string, unknown>;

// HomeButtonsConfig : bouton absent = défaut de la borne ; présent sans `enabled` = activé.
const HOME_FORMATS = [
  { id: 'photo', fallback: 'Photo', enabledByDefault: true },
  { id: 'gif', fallback: 'GIF', enabledByDefault: false },
  { id: 'boomerang', fallback: 'Boomerang', enabledByDefault: false },
];

const isObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const obj = (v: unknown): Json => (isObject(v) ? v : {});
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const trimmed = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

// Entier de la borne (int?) : clé absente = défaut, null = sans limite.
function limit(src: Json, key: string, fallback: number | null): number | null {
  if (!(key in src)) return fallback;
  const v = src[key];
  if (v === null) return null;
  return Number.isInteger(v) ? (v as number) : fallback;
}

function homeFormats(home: Json): { id: string; label: string }[] {
  const buttons = obj(home.buttons);
  return HOME_FORMATS.flatMap(({ id, fallback, enabledByDefault }) => {
    const raw = buttons[id];
    const enabled = isObject(raw) ? bool(raw.enabled, true) : enabledByDefault;
    if (!enabled) return [];
    return [{ id, label: (isObject(raw) ? trimmed(raw.label) : '') || fallback }];
  });
}

export function buildKioskPreview(formConfig: unknown, resultScreen: unknown = null) {
  const kiosk = obj(obj(formConfig).kiosk);
  const home = obj(kiosk.home);
  const result = obj(kiosk.result);
  const buttons = obj(result.buttons);
  const button = (key: string) => bool(obj(buttons[key]).enabled, true);
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
