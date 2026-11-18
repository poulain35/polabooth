// Graisses proposées pour un texte (modèles photos et boutons de la borne).
export const TEXT_WEIGHT_OPTIONS = [
  { value: '100', label: 'Thin' }, { value: '200', label: 'Extra Light' }, { value: '300', label: 'Light' },
  { value: 'normal', label: 'Normal' }, { value: '500', label: 'Medium' }, { value: '600', label: 'Semi Bold' },
  { value: 'bold', label: 'Bold' }, { value: '800', label: 'Extra Bold' }, { value: '900', label: 'Black' },
];

// 400 et 700 sont enregistrés tels quels par les modèles : ils valent « Normal » et « Bold ».
export const weightValue = (w) => {
  const v = String(w || 'normal');
  return v === '400' ? 'normal' : v === '700' ? 'bold' : v;
};
