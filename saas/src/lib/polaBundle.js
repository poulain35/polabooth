// Fichier .pola (LAB-216) : tout ce que la borne récupère en ligne pour un événement, pour
// qu'elle fonctionne avec ce seul fichier, sans réseau. Fonctions pures (pas de réseau ni de DOM).
// Lu par kiosk/PolaKiosk/Services/SyncService.cs (ImportPolaFileAsync) : garder les deux alignés.

import { frameTitle } from './clientDesigns.js';
import { planFonts, planImages, urlLastSegment } from './kioskScreensPublish.js';

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
    return 'Aucun cadre photo approuvé pour cet événement. Approuvez le cadre photo du client avant de '
      + 'télécharger le fichier .pola : sans lui, la borne imprimerait les photos sans cadre.';
  }
  if (!design.final_png_url) {
    return 'Le cadre photo approuvé n\'a pas de rendu PNG. Demandez au client de renvoyer son cadre photo, '
      + 'puis approuvez-le à nouveau.';
  }
  return null;
}

/**
 * Écran d'accueil du client à embarquer ({ id, final_png_url }), ou null. Mêmes conditions que la
 * RPC kiosk_get_approved_design (LAB-288) : écran validé, home.personalized et home.client_design
 * valant le booléen true.
 */
export function polaHomeDesign(kiosk, homeDesign) {
  const home = kiosk?.home;
  if (home?.personalized !== true || home?.client_design !== true) return null;
  if (!homeDesign || homeDesign.status !== 'approved' || !homeDesign.final_png_url) return null;
  return { id: homeDesign.id, final_png_url: homeDesign.final_png_url };
}

const SCREEN_LABELS = { home: "écran d'accueil de la borne", result: 'écran de partage de la borne' };

/**
 * Bloc `screens` (LAB-298) : plans publiés de l'organisation (`{home, result}`, comme la RPC
 * kiosk_get_screens) et leurs images, en assets `screens/{dernier segment de l'adresse}`. Un écran
 * dont une image manque est retiré en entier (jamais de plan partiel : la borne affichera l'écran
 * standard). Ses polices (LAB-331) suivent sous le même préfixe ; une police manquante ne retire
 * pas l'écran : la borne écrit alors ses textes en DM Sans (polaBundleWarnings le signale).
 * `block` vaut null quand aucun écran ne reste.
 */
export function polaScreens(screens, imagesBase64 = {}) {
  const block = {};
  const assets = {};
  for (const kind of ['home', 'result']) {
    const plan = screens?.[kind];
    if (!plan || typeof plan !== 'object') continue;
    const urls = planImages(plan);
    if (!urls.every((url) => imagesBase64[url])) continue;
    for (const url of [...urls, ...planFonts(plan)]) {
      if (imagesBase64[url]) assets[`screens/${urlLastSegment(url)}`] = imagesBase64[url];
    }
    block[kind] = plan;
  }
  if (Object.keys(block).length === 0) return { block: null, assets: {} };
  return { block: { home: block.home ?? null, result: block.result ?? null }, assets };
}

const frameSlot = (frame) => (Number.isInteger(frame?.slot) ? frame.slot : 1);

/**
 * Bloc `frames` (LAB-314, spec choix-cadre-invite) : les autres cadres validés, triés par slot, comme
 * la RPC kiosk_get_approved_design, et leurs PNG en assets `frame/{id}`. Seulement si
 * frame_choice.enabled vaut le booléen true (sinon `block` vaut null : .pola d'avant, un seul cadre).
 * Un cadre sans PNG téléchargé est retiré. Le cadre principal (`design`) n'y figure jamais.
 */
export function polaFrames(kiosk, design, frames, imagesBase64 = {}) {
  if (kiosk?.frame_choice?.enabled !== true) return { block: null, assets: {} };
  const block = [];
  const assets = {};
  const others = (frames ?? [])
    .filter((frame) => frame && frame.id !== design?.id && (frame.kind ?? 'print') === 'print'
      && (frame.status ?? 'approved') === 'approved')
    .sort((a, b) => frameSlot(a) - frameSlot(b));
  for (const frame of others) {
    const png = imagesBase64[frame.id];
    if (!frame.final_png_url || !png) continue;
    block.push({
      id:            frame.id,
      slot:          frameSlot(frame),
      label:         frame.label ?? null,
      format:        frame.format ?? null,
      canvas_json:   frame.canvas_json ?? null,
      final_png_url: frame.final_png_url,
    });
    assets[`frame/${frame.id}`] = png;
  }
  return { block, assets };
}

/**
 * Bundle .pola, identique à ce que la synchro en ligne de la borne récupère :
 * - event : réponse de la RPC kiosk_get_event (dates comprises, form_config réduit à sa partie kiosk) ;
 * - design : cadre principal = modèle photo validé au plus petit slot (id, format, canvas_json,
 *   final_png_url ; + label quand le choix du cadre est actif, LAB-314) ;
 * - frames + assets.frame/{id} : autres cadres validés (LAB-314), seulement si
 *   form_config.kiosk.frame_choice.enabled vaut true, voir polaFrames ;
 * - assets.design_png : PNG percé du design (final_png_url) ;
 * - assets.home_background : fond d'accueil (form_config.kiosk.home.background_url) ;
 * - assets.logo : logo de la société (contact.logo_url, LAB-257), facultatif ;
 * - home_design + assets.home_design : écran d'accueil créé par le client (LAB-290), facultatifs,
 *   seulement aux conditions de polaHomeDesign ;
 * - screens + assets.screens/{nom} : écrans de la borne publiés par l'organisation (LAB-298),
 *   facultatifs, voir polaScreens ;
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
  homeDesign = null,
  homeDesignBase64 = null,
  guestFormEnabled = true,
  screens = null,
  screenImagesBase64 = {},
  frames = [],
  frameImagesBase64 = {},
  exportedAt = new Date().toISOString(),
}) {
  const problem = polaDesignProblem(design);
  if (problem) throw new PolaExportError(problem);
  if (!designPngBase64) {
    throw new PolaExportError('Le rendu PNG du cadre photo approuvé n\'a pas pu être téléchargé. Réessayez dans un instant.');
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
  // Écran d'accueil (LAB-290) : PNG non téléchargé = comme le logo, home_design gardé sans l'image
  // (la borne peut reprendre celle qu'elle a en cache pour ce design).
  const homeDesignEntry = polaHomeDesign(kiosk, homeDesign);
  if (homeDesignEntry && homeDesignBase64) assets.home_design = homeDesignBase64;

  const bundle = {
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
  if (homeDesignEntry) bundle.home_design = homeDesignEntry;
  // Choix du cadre (LAB-314) : rien n'est ajouté quand il est coupé (.pola d'avant, strictement).
  const frameBlock = polaFrames(kiosk, design, frames, frameImagesBase64);
  if (frameBlock.block) {
    bundle.design.label = design.label ?? null;
    bundle.frames = frameBlock.block;
    Object.assign(assets, frameBlock.assets);
  }
  const screenBlock = polaScreens(screens, screenImagesBase64);
  if (screenBlock.block) {
    bundle.screens = screenBlock.block;
    Object.assign(assets, screenBlock.assets);
  }
  return bundle;
}

/**
 * Éléments facultatifs manquants, à signaler à l'admin sans bloquer l'export. `screens` : les
 * écrans publiés passés à buildPolaBundle, pour signaler ceux qui ont été retirés. `frames` : les
 * cadres passés à buildPolaBundle, pour signaler ceux qui ont été retirés (LAB-314).
 */
export function polaBundleWarnings(bundle, { screens = null, frames = [] } = {}) {
  const warnings = [];
  if (bundle.event.form_config.kiosk?.home?.background_url && !bundle.assets.home_background) {
    warnings.push('fond d\'accueil non téléchargé (la borne affichera le fond crème)');
  }
  if (!bundle.contact) warnings.push('coordonnées du loueur absentes');
  if (bundle.contact?.logo_url && !bundle.assets.logo) {
    warnings.push("logo de la société non téléchargé (la borne gardera celui qu'elle a déjà, sinon affichera le nom de la société)");
  }
  const home = bundle.event.form_config.kiosk?.home;
  if (bundle.home_design && !bundle.assets.home_design) {
    warnings.push("écran d'accueil du client non téléchargé (la borne gardera celui qu'elle a déjà pour cet écran, sinon affichera l'accueil habituel)");
  } else if (!bundle.home_design && home?.personalized === true && home?.client_design === true) {
    warnings.push("écran d'accueil du client pas encore validé (la borne affichera l'accueil habituel)");
  }
  for (const kind of ['home', 'result']) {
    if (screens?.[kind] && !bundle.screens?.[kind]) {
      warnings.push(`${SCREEN_LABELS[kind]} non téléchargé (la borne affichera l'écran standard)`);
    }
    const missingFonts = (bundle.screens?.[kind]?.texts ?? [])
      .filter((t) => typeof t?.font_file === 'string' && t.font_file !== ''
        && !bundle.assets[`screens/${urlLastSegment(t.font_file)}`])
      .map((t) => t.font);
    for (const family of new Set(missingFonts)) {
      warnings.push(`police ${family} de l'${SCREEN_LABELS[kind]} non téléchargée (la borne écrira ces textes en DM Sans, sauf si elle l'a déjà)`);
    }
  }
  if (bundle.frames) {
    const kept = new Set(bundle.frames.map((frame) => frame.id));
    const missing = (frames ?? [])
      .filter((frame) => frame && frame.id !== bundle.design.id && (frame.status ?? 'approved') === 'approved'
        && !kept.has(frame.id))
      .sort((a, b) => frameSlot(a) - frameSlot(b));
    for (const frame of missing) {
      warnings.push(`« ${frameTitle(frame)} » non téléchargé (la borne ne le proposera pas aux invités)`);
    }
  }
  return warnings;
}

export function polaFileName(event) {
  const safeName = (event.name || 'evenement').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  return `${safeName}_${event.access_code}.pola`;
}
