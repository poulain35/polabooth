// Exports CSV de l'admin (LAB-393) : un seul format pour Excel FR, protégé des formules.

import { downloadBlob } from './download.js';

export const UTF8_BOM = String.fromCharCode(0xfeff);
const CSV_MIME = 'text/csv;charset=utf-8';

const FORMULA_START = /^[=+\-@\t\r]/;

/** Anti-injection : une cellule qui commence par = + - @ tabulation ou retour chariot prend un '. */
export function csvCell(value) {
  let s = String(value ?? '');
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV pour Excel FR : séparateur ;, fins de ligne CRLF, BOM UTF-8. */
export function toCsv({ header, rows }) {
  return `${UTF8_BOM}${[header, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n')}\r\n`;
}

/** Télécharge un CSV produit par toCsv. */
export function downloadCsv(csv, fileName) {
  downloadBlob(new Blob([csv], { type: CSV_MIME }), fileName);
}
