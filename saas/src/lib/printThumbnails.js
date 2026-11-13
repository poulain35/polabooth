// LAB-227 : miniature des impressions dans l'admin. Depuis kiosk_record_print, la borne n'envoie
// plus composite_url ; la miniature vient de la photo kiosk de la même séance. Le numéro de séance
// n'est pas une colonne de photos : il est dans storage_path (photos/{slug}-{id8}/{session_id}/{fichier}).

const SESSION_IN_PATH = /^photos\/[^/]+\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[^/]+$/i;

/** Numéro de séance d'une photo kiosk, en minuscules, ou null. */
export function sessionIdFromStoragePath(storagePath) {
  const m = typeof storagePath === 'string' ? SESSION_IN_PATH.exec(storagePath) : null;
  return m ? m[1].toLowerCase() : null;
}

/** Séances dont la miniature manque (composite_url vide), sans doublon. */
export function sessionsNeedingThumbnail(logs) {
  const ids = new Set();
  for (const log of logs ?? []) {
    if (!log.composite_url && log.session_id) ids.add(String(log.session_id).toLowerCase());
  }
  return [...ids];
}

/**
 * Complète composite_url des impressions par la photo de leur séance. Garde composite_url déjà
 * rempli (anciennes lignes envoyées par la borne). photos : { storage_path, photo_url, created_at },
 * la première photo de la séance (created_at le plus ancien) gagne. Ne modifie pas les entrées.
 */
export function withPrintThumbnails(logs, photos) {
  const bySession = new Map();
  const sorted = [...(photos ?? [])].sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
  for (const p of sorted) {
    const sid = sessionIdFromStoragePath(p.storage_path);
    if (sid && p.photo_url && !bySession.has(sid)) bySession.set(sid, p.photo_url);
  }
  return (logs ?? []).map((log) => {
    if (log.composite_url || !log.session_id) return log;
    const url = bySession.get(String(log.session_id).toLowerCase());
    return url ? { ...log, composite_url: url } : log;
  });
}
