/**
 * Règles de revue d'un design client (LAB-290), sans Deno ni base : testées par node --test.
 *
 * - Un design envoyé se valide ou se refuse. Un design validé est en lecture seule pour le client
 *   (écran d'accueil, LAB-290 ; cadre du modèle photo, LAB-294) : l'admin le rouvre en le refusant
 *   avec un motif (« Rouvrir pour correction »).
 * - Modèle photo (kind = 'print') : un refus remet l'événement en 'active' pour que le client
 *   renvoie son cadre.
 * - Écran d'accueil (kind = 'home') : ne touche jamais events.status.
 * Mêmes règles côté admin : src/lib/clientDesigns.js (designReviewActions).
 */

export type ReviewAction = 'approve' | 'reject';
export type DesignKind = 'print' | 'home';

/** Une ligne lue avant LAB-288 sans kind compte comme modèle photo. */
export function designKind(kind: unknown): DesignKind {
  return kind === 'home' ? 'home' : 'print';
}

/** La revue est-elle possible pour ce design dans cet état ? (même règle pour les deux kinds) */
export function canReview(_kind: unknown, status: unknown, action: ReviewAction): boolean {
  if (status === 'submitted') return true;
  return action === 'reject' && status === 'approved';
}

/** Seul le refus du modèle photo remet l'événement en 'active'. */
export function resetsEventStatus(kind: unknown, action: ReviewAction): boolean {
  return action === 'reject' && designKind(kind) === 'print';
}

/** Type de la ligne email_logs écrite pour l'email au client. */
export function reviewEmailLogType(kind: unknown, action: ReviewAction): string {
  const prefix = designKind(kind) === 'home' ? 'home_design' : 'design';
  return `${prefix}_${action === 'approve' ? 'approved' : 'rejected'}`;
}

/**
 * Nom du cadre cité dans l'email au client (LAB-312) : seulement si l'événement a le choix du cadre
 * actif ou si c'est un cadre ajouté (slot > 1). Nom saisi par le client, sinon « Cadre n ».
 * L'écran d'accueil et un événement à un seul cadre n'en citent pas (emails inchangés).
 */
export function reviewFrameLabel(
  design: { kind?: unknown; slot?: unknown; label?: unknown },
  frameChoiceEnabled: boolean,
): string | null {
  if (designKind(design.kind) !== 'print') return null;
  const slot = typeof design.slot === 'number' ? design.slot : 1;
  if (!frameChoiceEnabled && slot === 1) return null;
  const label = typeof design.label === 'string' ? design.label.trim() : '';
  return label || `Cadre ${slot}`;
}

/** Message de réponse (succès), et début du message quand l'email au client est refusé. */
export function reviewMessage(kind: unknown, action: ReviewAction): string {
  if (designKind(kind) === 'home') {
    return action === 'approve' ? 'Écran d’accueil validé' : 'Écran d’accueil renvoyé au client pour correction';
  }
  return action === 'approve' ? 'Template approuvé' : 'Template refusé';
}
