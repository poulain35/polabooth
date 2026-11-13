// kiosk-config.json, lu par la borne à l'adresse https://<SaaS>/kiosk-config.json (open core K2).
// Généré au build par vite.config.js depuis les variables d'environnement, jamais versionné.

export const KIOSK_CONFIG_FILE = 'kiosk-config.json';

export const isJwt = (key) => typeof key === 'string' && /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(key);

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * KIOSK_SUPABASE_URL (défaut VITE_SUPABASE_URL) et KIOSK_SUPABASE_ANON_KEY (défaut
 * VITE_SUPABASE_ANON_KEY si c'est un JWT). La borne appelle des fonctions vérifiées par la
 * passerelle (verify_jwt), qui refuse une clé sb_publishable_… : sans JWT, pas de fichier.
 * Renvoie { content } ou { warning }.
 */
export function resolveKioskConfig(env) {
  const supabaseUrl = clean(env.KIOSK_SUPABASE_URL) || clean(env.VITE_SUPABASE_URL);
  const explicitKey = clean(env.KIOSK_SUPABASE_ANON_KEY);
  const fallbackKey = clean(env.VITE_SUPABASE_ANON_KEY);

  let anonKey;
  let keyProblem;
  if (explicitKey) {
    if (isJwt(explicitKey)) anonKey = explicitKey;
    else keyProblem = 'KIOSK_SUPABASE_ANON_KEY n\'est pas une clé au format JWT (eyJ…).';
  } else if (isJwt(fallbackKey)) {
    anonKey = fallbackKey;
  } else {
    keyProblem = fallbackKey
      ? 'KIOSK_SUPABASE_ANON_KEY est absente et VITE_SUPABASE_ANON_KEY n\'est pas une clé au format JWT (eyJ…).'
      : 'KIOSK_SUPABASE_ANON_KEY et VITE_SUPABASE_ANON_KEY sont absentes.';
  }

  const problems = [];
  if (!supabaseUrl) problems.push('KIOSK_SUPABASE_URL et VITE_SUPABASE_URL sont absentes.');
  else if (!/^https?:\/\/[^\s/]+$/.test(supabaseUrl.replace(/\/+$/, ''))) problems.push(`Adresse Supabase invalide : ${supabaseUrl}`);
  if (keyProblem) problems.push(keyProblem);

  if (problems.length) {
    return {
      content: null,
      warning: [
        `${KIOSK_CONFIG_FILE} N'EST PAS GÉNÉRÉ : les bornes ne pourront pas se connecter à ce SaaS.`,
        ...problems,
        'Définissez KIOSK_SUPABASE_ANON_KEY = clé anon au format JWT (Supabase > Project Settings > API Keys >',
        '« Legacy API Keys »), et KIOSK_SUPABASE_URL si l\'adresse Supabase diffère de VITE_SUPABASE_URL.',
      ].join('\n'),
    };
  }
  return { content: kioskConfigJson({ supabaseUrl: supabaseUrl.replace(/\/+$/, ''), anonKey }), warning: null };
}

export function kioskConfigJson({ supabaseUrl, anonKey }) {
  return `${JSON.stringify({ supabaseUrl, supabaseAnonKey: anonKey }, null, 2)}\n`;
}
