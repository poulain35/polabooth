// Logique pure du ménage quotidien des images des modèles (LAB-356), testée par logic.test.ts sous
// `node --test`. Aucun import Deno : le stockage et la base sont passés par l'interface CleanupStore.
//
// Règle : une image rangée par upload-design-image / remove-background (`{event_id}/images/…`,
// `templates/images/…`, `templates/previews/…` du bucket `designs`, nom = SHA-256 du contenu) est
// supprimée seulement si elle a plus de 7 jours (création ET dernière réécriture dans le stockage)
// et que son empreinte n'apparaît nulle part dans les tables parcourues (lignes entières sérialisées
// en JSON : groupes, fonds, motifs, masques, aperçus, réglages…). En cas de doute, on garde : toute
// erreur de lecture, réponse inattendue ou parcours incomplet → rien n'est supprimé.

const RETENTION_DAYS = 7;
const DAY_MS = 86_400_000;

/**
 * Tables parcourues à la recherche des adresses ou chemins d'images. Même liste que la liste
 * blanche de public.design_image_references (migration 20261228000000_design_images_cleanup.sql,
 * vérifié par logic.test.ts).
 */
export const REFERENCE_SOURCES = Object.freeze([
  'client_designs', 'design_versions', 'templates', 'kiosk_screens', 'events', 'organizations', 'decorations',
]);

/** Seuls chemins que le ménage peut supprimer (jamais le PNG final ni le reste du bucket). */
const IMAGE_PATH = /^(?:([0-9a-f-]{36})\/images|templates\/(images|previews))\/([0-9a-f]{64})\.(png|jpg|webp)$/;

type ImageFolder = 'event' | 'templates' | 'previews';
export type ImagePath = { folder: ImageFolder; eventId: string | null; sha: string; ext: string };
export type CandidateRow = { name: string; created_at: string | null; updated_at: string | null };
export type ReferencePage = { rows: number; lastId: string | null; runs: string[] };

/** Date limite : un objet créé ou réécrit après elle est trop récent pour être supprimé. */
export function cleanupCutoff(now: Date, days = RETENTION_DAYS): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

/** Chemin d'une image rangée, ou null pour tout autre objet du bucket (jamais supprimé). */
export function parseImagePath(name: unknown): ImagePath | null {
  if (typeof name !== 'string') return null;
  const m = IMAGE_PATH.exec(name);
  if (!m) return null;
  if (m[1]) return { folder: 'event', eventId: m[1], sha: m[3], ext: m[4] };
  return { folder: m[2] === 'previews' ? 'previews' : 'templates', eventId: null, sha: m[3], ext: m[4] };
}

/** Plus ancien que la date limite, à la création comme à la dernière réécriture ; date illisible → non. */
export function isOldEnough(row: CandidateRow, cutoffIso: string): boolean {
  const cutoff = Date.parse(cutoffIso);
  const created = Date.parse(String(row.created_at ?? ''));
  if (!Number.isFinite(cutoff) || !Number.isFinite(created) || created >= cutoff) return false;
  if (row.updated_at == null) return true;
  const updated = Date.parse(String(row.updated_at));
  return Number.isFinite(updated) && updated < cutoff;
}

/** Réponse de design_image_references validée ; toute forme inattendue lève (rien n'est supprimé). */
export function parseReferencePage(raw: unknown): ReferencePage {
  const page = raw as { rows?: unknown; last_id?: unknown; runs?: unknown } | null;
  if (!page || typeof page !== 'object') throw new Error('réponse des références illisible');
  const rows = page.rows;
  if (typeof rows !== 'number' || !Number.isInteger(rows) || rows < 0) throw new Error('nombre de lignes illisible');
  const lastId = page.last_id ?? null;
  if (lastId !== null && typeof lastId !== 'string') throw new Error('dernier identifiant illisible');
  if (rows > 0 && !lastId) throw new Error('dernier identifiant manquant');
  if (!Array.isArray(page.runs) || page.runs.some((r) => typeof r !== 'string')) throw new Error('empreintes illisibles');
  return { rows, lastId, runs: page.runs as string[] };
}

/**
 * Empreintes trouvées dans les tables : suites d'au moins 64 caractères hexadécimaux. Une suite
 * plus longue (empreinte collée à d'autres chiffres) protège toute empreinte qu'elle contient.
 */
export class ReferenceIndex {
  private exact = new Set<string>();
  private longer: string[] = [];

  add(runs: Iterable<string>) {
    for (const raw of runs) {
      const run = String(raw).toLowerCase();
      if (!/^[0-9a-f]{64,}$/.test(run)) continue;
      if (run.length === 64) this.exact.add(run);
      else this.longer.push(run);
    }
  }

  has(sha: string): boolean {
    const s = sha.toLowerCase();
    return this.exact.has(s) || this.longer.some((run) => run.includes(s));
  }

  get size(): number {
    return this.exact.size + this.longer.length;
  }
}

/** Objets à examiner : chemins d'images rangées, assez anciens. Le reste est écarté (gardé). */
export function eligibleCandidates(rows: CandidateRow[], cutoffIso: string): CandidateRow[] {
  return rows.filter((r) => parseImagePath(r.name) !== null && isOldEnough(r, cutoffIso));
}

/** Décision : supprimables = images rangées, assez anciennes, dont l'empreinte n'apparaît nulle part. */
export function planDeletion(rows: CandidateRow[], index: ReferenceIndex, cutoffIso: string) {
  const deletable: string[] = [];
  let used = 0;
  for (const row of eligibleCandidates(rows, cutoffIso)) {
    if (index.has(parseImagePath(row.name)!.sha)) used++;
    else deletable.push(row.name);
  }
  return { deletable, used };
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ── Déroulé d'un passage ─────────────────────────────────────────────────────────────────────────

export interface CleanupStore {
  /** Objets du bucket `designs` dans les dossiers d'images, plus anciens que `cutoff` (au plus `limit`). */
  candidates(cutoffIso: string, limit: number, names?: string[]): Promise<CandidateRow[]>;
  /** Une page d'une table : réponse brute de design_image_references. */
  references(source: string, afterId: string | null, limit: number, maxBytes: number): Promise<unknown>;
  /** Supprime ces objets du bucket `designs` ; lève en cas d'échec. */
  remove(paths: string[]): Promise<void>;
}

export type CleanupLimits = {
  maxCandidates: number;
  pageRows: number;
  pageBytes: number;
  maxPagesPerSource: number;
  removeBatch: number;
  /** Durée maximale du parcours des références (ms) : au-delà, rien n'est supprimé. */
  scanBudgetMs: number;
};

export const DEFAULT_LIMITS: CleanupLimits = Object.freeze({
  maxCandidates: 300,
  pageRows: 100,
  pageBytes: 8 * 1024 * 1024,
  maxPagesPerSource: 2000,
  removeBatch: 100,
  scanBudgetMs: 80_000,
});

export type CleanupSummary = {
  cutoff: string;
  candidates: number;
  scanned: Record<string, number>;
  used: number;
  deleted: number;
  errors: string[];
};

/**
 * Un passage : candidats → parcours complet des tables → décision → nouvelle vérification des
 * candidats (réécrits entre-temps ?) → suppression par lots. Une erreur avant la suppression
 * arrête tout (rien n'est supprimé) ; une erreur de suppression est notée, les autres lots continuent.
 */
export async function runCleanup(
  store: CleanupStore,
  now: Date,
  limits: CleanupLimits = DEFAULT_LIMITS,
  clock: () => number = Date.now,
): Promise<CleanupSummary> {
  const cutoff = cleanupCutoff(now);
  const summary: CleanupSummary = { cutoff, candidates: 0, scanned: {}, used: 0, deleted: 0, errors: [] };

  const found = eligibleCandidates(await store.candidates(cutoff, limits.maxCandidates), cutoff);
  summary.candidates = found.length;
  if (!found.length) return summary;

  const index = new ReferenceIndex();
  const deadline = clock() + limits.scanBudgetMs;
  for (const source of REFERENCE_SOURCES) {
    let after: string | null = null;
    let rows = 0;
    for (let pages = 0; ; pages++) {
      if (pages >= limits.maxPagesPerSource) throw new Error(`${source} : trop de pages, parcours incomplet`);
      if (clock() > deadline) throw new Error(`parcours des références trop long (${source}) : rien n’a été supprimé`);
      const page = parseReferencePage(await store.references(source, after, limits.pageRows, limits.pageBytes));
      if (page.rows === 0) break;
      if (after !== null && page.lastId! <= after) throw new Error(`${source} : pagination bloquée`);
      index.add(page.runs);
      rows += page.rows;
      after = page.lastId;
    }
    summary.scanned[source] = rows;
  }

  const plan = planDeletion(found, index, cutoff);
  summary.used = plan.used;
  if (!plan.deletable.length) return summary;

  // Nouvelle lecture juste avant la suppression : une image renvoyée pendant le parcours a une date
  // de réécriture récente et sort de la liste.
  const recheck = new Set(eligibleCandidates(await store.candidates(cutoff, plan.deletable.length, plan.deletable), cutoff)
    .map((r) => r.name));
  const toDelete = plan.deletable.filter((name) => recheck.has(name));

  for (const batch of chunk(toDelete, limits.removeBatch)) {
    try {
      await store.remove(batch);
      summary.deleted += batch.length;
    } catch (e) {
      summary.errors.push(`suppression : ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return summary;
}
