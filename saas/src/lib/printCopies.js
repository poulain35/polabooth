// Nombre de copies imprimées, lu dans des lignes de print_logs (LAB-420 : écrit une seule fois pour
// le tableau de bord, la fiche de l'événement et le papier des bornes). `copies` vide compte 0.
export function sumCopies(rows) {
  return (rows ?? []).reduce((sum, row) => sum + (row.copies ?? 0), 0);
}
