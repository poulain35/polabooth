// LAB-200 : la borne ne se met à jour que sur demande depuis la page Licences (« Mettre à jour »).
// État affiché d'une demande, à partir des colonnes update_* de kiosk_licenses.

/** Compare deux versions « 1.2.3 » numériquement (négatif si a < b). */
export function compareVersions(a, b) {
  const pa = String(a ?? '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b ?? '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Dernière version publiée (numéro le plus élevé), ou null si aucune. */
export function latestRelease(releases) {
  return (releases ?? []).reduce(
    (best, rel) => (!best || compareVersions(rel.version, best.version) > 0 ? rel : best),
    null,
  );
}

const time = (iso) => (iso ? new Date(iso).getTime() : NaN);

/**
 * État de la dernière demande de mise à jour d'une borne :
 * - none      : aucune demande ;
 * - requested : demandée, pas encore lue par la borne ;
 * - received  : lue par la borne, installation au premier écran sans séance invité ;
 * - installed : la borne tourne sur la version demandée (heartbeat) ;
 * - failed    : échec signalé par la borne, plus d'essai sans nouvelle demande.
 */
export function kioskUpdateStatus(lic) {
  const version = lic?.update_requested_version ?? null;
  const requestedAt = lic?.update_requested_at ?? null;
  if (!version || !requestedAt) return { state: 'none' };

  const base = {
    version,
    requestedAt,
    receivedAt: lic.update_received_at ?? null,
    failedAt: lic.update_failed_at ?? null,
    error: lic.update_error ?? null,
  };
  const since = (iso) => time(iso) >= time(requestedAt);

  if (lic.app_version && compareVersions(lic.app_version, version) === 0) return { ...base, state: 'installed' };
  if (base.failedAt && since(base.failedAt)) return { ...base, state: 'failed' };
  if (base.receivedAt && since(base.receivedAt)) return { ...base, state: 'received' };
  return { ...base, receivedAt: null, failedAt: null, error: null, state: 'requested' };
}

/**
 * Encart « Nouvelle version » du menu de l'admin : dernière version publiée et nombre de bornes du
 * compte (`orgId`) en service qui tournent sur une version plus ancienne, sans demande en cours vers
 * cette version (demandée ou reçue). Null si aucune borne n'est en retard. Une borne qui n'a jamais
 * donné sa version n'est pas comptée.
 */
export function pendingKioskUpdate(licenses, releases, orgId) {
  const latest = latestRelease(releases)?.version;
  if (!latest || !orgId) return null;
  const count = (licenses ?? []).filter((lic) => {
    if (lic.org_id !== orgId || lic.retired_at || !lic.app_version) return false;
    if (compareVersions(lic.app_version, latest) >= 0) return false;
    const status = kioskUpdateStatus(lic);
    const inProgress = (status.state === 'requested' || status.state === 'received')
      && compareVersions(status.version, latest) >= 0;
    return !inProgress;
  }).length;
  return count > 0 ? { version: latest, count } : null;
}
