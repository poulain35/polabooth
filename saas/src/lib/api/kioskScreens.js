// Écrans de la borne composés par l'admin.
import {
  SCREEN_FONT_MAX_BYTES, dataUrlMime, draftSizeProblem, inlineImageSources, nextScreenVersion, planFonts,
  planImages, planSizeProblem, publishedPlan, referencedScreenFiles, replaceImageSources, screenAssetName,
  screenAssetNames, screenFontContentType, screenStorageFolder, screenStoragePath, screensByKind,
  staleScreenFiles, unusedScreenAssets,
} from '../kioskScreensPublish.js';
import { kioskStorageErrorMessage } from '../kioskBackground.js';
import { screenLayoutKind } from '../kioskScreenLayout.js';
import { supabase } from './client.js';
import { fetchGoogleFontFile } from './library.js';
import { sha256Hex } from './kiosks.js';
import { ownOrganization } from './session.js';

// ── Écrans de la borne composés par l'admin (LAB-298) ───────────────────────
// Une ligne kiosk_screens par écran (home, result) et par organisation. Le brouillon ne change
// rien sur les bornes ; elles ne lisent que `published` (RPC kiosk_get_screens). Images dans
// kiosk-backgrounds/org/{org_id}/ (règle kiosk_bg_path_allowed : propriétaire de l'org).

const KIOSK_SCREEN_COLUMNS = 'id, org_id, kind, draft_json, draft_updated_at, published, published_version, published_at';
const KIOSK_SCREEN_IMAGE_CACHE = '31536000';

/**
 * Org du propriétaire connecté, nom de la société et logo (pour le modèle d'origine de l'accueil)
 * et ses deux écrans : `{ orgId, brandName, logoUrl, screens: { home, result } }`.
 */
export async function getKioskScreensContext() {
  const { signedIn, org } = await ownOrganization('id, name, contact_company, logo_url');
  if (!signedIn) throw new Error('Session expirée : reconnectez-vous.');
  if (!org) throw new Error('Aucune organisation pour ce compte.');
  const { data: rows, error: rowsError } = await supabase
    .from('kiosk_screens').select(KIOSK_SCREEN_COLUMNS).eq('org_id', org.id);
  if (rowsError) throw rowsError;
  return {
    orgId: org.id,
    brandName: org.contact_company || org.name || '',
    logoUrl: org.logo_url || null,
    screens: screensByKind(rows),
  };
}

/**
 * Plan publié d'un écran de la borne (`kiosk_screens.published`), ou null : aperçu « Sur l'écran
 * de partage » du modèle photo (LAB-309). Sans `orgId`, l'org du propriétaire connecté.
 */
export async function getPublishedKioskScreen(kind, orgId = null) {
  let id = orgId;
  if (!id) {
    const { org } = await ownOrganization('id');
    id = org?.id ?? null;
  }
  if (!id) return null;
  const { data, error } = await supabase
    .from('kiosk_screens').select('published').eq('org_id', id).eq('kind', kind).maybeSingle();
  if (error) throw error;
  return data?.published ?? null;
}

/** Ligne d'un écran relue (null s'il n'en a pas encore), par exemple après une publication échouée. */
export async function getKioskScreen(orgId, kind) {
  const { data, error } = await supabase
    .from('kiosk_screens').select(KIOSK_SCREEN_COLUMNS).eq('org_id', orgId).eq('kind', kind).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

function dataUrlToBlob(dataUrl) {
  const comma = String(dataUrl).indexOf(',');
  const head = String(dataUrl).slice(0, comma);
  const body = String(dataUrl).slice(comma + 1);
  const type = dataUrlMime(head) ?? 'application/octet-stream';
  const binary = /;base64/i.test(head) ? atob(body) : decodeURIComponent(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

// Le bucket n'accepte que PNG et JPEG : une autre image (WebP, GIF, SVG) est redessinée en PNG.
async function screenAssetBlob(dataUrl) {
  const mime = dataUrlMime(dataUrl);
  if (mime === 'image/png' || mime === 'image/jpeg') return dataUrlToBlob(dataUrl);
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Une image importée est illisible : retirez-la, puis réessayez.'));
    el.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || 1024;
  canvas.height = img.naturalHeight || 1024;
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

const uploadedScreenAssets = new Map();

// Images importées (data URL dans le JSON) → org/{org_id}/screen-asset-{empreinte}.png|jpg : le
// brouillon garde leur adresse, pas leurs octets. Même image = même fichier, envoyé une fois.
async function storeScreenAssets(orgId, state) {
  const sources = inlineImageSources(state);
  if (sources.length === 0) return state;
  const bucket = supabase.storage.from('kiosk-backgrounds');
  const urls = new Map();
  for (const src of sources) {
    const blob = await screenAssetBlob(src);
    const hash = (await sha256Hex(blob)).slice(0, 32);
    const path = screenStoragePath(orgId, screenAssetName(hash, blob.type));
    if (!uploadedScreenAssets.has(path)) {
      const { error } = await bucket.upload(path, blob, {
        upsert: true, contentType: blob.type, cacheControl: KIOSK_SCREEN_IMAGE_CACHE,
      });
      if (error) throw new Error(kioskStorageErrorMessage(error));
      uploadedScreenAssets.set(path, bucket.getPublicUrl(path).data.publicUrl);
    }
    urls.set(src, uploadedScreenAssets.get(path));
  }
  return replaceImageSources(state, urls);
}

// Aperçu des cartes : org/{org_id}/screen-{kind}-preview.png (hors du nettoyage des versions).
async function storeScreenPreview(orgId, kind, previewDataUrl) {
  if (!previewDataUrl) return;
  const { error } = await supabase.storage.from('kiosk-backgrounds')
    .upload(screenStoragePath(orgId, `screen-${kind}-preview.png`), dataUrlToBlob(previewDataUrl), {
      upsert: true, contentType: 'image/png',
    });
  if (error) console.warn('Aperçu de l’écran non enregistré :', error.message);
}

/** Adresse de l'aperçu d'un écran (à suffixer d'une version pour le cache du navigateur). */
export function kioskScreenPreviewUrl(orgId, kind) {
  return supabase.storage.from('kiosk-backgrounds')
    .getPublicUrl(screenStoragePath(orgId, `screen-${kind}-preview.png`)).data.publicUrl;
}

async function removeScreenFiles(paths) {
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from('kiosk-backgrounds').remove(paths);
  if (error) console.warn('Fichiers des écrans de la borne non supprimés :', error.message);
}

// Images importées que plus rien ne référence (LAB-317), sans bloquer. Gardées : celles des deux
// brouillons et des plans publiés de l'org, et `keep` (images vues pendant la séance d'édition :
// une annulation peut faire revenir une image retirée puis enregistrée).
async function cleanupScreenAssets(orgId, draft, keep) {
  try {
    const { data: files, error } = await supabase.storage.from('kiosk-backgrounds')
      .list(screenStorageFolder(orgId), { limit: 1000, search: 'screen-asset-' });
    if (error) throw error;
    const known = new Set([...screenAssetNames(draft), ...(keep ?? [])]);
    const candidates = unusedScreenAssets((files ?? []).map((f) => f.name), known);
    if (candidates.length === 0) return;
    const { data: rows, error: rowsError } = await supabase
      .from('kiosk_screens').select('draft_json, published').eq('org_id', orgId);
    if (rowsError) throw rowsError;
    const unused = unusedScreenAssets(candidates, new Set([...known, ...referencedScreenFiles(rows)]));
    const paths = unused.map((name) => screenStoragePath(orgId, name));
    await removeScreenFiles(paths);
    for (const path of paths) uploadedScreenAssets.delete(path);
  } catch (err) {
    console.warn('Nettoyage des images importées impossible :', err?.message ?? err);
  }
}

/**
 * Enregistre le brouillon d'un écran (`state` : enveloppe de serializeState) sans toucher à la
 * version publiée. Les images importées partent dans Storage d'abord ; un brouillon trop lourd est
 * refusé avec un message clair. Puis les images importées que plus rien ne référence sont
 * supprimées (sauf `keepAssets`, noms ou adresses). Retourne la ligne à jour.
 */
export async function saveKioskScreenDraft(orgId, kind, state, { previewDataUrl = null, keepAssets = [] } = {}) {
  const draft = await storeScreenAssets(orgId, state);
  const tooBig = draftSizeProblem(draft);
  if (tooBig) throw new Error(tooBig);
  const { data, error } = await supabase
    .from('kiosk_screens')
    .upsert(
      { org_id: orgId, kind, draft_json: draft, draft_updated_at: new Date().toISOString() },
      { onConflict: 'org_id,kind' },
    )
    .select(KIOSK_SCREEN_COLUMNS)
    .single();
  if (error) throw error;
  await storeScreenPreview(orgId, kind, previewDataUrl);
  await cleanupScreenAssets(orgId, draft, keepAssets);
  return data;
}

// Fichiers des autres versions de l'écran (la précédente, les essais échoués) : sans bloquer.
async function cleanupKioskScreenFiles(orgId, kind, version) {
  try {
    const { data, error } = await supabase.storage.from('kiosk-backgrounds')
      .list(screenStorageFolder(orgId), { limit: 1000, search: `screen-${kind}-v` });
    if (error) throw error;
    const stale = staleScreenFiles((data ?? []).map((f) => f.name), kind, version);
    await removeScreenFiles(stale.map((name) => screenStoragePath(orgId, name)));
  } catch (err) {
    console.warn('Nettoyage des écrans de la borne impossible :', err?.message ?? err);
  }
}

/**
 * Publie un écran sur les bornes. `layout` et `images` (`[{ name, dataUrl }]`) viennent de
 * buildScreenLayout (sans contrôle bloquant) et d'exportScreenParts, calculés pour la version
 * `nextScreenVersion(row)` ; `row` est la ligne lue par la page (null si l'écran n'en a pas).
 * 1. brouillon enregistré ; 2. version réservée (`published_version` = n seulement s'il vaut
 * encore n − 1 : deux publications en même temps ne prennent jamais le même numéro) ; 3. images
 * envoyées ; 4. `published` écrit (toujours conditionné à n) ; 5. fichiers des autres versions
 * supprimés, sans bloquer. Un échec après la réservation « brûle » le numéro : jamais réutilisé.
 */
/**
 * Fichier TTF ou OTF de chaque police des textes vivants à publier (`parts.fonts` de
 * buildScreenLayout, LAB-331) : police Google par google-font-file (le navigateur n'obtient que du
 * WOFF2), police importée par son fichier du bucket fonts. Une police introuvable revient dans
 * `failed` : la publication part quand même, ses textes en DM Sans.
 */
export async function fetchScreenFonts(fonts) {
  const files = [];
  const failed = [];
  for (const font of fonts ?? []) {
    try {
      const res = font.source === 'google'
        ? await fetchGoogleFontFile(font.family, font.weight)
        : await fetch(font.url);
      const blob = res.ok ? await res.blob() : null;
      if (blob && blob.size > 0 && blob.size <= SCREEN_FONT_MAX_BYTES) files.push({ name: font.name, blob });
      else failed.push(font);
    } catch {
      failed.push(font);
    }
  }
  return { files, failed };
}

export async function publishKioskScreen({
  orgId, kind, row, state, layout, images, fonts = [], previewDataUrl = null, keepAssets = [],
}) {
  const version = nextScreenVersion(row);
  if (layout?.version !== version || layout?.kind !== screenLayoutKind(kind)) throw new Error('Plan de l’écran incohérent : réessayez.');
  const bucket = supabase.storage.from('kiosk-backgrounds');
  const urlOf = (name) => bucket.getPublicUrl(screenStoragePath(orgId, name)).data.publicUrl;
  const plan = publishedPlan(layout, urlOf);
  const tooBig = planSizeProblem(plan);
  if (tooBig) throw new Error(tooBig);
  const names = planImages(layout);
  const byName = new Map(images.map((i) => [i.name, i.dataUrl]));
  if (names.some((n) => !byName.has(n)) || byName.size !== names.length) {
    throw new Error('Export des images de l’écran incomplet : réessayez.');
  }
  const fontNames = planFonts(layout);
  const fontByName = new Map(fonts.map((f) => [f.name, f.blob]));
  if (fontNames.some((n) => !fontByName.has(n))) throw new Error('Polices de l’écran incomplètes : réessayez.');

  const saved = await saveKioskScreenDraft(orgId, kind, state, { previewDataUrl, keepAssets });
  const previous = row?.published_version ?? 0;
  if ((saved.published_version ?? 0) !== previous) {
    throw new Error('Cet écran vient d’être publié ailleurs (autre onglet ?). Rechargez la page, puis publiez à nouveau.');
  }
  const { data: reserved, error: reserveError } = await supabase
    .from('kiosk_screens')
    .update({ published_version: version })
    .eq('id', saved.id)
    .eq('published_version', previous)
    .select('id');
  if (reserveError) throw reserveError;
  if (!reserved?.length) {
    throw new Error('Une autre publication de cet écran est en cours. Rechargez la page, puis réessayez.');
  }

  const uploaded = [];
  try {
    for (const name of names) {
      const path = screenStoragePath(orgId, name);
      const { error } = await bucket.upload(path, dataUrlToBlob(byName.get(name)), {
        upsert: true, contentType: 'image/png', cacheControl: KIOSK_SCREEN_IMAGE_CACHE,
      });
      if (error) throw new Error(kioskStorageErrorMessage(error));
      uploaded.push(path);
    }
    for (const name of fontNames) {
      const path = screenStoragePath(orgId, name);
      const { error } = await bucket.upload(path, fontByName.get(name), {
        upsert: true, contentType: screenFontContentType(name), cacheControl: KIOSK_SCREEN_IMAGE_CACHE,
      });
      if (error) throw new Error(kioskStorageErrorMessage(error));
      uploaded.push(path);
    }
    const publishedAt = new Date().toISOString();
    const { data: done, error } = await supabase
      .from('kiosk_screens')
      .update({ published: plan, published_at: publishedAt, draft_updated_at: publishedAt })
      .eq('id', saved.id)
      .eq('published_version', version)
      .select(KIOSK_SCREEN_COLUMNS);
    if (error) throw error;
    if (!done?.length) throw new Error('Une autre publication de cet écran est passée entre-temps. Rechargez la page.');
    await cleanupKioskScreenFiles(orgId, kind, version);
    return done[0];
  } catch (err) {
    await removeScreenFiles(uploaded);
    throw err;
  }
}

/**
 * Dépublie un écran : `published` = NULL, la borne revient à l'écran standard à sa prochaine
 * synchro. `published_version` est gardé : la prochaine publication prendra le numéro suivant.
 */
export async function unpublishKioskScreen(rowId) {
  const { data, error } = await supabase
    .from('kiosk_screens')
    .update({ published: null })
    .eq('id', rowId)
    .select(KIOSK_SCREEN_COLUMNS)
    .single();
  if (error) throw error;
  return data;
}
