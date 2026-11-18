// Design du client (éditeur public par code d'accès) : brouillon, cadres, images, versions, envoi.
import { functionError } from '../httpErrors.js';
import { frameFields } from '../clientDesignFrames.js';
import { createSaveQueue, saveTimeoutMs, sendWithRetry } from '../saveQueue.js';
import { STORABLE_IMAGE_TYPES, createImageStore, dataUrlToBytes, isDataImage, needsStorage } from '../designImages.js';
import { callFunction, requestFunction } from './functions.js';

/** Valide un code d'accès et retourne l'événement + le design en cours. */
export async function getEventByCode(code) {
  // { event, design, home_editor, home_design } : home_editor = onglet « Mon écran d'accueil »
  // affiché (LAB-289), home_design = l'écran d'accueil enregistré (null sans onglet).
  return callFunction(`get-event?code=${encodeURIComponent(code)}`, { method: 'GET', fallback: 'Erreur serveur' });
}

/**
 * Sauvegarde du brouillon (LAB-323). Le canvas_json peut peser plusieurs Mo :
 *  - un seul envoi : `withVersion` demande à autosave-design de créer aussi la version de
 *    l'historique (plus de second envoi à design-versions, sauf fonction pas encore à jour) ;
 *  - délai maximal selon la taille et un nouvel essai sur une panne passagère (`onRetry` prévient
 *    l'appelant), puis une erreur claire : jamais d'attente sans fin (`saveQueue.js`) ;
 *  - une seule sauvegarde en cours, une seule en attente par brouillon (la plus récente) ;
 *  - contenu identique au dernier envoi réussi : aucun envoi.
 * La promesse se résout une fois le brouillon enregistré ; en cas d'échec, rien n'est effacé côté
 * éditeur, l'appelant garde son état « modifié ».
 */
const _saveQueue = createSaveQueue();
// Corps du dernier envoi réussi, par brouillon (code|kind|slot).
const _lastSaved = new Map();

// `body` déjà sérialisé : le même texte sert à chaque essai et à la comparaison.
function _postJson(path, body, signal) {
  return callFunction(path, { body, signal, fallback: 'Erreur sauvegarde' });
}

/**
 * `kind` : 'print' (modèle photo, défaut) ou 'home' (écran d'accueil de la borne, LAB-289).
 * `slot` et `label` (LAB-313) : cadre du modèle photo et son nom, seulement quand le choix du cadre
 * est actif ; absents, le corps envoyé est celui d'avant. `withVersion` (LAB-323) : crée aussi la
 * version de l'historique. Retourne `{ design_id, version? }` ou `{ skipped: true }`.
 */
export function autosaveDesign({ code, canvasJson, format, kind = 'print', slot, label, withVersion = false, onRetry }) {
  const key = `${code}|${kind}|${slot ?? 1}`;
  const body = JSON.stringify({
    code, canvas_json: canvasJson, format, kind, ...frameFields({ slot, label }),
    ...(withVersion ? { with_version: true } : {}),
  });
  if (_lastSaved.get(key) === body) return Promise.resolve({ skipped: true });

  return _saveQueue.enqueue(key, async () => {
    const options = { timeoutMs: saveTimeoutMs(body.length), onRetry };
    const result = await sendWithRetry((signal) => _postJson('autosave-design', body, signal), options);
    // Fonction pas encore redéployée (pas de champ version) : version enregistrée à part, comme avant.
    if (withVersion && result.version === undefined) {
      const versionBody = JSON.stringify({
        code, kind, action: 'save', canvas_json: canvasJson, format, label: null, ...frameFields({ slot }),
      });
      result.version = (await sendWithRetry(
        (signal) => _postJson('design-versions', versionBody, signal), { ...options, timeoutMs: saveTimeoutMs(versionBody.length) },
      )).version;
    }
    _lastSaved.set(key, body);
    return result;
  });
}

/**
 * Supprime un cadre ajouté (slot > 1) non validé et son historique (autosave-design `delete`,
 * LAB-313). Une sauvegarde en attente pour ce cadre est annulée, celle en cours est attendue (elle
 * recréerait le cadre). 404 (cadre jamais enregistré) = déjà supprimé.
 */
export async function deleteDesignFrame({ code, slot }) {
  const key = `${code}|print|${slot}`;
  _saveQueue.cancel(key, { skipped: true });
  await _saveQueue.settled(key);
  _lastSaved.delete(key);

  // requestFunction : le 404 « Cadre introuvable » est lu avant l'erreur.
  const { res, data } = await requestFunction('autosave-design', { json: { code, kind: 'print', slot, delete: true } });
  if (res.status === 404 && data?.error === 'Cadre introuvable') return { deleted: true, slot };
  if (!res.ok) throw functionError(res, data, 'Erreur lors de la suppression du cadre');
  return data;
}

/** Enregistre le nom de l'événement saisi par le client (via service_role, RLS bloque l'anon). */
export async function setEventName({ code, name }) {
  // { name }
  return callFunction('set-event-name', { json: { code, name }, fallback: "Erreur lors de l'enregistrement du nom" });
}

/**
 * Approuve ou rejette un design soumis (admin uniquement). Refus Brevo (502) : l'erreur porte
 * `reviewed: true`, la décision est enregistrée mais le client n'a pas reçu l'email.
 */
export async function reviewDesign({ designId, action, feedback }) {
  return callFunction('review-design', {
    admin: true,
    json: { design_id: designId, action, feedback },
    fallback: 'Erreur lors de la revue',
    errorFields: (data) => ({ reviewed: data.reviewed === true }),
  });
}

/**
 * Supprime l'arrière-plan d'une image. Renvoie l'adresse du PNG transparent rangé dans le bucket
 * `designs` (LAB-348), ou un data URI si le stockage a échoué côté serveur.
 * Auth : code d'accès événement (client) OU session admin si pas de code.
 */
export async function removeImageBackground(image, code = null) {
  const data = await callFunction('remove-background', {
    admin: !code, json: { image, code }, fallback: 'Erreur lors de la suppression du fond',
  });
  return data.url;
}

// ── Images des modèles dans le stockage (LAB-348) ─────────────────────────────

/**
 * Range une image d'un modèle (octets PNG, JPEG ou WebP) dans le bucket `designs` par
 * upload-design-image ; renvoie son adresse https. Auth : code d'accès de l'événement (client) OU
 * session admin si pas de code (bibliothèque de modèles). `preview` (admin) : aperçu d'un modèle
 * de la bibliothèque, rangé dans `templates/previews/` (LAB-356).
 */
export async function uploadDesignImage(bytes, mime, code = null, { preview = false } = {}) {
  const query = code ? `?code=${encodeURIComponent(code)}` : (preview ? '?kind=preview' : '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const data = await callFunction(`upload-design-image${query}`, {
      admin: !code, body: bytes, contentType: mime, signal: controller.signal,
      fallback: "Erreur lors de l'envoi de l'image",
    });
    return data.url;
  } finally {
    clearTimeout(timer);
  }
}

// Octets d'une adresse temporaire (fond IA Replicate) : lue en CORS, comme l'éditeur l'affiche.
async function fetchImageBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Image illisible (${res.status})`);
  const blob = await res.blob();
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: (blob.type || '').toLowerCase() };
}

/**
 * Aperçu d'un modèle de la bibliothèque rangé dans le stockage (LAB-356) : l'aperçu produit par
 * l'éditeur (data URL JPEG) ou une adresse temporaire (fond IA) devient une adresse https
 * (`templates/previews/{sha256}.{ext}`). Une adresse déjà rangée, ou l'absence d'aperçu, est
 * rendue telle quelle. Lève en cas d'échec : l'aperçu n'est alors pas enregistré.
 */
export async function storeTemplatePreview(previewUrl) {
  if (!needsStorage(previewUrl)) return previewUrl || null;
  const { bytes, mime } = isDataImage(previewUrl) ? dataUrlToBytes(previewUrl) : await fetchImageBytes(previewUrl);
  if (!STORABLE_IMAGE_TYPES.includes(mime)) throw new Error(`Aperçu dans un format non pris en charge (${mime || 'inconnu'})`);
  return uploadDesignImage(bytes, mime, null, { preview: true });
}

const designImageStores = new Map();

/**
 * Magasin d'images d'un événement (`code`) ou de la bibliothèque (admin, sans code) : partagé par
 * l'éditeur (envoi dès l'ajout d'une image) et par les sauvegardes (qui attendent les envois).
 */
export function designImageStore(code = null) {
  const key = code ? `code:${code}` : 'admin';
  if (!designImageStores.has(key)) {
    designImageStores.set(key, createImageStore({
      upload: (bytes, mime) => uploadDesignImage(bytes, mime, code),
      fetchBytes: fetchImageBytes,
    }));
  }
  return designImageStores.get(key);
}

/**
 * `canvasJson` (objet ou chaîne, rendu sous la même forme) avec ses images rangées dans le
 * stockage. Une image dont l'envoi échoue reste intégrée : la sauvegarde passe quand même.
 */
export async function storeDesignImages(canvasJson, code = null) {
  if (!canvasJson) return canvasJson;
  const asString = typeof canvasJson === 'string';
  const state = asString ? JSON.parse(canvasJson) : canvasJson;
  const { state: resolved, failed } = await designImageStore(code).resolveState(state);
  if (failed) console.warn(`${failed} image(s) gardée(s) intégrée(s) au modèle (envoi impossible).`);
  if (resolved === state) return canvasJson;
  return asString ? JSON.stringify(resolved) : resolved;
}

// ── Historique des versions ───────────────────────────────────────────────────

// LAB-115 : la table design_versions n'est plus accessible avec la clé anon. Client comme admin
// connecté passent par l'edge function design-versions, qui exige le code d'accès de l'éditeur.
function callDesignVersionFunction(payload) {
  return callFunction('design-versions', { json: payload, fallback: 'Erreur historique des versions' });
}

/**
 * Sauvegarde une version nommée du design (appel manuel). `kind` : 'print' (défaut) ou 'home'.
 * `slot` (LAB-313) : cadre du modèle photo, seulement quand le choix du cadre est actif (chaque
 * cadre a son historique) ; `label` est ici le nom de la version.
 */
export async function saveDesignVersion({ code, canvasJson, format, label, kind = 'print', slot }) {
  const data = await callDesignVersionFunction({
    code, kind, action: 'save', canvas_json: canvasJson, format, label: label?.trim() || null, ...frameFields({ slot }),
  });
  return data.version;
}

/** Liste les 20 dernières versions du design `kind` (et du cadre `slot`, LAB-313) de l'événement du code. */
export async function listDesignVersions(code, kind = 'print', slot) {
  const data = await callDesignVersionFunction({ code, kind, action: 'list', ...frameFields({ slot }) });
  return data?.versions ?? [];
}

/** Récupère une version complète (avec canvas_json), si elle appartient au design `kind` (et au cadre `slot`) du code. */
export async function getDesignVersion(code, versionId, kind = 'print', slot) {
  const data = await callDesignVersionFunction({ code, kind, action: 'get', version_id: versionId, ...frameFields({ slot }) });
  return data.version;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Soumission finale du design (PNG base64 + JSON). `kind` : 'print' (modèle photo, défaut) ou
 * 'home' (écran d'accueil : le statut de l'événement ne change pas, LAB-289). `slot` et `label`
 * (LAB-313) : cadre envoyé et son nom, seulement quand le choix du cadre est actif. `notify: false`
 * (LAB-322) : pas d'email à l'admin pour ce cadre (cadres d'un envoi groupé avant le dernier).
 */
export async function submitDesign({ code, canvasJson, format, pngBase64, kind = 'print', slot, label, notify = true }) {
  // { design_id, message }
  return callFunction('submit-design', {
    json: {
      code,
      canvas_json: canvasJson,
      format,
      kind,
      png_base64:  pngBase64,
      ...frameFields({ slot, label }),
      ...(notify === false ? { notify: false } : {}),
    },
    fallback: 'Erreur lors de la soumission',
  });
}
