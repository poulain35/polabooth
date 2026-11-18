// Conversation de l'assistant jointe au message d'aide (LAB-392) : seuls les échanges utiles sont
// gardés, bornés en nombre et en longueur, pour qu'un appel public ne puisse pas écrire n'importe quel
// JSON dans support_messages.transcript. Forme envoyée par src/pages/Assistance.jsx :
// [{ role: 'user' | 'assistant', content: string }].
// Pur, sans import Deno : testé par transcript.test.ts sous `node --test`.

export const MAX_TRANSCRIPT_ITEMS = 24;
export const MAX_TRANSCRIPT_ITEM_CHARS = 2000;

export type TranscriptItem = { role: 'user' | 'assistant'; content: string };

/**
 * Garde les `MAX_TRANSCRIPT_ITEMS` derniers échanges valides (rôle user ou assistant, contenu texte
 * non vide), chacun coupé à `MAX_TRANSCRIPT_ITEM_CHARS` caractères, sans autre clé.
 * null si ce n'est pas un tableau ou s'il ne reste rien.
 */
export function sanitizeTranscript(raw: unknown): TranscriptItem[] | null {
  if (!Array.isArray(raw)) return null;
  const items: TranscriptItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { role, content } = item as { role?: unknown; content?: unknown };
    if (role !== 'user' && role !== 'assistant') continue;
    if (typeof content !== 'string') continue;
    const text = content.trim().slice(0, MAX_TRANSCRIPT_ITEM_CHARS);
    if (!text) continue;
    items.push({ role, content: text });
  }
  const kept = items.slice(-MAX_TRANSCRIPT_ITEMS);
  return kept.length ? kept : null;
}
