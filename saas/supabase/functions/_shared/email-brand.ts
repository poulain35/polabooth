// Marque des emails (open core, lot L7) : le gabarit (email-layout.ts) ne contient aucune marque,
// seulement des marqueurs (BRAND_MARKS). postBrevo (_shared/email.ts) les remplit juste avant
// l'envoi avec l'identité de l'entreprise de l'instance (Paramètres → Entreprise) :
//   - nom : business_profile.company_name, sinon contact_company, sinon le nom de l'organisation ;
//   - logo : business_profile.email_logo_url, sinon organizations.logo_url, sinon le nom en texte ;
//   - lien du logo : business_profile.website_url ;
//   - pied de page client : business_profile.email_reviews_text (`**gras**` permis), les réseaux
//     (business_profile.social_*_url), le nom et contact_address (lignes jointes par des virgules) ;
//   - mentions légales : business_profile.email_legal_footer, sinon le nom.
// Un champ vide fait disparaître son bloc. Rendu pur, sans import Deno : testé sous `node --test`.

import { BODY_FONT, BRAND, BRAND_MARKS, escapeHtml, fontSize, HEADING_FONT } from './email-layout.ts';

export interface EmailBrand {
  name: string;
  logoUrl: string | null;
  siteUrl: string | null;
  /** Adresse sur une ligne. */
  address: string | null;
  legalFooter: string | null;
  reviewsText: string | null;
  socials: Array<{ name: string; icon: string; url: string }>;
}

/** Réseaux proposés dans Paramètres → Entreprise (clé de business_profile, nom, icône Brevo). */
export const SOCIAL_NETWORKS = [
  { key: 'social_facebook_url', name: 'Facebook', icon: 'facebook' },
  { key: 'social_instagram_url', name: 'Instagram', icon: 'instagram' },
  { key: 'social_linkedin_url', name: 'LinkedIn', icon: 'linkedin' },
] as const;

const SOCIAL_ICONS = 'https://creative-assets.mailinblue.com/editor/social-icons/rounded_bw';

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const httpUrl = (v: unknown): string | null => {
  const t = text(v);
  return t && /^https?:\/\//i.test(t) ? t : null;
};

/** Ligne `organizations` (ou null) → marque des emails. `fallbackName` : nom sans fiche (FROM_NAME). */
export function emailBrandFromOrg(row: Record<string, unknown> | null, fallbackName = ''): EmailBrand {
  const org = row ?? {};
  const profile = (org.business_profile && typeof org.business_profile === 'object' ? org.business_profile : {}) as Record<string, unknown>;
  const address = text(org.contact_address);
  return {
    name: text(profile.company_name) ?? text(org.contact_company) ?? text(org.name) ?? fallbackName,
    logoUrl: httpUrl(profile.email_logo_url) ?? httpUrl(org.logo_url),
    siteUrl: httpUrl(profile.website_url),
    address: address ? address.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(', ') : null,
    legalFooter: text(profile.email_legal_footer),
    reviewsText: text(profile.email_reviews_text),
    socials: SOCIAL_NETWORKS.flatMap((s) => {
      const url = httpUrl(profile[s.key]);
      return url ? [{ name: s.name, icon: s.icon, url }] : [];
    }),
  };
}

/** Texte échappé, `**gras**` rendu en <strong>. */
function richText(value: string): string {
  return escapeHtml(value).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function linked(brand: EmailBrand, inner: string): string {
  return brand.siteUrl ? `<a href="${escapeHtml(brand.siteUrl)}" target="_blank">${inner}</a>` : inner;
}

function header(brand: EmailBrand): string {
  if (brand.logoUrl) {
    return linked(brand, `<img src="${escapeHtml(brand.logoUrl)}" width="300" alt="${escapeHtml(brand.name)}" class="pola-logo" style="display:block;width:300px;max-width:100%;height:auto;border:0;">`);
  }
  if (!brand.name) return '';
  return `<span style="font-family:${HEADING_FONT};font-weight:600;${fontSize('h1')}line-height:1.25;color:${BRAND.heading};">${escapeHtml(brand.name)}</span>`;
}

function footer(brand: EmailBrand): string {
  const parts: string[] = [];
  if (brand.reviewsText) {
    parts.push(`<p style="margin:0 0 16px;"><span style="color:${BRAND.accent};">★★★★★</span> ${richText(brand.reviewsText)}</p>`);
  }
  if (brand.socials.length) {
    const icons = brand.socials.map((s) =>
      `<td style="padding:0 8px;"><a href="${escapeHtml(s.url)}" target="_blank"><img src="${SOCIAL_ICONS}/${s.icon}_32px.png" width="32" height="32" alt="${s.name}" style="display:block;border:0;width:32px;height:32px;"></a></td>`).join('');
    parts.push(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;"><tr>${icons}</tr></table>`);
  }
  const identity = [brand.name ? `<strong>${escapeHtml(brand.name)}</strong>` : '', brand.address ? escapeHtml(brand.address) : '']
    .filter(Boolean).join('<br>');
  if (identity) parts.push(`<p style="margin:16px 0 0;${fontSize('legal')}">${identity}</p>`);
  if (brand.logoUrl) {
    parts.push(linked(brand, `<img src="${escapeHtml(brand.logoUrl)}" width="95" alt="${escapeHtml(brand.name)}" style="display:block;margin:16px auto 0;width:95px;height:auto;border:0;">`));
  }
  if (!parts.length) return '';
  return `<tr><td align="center" class="pola-pad" style="padding:32px 32px 0;font-family:${BODY_FONT};${fontSize('small')}line-height:1.5;color:${BRAND.text};">
        ${parts.join('\n        ')}
      </td></tr>`;
}

/** Remplit les marqueurs du gabarit avec la marque. Sans marqueur (HTML libre), le HTML est rendu tel quel. */
export function applyEmailBrand(html: string, brand: EmailBrand): string {
  return html
    .replaceAll(BRAND_MARKS.header, header(brand))
    .replaceAll(BRAND_MARKS.footer, footer(brand))
    .replaceAll(BRAND_MARKS.legal, escapeHtml(brand.legalFooter ?? brand.name))
    .replaceAll(BRAND_MARKS.name, escapeHtml(brand.name));
}

type Env = (key: string) => string | undefined;
const denoEnv: Env = (key) =>
  (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(key);

const CACHE_MS = 60_000;

/**
 * Chargeur de la marque de l'instance (première organisation, open core D1) par l'API REST avec la
 * clé service_role, mis en cache 60 s. Lecture impossible : marque minimale (FROM_NAME), l'email part.
 */
export function instanceBrandLoader(env: Env = denoEnv, fetchImpl: typeof fetch = (...a) => fetch(...a)): () => Promise<EmailBrand> {
  let cached: { at: number; brand: EmailBrand } | null = null;
  return async () => {
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.brand;
    const fallbackName = env('FROM_NAME') ?? '';
    const url = env('SUPABASE_URL')?.replace(/\/+$/, '');
    const key = env('SUPABASE_SERVICE_ROLE_KEY');
    let row: Record<string, unknown> | null = null;
    if (url && key) {
      try {
        const res = await fetchImpl(`${url}/rest/v1/organizations?select=*&order=created_at.asc&limit=1`, {
          headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
        });
        if (res.ok) row = ((await res.json()) as Array<Record<string, unknown>>)[0] ?? null;
        else console.warn(`Marque des emails illisible (${res.status})`);
      } catch (e) {
        console.warn('Marque des emails illisible :', e);
      }
      if (!row) return emailBrandFromOrg(null, fallbackName); // pas de cache : relue au prochain email
    }
    const brand = emailBrandFromOrg(row, fallbackName);
    cached = { at: Date.now(), brand };
    return brand;
  };
}
