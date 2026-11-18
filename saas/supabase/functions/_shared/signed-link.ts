// Liens admin signés (spec reservation-facturation §5.8) : boutons des emails n°2 et n°17.
// sig = base64url(HMAC-SHA256(BOOKING_LINK_SECRET, "{lead_id}.{a}.{exp}.{n}")), validité 14 jours.
// Le contrôle d'usage unique (decision_nonce / decision_used_at) et de l'état du lead
// est fait par booking-decision (LAB-61). Module pur, testé par signed-link.test.ts.

export type DecisionAction = 'accept' | 'refuse' | 'extend' | 'expire';

const DECISION_ACTIONS: readonly DecisionAction[] = ['accept', 'refuse', 'extend', 'expire'];
export const DECISION_LINK_TTL_SECONDS = 14 * 24 * 3600;
/** Taille minimale de la clé HMAC (256 bits) : en dessous, le tunnel refuse de servir (503). */
export const MIN_LINK_SECRET_BYTES = 32;

const encoder = new TextEncoder();

/** Message d'erreur explicite si BOOKING_LINK_SECRET est absent ou trop court, sinon null. */
export function linkSecretProblem(secret: string | undefined): string | null {
  if (!secret) return 'BOOKING_LINK_SECRET manquant';
  const bytes = encoder.encode(secret).length;
  if (bytes < MIN_LINK_SECRET_BYTES) {
    return `BOOKING_LINK_SECRET trop court (${bytes} octets, minimum ${MIN_LINK_SECRET_BYTES})`;
  }
  return null;
}

export function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomBase64url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

/** Nonce stocké dans leads.decision_nonce (128 bits). */
export function generateNonce(): string {
  return randomBase64url(16);
}

function decisionPayload(leadId: string, action: DecisionAction, exp: number | string, nonce: string): string {
  return `${leadId}.${action}.${exp}.${nonce}`;
}

async function hmacSha256Base64url(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return base64url(new Uint8Array(sig));
}

export function timingSafeEqual(a: string, b: string): boolean {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

export interface SignedDecisionLink {
  url: string;
  exp: number;
  sig: string;
}

/** Construit `{baseUrl}/admin/demandes/{leadId}?a=…&exp=…&n=…&sig=…`. `now` en ms. */
export async function signDecisionLink(params: {
  secret: string;
  baseUrl: string;
  leadId: string;
  action: DecisionAction;
  nonce: string;
  now?: number;
  ttlSeconds?: number;
}): Promise<SignedDecisionLink> {
  const { secret, baseUrl, leadId, action, nonce } = params;
  if (!secret) throw new Error('BOOKING_LINK_SECRET manquant');
  const now = params.now ?? Date.now();
  const exp = Math.floor(now / 1000) + (params.ttlSeconds ?? DECISION_LINK_TTL_SECONDS);
  const sig = await hmacSha256Base64url(secret, decisionPayload(leadId, action, exp, nonce));
  const qs = new URLSearchParams({ a: action, exp: String(exp), n: nonce, sig });
  const url = `${baseUrl.replace(/\/+$/, '')}/admin/demandes/${encodeURIComponent(leadId)}?${qs}`;
  return { url, exp, sig };
}

export type VerifyResult =
  | { ok: true; action: DecisionAction; nonce: string; exp: number }
  | { ok: false; reason: 'malformed' | 'expired' | 'bad_signature' };

/** Vérifie signature et expiration. `now` en ms. */
export async function verifyDecisionLink(params: {
  secret: string;
  leadId: string;
  a: string | null;
  exp: string | null;
  n: string | null;
  sig: string | null;
  now?: number;
}): Promise<VerifyResult> {
  const { secret, leadId, a, exp, n, sig } = params;
  if (!secret || !leadId || !a || !exp || !n || !sig) return { ok: false, reason: 'malformed' };
  if (!(DECISION_ACTIONS as readonly string[]).includes(a)) return { ok: false, reason: 'malformed' };
  if (!/^[1-9]\d{0,11}$/.test(exp)) return { ok: false, reason: 'malformed' };
  const expected = await hmacSha256Base64url(secret, decisionPayload(leadId, a as DecisionAction, exp, n));
  if (!timingSafeEqual(expected, sig)) return { ok: false, reason: 'bad_signature' };
  const nowSec = Math.floor((params.now ?? Date.now()) / 1000);
  if (Number(exp) < nowSec) return { ok: false, reason: 'expired' };
  return { ok: true, action: a as DecisionAction, nonce: n, exp: Number(exp) };
}
