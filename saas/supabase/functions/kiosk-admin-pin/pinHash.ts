// Hash du PIN admin des bornes : PBKDF2-SHA256, format pbkdf2$iterations$salt_b64$hash_b64.
// Même calcul côté kiosk (AdminPinService.cs) : le vecteur de test est partagé entre les deux.

export const PIN_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

export const isValidPin = (pin: unknown): pin is string => typeof pin === 'string' && /^\d{4,8}$/.test(pin);

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

export async function hashPin(pin: string, salt?: Uint8Array<ArrayBuffer>, iterations = PIN_ITERATIONS): Promise<string> {
  if (!isValidPin(pin)) throw new Error('PIN invalide : 4 à 8 chiffres');
  const s = salt ?? crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: s, iterations },
    key,
    HASH_BYTES * 8,
  );
  return `pbkdf2$${iterations}$${toBase64(s)}$${toBase64(new Uint8Array(bits))}`;
}
