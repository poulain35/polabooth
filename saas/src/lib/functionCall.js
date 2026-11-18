// Appels aux edge functions Supabase (LAB-420) : adresse, en-têtes (apikey, session de l'admin),
// lecture du JSON et erreur au message du serveur, écrits une seule fois. Module pur : le client
// Supabase est branché dans lib/api/functions.js.
import { functionError, readJson } from './httpErrors.js';

export const SESSION_EXPIRED_MESSAGE = 'Session expirée — reconnectez-vous';

/**
 * `getSession()` rend la session Supabase ou null. Options communes à chaque appel :
 *  - `admin` : ajoute `Authorization: Bearer <jeton de la session>` ; sans session, lève
 *    SESSION_EXPIRED_MESSAGE (status 401) sans rien envoyer. Sinon appel anonyme (apikey seule) ;
 *  - `json` (objet, sérialisé) ou `body` (envoyé tel quel : chaîne déjà sérialisée, octets) ;
 *  - `contentType` (JSON par défaut, posé seulement s'il y a un corps), `method` (POST), `signal`.
 */
export function createFunctionCaller({ baseUrl, anonKey, getSession, fetchImpl = (...args) => fetch(...args) }) {
  async function headersFor({ admin, contentType }) {
    const headers = {};
    if (contentType) headers['Content-Type'] = contentType;
    headers.apikey = anonKey;
    if (admin) {
      const session = await getSession();
      if (!session) throw Object.assign(new Error(SESSION_EXPIRED_MESSAGE), { status: 401 });
      headers.Authorization = `Bearer ${session.access_token}`;
    }
    return headers;
  }

  /** Réponse brute de la fonction `path` (fichier, statut lu par l'appelant). */
  async function fetchFunction(path, {
    admin = false, json, body, contentType = 'application/json', method = 'POST', signal,
  } = {}) {
    const payload = json === undefined ? body : JSON.stringify(json);
    const headers = await headersFor({ admin, contentType: payload === undefined ? null : contentType });
    return fetchImpl(`${baseUrl}/${path}`, { method, headers, body: payload, signal });
  }

  /** `{ res, data }` sans lever sur un statut d'erreur : corps vide ou non JSON ⇒ data = {}. */
  async function requestFunction(path, options) {
    const res = await fetchFunction(path, options);
    return { res, data: await readJson(res) };
  }

  /**
   * Corps JSON de la réponse. Statut en erreur : lève functionError (message du serveur, sinon
   * `fallback`), complétée par `errorFields(data)` quand la réponse porte d'autres champs utiles.
   */
  async function callFunction(path, { fallback, errorFields, ...options } = {}) {
    const { res, data } = await requestFunction(path, options);
    if (!res.ok) throw Object.assign(functionError(res, data, fallback), errorFields?.(data));
    return data;
  }

  return { fetchFunction, requestFunction, callFunction };
}
