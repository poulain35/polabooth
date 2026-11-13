// Pièces jointes Brevo (LAB-88) : Brevo déduit le format d'une pièce jointe { url } de l'extension
// de l'URL et refuse les liens PDF de Pennylane (« /public/invoice/pdf?… » → « Unsupported file
// format »). On télécharge donc chaque pièce jointe par URL et on l'envoie en base64 avec son nom.
// Module pur (fetch injecté) pour être testé sous `node --test`.

export type Attachment =
  | { url: string; name?: string }
  | { content: string; name: string };

/** Base64 d'un binaire, par blocs pour ne pas dépasser la pile de String.fromCharCode. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Nom de fichier par défaut : dernier segment du chemin de l'URL. */
function fallbackName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '') || 'piece-jointe';
  } catch {
    return 'piece-jointe';
  }
}

/** Signature d'un fichier PDF (« %PDF- »). */
export function isPdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-';
}

/**
 * Remplace les pièces jointes { url } par leur contenu base64. Un téléchargement en échec retire
 * la pièce jointe (avertissement journalisé) sans bloquer l'email : le client retrouve le document
 * depuis sa page récapitulative. Idem pour un « .pdf » qui n'en est pas un (LAB-90 : une URL
 * non déployée renvoie la page HTML de l'application avec un statut 200).
 */
export async function inlineAttachments(
  attachments: Attachment[],
  fetchFn: typeof fetch,
  warn: (msg: string) => void = console.warn,
): Promise<Attachment[]> {
  const out: Attachment[] = [];
  for (const a of attachments) {
    if (!('url' in a)) {
      out.push(a);
      continue;
    }
    const name = a.name ?? fallbackName(a.url);
    try {
      const res = await fetchFn(a.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (/\.pdf$/i.test(name) && !isPdf(bytes)) {
        throw new Error(`contenu non PDF (${res.headers.get('content-type') ?? 'type inconnu'})`);
      }
      out.push({ content: toBase64(bytes), name });
    } catch (e) {
      warn(`Pièce jointe « ${name} » non téléchargée, email envoyé sans : ${e instanceof Error ? e.message : e}`);
    }
  }
  return out;
}
