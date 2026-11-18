// Garde-fou des emails hors production (LAB-80) : préfixe d'objet, liste blanche des destinataires,
// redirection. Logique pure (aucun accès Deno ni réseau) appliquée par postBrevo dans email.ts.
// Aucune variable définie (prod) : le payload Brevo est renvoyé tel quel.

export interface EmailGuardConfig {
  /** EMAIL_SUBJECT_PREFIX, ex. « [TEST] ». */
  subjectPrefix?: string;
  /** EMAIL_ALLOWLIST découpée : adresses ou domaines, en minuscules. */
  allowlist?: string[];
  /** EMAIL_REDIRECT_TO, en minuscules. */
  redirectTo?: string;
}

export type BrevoPayload = Record<string, unknown>;

export type EmailGuardResult =
  | { action: 'send'; payload: BrevoPayload }
  | { action: 'block'; blocked: string[] };

/** Résout l'objet d'un template Brevo (params déjà substitués), ou null si indisponible. */
export type TemplateSubjectResolver = (templateId: number, params: Record<string, unknown>) => Promise<string | null>;

interface Recipient { email: string; name?: string }

const RECIPIENT_FIELDS = ['to', 'cc', 'bcc'] as const;

export function parseEmailGuardConfig(get: (key: string) => string | undefined): EmailGuardConfig {
  const config: EmailGuardConfig = {};
  const prefix = get('EMAIL_SUBJECT_PREFIX');
  if (prefix) config.subjectPrefix = prefix;
  const allowlist = (get('EMAIL_ALLOWLIST') ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
  if (allowlist.length) config.allowlist = allowlist;
  const redirectTo = get('EMAIL_REDIRECT_TO')?.trim().toLowerCase();
  if (redirectTo) config.redirectTo = redirectTo;
  return config;
}

function isGuardActive(config: EmailGuardConfig): boolean {
  return Boolean(config.subjectPrefix || config.allowlist || config.redirectTo);
}

/**
 * Adresse autorisée : égale à une entrée, ou alias Gmail `+tag` d'une entrée, ou du domaine d'une
 * entrée sans « @ ». Insensible à la casse.
 */
export function isAllowedRecipient(email: string, allowlist: string[]): boolean {
  const addr = email.trim().toLowerCase();
  const at = addr.lastIndexOf('@');
  if (at < 0) return false;
  const domain = addr.slice(at + 1);
  const untagged = addr.slice(0, at).replace(/\+.*$/, '') + '@' + domain;
  return allowlist.some((entry) => (entry.includes('@') ? entry === addr || entry === untagged : entry === domain));
}

/** Substitue `{{ params.X }}` (filtres éventuels ignorés) dans l'objet d'un template Brevo. */
export function renderTemplateSubject(subject: string, params: Record<string, unknown>): string {
  return subject.replace(/\{\{\s*params\.(\w+)[^}]*\}\}/g, (_, key: string) => String(params[key] ?? ''));
}

/** « [TEST] » + redirection de a@x.fr → « [TEST → a@x.fr] ». */
export function subjectTag(prefix: string | undefined, redirectedFrom: string[]): string {
  if (!redirectedFrom.length) return prefix ?? '';
  const origins = redirectedFrom.join(', ');
  const bracketed = prefix?.match(/^\s*\[([^\]]*)\]\s*$/);
  if (bracketed) return `[${bracketed[1].trim()} → ${origins}] `;
  return `${prefix ?? ''}[→ ${origins}] `;
}

/**
 * Applique le garde-fou à un payload Brevo (/v3/smtp/email).
 * - Hors liste blanche (to/cc/bcc) : remplacé par redirectTo, ou email bloqué si pas de redirection.
 *   Sans liste blanche mais avec redirectTo, tous les destinataires sont redirigés.
 * - Objet préfixé ; pour un template Brevo, l'objet du template est passé en surcharge `subject`.
 */
export async function applyEmailGuard(
  payload: BrevoPayload,
  config: EmailGuardConfig,
  resolveTemplateSubject?: TemplateSubjectResolver,
): Promise<EmailGuardResult> {
  if (!isGuardActive(config)) return { action: 'send', payload };

  const { allowlist, redirectTo } = config;
  const allowed = (email: string) => {
    if (redirectTo && email.trim().toLowerCase() === redirectTo) return true;
    if (allowlist) return isAllowedRecipient(email, allowlist);
    return !redirectTo;
  };

  const redirectedFrom: string[] = [];
  const blocked: string[] = [];
  const seen = new Set<string>();
  const out: BrevoPayload = { ...payload };

  for (const field of RECIPIENT_FIELDS) {
    const list = payload[field] as Recipient[] | undefined;
    if (!list) continue;
    const kept: Recipient[] = [];
    for (const r of list) {
      let next = r;
      if (!allowed(r.email)) {
        if (!redirectTo) { blocked.push(r.email); continue; }
        if (!redirectedFrom.includes(r.email)) redirectedFrom.push(r.email);
        next = { email: redirectTo };
      }
      const key = next.email.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(next);
    }
    if (kept.length) out[field] = kept;
    else delete out[field];
  }

  if (blocked.length) return { action: 'block', blocked };

  const tag = subjectTag(config.subjectPrefix, redirectedFrom);
  if (tag) {
    let base = payload.subject as string | undefined;
    if (base === undefined && payload.templateId) {
      const templateId = Number(payload.templateId);
      const params = (payload.params as Record<string, unknown> | undefined) ?? {};
      base = (await resolveTemplateSubject?.(templateId, params)) ?? `Template Brevo n°${templateId}`;
    }
    out.subject = tag + (base ?? '');
  }

  return { action: 'send', payload: out };
}
