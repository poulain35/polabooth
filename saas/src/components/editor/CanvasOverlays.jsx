import { CANVAS_OVERFLOW_PAD, KIOSK_GUIDE_COLOR } from './canvasStyle';

// ─── Écran d'accueil : repères de la borne (LAB-289) ─────────────────────────
// Hors du canvas Fabric : jamais exportés. Sur un écran 16:10, la borne recadre l'image
// 16:9 et coupe safeZoneInsetX à gauche et à droite.

export function HomeScreenOverlay({ format }) {
  const W = format.canvasWidth;
  const H = format.canvasHeight;
  const inset = format.safeZoneInsetX ?? 0;
  const reserved = format.reservedBottom ?? 0;
  const pillH = format.pillHeight ?? 0;
  const pillW = 330;
  const pillY = H - (format.pillBottomInset ?? 0) - pillH;
  const color = KIOSK_GUIDE_COLOR;
  const font = 'system-ui, -apple-system, sans-serif';
  return (
    <svg
      style={{ position: 'absolute', left: CANVAS_OVERFLOW_PAD, top: CANVAS_OVERFLOW_PAD, pointerEvents: 'none' }}
      width={W}
      height={H}
      aria-hidden="true"
    >
      {inset > 0 && (
        <>
          <rect x={0} y={0} width={inset} height={H} fill={color} opacity={0.06} />
          <rect x={W - inset} y={0} width={inset} height={H} fill={color} opacity={0.06} />
          <line x1={inset} y1={0} x2={inset} y2={H} stroke={color} strokeWidth={1} strokeDasharray="5 3" opacity={0.8} />
          <line x1={W - inset} y1={0} x2={W - inset} y2={H} stroke={color} strokeWidth={1} strokeDasharray="5 3" opacity={0.8} />
          <text x={inset + 4} y={12} fontSize={8} fill={color} fontFamily={font} fontWeight="600" opacity={0.95}>Zone de sécurité</text>
        </>
      )}
      {reserved > 0 && (
        <>
          <rect x={0} y={H - reserved} width={W} height={reserved} fill={color} opacity={0.06} />
          <line x1={0} y1={H - reserved} x2={W} y2={H - reserved} stroke={color} strokeWidth={1} strokeDasharray="5 3" opacity={0.8} />
          <text x={W - inset - 4} y={H - reserved - 4} fontSize={8} fill={color} fontFamily={font} fontWeight="600" textAnchor="end" opacity={0.95}>Boutons de la borne</text>
        </>
      )}
      {pillH > 0 && (
        <>
          <rect x={(W - pillW) / 2} y={pillY} width={pillW} height={pillH} rx={pillH / 2}
            fill="rgba(0,0,0,0.55)" stroke="rgba(255,255,255,0.7)" strokeWidth={1} />
          <text x={W / 2} y={pillY + pillH / 2 + 6} fontSize={17} fill="#fff" textAnchor="middle"
            fontFamily={font} fontWeight="600">Touchez l'écran pour commencer</text>
        </>
      )}
    </svg>
  );
}

// ─── Écrans composés par l'admin : repères (LAB-296) ─────────────────────────
// Hors de Fabric, jamais exportés : zone 16:10 (la borne recadre le 16:9) et, sur l'accueil,
// le cadenas de la borne (zone tactile réservée en haut à droite).

export function KioskScreenOverlay({ format }) {
  const W = format.canvasWidth;
  const H = format.canvasHeight;
  const k = format.canvasWidth / format.exportWidth;
  const safe = format.safeZoneExport;
  const lock = format.lockZoneExport;
  const left = safe ? safe.x * k : 0;
  const right = safe ? (safe.x + safe.w) * k : W;
  const color = KIOSK_GUIDE_COLOR;
  const font = 'system-ui, -apple-system, sans-serif';
  return (
    <svg
      style={{ position: 'absolute', left: CANVAS_OVERFLOW_PAD, top: CANVAS_OVERFLOW_PAD, pointerEvents: 'none' }}
      width={W}
      height={H}
      aria-hidden="true"
    >
      {safe && (
        <>
          <rect x={0} y={0} width={left} height={H} fill={color} opacity={0.06} />
          <rect x={right} y={0} width={W - right} height={H} fill={color} opacity={0.06} />
          <line x1={left} y1={0} x2={left} y2={H} stroke={color} strokeWidth={1} strokeDasharray="5 3" opacity={0.8} />
          <line x1={right} y1={0} x2={right} y2={H} stroke={color} strokeWidth={1} strokeDasharray="5 3" opacity={0.8} />
          <text x={left + 4} y={12} fontSize={8} fill={color} fontFamily={font} fontWeight="600" opacity={0.95}>
            Zone de sécurité (écran 16:10)
          </text>
        </>
      )}
      {lock && (
        <>
          <rect x={lock.x * k} y={lock.y * k} width={lock.w * k} height={lock.h * k} rx={4}
            fill={color} fillOpacity={0.08} stroke={color} strokeWidth={1} strokeDasharray="3 2" opacity={0.9} />
          <text x={(lock.x + lock.w / 2) * k} y={(lock.y + lock.h) * k + 9} fontSize={7} fill={color}
            fontFamily={font} fontWeight="600" textAnchor="middle" opacity={0.95}>Cadenas</text>
        </>
      )}
    </svg>
  );
}
