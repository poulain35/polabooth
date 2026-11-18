import tailwindcssAnimate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
  // Mode sombre de l'admin (LAB-340) : classe `dark` sur <html>, variantes `dark:` ignorées dans un
  // élément `.light-island` (canevas, aperçus de la borne et des emails, qui restent clairs).
  darkMode: ['variant', '&:is(.dark *):not(.light-island, .light-island *)'],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // Police de l'interface : variable CSS de index.css (Inter sur les pages client, Lexend dans l'admin).
        sans: ['var(--font-ui)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // Pages client publiques (LAB-62, maquette reservation-recap v3.3) : style du site.
        pola: ['"DM Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        'pola-serif': ['"Cormorant Garamond"', 'Georgia', 'serif'],
        // Palette F « noyer & sauge » (refonte du site) : bilan client (LAB-236).
        'pf-serif': ['Fraunces', 'Georgia', '"Times New Roman"', 'serif'],
      },
      // ── Tokens shadcn/ui (mappés sur les variables CSS de index.css) ──
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          soft: 'hsl(var(--primary-soft))',
          ink: 'hsl(var(--primary-ink))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // ── Thème de l'admin (LAB-363, « Thème de l'admin » dans saas/CLAUDE.md) ──
        soft: 'hsl(var(--soft))',
        ink: 'hsl(var(--ink))',
        strong: {
          DEFAULT: 'hsl(var(--strong))',
          foreground: 'hsl(var(--strong-foreground))',
        },
        pastel: {
          peach: { DEFAULT: 'hsl(var(--pastel-peach))', ink: 'hsl(var(--pastel-peach-ink))' },
          mint: { DEFAULT: 'hsl(var(--pastel-mint))', ink: 'hsl(var(--pastel-mint-ink))' },
          sky: { DEFAULT: 'hsl(var(--pastel-sky))', ink: 'hsl(var(--pastel-sky-ink))' },
          lilac: { DEFAULT: 'hsl(var(--pastel-lilac))', ink: 'hsl(var(--pastel-lilac-ink))' },
          lemon: { DEFAULT: 'hsl(var(--pastel-lemon))', ink: 'hsl(var(--pastel-lemon-ink))' },
          rose: { DEFAULT: 'hsl(var(--pastel-rose))', ink: 'hsl(var(--pastel-rose-ink))' },
        },
        // Fond d'état : couleur complète (translucide en sombre), sans opacité Tailwind (`bg-state-red/50` ne marche pas).
        state: {
          amber: { DEFAULT: 'var(--state-amber)', fg: 'hsl(var(--state-amber-fg))' },
          green: { DEFAULT: 'var(--state-green)', fg: 'hsl(var(--state-green-fg))' },
          violet: { DEFAULT: 'var(--state-violet)', fg: 'hsl(var(--state-violet-fg))' },
          blue: { DEFAULT: 'var(--state-blue)', fg: 'hsl(var(--state-blue-fg))' },
          red: { DEFAULT: 'var(--state-red)', fg: 'hsl(var(--state-red-fg))' },
          gray: { DEFAULT: 'var(--state-gray)', fg: 'hsl(var(--state-gray-fg))' },
        },
        chart: {
          1: 'hsl(var(--chart-1))',
          2: 'hsl(var(--chart-2))',
          grid: 'hsl(var(--chart-grid))',
        },
        'switch-thumb': 'hsl(var(--switch-thumb))',
        // ── Éditeur plein écran (LAB-395) : une classe suit la portée (pages client ou admin, clair ou sombre),
        // à la place de `bg-white admin:bg-card`. Valeurs dans index.css, liste dans saas/CLAUDE.md (« Socle partagé »).
        editor: {
          workspace: 'hsl(var(--editor-workspace))',
          panel: 'hsl(var(--editor-panel))',
          soft: 'hsl(var(--editor-soft))',
          hover: 'hsl(var(--editor-hover))',
          pressed: 'hsl(var(--editor-pressed))',
          // Couleur complète (bleu doux de l'admin, accent à 10 % côté client) : pas d'opacité Tailwind.
          selected: 'var(--editor-selected)',
          line: 'hsl(var(--editor-line))',
          'line-strong': 'hsl(var(--editor-line-strong))',
          'line-soft': 'hsl(var(--editor-line-soft))',
          fg: 'hsl(var(--editor-fg))',
          ink: 'hsl(var(--editor-ink))',
          muted: 'hsl(var(--editor-muted))',
          faint: 'hsl(var(--editor-faint))',
          // Alerte (objet verrouillé, modifications non sauvegardées) : fond complet, sans opacité Tailwind.
          warning: { DEFAULT: 'var(--editor-warning)', fg: 'hsl(var(--editor-warning-fg))' },
          // Survol d'une ligne de menu ou d'un outil flottant : teinte d'accent côté client, neutre dans l'admin.
          'item-hover': { DEFAULT: 'var(--editor-item-hover)', fg: 'hsl(var(--editor-item-hover-fg))' },
          accent: {
            DEFAULT: 'hsl(var(--primary))',
            fg: 'hsl(var(--editor-accent-fg))',
          },
        },
        // ── Tokens du site vitrine (pages client publiques uniquement) ──
        pola: {
          bg: '#fffcf7',
          cream: '#fdfaf2',
          cream2: '#f5f2ec',
          green: '#5e745d',
          'green-dark': '#385041',
          deep: '#375041',
          sage: '#c4d4c4',
          'sage-soft': '#e4ece4',
          peach: '#e3c0aa',
          'peach-soft': '#f7e9df',
          gold: '#b69d78',
          brown: '#351e15',
          ink: '#252436',
          muted: '#5f5e6b',
          line: '#e9e9e9',
          error: '#9b2c1f',
          'error-soft': '#fbeeea',
        },
        // ── Palette F « noyer & sauge » (site/src/styles/global.css, --pf-*) ──
        pf: {
          bg: '#FAFAF6',
          surface: '#F4EBDF',
          'surface-2': '#EFE2D1',
          text: '#2A1F18',
          muted: '#65584C',
          noyer: '#6A4128',
          'noyer-h': '#55331F',
          sage: '#3F6B4E',
          'sage-soft': '#E4E9DC',
          line: '#E4D3BE',
          forest: '#243A2D',
          'on-dark': '#F6F4EC',
          gold: '#E8B85F',
        },
      },
      borderRadius: {
        pola: '30px',
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        // Boutons, champs, menus : 6 px sur les pages client, 12 px dans l'admin.
        control: 'var(--radius-control)',
        // Fenêtres : 8 px sur les pages client, 20 px dans l'admin.
        dialog: 'var(--radius-dialog)',
        card: '1.25rem',
        // Éditeur (LAB-396) : menus 16 px / 12 px (client / admin), outils flottants 12 / 8, lignes de menu 6 / 8.
        'editor-popover': 'var(--editor-radius-popover)',
        'editor-tool': 'var(--editor-radius-tool)',
        'editor-item': 'var(--editor-radius-item)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        float: 'var(--shadow-float)',
        'editor-float': 'var(--editor-shadow-float)',
        'editor-raised': 'var(--editor-shadow-raised)',
        'editor-subtle': 'var(--editor-shadow-subtle)',
      },
      spacing: {
        card: '1.375rem',
      },
      fontSize: {
        'page-title': ['1.875rem', { lineHeight: '1.15', letterSpacing: '-0.02em', fontWeight: '400' }],
        'card-title': ['1.0625rem', { lineHeight: '1.35', letterSpacing: '-0.01em', fontWeight: '500' }],
        figure: ['2.125rem', { lineHeight: '1.1', letterSpacing: '-0.03em', fontWeight: '400' }],
        // Éditeur (LAB-396) : 9 / 10 / 12 px côté client, 10 / 11 / 13 px dans l'admin.
        'editor-2xs': 'var(--editor-text-2xs)',
        'editor-xs': 'var(--editor-text-xs)',
        'editor-sm': 'var(--editor-text-sm)',
      },
      fontWeight: {
        // Éditeur (LAB-396) : libellés 600 / 500 (client / admin), gras 700 / 600, titres de section 700 / 500.
        'editor-strong': 'var(--editor-weight-strong)',
        'editor-bold': 'var(--editor-weight-bold)',
        'editor-heading': 'var(--editor-weight-heading)',
      },
    },
  },
  plugins: [
    tailwindcssAnimate,
    // `admin:` : classe appliquée seulement dans l'admin (<html class="admin-ui">), pour les composants de
    // base partagés avec les pages client quand une variable CSS ne suffit pas.
    ({ addVariant }) => addVariant('admin', '.admin-ui &'),
  ],
}
