const blank = {
  id: 'blank',
  name: 'Vierge',
  bgColor: '#ffffff',
  apply: (canvas) => { canvas.backgroundColor = '#ffffff'; },
};

export const TEMPLATES    = [blank];
export const TEMPLATE_MAP = { blank };
