/**
 * Téléchargement d'un fichier depuis la page (LAB-395) : un seul endroit pour le lien `<a download>`.
 */

/** Télécharge une adresse (data:, blob: ou de même origine) sous le nom `fileName`. */
export function downloadUrl(href, fileName) {
  const a = document.createElement('a');
  a.href = href;
  a.download = fileName;
  // Dans la page le temps du clic : Firefox ignore le clic d'un lien hors du document.
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Télécharge un Blob (CSV, zip, .pola, .ics…). L'adresse temporaire est libérée une seconde après. */
export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  downloadUrl(url, fileName);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
