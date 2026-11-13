import tailwindcssAnimate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
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
        },
      },
      borderRadius: {
        pola: '30px',
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [tailwindcssAnimate],
}
