// Adresse du front SaaS dans les liens des emails et des notifications (open core, lot L7) : seulement
// les variables d'environnement, plus d'adresse codée en dur. `appUrl` lit APP_URL puis PUBLIC_APP_URL,
// `publicAppUrl` l'inverse (fonctions qui préféraient déjà PUBLIC_APP_URL). Aucune des deux : chaîne
// vide et un avertissement (liens relatifs dans les emails, à corriger dans les secrets).
// Sans import Deno : testé sous `node --test`.

type Env = (key: string) => string | undefined;
const denoEnv: Env = (key) =>
  (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(key);

function firstOf(env: Env, names: string[]): string {
  for (const name of names) {
    const value = env(name);
    if (value !== undefined) return value;
  }
  console.warn(`${names.join(' / ')} non configurée : liens des emails sans adresse du site`);
  return '';
}

/** APP_URL, sinon PUBLIC_APP_URL (`??` : une variable vide reste vide, comme avant L7). */
export const appUrl = (env: Env = denoEnv): string => firstOf(env, ['APP_URL', 'PUBLIC_APP_URL']);

/** PUBLIC_APP_URL, sinon APP_URL. */
export const publicAppUrl = (env: Env = denoEnv): string => firstOf(env, ['PUBLIC_APP_URL', 'APP_URL']);
