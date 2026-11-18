// Code d'accès d'un événement (LAB-393) : 6 caractères sans signe ambigu (ni 0, 1, O, I), tirés par
// crypto.getRandomValues. Seule fonction de génération du front.

export const ACCESS_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ACCESS_CODE_LENGTH = 6;

const cryptoRandom = (bytes) => globalThis.crypto.getRandomValues(bytes);

/** Erreur Postgres de clé unique (code déjà pris). */
export const isUniqueViolation = (error) => error?.code === '23505';

/**
 * `length` signes de `alphabet` (256 signes au plus), tirés au hasard sans biais : un octet au-delà
 * du plus grand multiple de la taille de l'alphabet est rejeté (pas de biais modulo).
 */
export function randomString(alphabet, length, getRandomValues = cryptoRandom) {
  const limit = 256 - (256 % alphabet.length);
  let out = '';
  while (out.length < length) {
    for (const byte of getRandomValues(new Uint8Array(length * 2))) {
      if (byte >= limit) continue;
      out += alphabet[byte % alphabet.length];
      if (out.length === length) break;
    }
  }
  return out;
}

export function generateAccessCode(getRandomValues = cryptoRandom) {
  return randomString(ACCESS_CODE_ALPHABET, ACCESS_CODE_LENGTH, getRandomValues);
}
