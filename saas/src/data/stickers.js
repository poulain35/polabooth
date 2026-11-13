const N = 'xmlns="http://www.w3.org/2000/svg"';

// ─── Formes géométriques inline (toujours disponibles, aucun fichier requis) ───

const INLINE_CATEGORIES = [
  {
    id: 'hearts',
    label: 'Cœurs',
    items: [
      {
        id: 'heart_fill', label: 'Cœur',
        svg: `<svg ${N} viewBox="0 0 100 90"><path d="M50 82 C22 64 3 50 3 32 C3 15 14 6 27 6 C37 6 45 12 50 20 C55 12 63 6 73 6 C86 6 97 15 97 32 C97 50 78 64 50 82Z" fill="#e74c3c"/></svg>`,
      },
      {
        id: 'heart_outline', label: 'Cœur contour',
        svg: `<svg ${N} viewBox="0 0 100 90"><path d="M50 82 C22 64 3 50 3 32 C3 15 14 6 27 6 C37 6 45 12 50 20 C55 12 63 6 73 6 C86 6 97 15 97 32 C97 50 78 64 50 82Z" fill="none" stroke="#e74c3c" stroke-width="6" stroke-linejoin="round"/></svg>`,
      },
      {
        id: 'hearts_double', label: 'Deux cœurs',
        svg: `<svg ${N} viewBox="0 0 120 100"><path d="M38 68 C15 52 2 40 2 25 C2 11 11 4 22 4 C29 4 34 8 38 15 C42 8 47 4 54 4 C65 4 74 11 74 25 C74 40 61 52 38 68Z" fill="#e74c3c"/><path d="M82 82 C62 68 50 58 50 44 C50 31 58 25 67 25 C73 25 78 29 82 35 C86 29 91 25 97 25 C106 25 114 31 114 44 C114 58 102 68 82 82Z" fill="#9b59b6"/></svg>`,
      },
      {
        id: 'bow', label: 'Nœud',
        svg: `<svg ${N} viewBox="0 0 120 80"><path d="M60 40 L8 8 L28 40 L8 72Z" fill="#e74c3c"/><path d="M60 40 L112 8 L92 40 L112 72Z" fill="#e74c3c"/><circle cx="60" cy="40" r="12" fill="#c0392b"/></svg>`,
      },
    ],
  },
  {
    id: 'stars',
    label: 'Étoiles',
    items: [
      {
        id: 'star5', label: 'Étoile',
        svg: `<svg ${N} viewBox="0 0 100 100"><polygon points="50,5 61,35 95,35 68,57 79,91 50,70 21,91 32,57 5,35 39,35" fill="#f1c40f"/></svg>`,
      },
      {
        id: 'sparkle4', label: 'Étincelle',
        svg: `<svg ${N} viewBox="0 0 100 100"><path d="M50,5 L57,43 L95,50 L57,57 L50,95 L43,57 L5,50 L43,43Z" fill="#f1c40f"/></svg>`,
      },
      {
        id: 'starburst', label: 'Éclat',
        svg: `<svg ${N} viewBox="0 0 100 100"><path d="M50,5 L56,33 L80,14 L66,36 L95,35 L72,52 L88,76 L60,66 L55,95 L45,65 L17,76 L32,52 L5,35 L34,36 L20,14 L44,33Z" fill="#f39c12"/></svg>`,
      },
      {
        id: 'diamond', label: 'Diamant',
        svg: `<svg ${N} viewBox="0 0 100 110"><polygon points="50,5 95,38 50,105 5,38" fill="#3498db"/><polygon points="50,5 95,38 50,38" fill="#85c1e9" opacity="0.6"/></svg>`,
      },
    ],
  },
  {
    id: 'celebration',
    label: 'Fête',
    items: [
      {
        id: 'crown', label: 'Couronne',
        svg: `<svg ${N} viewBox="0 0 100 70"><path d="M5,65 L5,35 L25,52 L50,5 L75,52 L95,35 L95,65Z" fill="#f1c40f"/><rect x="5" y="59" width="90" height="10" rx="4" fill="#e67e22"/></svg>`,
      },
      {
        id: 'balloon', label: 'Ballon',
        svg: `<svg ${N} viewBox="0 0 80 120"><ellipse cx="40" cy="45" rx="34" ry="42" fill="#e74c3c"/><ellipse cx="28" cy="28" rx="10" ry="8" fill="rgba(255,255,255,0.25)"/><path d="M38 88 Q34 100 38 110 Q42 100 38 88Z" fill="#c0392b"/><line x1="32" y1="88" x2="44" y2="88" stroke="#c0392b" stroke-width="2"/></svg>`,
      },
      {
        id: 'confetti', label: 'Confettis',
        svg: `<svg ${N} viewBox="0 0 100 100"><rect x="12" y="8" width="10" height="14" rx="2" fill="#e74c3c" transform="rotate(20 17 15)"/><rect x="58" y="4" width="9" height="13" rx="2" fill="#3498db" transform="rotate(-15 62 10)"/><circle cx="82" cy="28" r="6" fill="#2ecc71"/><circle cx="10" cy="55" r="5" fill="#f1c40f"/><rect x="68" y="58" width="9" height="12" rx="2" fill="#9b59b6" transform="rotate(10 72 64)"/><circle cx="38" cy="80" r="6" fill="#e74c3c"/><rect x="22" y="70" width="8" height="12" rx="2" fill="#3498db" transform="rotate(-25 26 76)"/><circle cx="76" cy="84" r="5" fill="#f39c12"/></svg>`,
      },
      {
        id: 'champagne', label: 'Champagne',
        svg: `<svg ${N} viewBox="0 0 60 120"><path d="M10,8 L50,8 L38,65 L34,65 L34,108 L26,108 L26,65 L22,65Z" fill="#f39c12"/><ellipse cx="30" cy="108" rx="16" ry="5" fill="#e67e22"/><circle cx="25" cy="32" r="3" fill="rgba(255,255,255,0.5)"/><circle cx="38" cy="45" r="2" fill="rgba(255,255,255,0.5)"/><circle cx="22" cy="50" r="2" fill="rgba(255,255,255,0.5)"/></svg>`,
      },
    ],
  },
  {
    id: 'bubbles',
    label: 'Bulles',
    items: [
      {
        id: 'speech', label: 'Discours',
        svg: `<svg ${N} viewBox="0 0 120 100"><path d="M8,5 Q5,5 5,10 L5,68 Q5,72 8,72 L52,72 L38,90 L62,72 L112,72 Q115,72 115,68 L115,10 Q115,5 112,5Z" fill="#6366f1"/></svg>`,
      },
      {
        id: 'thought', label: 'Pensée',
        svg: `<svg ${N} viewBox="0 0 120 100"><ellipse cx="60" cy="38" rx="52" ry="34" fill="#6366f1"/><circle cx="32" cy="80" r="9" fill="#6366f1"/><circle cx="18" cy="93" r="5" fill="#6366f1"/></svg>`,
      },
      {
        id: 'banner', label: 'Bandeau',
        svg: `<svg ${N} viewBox="0 0 120 60"><path d="M5,30 L18,8 L102,8 L115,30 L102,52 L18,52Z" fill="#6366f1"/></svg>`,
      },
      {
        id: 'star_speech', label: 'Étoile message',
        svg: `<svg ${N} viewBox="0 0 100 100"><path d="M50,2 L57,30 L82,12 L67,36 L96,34 L74,52 L90,78 L62,66 L56,96 L44,66 L16,78 L32,52 L10,34 L39,36 L24,12 L49,30Z" fill="#f39c12"/></svg>`,
      },
    ],
  },
];

export const STICKER_CATEGORIES = [...INLINE_CATEGORIES];
