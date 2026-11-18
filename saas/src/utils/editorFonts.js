// Polices proposées par le sélecteur de police de l'éditeur (FontPicker de PropertiesPanel), chargées
// par les feuilles Google d'index.html. Tenir les deux listes alignées. L'onglet Polices de la
// Bibliothèque s'en sert pour signaler qu'une police Google est déjà proposée.

export const FONT_GROUPS = [
  {
    label: 'Mariage & Calligraphie',
    fonts: [
      'Tangerine','Corinthia','Italianno','Euphoria Script','Monsieur La Doulaise',
      'Mea Culpa','Lovers Quarrel','Engagement','Princess Sofia','WindSong',
      'Licorice','Waterfall','Gwendolyn','Ephesis','Norican',
      'Herr Von Muellerhoff','Mrs Saint Delafield','Inspiration',
    ],
  },
  {
    label: 'Sans-serif',
    fonts: [
      'Roboto','Open Sans','Lato','Montserrat','Nunito','Raleway','Poppins','Inter',
      'Source Sans 3','Ubuntu','Josefin Sans','Quicksand','Mulish','Karla','DM Sans',
      'Outfit','Figtree','Plus Jakarta Sans','Manrope','Jost','Work Sans','Barlow',
      'Exo 2','Nunito Sans','Noto Sans',
    ],
  },
  {
    label: 'Serif',
    fonts: [
      'Playfair Display','Merriweather','Lora','Cormorant Garamond','EB Garamond',
      'Libre Baskerville','Crimson Text','Cardo','Spectral','Gilda Display',
      'Italiana','Cinzel','Sorts Mill Goudy',
    ],
  },
  {
    label: 'Écriture',
    fonts: [
      'Dancing Script','Pacifico','Caveat','Sacramento','Great Vibes','Satisfy',
      'Kaushan Script','Courgette','Permanent Marker','Pinyon Script','Alex Brush',
      'Allura','Yellowtail','Parisienne','Petit Formal Script','Marck Script',
    ],
  },
  {
    label: 'Display',
    fonts: [
      'Oswald','Lobster','Righteous','Abril Fatface','Bebas Neue','Anton',
      'Alfa Slab One','Titan One','Fredoka One','Bungee','Black Ops One',
      'Russo One','Ultra','Squada One','Lilita One','Passion One',
    ],
  },
];

/** Toutes les familles de la liste, à plat. */
export const EDITOR_FONTS = FONT_GROUPS.flatMap((g) => g.fonts);
