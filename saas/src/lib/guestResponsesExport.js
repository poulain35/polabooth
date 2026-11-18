// Réponses au questionnaire de la borne (LAB-221, spec LAB-208) : recherche, lignes d'export,
// CSV (Excel FR) et .xlsx fait maison. Fonctions pures, sauf toXlsx qui charge jszip à la demande.
import { escapeLike } from './emailTracking.js';
import { formatParisDate, formatParisDateTime } from './dates.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const EXPORT_KINDS = { consent: 'consent', all: 'all' };

const PARIS = 'Europe/Paris';

// ── Normalisation (mêmes règles que la borne et kiosk_record_guest_response) ─────────────────

export const normalizeEmail = (value) => String(value ?? '').trim().toLowerCase();

/** E.164 si le numéro est complet (06… → +336…), sinon les chiffres saisis sans séparateurs. */
export function normalizePhone(value) {
  const compact = String(value ?? '').trim().replace(/[\s.\-()]/g, '');
  if (/^0[1-9]\d{8}$/.test(compact)) return `+33${compact.slice(1)}`;
  return compact;
}

/**
 * Filtre de recherche par e-mail ou téléphone : { column, pattern } pour un ILIKE, ou null.
 * Un numéro partiel commençant par 0 cherche le début du numéro E.164 (« 06 12 » → « +33612… »).
 */
export function guestSearchFilter(query) {
  const raw = String(query ?? '').trim();
  if (!raw) return null;
  if (!/^[+\d\s.\-()]+$/.test(raw)) {
    return { column: 'email', pattern: `%${escapeLike(normalizeEmail(raw))}%` };
  }
  const phone = normalizePhone(raw);
  if (!phone || !/^\+?\d+$/.test(phone)) return null;
  if (phone.startsWith('+')) return { column: 'phone', pattern: `${escapeLike(phone)}%` };
  if (phone.startsWith('0')) return { column: 'phone', pattern: `+33${escapeLike(phone.slice(1))}%` };
  return { column: 'phone', pattern: `%${escapeLike(phone)}%` };
}

// ── Formatage des cellules ───────────────────────────────────────────────────────────────────

// Dates des cellules : définies dans dates.js (LAB-395), réexportées pour les appelants existants.
export { formatParisDate, formatParisDateTime };

/** +33612345678 → 06 12 34 56 78 ; les numéros étrangers restent en E.164. */
export function formatPhone(value) {
  const s = String(value ?? '').trim();
  const m = /^\+33([1-9]\d{8})$/.exec(s);
  if (!m) return s;
  return `0${m[1]}`.replace(/(\d{2})(?=\d)/g, '$1 ');
}

const yesNo = (b) => (b ? 'Oui' : 'Non');

/**
 * Réponse en texte : choix multiples joints par `separator` (« | » dans les exports, « , » à l'écran),
 * booléens en Oui/Non, téléphone lisible. Sert aussi aux réponses du formulaire client (LAB-395).
 */
export function formatAnswer(value, { type, separator = ' | ' } = {}) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map((v) => String(v)).join(separator);
  if (typeof value === 'boolean') return yesNo(value);
  if (type === 'checkbox') return yesNo(value === true || value === 'true');
  if (type === 'tel') return formatPhone(value);
  return String(value);
}

// ── Colonnes et lignes ───────────────────────────────────────────────────────────────────────

const byAnsweredAt = (a, b) => Date.parse(a.answered_at) - Date.parse(b.answered_at);

/**
 * Une colonne par question : d'abord l'ordre de la config actuelle (form_config.kiosk.questionnaire),
 * puis les questions retirées depuis, retrouvées dans les snapshots. Libellé le plus récent.
 */
export function unionQuestions(responses, configQuestions = []) {
  const map = new Map();
  for (const r of [...responses].sort(byAnsweredAt)) {
    for (const q of Array.isArray(r.questions_snapshot) ? r.questions_snapshot : []) {
      if (!q?.id) continue;
      map.set(q.id, { id: q.id, label: q.label || q.id, type: q.type });
    }
  }
  const ordered = [];
  for (const q of Array.isArray(configQuestions) ? configQuestions : []) {
    if (!q?.id) continue;
    const known = map.get(q.id);
    ordered.push({ id: q.id, label: q.label || known?.label || q.id, type: q.type || known?.type });
    map.delete(q.id);
  }
  return [...ordered, ...map.values()];
}

/** Sessions des photos kiosk : photos/{dossier}/{sessionId}/{fichier}. */
export function photosBySession(photos) {
  const map = new Map();
  for (const p of photos ?? []) {
    const sessionId = String(p?.storage_path ?? '').split('/')[2];
    if (!sessionId) continue;
    if (!map.has(sessionId)) map.set(sessionId, []);
    map.get(sessionId).push(p);
  }
  return map;
}

export function responsePhotos(response, sessionMap) {
  return (response.session_ids ?? []).flatMap((id) => sessionMap.get(id) ?? []);
}

/**
 * Tableau à exporter : { header: string[], rows: string[][] }.
 * kind 'consent' : seulement marketing_consent = true (quel que soit le mode du questionnaire),
 * une ligne par envoi, sans dédoublonnage ; kind 'all' : toutes les réponses.
 */
export function buildExportTable({ responses, configQuestions = [], photos = [], galleryUrl = '', kind = EXPORT_KINDS.consent }) {
  const selected = (kind === EXPORT_KINDS.all
    ? [...responses]
    : responses.filter((r) => r.marketing_consent === true)).sort(byAnsweredAt);
  const questions = unionQuestions(responses, configQuestions);
  const sessions = photosBySession(photos);

  const header = [
    'Date et heure',
    ...questions.map((q) => q.label),
    'Consentement prospection',
    'Texte du consentement',
    'Lien photo',
    'Borne',
  ];
  const rows = selected.map((r) => {
    const answers = r.answers && typeof r.answers === 'object' ? r.answers : {};
    const links = galleryUrl
      ? responsePhotos(r, sessions).map((p) => `${galleryUrl}?photo=${p.id}`)
      : [];
    return [
      formatParisDateTime(r.answered_at),
      ...questions.map((q) => formatAnswer(answers[q.id], { type: q.type })),
      yesNo(r.marketing_consent === true),
      r.consent_text ?? '',
      links.join(' | '),
      r.machine_id ?? '',
    ];
  });
  return { header, rows };
}

// ── Nom du fichier ───────────────────────────────────────────────────────────────────────────

export function slugify(value) {
  return String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 40).replace(/-+$/, '');
}

/** contacts-{slug}-{AAAA-MM-DD}.{ext} (date de l'événement, à défaut celle du jour). */
export function exportFileName(event, { kind = EXPORT_KINDS.consent, format = 'xlsx', now = new Date() } = {}) {
  const slug = slugify(event?.name) || slugify(event?.client_name) || slugify(event?.access_code) || 'evenement';
  const day = String(event?.start_date ?? '').slice(0, 10);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(day)
    ? day
    : new Intl.DateTimeFormat('en-CA', { timeZone: PARIS }).format(now);
  const prefix = kind === EXPORT_KINDS.all ? 'reponses' : 'contacts';
  return `${prefix}-${slug}-${date}.${format === 'csv' ? 'csv' : 'xlsx'}`;
}

// ── CSV (format commun de lib/csv.js) ────────────────────────────────────────────────────────

export { csvCell, toCsv as toGuestCsv } from './csv.js';

// ── .xlsx (une feuille, cellules inlineStr) ──────────────────────────────────────────────────

// Caractères interdits en XML 1.0 (contrôles, surrogates isolés, U+FFFE/U+FFFF).
const XML_INVALID = /[^\t\n\r\x20-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu;

export function xmlEscape(value) {
  return String(value ?? '')
    .replace(XML_INVALID, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function columnLetter(index) {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function sheetXml({ header, rows }) {
  const all = [header, ...rows];
  const widths = header.map((_, c) => {
    const longest = Math.max(...all.map((row) => String(row[c] ?? '').length));
    return Math.min(60, Math.max(10, longest + 2));
  });
  const cols = widths.length
    ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const sheetRows = all.map((row, r) => {
    const style = r === 0 ? ' s="1"' : '';
    const cells = row.map((value, c) => {
      const text = xmlEscape(value);
      if (!text) return '';
      return `<c r="${columnLetter(c)}${r + 1}" t="inlineStr"${style}><is><t xml:space="preserve">${text}</t></is></c>`;
    }).join('');
    return `<row r="${r + 1}">${cells}</row>`;
  }).join('');
  return `${XML_HEAD}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">`
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    + `${cols}<sheetData>${sheetRows}</sheetData></worksheet>`;
}

/** Fichiers XML du classeur (chemin → contenu). */
export function buildXlsxParts(table, { sheetName = 'Contacts' } = {}) {
  return {
    '[Content_Types].xml': `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + '</Types>',
    '_rels/.rels': `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">`
      + `<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/>`
      + '</Relationships>',
    'xl/workbook.xml': `${XML_HEAD}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">`
      + `<sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">`
      + `<Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/>`
      + `<Relationship Id="rId2" Type="${NS_REL}/styles" Target="styles.xml"/>`
      + '</Relationships>',
    'xl/styles.xml': `${XML_HEAD}<styleSheet xmlns="${NS_MAIN}">`
      + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'
      + '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>'
      + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
      + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
      + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
      + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
      + '</styleSheet>',
    'xl/worksheets/sheet1.xml': sheetXml(table),
  };
}

/** Archive .xlsx ; type 'blob' dans le navigateur, 'uint8array' dans les tests. */
export async function toXlsx(table, { type = 'blob' } = {}) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  // Pas d'entrées de dossier dans l'archive : un .xlsx produit par Excel n'en contient pas.
  for (const [path, content] of Object.entries(buildXlsxParts(table))) zip.file(path, content, { createFolders: false });
  return zip.generateAsync({ type, mimeType: XLSX_MIME, compression: 'DEFLATE' });
}
