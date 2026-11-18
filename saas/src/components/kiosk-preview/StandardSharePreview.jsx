import { CanvasCopy } from './DesignedScreenPreview';
import { ACTION_STATE } from '../../lib/kioskScreenState';
import { KIOSK_COLORS as C, KIOSK_FONT_TEXT, KIOSK_FONT_TITLE } from '../../lib/kioskScreenTemplates';

// Écran de partage standard de la borne (« 3 · Partage » de kiosk/PolaKiosk/Views/ResultView.xaml,
// LAB-319), affiché quand l'organisation n'a pas publié le sien. Mêmes mesures que le XAML : grille de
// 1280 × 800 centrée dans la surface (Viewbox Uniform, bandes crème autour en 16:9). Textes et états
// des boutons : standardShareTexts, shareTexts et shareActionStates (miroirs de ResultViewModel).
// Non cliquable (D11).
const W = 1280;
const H = 800;
const DISABLED_OPACITY = 0.45; // ResultBareButton : IsEnabled=False
const PRINT_MAX = { width: 440, height: 600 };
const PRINT_SHADOW = '0 24px 34px rgba(36,65,47,0.22)'; // ResultPrintShadow

const ICONS = {
  clock: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z',
  print: 'M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z',
  mail: 'M22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6zm-2 0-8 5-8-5h16zm0 12H4V8l8 5 8-5v10z',
  qr: 'M9.5 6.5v3h-3v-3h3M11 5H5v6h6V5zm-1.5 9.5v3h-3v-3h3M11 13H5v6h6v-6zm6.5-6.5v3h-3v-3h3M19 5h-6v6h6V5zm-2 8h-2v2h2v-2zm-4 0h-2v2h2v-2zm6 0h-2v2h2v-2zm-2 2h-2v2h2v-2zm-4 0h-2v2h2v-2zm6 0h-2v2h2v-2zm-4 2h-2v2h2v-2zm4 0h-2v2h2v-2zM22 7h-2V4h-3V2h5v5zm0 15v-5h-2v3h-3v2h5zM2 22h5v-2H4v-3H2v5zM2 2v5h2V4h3V2H2z',
  refresh: 'M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
};

// Path Stretch=Uniform : le dessin de l'icône (et non sa boîte 24 × 24) remplit la taille donnée.
const ICON_BOUNDS = {
  clock: '2 2 20 20', print: '2 3 20 18', mail: '2 4 20 16', qr: '2 2 20 20', refresh: '4.01 4 15.99 16',
};

function Icon({ name, size, color, style }) {
  return (
    <svg width={size} height={size} viewBox={ICON_BOUNDS[name]} preserveAspectRatio="xMidYMid meet"
      aria-hidden="true" style={{ flexShrink: 0, display: 'block', ...style }}>
      <path d={ICONS[name]} fill={color} />
    </svg>
  );
}

const TITLE = { fontFamily: KIOSK_FONT_TITLE, fontWeight: 600, color: C.forest, margin: 0 };
const TEXT = { fontFamily: KIOSK_FONT_TEXT, margin: 0, lineHeight: 'normal' };

const shownAs = (state) => (state === ACTION_STATE.disabled ? { opacity: DISABLED_OPACITY } : null);

function printSize(composite) {
  if (!composite?.width || !composite?.height) return PRINT_MAX;
  const scale = Math.min(PRINT_MAX.width / composite.width, PRINT_MAX.height / composite.height);
  return { width: composite.width * scale, height: composite.height * scale };
}

function PrintCard({ composite }) {
  const size = printSize(composite);
  return (
    <div style={{
      width: size.width, height: size.height, background: C.paper, borderRadius: 6, boxShadow: PRINT_SHADOW,
      transform: 'rotate(-2deg)', transformOrigin: 'center center',
    }}>
      {composite && <CanvasCopy source={composite} style={{ width: '100%', height: '100%', display: 'block' }} />}
    </div>
  );
}

function StepperButton({ glyph, state }) {
  return (
    <div style={{
      width: 52, height: 52, borderRadius: 26, border: '2px solid rgba(247,241,231,0.5)', boxSizing: 'border-box',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      ...TEXT, fontSize: 28, color: C.cream, ...shownAs(state),
    }}>{glyph}</div>
  );
}

function PrintBlock({ texts, copies, actions }) {
  return (
    <div style={{ marginTop: 22, background: C.forest, borderRadius: 28, padding: '24px 26px' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <Icon name="print" size={40} color={C.cream} />
        <div style={{ flex: 1, minWidth: 0, margin: '0 12px 0 18px' }}>
          <p style={{ ...TITLE, fontSize: 32, lineHeight: '36px', color: C.cream }}>Imprimer</p>
          <p style={{ ...TEXT, fontSize: 15, color: C.mint, marginTop: 2 }}>{texts.printSubtitle}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <StepperButton glyph="−" state={actions.copies_minus} />
          <span style={{ ...TITLE, fontSize: 34, color: C.cream, minWidth: 40, margin: '0 12px', textAlign: 'center' }}>
            {copies}
          </span>
          <StepperButton glyph="+" state={actions.copies_plus} />
        </div>
      </div>
      <div style={{
        ...TEXT, marginTop: 18, height: 64, borderRadius: 20, background: C.cream, display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: 21, fontWeight: 700, color: C.forest, ...shownAs(actions.print),
      }}>{texts.printButton}</div>
    </div>
  );
}

function ShareTile({ icon, title, subtitle, background, tall, state }) {
  return (
    <div style={{
      flex: '1 1 0', minWidth: 0, margin: '0 9px', height: tall ? 180 : 124, padding: '20px 22px', borderRadius: 26,
      boxSizing: 'border-box', background, display: 'flex', alignItems: 'center', ...shownAs(state),
    }}>
      <Icon name={icon} size={40} color={C.forest} />
      <div style={{ marginLeft: 16 }}>
        <p style={{ ...TITLE, fontSize: 28, lineHeight: '32px' }}>{title}</p>
        <p style={{ ...TEXT, fontSize: 15, color: C.forest, marginTop: 2, whiteSpace: 'nowrap' }}>{subtitle}</p>
      </div>
    </div>
  );
}

const OUTLINE_BUTTON = {
  height: 52, padding: '0 22px', borderRadius: 26, border: `2px solid ${C.sage}`, boxSizing: 'border-box',
  display: 'flex', alignItems: 'center', ...TEXT, fontSize: 17, fontWeight: 600, color: C.forest, whiteSpace: 'nowrap',
};

/**
 * @param {object} p
 * @param {{width:number,height:number}} p.surface  surface de l'aperçu (800 de haut)
 * @param {number} p.ox
 * @param {number} p.oy
 * @param {HTMLCanvasElement|null} p.composite  tirage monté (null : en préparation)
 * @param {object} p.inputs   entrées de shareInputsForState
 * @param {object} p.actions  shareActionStates(inputs)
 * @param {object} p.texts    shareTexts(inputs)
 * @param {object} p.standardTexts  standardShareTexts(inputs, …)
 */
export default function StandardSharePreview({ surface, ox, oy, composite, inputs, actions, texts, standardTexts }) {
  const left = ox + (surface.width - W) / 2;
  const showPrint = inputs.ShowPrintBlock;
  const showEmail = actions.email !== ACTION_STATE.hidden;
  const showQr = actions.qr !== ACTION_STATE.hidden;
  const showRetake = actions.retake !== ACTION_STATE.hidden;
  const showFinish = actions.finish !== ACTION_STATE.hidden;

  return (
    <div style={{ position: 'absolute', left: ox, top: oy, width: surface.width, height: surface.height, background: C.cream, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: left - ox, top: 0, width: W, height: H, overflow: 'hidden' }}>
        <div style={{
          position: 'absolute', left: -120, top: 90, width: 600, height: 760, borderRadius: '300px 300px 0 0', background: C.mint,
        }} />

        <div style={{ position: 'absolute', left: 72, top: 48, width: 440, height: H - 96, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <PrintCard composite={composite} />
        </div>

        <div style={{
          position: 'absolute', left: 584, top: 48, width: W - 72 - 584, height: H - 96,
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
        }}>
          {texts.countdown && (
            <div style={{
              alignSelf: 'flex-start', marginBottom: 22, padding: '8px 16px', borderRadius: 20, background: C.creamDark,
              display: 'flex', alignItems: 'center',
            }}>
              <Icon name="clock" size={17} color={C.brown} style={{ marginRight: 8 }} />
              <span style={{ ...TEXT, fontSize: 15, fontWeight: 500, color: C.brown }}>{texts.countdown}</span>
            </div>
          )}

          <p style={{ ...TITLE, fontSize: 72, lineHeight: '76px' }}>Magnifique !</p>
          <p style={{ ...TEXT, fontSize: 21, color: C.brown, marginTop: 6 }}>{standardTexts.subtitle}</p>

          {showPrint && <PrintBlock texts={standardTexts} copies={inputs.Copies} actions={actions} />}

          {(showEmail || showQr) && (
            <div style={{ display: 'flex', margin: '18px -9px 0' }}>
              {showEmail && (
                <ShareTile icon="mail" title="Email" subtitle="Dans votre boîte mail" background={C.mint}
                  tall={!showPrint} state={actions.email} />
              )}
              {showQr && (
                <ShareTile icon="qr" title="QR code" subtitle="Sur votre téléphone" background={C.blush}
                  tall={!showPrint} state={actions.qr} />
              )}
            </div>
          )}

          {texts.share_status && (
            <p style={{ ...TEXT, fontSize: 15, color: C.brown, marginTop: 10 }}>{texts.share_status}</p>
          )}

          {(showRetake || showFinish) && (
            <div style={{ marginTop: 22, display: 'flex', justifyContent: 'space-between' }}>
              {showRetake && (
                <div style={OUTLINE_BUTTON}>
                  <Icon name="refresh" size={20} color={C.forest} style={{ marginRight: 10 }} />
                  {standardTexts.retake}
                </div>
              )}
              {showFinish && <div style={{ ...OUTLINE_BUTTON, marginLeft: 'auto' }}>Terminer</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
