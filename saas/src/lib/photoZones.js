// Zones photo d'un design Fabric.js, y compris celles rangées dans un groupe (LAB-214).
// Le kiosk (CompositeService.ParsePhotoZones) reproduit la même géométrie pour placer les
// photos : toute modification ici doit y être répercutée (vecteur commun dans les tests).

const CONTAINER_TYPES = new Set(['group', 'activeSelection']);

const isContainer = (o) => CONTAINER_TYPES.has(o?.type) && typeof o.getObjects === 'function';

/** Zones photo (objets Fabric vivants), enfants de groupes compris, dans l'ordre d'empilement. */
export function findPhotoZones(objects) {
  const zones = [];
  for (const o of objects ?? []) {
    if (o?.isPhotoZone) zones.push(o);
    else if (isContainer(o)) zones.push(...findPhotoZones(o.getObjects()));
  }
  return zones;
}

/** Objets dessinés (hors groupes eux-mêmes), dans l'ordre où Fabric les peint. */
export function flattenObjects(objects) {
  const flat = [];
  for (const o of objects ?? []) {
    if (isContainer(o)) flat.push(...flattenObjects(o.getObjects()));
    else if (o) flat.push(o);
  }
  return flat;
}

/**
 * Rectangle d'une zone en coordonnées canvas à partir de sa matrice Fabric complète
 * ([a, b, c, d, e, f], groupes compris) : centre, taille et angle en degrés (sens horaire).
 * Le cisaillement est ignoré. Un miroir ne retourne jamais la photo : la zone garde le même
 * rectangle et prend l'orientation la plus proche de l'endroit.
 */
export function zoneRectFromMatrix(matrix, width, height) {
  let [a, b] = matrix;
  const [, , c, d, e, f] = matrix;
  let det = a * d - b * c;
  const mirrored = det < 0;
  if (mirrored) {
    a = -a;
    b = -b;
    det = -det;
  }
  const scaleX = Math.hypot(a, b);
  let angle = (Math.atan2(b, a) * 180) / Math.PI;
  if (mirrored && Math.abs(angle) > 90) angle += angle > 0 ? -180 : 180;
  return { cx: e, cy: f, width: width * scaleX, height: (height * det) / scaleX, angle };
}

/** Rectangle canvas d'une zone photo vivante (dans un groupe ou non). */
export function photoZoneRect(zone) {
  return zoneRectFromMatrix(zone.calcTransformMatrix(), zone.width, zone.height);
}

/** Copie des objets sérialisés sans aucune zone photo, groupes compris ; un groupe vidé disparaît. */
export function withoutPhotoZones(objects) {
  return (objects ?? []).flatMap((o) => {
    if (o?.isPhotoZone) return [];
    if (o?.type !== 'group' || !Array.isArray(o.objects)) return [o];
    const children = withoutPhotoZones(o.objects);
    return children.length ? [{ ...o, objects: children }] : [];
  });
}
