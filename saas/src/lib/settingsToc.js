// Sommaire de la page Réglages (LAB-338) : sections affichées et section suivie au défilement.
// Logique pure de `pages/admin/AdminReglages.jsx`. Testé dans settingsToc.test.js.

/**
 * Sections affichées, dans l'ordre de `sections`. `hidden` liste les identifiants à cacher
 * (ex. « offres » sans module de réservation).
 */
export function visibleSections(sections, hidden = []) {
  return sections.filter((section) => !hidden.includes(section.id));
}

/**
 * Section suivie par le sommaire. `positions` : `[{ id, top }]` dans l'ordre de la page, `top` étant
 * la distance entre le haut de la section et le haut de la zone qui défile. La section suivie est la
 * dernière dont le haut a passé la ligne `offset`. En bas de page, les dernières sections ne peuvent
 * plus atteindre cette ligne : on suit la dernière, sauf si la section choisie dans le sommaire
 * (`preferred`) a son haut à l'écran (`top` entre 0 et `viewHeight`).
 */
export function activeSectionId(positions, { offset = 0, atBottom = false, preferred = null, viewHeight = Infinity } = {}) {
  if (!positions.length) return null;
  if (atBottom) {
    const chosen = positions.find((p) => p.id === preferred);
    if (chosen && chosen.top >= 0 && chosen.top < viewHeight) return chosen.id;
    return positions[positions.length - 1].id;
  }
  let current = positions[0].id;
  for (const p of positions) {
    if (p.top <= offset) current = p.id;
    else break;
  }
  return current;
}

/** Identifiant de section tiré du fragment de l'adresse (`#services` → `services`). */
export function hashSectionId(hash) {
  try {
    return decodeURIComponent(String(hash ?? '').replace(/^#/, '')) || null;
  } catch {
    return null;
  }
}
