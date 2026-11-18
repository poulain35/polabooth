// Règles pures de google-font-file (LAB-331), sans import Deno : testables sous `node --test`.

/** Taille maximale d'un fichier de police renvoyé (limite du bucket kiosk-backgrounds : 10 Mo). */
export const MAX_FONT_BYTES = 10 * 1024 * 1024;

/**
 * User-Agent envoyé à fonts.googleapis.com : sans navigateur récent reconnu, l'API renvoie des
 * fichiers TrueType (`format('truetype')`) au lieu de WOFF2, ce que la borne (WPF) sait lire.
 */
export const LEGACY_USER_AGENT = 'Mozilla/5.0';

export type FontRequest = { family: string; weight: number };

/** Corps `{ family, weight }` → requête validée, ou message d'erreur. */
export function parseFontRequest(body: unknown): FontRequest | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const family = typeof b.family === 'string' ? b.family.trim() : '';
  // Noms des familles Google : lettres, chiffres et espaces (ex. « Exo 2 », « M PLUS 1p »).
  if (!/^[A-Za-z0-9][A-Za-z0-9 ]{0,59}$/.test(family)) return { error: 'Famille de police invalide' };
  const weight = b.weight;
  if (typeof weight !== 'number' || !Number.isInteger(weight) || weight < 100 || weight > 900) {
    return { error: 'Graisse invalide (100 à 900)' };
  }
  return { family, weight };
}

/**
 * Adresses CSS à essayer dans l'ordre : la graisse demandée, puis la graisse par défaut de la
 * famille (une famille sans cette graisse, ex. Pacifico 700, répond 400 à la première).
 */
export function fontCssUrls({ family, weight }: FontRequest): string[] {
  const name = family.replace(/ +/g, '+');
  return [
    `https://fonts.googleapis.com/css2?family=${name}:wght@${weight}`,
    `https://fonts.googleapis.com/css2?family=${name}`,
  ];
}

/** Premier fichier TrueType ou OpenType de la feuille CSS, sur fonts.gstatic.com seulement. */
export function fontFileUrl(css: string): string | null {
  for (const m of css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)\s'"]+)\)\s*format\(['"](truetype|opentype)['"]\)/g)) {
    return m[1];
  }
  return null;
}

/** Vrai si les octets commencent par une signature TrueType (00 01 00 00, « true ») ou OpenType (« OTTO »). */
export function isFontFile(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  return (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0) || tag === 'true' || tag === 'OTTO';
}
