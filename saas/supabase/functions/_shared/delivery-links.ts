// Contenu générique de l'email de livraison (open core, lot L4), sans import Deno : testé sous
// `node --test`. Les fonctionnalités remplissent events.delivery_links et
// events.delivery_attachment_url ; send-delivery ne connaît ni l'audio ni la facture.

export type DeliveryLink = { label: string; url: string };

export const MAX_DELIVERY_LINKS = 6;
const MAX_LABEL_LENGTH = 80;

/**
 * Liens à afficher, dans l'ordre de la colonne : libellé non vide (80 caractères au plus), URL
 * http(s) absolue ou chemin relatif (« /audio/ABC ») complété par l'adresse de l'application.
 * Une entrée invalide est ignorée ; deux entrées à la même URL n'en font qu'une.
 */
export function deliveryLinks(raw: unknown, appUrl: string, max = MAX_DELIVERY_LINKS): DeliveryLink[] {
  if (!Array.isArray(raw)) return [];
  const base = appUrl.replace(/\/+$/, '');
  const seen = new Set<string>();
  const out: DeliveryLink[] = [];
  for (const item of raw) {
    if (out.length >= max) break;
    if (!item || typeof item !== 'object') continue;
    const label = typeof (item as { label?: unknown }).label === 'string' ? (item as { label: string }).label.trim() : '';
    const url = absoluteUrl((item as { url?: unknown }).url, base);
    if (!label || !url || seen.has(url)) continue;
    seen.add(url);
    out.push({ label: label.slice(0, MAX_LABEL_LENGTH), url });
  }
  return out;
}

function absoluteUrl(raw: unknown, base: string): string | null {
  if (typeof raw !== 'string') return null;
  const url = raw.trim();
  if (url.startsWith('/') && !url.startsWith('//')) return base ? `${base}${url}` : null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** URL de la pièce jointe, ou null si elle n'est pas une URL http(s). */
export function deliveryAttachmentUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return absoluteUrl(raw, '');
}

/**
 * Nom du fichier joint : le dernier segment de l'URL s'il se termine par .pdf (caractères sûrs
 * seulement), sinon « document.pdf ».
 */
export function deliveryAttachmentName(url: string): string {
  let last = '';
  try {
    last = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
  } catch {
    return 'document.pdf';
  }
  const safe = last.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.pdf$/i.test(safe) ? safe : 'document.pdf';
}
