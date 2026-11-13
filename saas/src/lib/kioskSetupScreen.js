// LAB-253 : fond de l'écran de saisie du code de la borne (default/setup_config.json).
// Couleurs de la borne fixes depuis LAB-249 : seul reste le choix entre le fond Pola (crème)
// et une image. La borne affiche l'image si bg_type vaut « image », le fond crème sinon.

export const SETUP_BG_CREAM = 'cream';
export const SETUP_BG_IMAGE = 'image';

/** Fond crème de la borne (même valeur que KioskCreamColor dans kiosk/PolaKiosk/App.xaml). */
export const KIOSK_CREAM = '#F7F1E7';

/** Réglage lu → choix affiché. Les anciens « gradient » et « solid » deviennent le fond Pola. */
export function normalizeSetupConfig(cfg) {
  const url = typeof cfg?.bg_image_url === 'string' && cfg.bg_image_url ? cfg.bg_image_url : null;
  return {
    bg_type: cfg?.bg_type === SETUP_BG_IMAGE ? SETUP_BG_IMAGE : SETUP_BG_CREAM,
    bg_image_url: url,
  };
}

/** Choix affiché → fichier enregistré, sans les anciens champs de couleur. */
export function setupConfigToSave(cfg) {
  const { bg_type, bg_image_url } = normalizeSetupConfig(cfg);
  return { bg_type, bg_image_url };
}
