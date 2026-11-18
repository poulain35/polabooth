// Exports CSV de l'admin (LAB-393) : format commun et protection des formules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { csvCell, toCsv, UTF8_BOM } from './csv.js';
import { csvCell as guestCsvCell, toGuestCsv } from './guestResponsesExport.js';

test('une cellule « =1+1 » n’est plus une formule', () => {
  assert.equal(csvCell('=1+1'), "'=1+1");
  for (const start of ['=', '+', '-', '@', '\t', '\r']) {
    assert.ok(csvCell(`${start}1+1`).replace(/^"/, '').startsWith(`'${start}`), `préfixe pour ${JSON.stringify(start)}`);
  }
  assert.equal(csvCell('Mariage 2027'), 'Mariage 2027');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(12), '12');
});

test('toCsv : ;, CRLF, BOM, guillemets doublés', () => {
  const csv = toCsv({ header: ['Nom', 'Code'], rows: [['=HYPERLINK("http://x")', 'AB;CD'], ['Élodie', 'XYZ234']] });
  assert.equal(csv, `${UTF8_BOM}Nom;Code\r\n"'=HYPERLINK(""http://x"")";"AB;CD"\r\nÉlodie;XYZ234\r\n`);
});

test('guestResponsesExport garde le même format (fonctions partagées)', () => {
  assert.equal(guestCsvCell, csvCell);
  assert.equal(toGuestCsv, toCsv);
});

test('plus aucun CSV maison dans l’admin', () => {
  for (const page of ['../pages/admin/AdminEvents.jsx', '../pages/admin/AdminStats.jsx']) {
    const src = readFileSync(new URL(page, import.meta.url), 'utf8');
    assert.match(src, /from '\.\.\/\.\.\/lib\/csv'/, page);
    assert.doesNotMatch(src, /const esc = /, page);
  }
});
