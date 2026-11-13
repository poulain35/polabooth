// Gabarit commun à tous les emails HTML du SaaS (LAB-82) : tunnel de réservation, emails de
// l'éditeur (_shared/saas-emails.ts) et photo kiosk. Fond crème, carte blanche de 600 px, logo
// centré, titres Fraunces, texte Roboto. Tables + styles en ligne pour Gmail et Outlook ; la media
// query ne sert qu'à resserrer les marges sur mobile.
// Sans marque (open core, lot L7) : le logo, le pied de page (avis, réseaux, adresse) et les mentions
// légales sont des marqueurs remplis à l'envoi par applyEmailBrand (_shared/email-brand.ts), avec
// l'identité saisie dans Paramètres → Entreprise.
// Rendu pur (sans Deno ni réseau) : n'importe aucun module d'email, pour éviter les imports circulaires.

/** Marqueurs remplacés à l'envoi par l'identité de l'entreprise (email-brand.ts). */
export const BRAND_MARKS = {
  header: '<!--brand:header-->',
  footer: '<!--brand:footer-->',
  legal: '%%BRAND_LEGAL%%',
  /** Nom de l'entreprise, utilisable dans un texte (survit à escapeHtml). */
  name: '%%BRAND_NAME%%',
} as const;

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const BRAND = {
  bg: '#fffcf7', card: '#ffffff', text: '#26081A', heading: '#4f1337', link: '#693013',
  muted: '#6b5a62', border: '#efe6dc', soft: '#fdf6ec', button: '#4f1337', buttonText: '#ffffff',
  accent: '#fde633',
  // Couleurs sémantiques (accepter / refuser, alertes), adoucies pour le fond crème.
  success: '#3d7a4f', successSoft: '#e7f1e9', danger: '#b4322a', dangerSoft: '#fbe9e6',
  warning: '#8a5a12', warningSoft: '#fdf1d8',
} as const;

/**
 * Échelle typographique unique (px). Aucun corps d'email n'écrit de taille en dur : tout passe
 * par `fontSize()` ou les helpers ci-dessous. `highlight` : n° de réservation mis en avant.
 */
export const TYPE = { h1: 28, h2: 20, highlight: 20, body: 16, small: 14, legal: 12 } as const;
export type TypeSize = keyof typeof TYPE;
export const ALLOWED_FONT_SIZES: ReadonlySet<number> = new Set(Object.values(TYPE));

export function fontSize(size: TypeSize): string {
  return `font-size:${TYPE[size]}px;`;
}

export const HEADING_FONT = 'Fraunces, Arial, sans-serif';
export const BODY_FONT = 'Roboto, Arial, sans-serif';
export interface LayoutOptions {
  /** `admin` : sans le bloc avis / réseaux / adresse (emails internes). */
  audience?: 'client' | 'admin';
}

/** Gabarit commun à tous les emails HTML (client et admin). */
export function layout(title: string, body: string, opts: LayoutOptions = {}): string {
  // Les <p> nus reçoivent une marge explicite : certains webmails remettent les marges à zéro.
  const content = body.replace(/<p>/g, '<p style="margin:0 0 16px;">');
  return `<!DOCTYPE html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>${escapeHtml(title)}</title>
<!--[if !mso]><!--><style type="text/css">@import url("https://fonts.googleapis.com/css2?family=Fraunces:wght@400;600&family=Roboto:wght@400;700&display=swap");</style><!--<![endif]-->
<style type="text/css">
  body { margin:0; padding:0; -webkit-text-size-adjust:100%; }
  @media only screen and (max-width:600px) {
    .pola-container { width:100% !important; max-width:100% !important; }
    .pola-pad { padding-left:15px !important; padding-right:15px !important; }
    .pola-card { padding:24px 15px !important; }
    .pola-logo { width:240px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.bg}" style="background:${BRAND.bg};">
  <tr><td align="center">
    <table role="presentation" class="pola-container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
      <tr><td align="center" class="pola-pad" style="padding:32px 32px 24px;">
        ${BRAND_MARKS.header}
      </td></tr>
      <tr><td class="pola-card" bgcolor="${BRAND.card}" style="background:${BRAND.card};border-radius:8px;padding:40px 32px;font-family:${BODY_FONT};${fontSize('body')}line-height:1.5;color:${BRAND.text};">
        <h1 style="margin:0 0 24px;font-family:${HEADING_FONT};font-weight:600;${fontSize('h1')}line-height:1.25;color:${BRAND.heading};">${escapeHtml(title)}</h1>
${content}
      </td></tr>
      ${opts.audience === 'admin' ? '' : BRAND_MARKS.footer}
      <tr><td align="center" class="pola-pad" style="padding:16px 32px 32px;font-family:${BODY_FONT};${fontSize('legal')}line-height:1.5;color:${BRAND.muted};">${BRAND_MARKS.legal}</td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

/** Bouton d'action « bulletproof » : la cellule porte la couleur (Outlook ignore le padding des liens). */
export function button(url: string, label: string, color: string = BRAND.button): string {
  return buttonRow([{ url, label, color }]);
}

export function buttonRow(
  buttons: Array<{ url: string; label: string; color?: string }>,
  opts: { align?: 'left' | 'center'; margin?: string } = {},
): string {
  const cells = buttons.map((b) => {
    const bg = b.color ?? BRAND.button;
    return `<td bgcolor="${bg}" style="background:${bg};border-radius:8px;"><a href="${escapeHtml(b.url)}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${BODY_FONT};${fontSize('body')}font-weight:700;line-height:1.2;color:${BRAND.buttonText};text-decoration:none;border-radius:8px;">${escapeHtml(b.label)}</a></td>`;
  }).join('<td width="12" style="width:12px;">&nbsp;</td>');
  const center = opts.align === 'center';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"${center ? ' align="center"' : ''} style="margin:${opts.margin ?? (center ? '24px auto' : '24px 0')};"><tr>${cells}</tr></table>`;
}

export function textLink(url: string, label: string, bold = false): string {
  return `<a href="${escapeHtml(url)}" style="color:${BRAND.link};text-decoration:underline;${bold ? 'font-weight:700;' : ''}">${escapeHtml(label)}</a>`;
}

export function sectionTitle(text: string): string {
  return `<h3 style="margin:24px 0 8px;font-family:${HEADING_FONT};font-weight:600;${fontSize('h2')}line-height:1.3;color:${BRAND.heading};">${escapeHtml(text)}</h3>`;
}

/** Valeur mise en avant (n° de réservation) : taille `highlight`, lettres espacées, prune. */
export function highlight(text: string): string {
  return `<strong style="${fontSize('highlight')}letter-spacing:2px;color:${BRAND.heading};">${escapeHtml(text)}</strong>`;
}

export type Tone = 'neutral' | 'warning' | 'danger' | 'success';

const TONES: Record<Tone, { bg: string; border: string; color: string }> = {
  neutral: { bg: BRAND.soft, border: BRAND.border, color: BRAND.text },
  warning: { bg: BRAND.warningSoft, border: BRAND.warningSoft, color: BRAND.warning },
  danger: { bg: BRAND.dangerSoft, border: BRAND.dangerSoft, color: BRAND.danger },
  success: { bg: BRAND.successSoft, border: BRAND.successSoft, color: BRAND.success },
};

/**
 * Encadré (message libre, consignes, rappel, alerte) ; `accent` ajoute un filet prune à gauche,
 * `tone` les couleurs sémantiques, `size: 'small'` le texte secondaire.
 */
export function softBox(innerHtml: string, opts: {
  accent?: boolean; preWrap?: boolean; margin?: string; tone?: Tone; size?: 'body' | 'small';
} = {}): string {
  const t = TONES[opts.tone ?? 'neutral'];
  return `<p style="margin:${opts.margin ?? '16px 0'};padding:14px 16px;background:${t.bg};border:1px solid ${t.border};border-radius:8px;${opts.tone && opts.tone !== 'neutral' ? `color:${t.color};` : ''}${opts.size === 'small' ? fontSize('small') : ''}${opts.accent ? `border-left:3px solid ${BRAND.heading};` : ''}${opts.preWrap ? 'white-space:pre-wrap;' : ''}">${innerHtml}</p>`;
}

/** Encadré crème pouvant contenir des blocs (bouton, plusieurs paragraphes). */
export function panel(innerHtml: string, opts: { align?: 'left' | 'center'; margin?: string } = {}): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${BRAND.soft}" style="width:100%;border-collapse:separate;background:${BRAND.soft};border:1px solid ${BRAND.border};border-radius:8px;margin:${opts.margin ?? '24px 0'};"><tr><td${opts.align === 'center' ? ' align="center"' : ''} style="padding:20px;${opts.align === 'center' ? 'text-align:center;' : ''}">${innerHtml}</td></tr></table>`;
}

/** Paragraphe en texte secondaire (`small`), HTML déjà échappé par l'appelant. */
export function smallText(html: string, opts: { muted?: boolean; color?: string; margin?: string; align?: 'center' } = {}): string {
  const color = opts.color ?? (opts.muted ? BRAND.muted : null);
  return `<p style="margin:${opts.margin ?? '16px 0 0'};${fontSize('small')}${color ? `color:${color};` : ''}${opts.align ? `text-align:${opts.align};` : ''}">${html}</p>`;
}

/** Note secondaire grisée (références, validité d'un lien, avertissement). */
export function mutedNote(text: string, margin = '16px 0 0'): string {
  return smallText(escapeHtml(text), { muted: true, margin });
}

/** Code à recopier (code d'accès) : grand, centré, lettres espacées, dans un encadré crème. */
export function codeBox(code: string): string {
  return `<p style="margin:8px 0 24px;padding:12px 24px;background:${BRAND.soft};border:1px solid ${BRAND.border};border-radius:8px;text-align:center;${fontSize('h1')}font-weight:700;letter-spacing:6px;color:${BRAND.heading};">${escapeHtml(code)}</p>`;
}

/** Tableau libellé / valeur bordé (fiches admin) ; les valeurs sont du HTML déjà échappé. */
export function detailsTable(rows: Array<[string, string]>): string {
  const cell = `padding:6px 0;border-bottom:1px solid ${BRAND.border};vertical-align:top;`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;${fontSize('small')}border-collapse:collapse;">
      ${rows.map(([k, v]) => `<tr><td style="${cell}color:${BRAND.muted};width:120px;">${escapeHtml(k)}</td><td style="${cell}">${v}</td></tr>`).join('\n      ')}
    </table>`;
}

/** Tableau clé / valeur (paiement, créneaux) dans un encadré crème ; valeurs en texte brut. */
export function infoTable(rows: Array<[string, string]>): string {
  const td = (last: boolean) => `padding:8px 0;${last ? '' : `border-bottom:1px solid ${BRAND.border};`}vertical-align:top;`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${BRAND.soft}" style="width:100%;border-collapse:separate;background:${BRAND.soft};border:1px solid ${BRAND.border};border-radius:8px;${fontSize('small')}margin:12px 0 0;"><tr><td style="padding:4px 16px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;">${rows.map(([k, v], i) =>
    `<tr><td style="${td(i === rows.length - 1)}color:${BRAND.muted};padding-right:12px;">${escapeHtml(k)}</td><td style="${td(i === rows.length - 1)}text-align:right;font-weight:700;">${escapeHtml(v)}</td></tr>`).join('')}</table>
  </td></tr></table>`;
}
