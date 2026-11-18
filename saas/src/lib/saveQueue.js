// Sauvegarde des brouillons de l'éditeur /e/:code (LAB-323). Un brouillon peut peser plusieurs Mo :
// chaque envoi a un délai maximal proportionnel à sa taille, un nouvel essai sur une panne passagère,
// et une file qui n'envoie jamais deux sauvegardes à la fois.

import { isFetchFailure } from './networkError.js';

export const SAVE_RETRY_MESSAGE = 'Sauvegarde impossible, nouvel essai…';
export const SAVE_FAILED_MESSAGE =
  'Sauvegarde impossible. Vos modifications sont gardées : vérifiez votre connexion puis cliquez sur « Sauvegarder ».';

const SAVE_ATTEMPTS = 2;
const SAVE_RETRY_DELAY_MS = 2000;

/**
 * Délai maximal d'un envoi de `bytes` octets : 20 s, plus le temps d'envoi à 100 Ko/s (connexion
 * mobile faible), 2 min au plus. 6 Mo → 80 s.
 */
export function saveTimeoutMs(bytes, { baseMs = 20_000, bytesPerSecond = 100_000, maxMs = 120_000 } = {}) {
  const size = Math.max(0, Number(bytes) || 0);
  return Math.min(maxMs, Math.round(baseMs + (size / bytesPerSecond) * 1000));
}

function saveTimeoutError() {
  return Object.assign(new Error('La sauvegarde a pris trop de temps.'), { timeout: true });
}

/** Panne passagère qui mérite un nouvel essai : délai dépassé, réseau coupé, serveur en erreur (5xx). */
export function isRetryableSaveError(error) {
  if (!error) return false;
  if (error.timeout || error.name === 'AbortError') return true;
  if (isFetchFailure(error)) return true;
  return Number(error.status) >= 500;
}

/**
 * Lance `send(signal)` avec un délai maximal par essai et `attempts` essais au plus. Le délai est
 * garanti même si `send` ignore le signal. Sur une panne passagère, `onRetry(error, attempt)` est
 * appelé avant le nouvel essai ; après le dernier, l'erreur levée porte SAVE_FAILED_MESSAGE (et
 * l'erreur d'origine en `cause`). Une autre erreur (400, 403, 409, 429…) est levée telle quelle.
 */
export async function sendWithRetry(send, {
  timeoutMs,
  attempts = SAVE_ATTEMPTS,
  retryDelayMs = SAVE_RETRY_DELAY_MS,
  onRetry = null,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  for (let attempt = 1; ; attempt += 1) {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(saveTimeoutError()); }, timeoutMs);
    });
    try {
      return await Promise.race([Promise.resolve().then(() => send(controller.signal)), timeout]);
    } catch (raw) {
      const error = controller.signal.aborted && !raw?.timeout ? saveTimeoutError() : raw;
      if (!isRetryableSaveError(error)) throw error;
      if (attempt >= attempts) throw Object.assign(new Error(SAVE_FAILED_MESSAGE), { cause: error, retryable: true });
      onRetry?.(error, attempt);
      await wait(retryDelayMs);
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * File des sauvegardes : une seule en cours ; en attente, au plus une par brouillon (`key`). Une
 * sauvegarde ajoutée pour un brouillon déjà en attente remplace la précédente (le contenu le plus
 * récent part) et les deux appelants reçoivent le même résultat.
 */
export function createSaveQueue() {
  let running = null;
  const pending = new Map();

  function pump() {
    if (running || !pending.size) return;
    const [key, entry] = pending.entries().next().value;
    pending.delete(key);
    running = { key, done: entry.promise.then(() => {}, () => {}) };
    const finish = (settle) => (value) => { running = null; settle(value); pump(); };
    Promise.resolve()
      .then(() => entry.job())
      .then(finish(entry.resolve), finish(entry.reject));
  }

  return {
    enqueue(key, job) {
      const waiting = pending.get(key);
      if (waiting) { waiting.job = job; return waiting.promise; }
      let resolve, reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      pending.set(key, { job, promise, resolve, reject });
      pump();
      return promise;
    },
    /** Retire la sauvegarde en attente de `key` ; son appelant reçoit `value`. */
    cancel(key, value) {
      const waiting = pending.get(key);
      if (!waiting) return;
      pending.delete(key);
      waiting.resolve(value);
    },
    /** Se résout quand la sauvegarde en cours de `key` (s'il y en a une) est terminée, en succès ou non. */
    settled(key) {
      return running?.key === key ? running.done : Promise.resolve();
    },
    get busy() { return Boolean(running); },
    get waiting() { return pending.size; },
  };
}
