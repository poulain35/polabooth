// Accès par code d'événement, partagé par les fonctions publiques (LAB-392) : autosave-design,
// design-versions, get-event, get-audio-tracks, get-guest-upload-url, get-photos, record-guest-photo,
// remove-background, set-event-name, submit-design, upload-design-image, submit-support-message.
//
// Une seule recherche (code normalisé, `maybeSingle`) puis, dans cet ordre : code inconnu, événement
// archivé, lien expiré, fonctionnalité de l'organisation. Chaque fonction garde ses propres statuts
// et messages de refus (le front et la borne les affichent tels quels) : ils sont passés en options.
// Un code inconnu est compté pour l'IP (`guard.codeFailed`) quand la fonction le demande. Une erreur
// de lecture répond 500 générique, sans compter d'échec de code (avant LAB-392, elle passait pour un
// code inconnu).
// Sans import Deno/esm.sh : testé par event-by-code.test.ts sous `node --test`.

import { corsResponse } from './cors.ts';
import { templateLinkExpired, mediaLinkExpired } from './expiry.ts';
import { requireFeature, type FeatureId } from './features.ts';
import type { Guarded } from './admin-guard.ts';

// Sous-ensemble du client supabase-js.
// deno-lint-ignore no-explicit-any
export interface EventCodeDb { from(table: string): any }

/** Refus renvoyé tel quel au client : `{ error }` avec ce statut. */
interface Refusal { status: number; error: string }

/**
 * Règle d'expiration du lien :
 *   - `template` : lien de l'éditeur, expire à la fin du jour de `end_date` (templateLinkExpired) ;
 *   - `media` : galeries et dépôt des invités, expire à `expires_at` (mediaLinkExpired).
 */
type ExpiryRule = { rule: 'template' | 'media'; refusal: Refusal };

export interface EventByCodeOptions {
  /** Colonnes utiles à la fonction ; `id`, `org_id` et celles des contrôles sont ajoutées. */
  columns: readonly string[];
  /** Réponse au code inconnu. */
  notFound: Refusal;
  /** Refus d'un événement archivé (`status = 'archived'`) ; absent = accepté. */
  archived?: Refusal;
  /** Refus d'un lien expiré ; absent = pas de contrôle d'expiration. */
  expiry?: ExpiryRule;
  /** Fonctionnalité exigée pour l'organisation (404 `fonctionnalite_desactivee` sinon). */
  feature?: FeatureId;
  /** Garde de débit : un code inconnu y est compté (`codeFailed`). Absent = non compté. */
  guard?: { codeFailed(): Promise<void> } | null;
  /** Nom de la fonction, pour les journaux. */
  fn: string;
  now?: () => Date;
}

export const EVENT_LOOKUP_ERROR = 'Erreur serveur, réessayez dans un instant.';

/** Code d'accès tel que stocké (majuscules, sans espaces autour) ; null si absent ou vide. */
export function normalizeAccessCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return code || null;
}

/** Colonnes lues : celles de la fonction, plus `id`, `org_id` et celles des contrôles demandés. */
export function eventColumns(opts: Pick<EventByCodeOptions, 'columns' | 'archived' | 'expiry'>): string {
  const cols = new Set<string>(['id', 'org_id', ...opts.columns]);
  if (opts.archived) cols.add('status');
  if (opts.expiry?.rule === 'template') cols.add('end_date');
  if (opts.expiry?.rule === 'media') cols.add('expires_at');
  return [...cols].join(', ');
}

/** Recherche seule (sans refus) : l'événement du code, null s'il n'existe pas ; `error` si la lecture échoue. */
export async function findEventByCode<T = Record<string, unknown>>(
  db: EventCodeDb, code: string, columns: string,
): Promise<{ event: T | null; error: unknown }> {
  try {
    const { data, error } = await db.from('events').select(columns).eq('access_code', code).maybeSingle();
    return error ? { event: null, error } : { event: (data as T | null) ?? null, error: null };
  } catch (e) {
    return { event: null, error: e };
  }
}

function refuse(r: Refusal): Response {
  return corsResponse(r.status, { error: r.error });
}

/** Événement du code d'accès, ou la réponse de refus de la fonction. `code` : déjà normalisé. */
export async function eventByCode<T extends Record<string, unknown> = Record<string, unknown>>(
  db: EventCodeDb, code: string, opts: EventByCodeOptions,
): Promise<Guarded<{ event: T & { id: string; org_id: string } }>> {
  const { event, error } = await findEventByCode<T & { id: string; org_id: string }>(db, code, eventColumns(opts));
  if (error) {
    console.error(`${opts.fn} : lecture de l'événement par code impossible`, error);
    return { response: corsResponse(500, { error: EVENT_LOOKUP_ERROR }) };
  }
  if (!event) {
    if (opts.guard) await opts.guard.codeFailed();
    return { response: refuse(opts.notFound) };
  }
  if (opts.archived && event.status === 'archived') return { response: refuse(opts.archived) };
  if (opts.expiry) {
    const now = opts.now?.() ?? new Date();
    const expired = opts.expiry.rule === 'template'
      ? templateLinkExpired(event.end_date as string | null, now)
      : mediaLinkExpired(event.expires_at as string | null, now);
    if (expired) return { response: refuse(opts.expiry.refusal) };
  }
  if (opts.feature) {
    const disabled = await requireFeature(db, event.org_id, opts.feature);
    if (disabled) return { response: disabled };
  }
  return { event };
}
