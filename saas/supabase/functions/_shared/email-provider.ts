// Fournisseur d'envoi des emails (open core étape 2, lot S2) : Brevo (API) ou SMTP.
// Lu à chaque envoi : EMAIL_PROVIDER = « brevo » ou « smtp ». Absente (ou autre valeur) : Brevo,
// comme avant S2, sauf s'il n'y a aucune clé Brevo et que SMTP_HOST est défini.
// Sans import Deno ni esm.sh : testé sous `node --test`.

import { denoEnv, type EnvGet } from './secrets.ts';

export type EmailProvider = 'brevo' | 'smtp';

/**
 * `brevoKey` : la même lecture que l'envoi Brevo (Paramètres > Clés, sinon BREVO_API_KEY). Elle n'est
 * appelée que dans le cas automatique avec SMTP_HOST défini : sans variable nouvelle, rien ne change.
 */
export async function resolveEmailProvider(
  brevoKey: () => Promise<string | null>,
  env: EnvGet = denoEnv,
): Promise<EmailProvider> {
  const explicit = env('EMAIL_PROVIDER')?.trim().toLowerCase();
  if (explicit === 'smtp' || explicit === 'brevo') return explicit;
  if (!env('SMTP_HOST')?.trim()) return 'brevo';
  return (await brevoKey()) ? 'brevo' : 'smtp';
}
