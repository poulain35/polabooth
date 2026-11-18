import { HOME_ELEMENTS, PREVIEW_MESSAGES, homeStartMode } from '../../lib/kioskPreview';
import { ACTION_BUTTON_TEXTS } from '../../lib/kioskScreenLayout';
import { KIOSK_COLORS, KIOSK_FONT_TEXT, KIOSK_FONT_TITLE } from '../../lib/kioskScreenTemplates';

// Éléments de l'accueil de la borne posés sur l'écran du client (HomeView.xaml), en px de la surface
// de 800 de haut. Non cliquables (D11).
const FOREST_LINE = 'rgba(36,65,47,0.14)';
const SOFT_SHADOW = '0 4px 28px rgba(36,65,47,0.10)';

const ICONS = {
  photo: 'M4 8h3l2-3h6l2 3h3v11H4z M8.5 13a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0z',
  video: 'M5 6h8a2.5 2.5 0 0 1 2.5 2.5v7a2.5 2.5 0 0 1 -2.5 2.5h-8a2.5 2.5 0 0 1 -2.5 -2.5v-7a2.5 2.5 0 0 1 2.5 -2.5z M15.5 10.5l6 -3.5v10l-6 -3.5z',
  gif: 'M6 5h12a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3z M10 9.5v5l4.5 -2.5z',
  boomerang: 'M17 2l4 4 -4 4 M3 11v-1a4 4 0 0 1 4 -4h14 M7 22l-4 -4 4 -4 M21 13v1a4 4 0 0 1 -4 4H3',
};
const LOCK_ICON = 'M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5zm3 8H9V6a3 3 0 0 1 6 0v3z';

function StrokeIcon({ path, size, color, width = 1.8 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={width}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

function StartPill() {
  const p = HOME_ELEMENTS.pill;
  return (
    <div style={{
      position: 'absolute', left: '50%', bottom: p.bottom, transform: 'translateX(-50%)',
      height: p.height, padding: `0 ${p.paddingRight}px 0 ${p.paddingLeft}px`, borderRadius: p.radius,
      background: KIOSK_COLORS.forest, boxShadow: SOFT_SHADOW, display: 'flex', alignItems: 'center',
      whiteSpace: 'nowrap',
    }}>
      <span style={{ position: 'relative', width: p.dot, height: p.dot, marginRight: p.dotGap, flexShrink: 0 }}>
        <span className="kiosk-preview-pulse" style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: KIOSK_COLORS.blush }} />
        <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: KIOSK_COLORS.blush }} />
      </span>
      <span style={{ fontFamily: KIOSK_FONT_TEXT, fontSize: p.fontSize, fontWeight: 600, color: KIOSK_COLORS.cream }}>
        {ACTION_BUTTON_TEXTS.start}
      </span>
    </div>
  );
}

function FormatTiles({ tiles }) {
  const t = HOME_ELEMENTS.tiles;
  return (
    <div style={{ position: 'absolute', left: '50%', bottom: t.bottom, transform: 'translateX(-50%)', display: 'flex' }}>
      {tiles.map((tile, i) => {
        const fg = tile.isPrimary ? KIOSK_COLORS.cream : KIOSK_COLORS.forest;
        const sub = tile.isPrimary ? KIOSK_COLORS.mint : KIOSK_COLORS.brown;
        return (
          <div key={`${tile.format}-${i}`} style={{
            width: t.width, height: t.height, margin: `0 ${t.gap}px`, borderRadius: t.radius, padding: t.padding,
            border: `2px solid ${tile.isPrimary ? KIOSK_COLORS.forest : '#D9CDB8'}`,
            background: tile.isPrimary ? KIOSK_COLORS.forest : KIOSK_COLORS.paper, boxShadow: SOFT_SHADOW,
            display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
          }}>
            <StrokeIcon path={ICONS[tile.format] ?? ICONS.photo} size={34} color={fg} />
            <span style={{ flex: 1 }} />
            <span style={{
              fontFamily: KIOSK_FONT_TITLE, fontWeight: 600, fontSize: 28, color: fg, lineHeight: 1.2,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{tile.title}</span>
            {tile.subtitle && (
              <span style={{
                fontFamily: KIOSK_FONT_TEXT, fontSize: 15, lineHeight: '19px', maxHeight: 38, overflow: 'hidden', color: sub,
              }}>{tile.subtitle}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// La borne n'affiche « Photos » qu'une fois des photos prises : grisé ici, avec la mention au survol.
function PhotosButton() {
  const b = HOME_ELEMENTS.photos;
  return (
    <div title={PREVIEW_MESSAGES.photosHint} style={{
      position: 'absolute', right: b.right, bottom: b.bottom, height: b.height,
      padding: `0 ${b.paddingRight}px 0 ${b.paddingLeft}px`, borderRadius: HOME_ELEMENTS.buttonRadius,
      background: KIOSK_COLORS.paper, border: `1.5px solid ${FOREST_LINE}`, boxShadow: SOFT_SHADOW,
      display: 'flex', alignItems: 'center', opacity: 0.45, boxSizing: 'border-box',
      fontFamily: KIOSK_FONT_TEXT, fontSize: b.fontSize, fontWeight: 600, color: KIOSK_COLORS.forest,
      pointerEvents: 'auto', cursor: 'help',
    }}>
      <span style={{ marginRight: 10, display: 'flex' }}>
        <StrokeIcon path={ICONS.photo} size={b.icon} color={KIOSK_COLORS.forest} width={2} />
      </span>
      {ACTION_BUTTON_TEXTS.gallery}
    </div>
  );
}

function LockButton() {
  const l = HOME_ELEMENTS.lock;
  return (
    <div style={{
      position: 'absolute', top: l.margin, right: l.margin, width: l.size, height: l.size, opacity: l.opacity,
      borderRadius: HOME_ELEMENTS.buttonRadius, background: KIOSK_COLORS.paper, border: `1.5px solid ${FOREST_LINE}`,
      boxShadow: SOFT_SHADOW, display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
    }}>
      <svg width={l.icon} height={l.icon} viewBox="0 0 24 24" aria-hidden="true">
        <path d={LOCK_ICON} fill={KIOSK_COLORS.forest} />
      </svg>
    </div>
  );
}

/**
 * Vue « Écran d'accueil » : éléments de la borne au-dessus du design du client. L'image elle-même
 * (cover) est posée par KioskPreview, qui gère aussi les bandes coupées. `tiles` : tuiles de format
 * de l'événement (plusieurs formats : tuiles à la place de la pastille). `composed` : accueil
 * composé par l'admin (LAB-309) ; ses boutons sont dans le design, la borne n'y ajoute que le cadenas.
 */
export default function HomePreview({ tiles = [], composed = false }) {
  return (
    <div className="absolute inset-0 flex flex-col" style={{ pointerEvents: 'none' }}>
      <div className="relative flex-1">
        {!composed && (homeStartMode(tiles) === 'tiles' ? <FormatTiles tiles={tiles} /> : <StartPill />)}
        {!composed && <PhotosButton />}
        <LockButton />
      </div>
    </div>
  );
}
