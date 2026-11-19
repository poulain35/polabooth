// Export du fichier .pola (mode hors ligne de la borne).
import {
  buildPolaBundle, polaBundleWarnings, polaDesignProblem, polaFileName, PolaExportError, polaHomeDesign,
} from '../polaBundle.js';
import { mainFrame } from '../clientDesigns.js';
import { planFonts, planImages, publishedScreensForFormat } from '../kioskScreensPublish.js';
import { isFeatureEnabled } from '../../features/catalog.js';
import { downloadBlob } from '../download.js';
import { supabase } from './client.js';

// ── Export fichier .pola (LAB-216) ───────────────────────────────────────────

async function urlToBase64(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function gzipString(str) {
  const bytes = new TextEncoder().encode(str);
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

// Écrans de la borne publiés par l'organisation de l'événement (LAB-298), comme la RPC
// kiosk_get_screens (accueil du format du cadre principal, sinon portrait), et leurs images et
// polices (LAB-331) en base64 par adresse (absente si non téléchargée).
async function polaScreenImages(orgId, format) {
  if (!orgId) return { screens: null, screenImagesBase64: {} };
  const { data, error } = await supabase.from('kiosk_screens').select('kind, published').eq('org_id', orgId);
  if (error) throw error;
  const screens = publishedScreensForFormat(data, format);
  const urls = [...new Set([screens.home, screens.result].filter(Boolean).flatMap((p) => [...planImages(p), ...planFonts(p)]))];
  const images = await Promise.all(urls.map((url) => urlToBase64(url)));
  return { screens, screenImagesBase64: Object.fromEntries(urls.flatMap((url, i) => (images[i] ? [[url, images[i]]] : []))) };
}

/**
 * Télécharge le fichier .pola de l'événement (voir polaBundle.js pour son contenu).
 * Lève PolaExportError sans design approuvé ou sans son PNG.
 * Retourne { fileName, warnings } (éléments facultatifs manquants).
 */
export async function exportPolaFile(eventId) {
  const [
    { data: event, error: evErr }, { data: approvedFrames, error: dsErr }, { data: homeDesign, error: hdErr },
  ] = await Promise.all([
    supabase.from('events').select('id, org_id, name, access_code, start_date, end_date, form_config').eq('id', eventId).single(),
    // Plusieurs cadres possibles (LAB-314) : le principal est le cadre validé au plus petit slot.
    supabase.from('client_designs').select('id, kind, status, slot, label, format, canvas_json, final_png_url')
      .eq('event_id', eventId).eq('kind', 'print').eq('status', 'approved').order('slot', { ascending: true }),
    // Écran d'accueil du client (LAB-290) : embarqué seulement aux conditions de polaHomeDesign.
    supabase.from('client_designs').select('id, status, final_png_url')
      .eq('event_id', eventId).eq('kind', 'home').eq('status', 'approved').maybeSingle(),
  ]);
  if (evErr) throw evErr;
  if (dsErr) throw dsErr;
  if (hdErr) throw hdErr;

  const design = mainFrame(approvedFrames);
  const problem = polaDesignProblem(design);
  if (problem) throw new PolaExportError(problem);
  // Autres cadres : téléchargés seulement si le choix du cadre est actif (sinon .pola d'avant).
  const frames = event.form_config?.kiosk?.frame_choice?.enabled === true
    ? approvedFrames.filter((frame) => frame.id !== design.id)
    : [];

  const homeBgUrl = event.form_config?.kiosk?.home?.background_url;
  const homeDesignEntry = polaHomeDesign(event.form_config?.kiosk, homeDesign);
  const [designPngBase64, homeBackgroundBase64, homeDesignBase64, { contact, logoBase64 }, guestFormEnabled] = await Promise.all([
    urlToBase64(design.final_png_url),
    homeBgUrl ? urlToBase64(homeBgUrl) : null,
    homeDesignEntry ? urlToBase64(homeDesignEntry.final_png_url) : null,
    supabase.rpc('get_org_contact_by_event', { p_event_id: eventId })
      .then(({ data }) => data ?? null, () => null)
      // Logo de la société (LAB-257) : facultatif, signalé dans les avertissements s'il manque.
      .then(async (c) => ({ contact: c, logoBase64: c?.logo_url ? await urlToBase64(c.logo_url) : null })),
    // Fonctionnalités de l'org de l'événement, pas de celle de l'utilisateur (LAB-317). Lecture
    // impossible : questionnaire gardé (comme avant), la borne en ligne reste filtrée par la RPC.
    supabase.from('organizations').select('features').eq('id', event.org_id).maybeSingle()
      .then(({ data, error }) => (error || !data ? true : isFeatureEnabled(data.features ?? {}, 'guest_form')), () => true),
  ]);
  const { screens, screenImagesBase64 } = await polaScreenImages(event.org_id, design.format);
  const frameImagesBase64 = Object.fromEntries(await Promise.all(frames.map(async (frame) => (
    [frame.id, frame.final_png_url ? await urlToBase64(frame.final_png_url) : null]
  ))));

  const bundle = buildPolaBundle({
    event, design, designPngBase64, homeBackgroundBase64, contact, logoBase64, homeDesign, homeDesignBase64, guestFormEnabled,
    screens, screenImagesBase64, frames, frameImagesBase64,
  });

  const compressed = await gzipString(JSON.stringify(bundle));
  const fileName   = polaFileName(event);
  downloadBlob(new Blob([compressed], { type: 'application/octet-stream' }), fileName);

  return { fileName, warnings: polaBundleWarnings(bundle, { screens, frames }) };
}
