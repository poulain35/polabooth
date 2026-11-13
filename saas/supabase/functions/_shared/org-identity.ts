// Identité de l'entreprise (open core, lot L5) : Paramètres → Entreprise, lue dans `organizations`
// (colonnes contact_*, logo_url, email_sender_*, et business_profile pour la signature et le lien
// d'avis). Un champ vide retombe sur la valeur d'avant L5 : expéditeur FROM_NAME / FROM_EMAIL,
// la prod ne change donc pas tant que rien n'est saisi. Sans FROM_NAME : le nom de l'entreprise ;
// sans FROM_EMAIL : aucune adresse (Brevo refuse l'envoi, à configurer dans les secrets).
// Sans import Deno ni esm.sh : testé par org-identity.test.ts (Deno lu à l'appel, jamais à l'import).

export interface OrgIdentity {
  companyName: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  logoUrl: string | null;
  reviewUrl: string | null;
  senderName: string;
  senderEmail: string;
}

/** Valeurs d'avant L5, utilisées quand le champ correspondant n'est pas saisi. */
export interface IdentityDefaults {
  companyName: string;
  senderName: string;
  senderEmail: string;
}

export interface Sender {
  email: string;
  name: string;
}

type Env = (key: string) => string | undefined;

// deno-lint-ignore no-explicit-any
export interface IdentityDb { from(table: string): any }

const denoEnv: Env = (key) =>
  (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(key);

/** Repli sur les variables d'environnement, comme _shared/email.ts avant L5 (`??` : une variable vide reste vide). */
export function identityDefaults(env: Env = denoEnv): IdentityDefaults {
  const fromName = env('FROM_NAME') ?? '';
  return {
    companyName: fromName,
    senderName: fromName,
    senderEmail: env('FROM_EMAIL') ?? '',
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Ligne `organizations` (ou null) → identité, chaque champ vide remplacé par son repli. */
export function resolveOrgIdentity(row: Record<string, unknown> | null, defaults: IdentityDefaults): OrgIdentity {
  const org = row ?? {};
  const profile = (org.business_profile && typeof org.business_profile === 'object' ? org.business_profile : {}) as Record<string, unknown>;
  const senderEmail = text(org.email_sender_email);
  // Même ordre que send-event-report : nom commercial du profil, fiche contact, nom de l'organisation.
  const companyName = text(profile.company_name) ?? text(org.contact_company) ?? text(org.name) ?? defaults.companyName;
  return {
    companyName,
    phone: text(org.contact_phone),
    email: text(org.contact_email),
    address: text(org.contact_address),
    logoUrl: text(org.logo_url),
    reviewUrl: text(profile.google_review_url),
    // Sans FROM_NAME : le nom de l'entreprise (lot L7, plus de nom codé en dur).
    senderName: text(org.email_sender_name) ?? (defaults.senderName || companyName),
    // Adresse mal formée : Brevo refuserait l'envoi, on garde l'expéditeur par défaut.
    senderEmail: senderEmail && EMAIL_RE.test(senderEmail) ? senderEmail : defaults.senderEmail,
  };
}

/**
 * Identité de l'organisation `orgId`. Organisation introuvable, id absent ou erreur de lecture :
 * replis seulement (un email part toujours, avec l'expéditeur d'avant L5).
 * `select('*')` : la lecture marche aussi si la migration 20261211000100 n'est pas encore appliquée.
 */
export async function getOrgIdentity(
  db: IdentityDb, orgId: string | null | undefined, defaults: IdentityDefaults = identityDefaults(),
): Promise<OrgIdentity> {
  if (!orgId) return resolveOrgIdentity(null, defaults);
  try {
    const { data, error } = await db.from('organizations').select('*').eq('id', orgId).maybeSingle();
    if (error) console.warn(`Identité de l'organisation ${orgId} illisible :`, error.message ?? error);
    return resolveOrgIdentity((data as Record<string, unknown> | null) ?? null, defaults);
  } catch (e) {
    console.warn(`Identité de l'organisation ${orgId} illisible :`, e);
    return resolveOrgIdentity(null, defaults);
  }
}

/** Expéditeur Brevo de l'identité. */
export const identitySender = (identity: OrgIdentity): Sender => ({ email: identity.senderEmail, name: identity.senderName });

/** Expéditeur des emails de l'organisation (raccourci des fonctions qui n'ont besoin que de lui). */
export async function orgSender(db: IdentityDb, orgId: string | null | undefined): Promise<Sender> {
  return identitySender(await getOrgIdentity(db, orgId));
}

/** Variante mise en cache par organisation, pour les passes qui envoient plusieurs emails. */
export function orgSenderCache(db: IdentityDb): (orgId: string | null | undefined) => Promise<Sender> {
  const cache = new Map<string, Promise<Sender>>();
  return (orgId) => {
    const key = orgId ?? '';
    if (!cache.has(key)) cache.set(key, orgSender(db, orgId));
    return cache.get(key)!;
  };
}
