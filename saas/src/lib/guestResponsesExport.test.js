// Export des réponses au questionnaire de la borne (LAB-221).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  buildExportTable, buildXlsxParts, columnLetter, csvCell, exportFileName,
  formatParisDate, formatParisDateTime, formatPhone, guestSearchFilter, normalizePhone,
  slugify, toGuestCsv, toXlsx, unionQuestions, xmlEscape, EXPORT_KINDS,
} from './guestResponsesExport.js';

const Q_OLD = [
  { id: 'q_nom', label: 'Nom', type: 'text' },
  { id: 'q_email', label: 'E-mail', type: 'email' },
  { id: 'q_old', label: 'Question retirée', type: 'text' },
];
const Q_NEW = [
  { id: 'q_nom', label: 'Votre nom', type: 'text' },
  { id: 'q_email', label: 'Votre e-mail', type: 'email' },
  { id: 'q_tel', label: 'Votre téléphone', type: 'tel' },
  { id: 'q_interets', label: 'Intérêts', type: 'multi' },
  { id: 'q_news', label: 'Catalogue', type: 'checkbox' },
];
const CONFIG = [...Q_NEW];

function response(overrides) {
  return {
    id: overrides.id,
    answered_at: '2026-11-04T13:05:00Z',
    answers: {},
    questions_snapshot: Q_NEW,
    email: null,
    phone: null,
    marketing_consent: false,
    consent_text: "J'accepte d'être recontacté(e) par Acme.",
    machine_id: 'PC-01',
    session_ids: [],
    ...overrides,
  };
}

const RESPONSES = [
  response({
    id: 'r1', answered_at: '2026-11-04T10:00:00Z', questions_snapshot: Q_OLD,
    answers: { q_nom: 'Ancien', q_email: 'jean@acme.fr', q_old: 'x' },
    email: 'jean@acme.fr', marketing_consent: true, session_ids: ['s1'],
  }),
  response({
    id: 'r2', answered_at: '2026-11-04T12:00:00Z',
    answers: { q_nom: 'Jean Dupont', q_email: 'jean@acme.fr', q_tel: '+33612345678', q_interets: ['Vin', 'Fromage'], q_news: true },
    email: 'jean@acme.fr', phone: '+33612345678', marketing_consent: true, session_ids: ['s2'],
  }),
  response({
    id: 'r3', answered_at: '2026-11-04T13:00:00Z',
    answers: { q_nom: '=HYPERLINK("http://x")', q_tel: '+33612345678' },
    phone: '+33612345678', marketing_consent: true,
  }),
  response({
    id: 'r4', answered_at: '2026-11-04T14:00:00Z',
    answers: { q_nom: 'Élodie Ça', q_email: 'elodie@ex.fr', q_news: false },
    email: 'elodie@ex.fr', marketing_consent: false, session_ids: ['s4'],
  }),
];

const PHOTOS = [
  { id: 'p1', storage_path: 'photos/salon-12345678/s1/composite.jpg' },
  { id: 'p2', storage_path: 'photos/salon-12345678/s2/composite.jpg' },
  { id: 'p4', storage_path: 'photos/salon-12345678/s4/composite.jpg' },
];
const GALLERY = 'https://photobooth.exemple.fr/photos/ABC123';

test('normalizePhone et guestSearchFilter : même normalisation que la borne', () => {
  assert.equal(normalizePhone('06 12 34 56 78'), '+33612345678');
  assert.equal(normalizePhone('06.12.34.56.78'), '+33612345678');
  assert.equal(normalizePhone('+33 6 12 34 56 78'), '+33612345678');
  assert.deepEqual(guestSearchFilter('  Jean@ACME.fr '), { column: 'email', pattern: '%jean@acme.fr%' });
  assert.deepEqual(guestSearchFilter('06 12 34 56 78'), { column: 'phone', pattern: '+33612345678%' });
  assert.deepEqual(guestSearchFilter('06 12'), { column: 'phone', pattern: '+33612%' });
  assert.deepEqual(guestSearchFilter('+44 20'), { column: 'phone', pattern: '+4420%' });
  assert.deepEqual(guestSearchFilter('5678'), { column: 'phone', pattern: '%5678%' });
  assert.deepEqual(guestSearchFilter('jean_d%'), { column: 'email', pattern: '%jean\\_d\\%%' });
  assert.equal(guestSearchFilter('   '), null);
  assert.equal(guestSearchFilter('--'), null);
});

test('formatage : dates à Paris, téléphone français lisible', () => {
  assert.equal(formatParisDateTime('2026-11-04T13:05:00Z'), '04/11/2026 14:05');
  assert.equal(formatParisDateTime('2026-07-01T22:30:00Z'), '02/07/2026 00:30');
  assert.equal(formatParisDate('2026-12-04T23:30:00Z'), '05/12/2026');
  assert.equal(formatParisDateTime(null), '');
  assert.equal(formatPhone('+33612345678'), '06 12 34 56 78');
  assert.equal(formatPhone('+442071234567'), '+442071234567');
});

test('unionQuestions : ordre de la config, libellé le plus récent, questions retirées à la fin', () => {
  const qs = unionQuestions(RESPONSES, CONFIG);
  assert.deepEqual(qs.map((q) => q.id), ['q_nom', 'q_email', 'q_tel', 'q_interets', 'q_news', 'q_old']);
  assert.equal(qs[0].label, 'Votre nom');
  assert.equal(qs[5].label, 'Question retirée');
  assert.deepEqual(unionQuestions(RESPONSES).map((q) => q.label).slice(0, 2), ['Votre nom', 'Votre e-mail']);
});

test('export « contacts » : une ligne par envoi, sans dédoublonnage', () => {
  const twice = [
    response({ id: 'd1', answered_at: '2026-11-04T10:00:00Z', email: 'meme@ex.fr', marketing_consent: true }),
    response({ id: 'd2', answered_at: '2026-11-04T11:00:00Z', email: 'meme@ex.fr', marketing_consent: true }),
  ];
  const { rows } = buildExportTable({ responses: twice, configQuestions: CONFIG, kind: EXPORT_KINDS.consent });
  assert.equal(rows.length, 2);
});

test('export « contacts » : seulement marketing_consent = true, même en mode obligatoire', () => {
  const required = RESPONSES.map((r) => ({ ...r, marketing_consent: r.id === 'r4' ? false : r.marketing_consent }));
  const extra = response({ id: 'r5', email: 'refus@ex.fr', marketing_consent: false });
  const { rows } = buildExportTable({ responses: [...required, extra], configQuestions: CONFIG, kind: EXPORT_KINDS.consent });
  assert.ok(rows.every((row) => row.includes('Oui')));
  assert.ok(!rows.some((row) => row.includes('elodie@ex.fr') || row.includes('refus@ex.fr')));
});

test('export « toutes » : colonnes, valeurs formatées, liens photo', () => {
  const { header, rows } = buildExportTable({
    responses: RESPONSES, configQuestions: CONFIG, photos: PHOTOS, galleryUrl: GALLERY, kind: EXPORT_KINDS.all,
  });
  assert.deepEqual(header, [
    'Date et heure', 'Votre nom', 'Votre e-mail', 'Votre téléphone', 'Intérêts', 'Catalogue', 'Question retirée',
    'Consentement prospection', 'Texte du consentement', 'Lien photo', 'Borne',
  ]);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[1], [
    '04/11/2026 13:00', 'Jean Dupont', 'jean@acme.fr', '06 12 34 56 78', 'Vin | Fromage', 'Oui', '',
    'Oui', "J'accepte d'être recontacté(e) par Acme.", `${GALLERY}?photo=p2`, 'PC-01',
  ]);
  assert.equal(rows[3][5], 'Non');
  assert.equal(rows[3][7], 'Non');
  assert.equal(rows[2][9], '');
  assert.equal(rows[0][6], 'x');
});

test('csvCell et toGuestCsv : ; + BOM, anti-injection, guillemets', () => {
  for (const start of ['=', '+', '-', '@', '\t', '\r']) {
    assert.ok(csvCell(`${start}1+1`).replace(/^"/, '').startsWith(`'${start}`), `préfixe pour ${JSON.stringify(start)}`);
  }
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvCell('06 12 34 56 78'), '06 12 34 56 78');
  assert.equal(csvCell('a;b'), '"a;b"');
  assert.equal(csvCell('il a dit "oui"'), '"il a dit ""oui"""');
  assert.equal(csvCell('ligne\nsuivante'), '"ligne\nsuivante"');

  const csv = toGuestCsv(buildExportTable({ responses: RESPONSES, configQuestions: CONFIG, kind: EXPORT_KINDS.all }));
  assert.ok(csv.startsWith(`${String.fromCharCode(0xfeff)}Date et heure;Votre nom;`));
  assert.ok(csv.includes(';"\'=HYPERLINK(""http://x"")";'));
  assert.ok(csv.includes('Élodie Ça'));
  assert.ok(csv.endsWith('\r\n'));
});

test('xmlEscape et columnLetter', () => {
  assert.equal(xmlEscape(`<a & "b" 'c'>`), '&lt;a &amp; &quot;b&quot; &apos;c&apos;&gt;');
  assert.equal(xmlEscape('ok\u0000\u0008\u000B\uFFFE fin'), 'ok fin');
  assert.equal(xmlEscape('photo 📸 é'), 'photo 📸 é');
  assert.equal(xmlEscape('\uD800seul'), 'seul');
  assert.deepEqual([0, 25, 26, 27, 701, 702].map(columnLetter), ['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
});

test('buildXlsxParts : fichiers attendus, content types, cellules inlineStr', () => {
  const table = buildExportTable({ responses: RESPONSES, configQuestions: CONFIG, kind: EXPORT_KINDS.all });
  const parts = buildXlsxParts(table);
  assert.deepEqual(Object.keys(parts).sort(), [
    '[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml',
    'xl/workbook.xml', 'xl/worksheets/sheet1.xml',
  ]);
  const types = parts['[Content_Types].xml'];
  assert.match(types, /PartName="\/xl\/workbook\.xml" ContentType="application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet\.main\+xml"/);
  assert.match(types, /PartName="\/xl\/worksheets\/sheet1\.xml" ContentType="application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.worksheet\+xml"/);
  assert.match(types, /PartName="\/xl\/styles\.xml"/);
  assert.match(parts['xl/workbook.xml'], /<sheet name="Contacts" sheetId="1" r:id="rId1"\/>/);

  const sheet = parts['xl/worksheets/sheet1.xml'];
  assert.ok(!sheet.includes('<f>'), 'aucune formule');
  assert.ok(!sheet.includes('t="s"'), 'pas de sharedStrings');
  assert.match(sheet, /<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">Date et heure<\/t><\/is><\/c>/);
  assert.ok(sheet.includes('<t xml:space="preserve">=HYPERLINK(&quot;http://x&quot;)</t>'), "formule gardée comme texte, sans '");
  assert.ok(sheet.includes('Élodie Ça'));
  assert.match(sheet, /<row r="5">/);
  for (const xml of Object.values(parts)) {
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'));
    assert.doesNotMatch(xml, /&(?!amp;|lt;|gt;|quot;|apos;)/, 'entités XML valides');
  }
});

test('toXlsx : archive zip lisible avec [Content_Types].xml en tête', async () => {
  const table = { header: ['Nom', 'Note'], rows: [['Zoé', '=1+1'], ['', 'vide à gauche']] };
  const bytes = await toXlsx(table, { type: 'uint8array' });
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  const zip = await JSZip.loadAsync(bytes);
  assert.equal(Object.keys(zip.files)[0], '[Content_Types].xml');
  assert.ok(Object.values(zip.files).every((f) => !f.dir), 'aucune entrée de dossier');
  const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
  assert.ok(sheet.includes('<c r="A2" t="inlineStr"><is><t xml:space="preserve">Zoé</t></is></c>'));
  assert.ok(sheet.includes('<row r="3"><c r="B3" t="inlineStr">'), 'cellule vide omise');
});

test('exportFileName : contacts-{slug}-{date}', () => {
  const event = { name: 'Salon Été & Vins', start_date: '2026-11-04', access_code: 'ABC123' };
  assert.equal(exportFileName(event), 'contacts-salon-ete-vins-2026-11-04.xlsx');
  assert.equal(exportFileName(event, { format: 'csv' }), 'contacts-salon-ete-vins-2026-11-04.csv');
  assert.equal(exportFileName(event, { kind: EXPORT_KINDS.all }), 'reponses-salon-ete-vins-2026-11-04.xlsx');
  assert.equal(
    exportFileName({ name: '', access_code: 'ABC123' }, { now: new Date('2026-12-31T23:30:00Z') }),
    'contacts-abc123-2027-01-01.xlsx',
  );
  assert.equal(slugify('   '), '');
});
