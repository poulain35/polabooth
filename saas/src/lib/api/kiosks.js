// Bornes : licences, association, versions, envoi d'un événement, PIN, papier, monitoring, alertes.
import { sumCopies } from '../printCopies.js';
import { supabase } from './client.js';
import { callFunction } from './functions.js';

// ── Licences kiosk ───────────────────────────────────────────────────────────

// Colonnes de kiosk_licenses lisibles par authenticated (droits par colonne, LAB-242) :
// select('*') est refusé, la colonne secret n'est plus lisible.
const LICENSE_COLUMNS = [
  'id', 'machine_id', 'machine_name', 'label', 'color', 'org_id', 'is_active', 'retired_at',
  'activated_at', 'last_seen_at', 'created_at', 'app_version',
  'printer_status', 'printer_name', 'printer_status_at', 'paper_capacity', 'paper_reset_at',
  'admin_pin_set_at', 'admin_pin_pushed_at', 'admin_pin_received_at',
  'update_requested_version', 'update_requested_at', 'update_received_at', 'update_failed_at', 'update_error',
  'pending_uploads', 'pending_uploads_at', 'camera_status', 'camera_status_at',
  'event_push_id', 'event_push_requested_at', 'event_push_received_at', 'event_push_applied_at', 'event_push_error',
  'camera_report', 'camera_request',
].join(', ');

/**
 * Bornes visibles (RLS : celles du compte, toutes pour le super-admin).
 * Par défaut sans les bornes retirées (listes de choix : planning, événement).
 */
export async function fetchLicenses({ includeRetired = false } = {}) {
  let q = supabase
    .from('kiosk_licenses')
    .select(LICENSE_COLUMNS)
    .order('created_at', { ascending: false });
  if (!includeRetired) q = q.is('retired_at', null);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/** Bornes en service dont le nom, l'identifiant ou le nom du PC contient le mot. */
export async function searchLicenses(orFilter, limit = 5) {
  const { data, error } = await supabase
    .from('kiosk_licenses')
    .select('id, label, machine_id, machine_name')
    .is('retired_at', null)
    .or(orFilter)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

// ── Association des bornes (LAB-243) ──────────────────────────────────────────
// Refus fonctionnels dans le JSON (champ status), exceptions pour les droits et la limite
// d'essais (PT429) : messages dans lib/kioskPairing.js.

/** État d'un code affiché par une borne (kiosk_pairing_lookup). Un code inconnu compte comme essai faux. */
export async function lookupPairing(code) {
  const { data, error } = await supabase.rpc('kiosk_pairing_lookup', { p_code: code });
  if (error) throw error;
  return data;
}

/**
 * Associe la borne qui affiche ce code. Retourne { status: 'ok', mode, license_id, label, org_id,
 * org_name } ou un refus { status, … }. orgId : super-admin seulement (sinon son propre compte).
 */
export async function approvePairing({ code, label, replaceLicenseId = null, orgId = null }) {
  const { data, error } = await supabase.rpc('kiosk_pairing_approve', {
    p_code:               code,
    p_label:              label,
    p_replace_license_id: replaceLicenseId,
    p_org_id:             orgId,
  });
  if (error) throw error;
  return data;
}

/** Retire une borne : secret effacé, hors des listes de choix et de la limite, réassociable. */
export async function retireLicense(licenseId) {
  const { data, error } = await supabase.rpc('kiosk_retire_license', { p_license_id: licenseId });
  if (error) throw error;
  return data;
}

/**
 * Comptes visibles pour le parc kiosk : id, nom, limite de bornes (vide = illimité).
 * RLS organizations : chacun ne lit que son compte. ownOrgId = compte de l'utilisateur connecté.
 */
export async function fetchKioskAccounts() {
  const { data: { session } } = await supabase.auth.getSession();
  // RPC : le super-admin voit tous les comptes, les autres leurs seuls comptes (pas de policy
  // super-admin sur organizations, lue ailleurs comme « mon compte »).
  const { data, error } = await supabase.rpc('kiosk_list_accounts');
  if (error) throw error;
  const accounts = data ?? [];
  const own = accounts.find((o) => o.owner_id === session?.user?.id) ?? null;
  return { accounts, ownOrgId: own?.id ?? null };
}

/** Limite de bornes d'un compte (null = illimité). Super-admin seulement (RPC kiosk_set_org_limit). */
export async function updateOrgKioskLimit(orgId, limit) {
  const { error } = await supabase.rpc('kiosk_set_org_limit', { p_org_id: orgId, p_limit: limit });
  if (error) throw error;
}

// ── Versions kiosk (déploiement) ──────────────────────────────────────────────

export async function fetchKioskReleases() {
  const { data, error } = await supabase
    .from('kiosk_releases')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Empreinte SHA-256 (hex minuscule) d'un fichier, calculée dans le navigateur. */
export async function sha256Hex(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** PUT d'un fichier sur une URL présignée du stockage (R2 / S3), avec progression en %. */
function putToStorage(url, file, contentType, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300)
      ? resolve()
      : reject(new Error(`Envoi de l'installeur refusé par le stockage (HTTP ${xhr.status}).`));
    xhr.onerror = () => reject(new Error("Envoi de l'installeur interrompu (réseau, ou CORS du bucket)."));
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.send(file);
  });
}

/**
 * LAB-269 : l'installeur part sur le stockage des médias (R2 / S3) par URL présignée
 * (get-release-upload-url, administrateurs de l'application) : Supabase Storage limite les
 * fichiers à 50 Mo sur l'offre gratuite. `onProgress(pourcentage)` suit l'envoi.
 */
export async function uploadKioskRelease({ version, notes, file, onProgress }) {
  const v = version.trim();
  if (!/^\d+\.\d+\.\d+$/.test(v)) throw new Error('Version invalide (format attendu : 1.2.3).');

  // Hash calculé avant l'upload : le kiosk refuse un installeur dont l'empreinte diffère.
  const sha256 = await sha256Hex(file);

  const upload = await callFunction('get-release-upload-url', {
    admin: true, json: { version: v, content_length: file.size }, fallback: "Impossible de préparer l'envoi de l'installeur.",
  });

  await putToStorage(upload.presigned_url, file, upload.content_type, onProgress);

  const { data, error } = await supabase
    .from('kiosk_releases')
    .upsert({ version: v, exe_url: upload.public_url, notes: notes ?? null, sha256 }, { onConflict: 'version' })
    .select().single();
  if (error) throw error;
  return data;
}

/**
 * LAB-200 : demande à une borne d'installer cette version (seule façon de la mettre à jour).
 * Nouvelle demande = réception et échec précédents effacés. Retourne les colonnes update_* à jour.
 */
export async function requestKioskUpdate(licenseId, version) {
  const { data, error } = await supabase.rpc('kiosk_request_update', {
    p_license_id: licenseId,
    p_version: version,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

// ── Envoi d'un événement sur la borne (LAB-245) ───────────────────────────────

/**
 * Demande à la borne de charger cet événement (propriétaire de la borne ET de l'événement, ou
 * super-admin ; même compte). Un nouvel envoi remplace le précédent. Retourne les colonnes
 * event_push_* à jour.
 */
export async function requestEventOnKiosk(licenseId, eventId) {
  const { data, error } = await supabase.rpc('kiosk_request_event', {
    p_license_id: licenseId,
    p_event_id: eventId,
  });
  if (error) throw error;
  return data;
}

/**
 * Demande de réglages de l'appareil photo (LAB-429) : seulement les valeurs changées, codes pris dans les listes
 * envoyées par la borne. Remplace une demande pas encore appliquée. Retourne la nouvelle demande (camera_request).
 */
export async function setKioskCameraSettings(licenseId, values) {
  const { data, error } = await supabase.rpc('set_kiosk_camera_settings', {
    p_license_id: licenseId,
    p_values: values,
  });
  if (error) throw error;
  return data;
}

/** Annule l'envoi tant que la borne n'a pas affiché l'événement. Retourne les colonnes effacées. */
export async function cancelEventRequest(licenseId) {
  const { data, error } = await supabase.rpc('kiosk_cancel_event_request', { p_license_id: licenseId });
  if (error) throw error;
  return data;
}

/** Événements qu'on peut envoyer sur une borne (RLS : ceux du compte, tous pour le super-admin). */
export async function fetchPushableEvents() {
  const { data, error } = await supabase
    .from('events')
    .select('id, org_id, name, status, start_date, photobooth_id')
    .in('status', ['active', 'submitted'])
    .order('start_date', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}

export async function deleteKioskRelease(releaseId) {
  const { error } = await supabase.from('kiosk_releases').delete().eq('id', releaseId);
  if (error) throw error;
}

function callKioskAdminPin(body) {
  return callFunction('kiosk-admin-pin', { admin: true, json: body, fallback: "Erreur lors de l'enregistrement du PIN" });
}

/** Définit le PIN admin d'une borne (haché côté serveur). Retourne les dates de statut du PIN. */
export function setKioskAdminPin(licenseId, pin) {
  return callKioskAdminPin({ action: 'set', license_id: licenseId, pin });
}

/** Envoie le PIN défini à la borne, qui le récupère à sa prochaine connexion. */
export function pushKioskAdminPin(licenseId) {
  return callKioskAdminPin({ action: 'push', license_id: licenseId });
}

export async function updateLicense(id, updates) {
  const { error } = await supabase
    .from('kiosk_licenses')
    .update(updates)
    .eq('id', id);
  if (error) throw error;
}

export async function deleteLicense(id) {
  const { error } = await supabase
    .from('kiosk_licenses')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

export async function updateLicenseColor(id, color) {
  const { error } = await supabase.from('kiosk_licenses').update({ color }).eq('id', id);
  if (error) throw error;
}

/**
 * Tirages consommés par machine depuis le dernier rechargement de rouleau.
 * @param {{machine_id: string|null, paper_reset_at: string|null}[]} machines
 * @returns {Promise<Record<string, number>>} machine_id → nb de copies imprimées
 * Une borne retirée qui a cédé son PC n'a plus de machine_id : ignorée.
 */
export async function getPaperUsage(machines) {
  const entries = await Promise.all(
    machines.filter((m) => m.machine_id).map(async (m) => {
      let q = supabase.from('print_logs').select('copies').eq('machine_id', m.machine_id);
      if (m.paper_reset_at) q = q.gte('printed_at', m.paper_reset_at);
      const { data } = await q;
      const used = sumCopies(data);
      return [m.machine_id, used];
    })
  );
  return Object.fromEntries(entries);
}

/**
 * Données de monitoring temps réel des bornes visibles, retirées comprises (la page les range à part).
 * Retourne les licences enrichies avec l'event actif et la dernière photo.
 */
export async function fetchKioskMonitoring() {
  const [{ data: licenses, error: licErr }, { data: events, error: evErr }, { data: photos }] =
    await Promise.all([
      supabase.from('kiosk_licenses').select(LICENSE_COLUMNS).order('created_at', { ascending: false }),
      supabase.from('events').select('id, name, start_date, end_date, status, photobooth_id')
        .not('photobooth_id', 'is', null),
      supabase.from('photos').select('id, event_id, created_at, thumbnail_url, photo_url')
        .eq('source', 'kiosk')
        .order('created_at', { ascending: false })
        .limit(200),
    ]);

  if (licErr) throw licErr;
  if (evErr)  throw evErr;

  // Map event_id → latest photo
  const latestPhotoByEvent = {};
  for (const p of (photos ?? [])) {
    if (!latestPhotoByEvent[p.event_id]) latestPhotoByEvent[p.event_id] = p;
  }

  // Enrich each license
  return (licenses ?? []).map((lic) => {
    const linkedEvents = (events ?? []).filter((e) => e.photobooth_id === lic.id);
    const now = new Date();
    const activeEvent = linkedEvents.find((e) => {
      const start = e.start_date ? new Date(e.start_date) : null;
      const end   = e.end_date   ? new Date(e.end_date)   : null;
      return e.status !== 'archived' && (!start || start <= now) && (!end || end >= now);
    }) ?? linkedEvents[0] ?? null;

    const lastPhoto = activeEvent ? latestPhotoByEvent[activeEvent.id] ?? null : null;

    return { ...lic, activeEvent, lastPhoto };
  });
}

/** Historique des alertes parc kiosk (ouvertes en premier via resolved_at null).
 * `hideDismissed` : sans les alertes retirées de la cloche par la croix (l'onglet Alertes les garde).
 */
export async function fetchKioskAlerts(limit = 20, { hideDismissed = false } = {}) {
  let query = supabase
    .from('kiosk_alerts')
    .select('id, event_id, machine_id, alert_type, detail, sent_at, resolved_at, events(name)')
    .order('sent_at', { ascending: false })
    .limit(limit);
  if (hideDismissed) query = query.is('dismissed_at', null);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/** Retire une alerte de la cloche (croix). L'alerte reste ouverte : seule la cloche la cache. */
export async function dismissKioskAlert(alertId) {
  const { error } = await supabase.rpc('dismiss_kiosk_alert', { p_alert_id: alertId });
  if (error) throw error;
}
