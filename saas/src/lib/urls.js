// Liens venus d'une donnée (saisie de l'admin, base, borne) : seul le http(s) devient cliquable,
// un lien `javascript:` ou `data:` reste du texte (LAB-393).

function parse(url) {
  if (typeof url !== 'string') return null;
  try {
    return new URL(url.trim());
  } catch {
    return null;
  }
}

/** URL cliquable seulement en http(s), sinon null. */
export function safeHttpUrl(url) {
  const u = parse(url);
  return u && (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null;
}

/** URL cliquable seulement en https, sinon null. */
export function safeHttpsUrl(url) {
  const u = parse(url);
  return u && u.protocol === 'https:' ? u.href : null;
}

/**
 * Champ de lien saisi par l'admin, avant enregistrement : vide → { url: null }, http(s) → { url }
 * normalisée, autre chose → { error }.
 */
export function httpUrlInput(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { url: null };
  const url = safeHttpUrl(raw);
  return url ? { url } : { error: 'Adresse web invalide : elle doit commencer par https://' };
}
