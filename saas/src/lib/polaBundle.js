// Fichier .pola (LAB-216) : tout ce que la borne récupère en ligne pour un événement, pour
// qu'elle fonctionne avec ce seul fichier, sans réseau. Fonctions pures (pas de réseau ni de DOM).
// Lu par kiosk/PolaKiosk/Services/SyncService.cs (ImportPolaFileAsync) : garder les deux alignés.

export const POLA_FORMAT_VERSION = 2;

export class PolaExportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PolaExportError';
  }
}

/** Raison pour laquelle l'événement ne peut pas être exporté, ou null. */
export function polaDesignProblem(design) {
  if (!design || design.status !== 'approved') {
    return 'Aucun design approuvé pour cet événement. Approuvez le design du client avant de '
      + 'télécharger le fichier .pola : sans lui, la borne imprimerait les photos sans cadre.';
  }
  if (!design.final_png_url) {
    return 'Le design approuvé n\'a pas de rendu PNG. Demandez au client de renvoyer son design, '
      + 'puis approuvez-le à nouveau.';
  }
  return null;
}

/**
 * Bundle .pola, identique à ce que la synchro en ligne de la borne récupère :
 * - event : réponse de la RPC kiosk_get_event (dates comprises, form_config réduit à sa partie kiosk) ;
 * - design : ligne client_designs approuvée (id, format, canvas_json, final_png_url) ;
 * - assets.design_png : PNG percé du design (final_png_url) ;
 * - assets.home_background : fond d'accueil (form_config.kiosk.home.background_url) ;
 * - assets.logo : logo de la société (contact.logo_url, LAB-257), facultatif ;
 * - contact : RPC get_org_contact_by_event (nom, téléphone, URL du logo et email du loueur ;
 *   l'email sert de contact de repli dans la notice du questionnaire, open core L7).
 * Les polices et images du design sont déjà dans le PNG : la borne ne lit dans canvas_json
 * que les zones photo. Aucun secret : seul le code d'accès de l'événement y figure.
 */
export function buildPolaBundle({
  event,
  design,
  designPngBase64,
  homeBackgroundBase64 = null,
  contact = null,
  logoBase64 = null,
  guestFormEnabled = true,
  exportedAt = new Date().toISOString(),
}) {
  const problem = polaDesignProblem(design);
  if (problem) throw new PolaExportError(problem);
  if (!designPngBase64) {
    throw new PolaExportError('Le rendu PNG du design approuvé n\'a pas pu être téléchargé. Réessayez dans un instant.');
  }

  // Questionnaire de la borne désactivé (open core) : retiré comme le fait la RPC kiosk_get_event.
  let kiosk = event.form_config?.kiosk ?? null;
  if (kiosk && !guestFormEnabled && 'questionnaire' in kiosk) {
    const { questionnaire: _omit, ...rest } = kiosk;
    kiosk = rest;
  }
  const assets = { design_png: designPngBase64 };
  if (kiosk?.home?.background_url && homeBackgroundBase64) assets.home_background = homeBackgroundBase64;
  // Logo (LAB-257) : contact.logo_url = null dit à la borne d'effacer le logo qu'elle a en mémoire.
  const logoUrl = contact?.contact_company ? contact.logo_url || null : null;
  if (logoUrl && logoBase64) assets.logo = logoBase64;

  return {
    version:     POLA_FORMAT_VERSION,
    exported_at: exportedAt,
    event: {
      id:          event.id,
      org_id:      event.org_id ?? null,
      name:        event.name,
      access_code: event.access_code,
      start_date:  event.start_date ?? null,
      end_date:    event.end_date ?? null,
      form_config: { kiosk },
    },
    design: {
      id:            design.id,
      format:        design.format ?? null,
      canvas_json:   design.canvas_json ?? null,
      final_png_url: design.final_png_url,
    },
    assets,
    contact: contact?.contact_company
      ? { company: contact.contact_company, phone: contact.contact_phone || null, logo_url: logoUrl, email: contact.contact_email || null }
      : null,
  };
}

/** Éléments facultatifs manquants, à signaler à l'admin sans bloquer l'export. */
export function polaBundleWarnings(bundle) {
  const warnings = [];
  if (bundle.event.form_config.kiosk?.home?.background_url && !bundle.assets.home_background) {
    warnings.push('fond d\'accueil non téléchargé (la borne affichera le fond crème)');
  }
  if (!bundle.contact) warnings.push('coordonnées du loueur absentes');
  if (bundle.contact?.logo_url && !bundle.assets.logo) {
    warnings.push("logo de la société non téléchargé (la borne gardera celui qu'elle a déjà, sinon affichera le nom de la société)");
  }
  return warnings;
}

export function polaFileName(event) {
  const safeName = (event.name || 'evenement').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  return `${safeName}_${event.access_code}.pola`;
}
