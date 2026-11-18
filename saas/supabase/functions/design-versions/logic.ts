// Historique des versions de design (LAB-115), sans import Deno/esm.sh : testable sous `node --test`.
// La table design_versions n'est plus accessible à anon : l'éditeur /e/:code (client anon comme admin
// connecté) passe par cette fonction, qui exige le code d'accès et ne touche qu'aux versions de
// l'événement de ce code. Chaque design (kind, LAB-289 : 'print' = modèle photo, 'home' = écran
// d'accueil) a son propre historique, et chaque cadre du modèle photo aussi (slot, LAB-312).

import {
  type DesignKind, formatAllowedForKind, parseDesignKind, parseDesignSlot, slotAllowedForKind,
} from '../_shared/design-kind.ts';

export const MAX_VERSIONS_LISTED = 20;
export const MAX_LABEL_LENGTH = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type VersionRequest =
  | { action: 'list'; code: string; kind: DesignKind; slot: number }
  | { action: 'get'; code: string; kind: DesignKind; slot: number; versionId: string }
  | { action: 'save'; code: string; kind: DesignKind; slot: number; canvasJson: Record<string, unknown>; format: string; label: string | null };

export type Parsed = { ok: true; request: VersionRequest } | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

export function parseVersionRequest(body: unknown): Parsed {
  if (!isObject(body)) return { ok: false, error: 'Body JSON invalide' };
  const code = typeof body.code === 'string' ? body.code.toUpperCase().trim() : '';
  if (!code) return { ok: false, error: 'code requis' };
  const kind = parseDesignKind(body.kind);
  if (!kind) return { ok: false, error: 'kind invalide (print ou home)' };
  const slot = parseDesignSlot(body.slot);
  if (slot === null || !slotAllowedForKind(kind, slot)) return { ok: false, error: 'slot invalide' };

  switch (body.action) {
    case 'list':
      return { ok: true, request: { action: 'list', code, kind, slot } };

    case 'get': {
      const versionId = typeof body.version_id === 'string' ? body.version_id.trim() : '';
      if (!UUID.test(versionId)) return { ok: false, error: 'version_id invalide' };
      return { ok: true, request: { action: 'get', code, kind, slot, versionId } };
    }

    case 'save': {
      if (!isObject(body.canvas_json)) return { ok: false, error: 'canvas_json requis' };
      const format = typeof body.format === 'string' ? body.format : '';
      if (!formatAllowedForKind(kind, format)) return { ok: false, error: 'format invalide' };
      const label = typeof body.label === 'string' ? body.label.trim().slice(0, MAX_LABEL_LENGTH) : '';
      return { ok: true, request: { action: 'save', code, kind, slot, canvasJson: body.canvas_json, format, label: label || null } };
    }

    default:
      return { ok: false, error: 'action invalide (list, get ou save)' };
  }
}

// Sous-ensemble du client supabase-js (service_role).
// deno-lint-ignore no-explicit-any
export type Db = { from: (table: string) => any };

export interface Outcome {
  status: number;
  body: Record<string, unknown>;
}

const LIST_COLUMNS = 'id, label, format, created_at';
const FULL_COLUMNS = 'id, canvas_json, format, label, created_at';

/** Exécute la requête pour l'événement `eventId`, déjà résolu depuis le code d'accès. */
export async function runVersionRequest(db: Db, eventId: string, request: VersionRequest): Promise<Outcome> {
  if (request.action === 'list') {
    const { data, error } = await db
      .from('design_versions')
      .select(LIST_COLUMNS)
      .eq('event_id', eventId)
      .eq('kind', request.kind)
      .eq('slot', request.slot)
      .order('created_at', { ascending: false })
      .limit(MAX_VERSIONS_LISTED);
    if (error) return failure('list', error);
    return { status: 200, body: { versions: data ?? [] } };
  }

  if (request.action === 'get') {
    // Le filtre event_id empêche de lire la version d'un autre événement avec son id.
    const { data, error } = await db
      .from('design_versions')
      .select(FULL_COLUMNS)
      .eq('id', request.versionId)
      .eq('event_id', eventId)
      .eq('kind', request.kind)
      .eq('slot', request.slot)
      .maybeSingle();
    if (error) return failure('get', error);
    if (!data) return { status: 404, body: { error: 'Version introuvable' } };
    return { status: 200, body: { version: data } };
  }

  const { data, error } = await db
    .from('design_versions')
    .insert({
      event_id: eventId, kind: request.kind, slot: request.slot,
      canvas_json: request.canvasJson, format: request.format, label: request.label,
    })
    .select(LIST_COLUMNS)
    .single();
  if (error || !data) return failure('save', error);
  return { status: 200, body: { version: data } };
}

function failure(action: string, error: unknown): Outcome {
  console.error(`design-versions ${action} :`, JSON.stringify(error));
  return { status: 500, body: { error: 'Erreur historique des versions' } };
}
