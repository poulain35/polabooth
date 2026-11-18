// Photos et galerie des invités.
import { parsePublicEvent, PUBLIC_EVENT_RPC } from '../publicEvent.js';
import { parsePublicPhotos, PUBLIC_PHOTOS_RPC, withDownloadUrls } from '../publicPhotos.js';
import { createGalleryOwnerCheck, getPhotosUrl } from '../galleryTracking.js';
import { isVideoUrl } from '../../utils/media.js';
import { supabase, supabaseAnon, FUNCTIONS_URL } from './client.js';
import { readEventFormConfig, updateEventFormConfig } from './forms.js';
import { callFunction } from './functions.js';

// ── Photos ────────────────────────────────────────────────────────────────────

export async function fetchEventsWithPhotoCount() {
  // Count agrégé côté serveur (embed PostgREST) — évite de télécharger toutes les photos pour compter.
  const { data, error } = await supabase
    .from('events')
    .select('id, name, client_name, access_code, created_at, photos(count)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(e => ({ ...e, photo_count: e.photos?.[0]?.count ?? 0 }));
}

export async function fetchPhotos(eventId) {
  const { data, error } = await supabase
    .from('photos')
    .select('*')
    .eq('event_id', eventId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Événement public par code d'accès via la RPC get_public_event (LAB-112 : anon n'a plus de
 * SELECT sur `events`). Renvoie { event: { id, name }, companyName, gallery, bookingBanner, eventType } ou null.
 */
export async function getPublicEvent(code) {
  const { data, error } = await supabase.rpc(PUBLIC_EVENT_RPC, { p_code: code });
  if (error) throw error;
  return parsePublicEvent(data);
}

/** Nom de l'entreprise associée à un code d'accès (utilisé dans les galeries publiques). */
export async function fetchCompanyByCode(code) {
  const pub = await getPublicEvent(code).catch(() => null);
  return pub?.companyName ?? '';
}

/**
 * Map { photoId -> download_url presigned } via la fonction get-photos. Repli silencieux si indispo.
 * `link` ({ via, photo } d'un QR code de la borne) : get-photos compte l'ouverture (LAB-232).
 */
async function fetchPhotoDownloadUrls(code, link) {
  try {
    // Hors de callFunction : GET avec la clé anon aussi en Authorization, adresse construite par
    // getPhotosUrl (paramètres du QR code) et repli silencieux sur {} au lieu d'une erreur.
    const res = await fetch(getPhotosUrl(FUNCTIONS_URL, code, link), {
      headers: { apikey: supabaseAnon, Authorization: `Bearer ${supabaseAnon}` },
    });
    if (!res.ok) return {};
    const { photos } = await res.json();
    return Object.fromEntries((photos ?? []).filter((p) => p.download_url).map((p) => [p.id, p.download_url]));
  } catch {
    return {};
  }
}

/**
 * Photos approuvées d'un événement actif, par code d'accès, via la RPC get_public_photos
 * (LAB-114 : anon n'a plus de SELECT sur `photos`).
 */
export async function fetchPublicPhotos(code) {
  const { data, error } = await supabase.rpc(PUBLIC_PHOTOS_RPC, { p_code: code });
  if (error) throw error;
  return parsePublicPhotos(data);
}

/**
 * Récupère l'événement et ses photos depuis un code d'accès public (galerie client, diaporama).
 * `link` ({ via, photo }) : seulement au premier chargement de la galerie ouverte par QR code.
 */
export async function fetchPhotosByAccessCode(code, link = {}) {
  const pub = await getPublicEvent(code).catch(() => null);
  if (!pub) throw new Error('Événement introuvable');
  const { event, companyName, bookingBanner, eventType, branding } = pub;

  // download_url (presigned GET, téléchargement forcé) généré par la fonction get-photos.
  // La RPC ne contient pas ce champ — repli sur photo_url si indispo.
  const [photos, downloadUrls] = await Promise.all([fetchPublicPhotos(code), fetchPhotoDownloadUrls(code, link)]);

  return { event, photos: withDownloadUrls(photos, downloadUrls), companyName, bookingBanner, eventType, branding };
}

/** Config galerie (form_config.gallery) d'un événement, lue depuis un code d'accès public. */
export async function getGalleryConfig(code) {
  const pub = await getPublicEvent(code).catch(() => null);
  return pub?.gallery ?? {};
}

export function getPhotoUploadUrl({ event_id, filename, content_type }) {
  return callFunction('get-photo-upload-url', {
    admin: true, json: { event_id, filename, content_type }, fallback: 'Erreur URL upload',
  });
}

export async function savePhoto({ event_id, photo_url, storage_path, thumbnail_url, width, height }) {
  const { data, error } = await supabase
    .from('photos')
    .insert({
      event_id, photo_url, storage_path, thumbnail_url: thumbnail_url ?? null, width: width ?? null, height: height ?? null,
      source: 'admin', media_type: isVideoUrl(storage_path ?? photo_url) ? 'video' : 'photo',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Presigned PUT R2 pour un invité (sans session admin). L'autorisation repose sur le
 * code d'accès de l'événement : header apikey anon uniquement, jamais de token admin.
 */
export function getGuestUploadUrl(code, { filename, content_type, content_length }) {
  // { presigned_url, public_url, storage_path }
  return callFunction('get-guest-upload-url', {
    json: { access_code: code, filename, content_type, content_length }, fallback: 'Erreur URL upload',
  });
}

/**
 * Enregistre une photo uploadée par un invité via l'Edge Function record-guest-photo.
 * Le serveur force source='guest' et décide status selon la modération de l'événement :
 * ni source ni status ne sont acceptés depuis le client (cf. LAB-22).
 */
export function recordGuestPhoto(code, { photo_url, storage_path, thumbnail_url, width, height, uploader_name }) {
  // { id, status }
  return callFunction('record-guest-photo', {
    json: { access_code: code, photo_url, storage_path, thumbnail_url, width, height, uploader_name },
    fallback: 'Erreur enregistrement photo',
  });
}

// LAB-232 : l'admin connecté propriétaire de l'événement n'est pas compté. La RLS events_owner_all
// ne lui montre que ses événements : une ligne trouvée par code = propriétaire.
const isGalleryOwner = createGalleryOwnerCheck({
  getUserId: async () => (await supabase.auth.getSession()).data.session?.user?.id ?? null,
  ownsEventByCode: async (code) => {
    const { data, error } = await supabase.from('events').select('id').eq('access_code', code.toUpperCase().trim()).limit(1);
    if (error) throw error;
    return (data ?? []).length > 0;
  },
});

/**
 * Enregistre un évènement d'usage de la galerie (ouverture, téléchargement, partage) par la RPC
 * track_gallery_event (code d'accès vérifié côté serveur, LAB-227). Fire-and-forget : un refus
 * n'empêche jamais d'utiliser la galerie. Rien n'est compté pour l'admin propriétaire (LAB-232).
 */
export function trackGalleryEvent(code, type, count = 1) {
  if (!code) return;
  isGalleryOwner(code).then((owner) => {
    if (owner) return;
    supabase.rpc('track_gallery_event', { p_code: code, p_type: type, p_count: count }).then(() => {}, () => {});
  });
}

/** Statistiques agrégées d'usage de la galerie pour un événement (lecture admin). */
export async function fetchGalleryStats(eventId) {
  const { data, error } = await supabase
    .from('gallery_analytics')
    .select('type, count, created_at')
    .eq('event_id', eventId);
  if (error) throw error;
  const stats = { views: 0, downloads: 0, shares: 0, lastActivity: null };
  for (const row of (data ?? [])) {
    if (row.type === 'view') stats.views += 1;
    else if (row.type === 'share') stats.shares += row.count;
    else stats.downloads += row.count; // download | download_all | download_selection
    if (!stats.lastActivity || row.created_at > stats.lastActivity) stats.lastActivity = row.created_at;
  }
  return stats;
}

export function deletePhoto(photoId) {
  return callFunction('delete-photo', { admin: true, method: 'DELETE', json: { photo_id: photoId }, fallback: 'Erreur suppression' });
}

/**
 * Fusionne un patch dans form_config.gallery sans écraser le reste de form_config.
 * Même mécanisme que les toggles audio/photos : on relit le form_config courant,
 * on applique le patch sur la sous-clé `gallery`, puis on réécrit via updateEventFormConfig.
 */
export async function updateGalleryConfig(eventId, patch) {
  const current = await readEventFormConfig(eventId);
  const nextConfig = { ...current, gallery: { ...(current.gallery ?? {}), ...patch } };
  const updated = await updateEventFormConfig(eventId, nextConfig);
  return updated.form_config?.gallery ?? {};
}

/** Change le statut de modération d'une photo ('approved' | 'pending' | 'rejected'). */
export async function setPhotoStatus(photoId, status) {
  const { data, error } = await supabase
    .from('photos')
    .update({ status })
    .eq('id', photoId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Change le statut de modération de plusieurs photos en une requête. */
export async function setPhotosStatus(photoIds, status) {
  if (!photoIds?.length) return [];
  const { data, error } = await supabase
    .from('photos')
    .update({ status })
    .in('id', photoIds)
    .select();
  if (error) throw error;
  return data ?? [];
}
