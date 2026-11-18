// Page blanche : point de départ de l'éditeur. Les cadres photo et les modèles viennent de la base.
export const BLANK_TEMPLATE = {
  id: 'blank',
  name: 'Vierge',
  bgColor: '#ffffff',
  apply: (canvas) => { canvas.backgroundColor = '#ffffff'; },
};
