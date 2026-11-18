import { useEffect, useMemo, useRef, useState } from 'react';
import HomePreview from './HomePreview';
import { ACTION_LABELS } from '../../lib/kioskScreenLayout';
import { ACTION_STATE } from '../../lib/kioskScreenState';
import { KIOSK_COLORS, KIOSK_FONT_TEXT } from '../../lib/kioskScreenTemplates';
import { canvasMeasure, fitScreenText } from '../../lib/kioskTextFit';
import { ensureKioskFonts, loadLiveFont } from '../../utils/kioskFonts';

// Écran composé par l'admin, dessiné comme DesignedScreen de la borne (LAB-309) : surface de
// 1920×1080 en cover centré, fond, emplacements, textes vivants puis boutons. `model` vient de
// designedScreenModel (kioskDesignedScreen.js) : boutons masqués déjà retirés, textes déjà choisis.
// Non cliquable (D11) : le survol d'un bouton donne seulement son action.
const SCREEN_W = 1920;
const SCREEN_H = 1080;
// DesignedScreen : voile des boutons grisés, crème à 60 %, à la forme de l'image du bouton.
const VEIL_COLOR = KIOSK_COLORS.cream;
const VEIL_OPACITY = 0.6;

const rotated = (angle) => (angle ? { transform: `rotate(${angle}deg)`, transformOrigin: 'center center' } : null);

function ScreenButton({ button }) {
  const disabled = button.state === ACTION_STATE.disabled;
  const label = ACTION_LABELS[button.action] ?? button.action;
  return (
    <div
      title={disabled ? `${label} (grisé à ce moment)` : label}
      style={{ position: 'absolute', left: button.x, top: button.y, width: button.w, height: button.h, cursor: 'help' }}
    >
      <img src={button.image} alt="" draggable={false}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', maxWidth: 'none' }} />
      {disabled && (
        <div style={{
          position: 'absolute', inset: 0, background: VEIL_COLOR, opacity: VEIL_OPACITY,
          WebkitMaskImage: `url("${button.image}")`, maskImage: `url("${button.image}")`,
          WebkitMaskSize: '100% 100%', maskSize: '100% 100%',
          WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
        }} />
      )}
    </div>
  );
}

const COVER = { width: '100%', height: '100%', maxWidth: 'none', objectFit: 'cover', objectPosition: 'center', display: 'block' };

// Copie d'un canvas déjà dessiné (montage du tirage) : un PNG d'un autre domaine le rend illisible
// (toDataURL impossible), mais il reste dessinable dans un autre canvas.
export function CanvasCopy({ source, style = COVER }) {
  const ref = useRef(null);
  useEffect(() => {
    const target = ref.current;
    if (!target || !source) return;
    target.width = source.width;
    target.height = source.height;
    target.getContext('2d').drawImage(source, 0, 0);
  }, [source]);
  return <canvas ref={ref} style={style} />;
}

/** Emplacement : image en cover centré, coins arrondis, tourné autour de son centre. `src` : adresse ou canvas. */
function ScreenSlot({ slot, src }) {
  return (
    <div style={{
      position: 'absolute', left: slot.x, top: slot.y, width: slot.w, height: slot.h,
      borderRadius: slot.radius || 0, overflow: 'hidden', ...rotated(slot.angle),
    }}>
      {typeof src === 'string' && <img src={src} alt="" draggable={false} style={COVER} />}
      {src && typeof src === 'object' && <CanvasCopy source={src} />}
    </div>
  );
}

function ScreenText({ item }) {
  const { spec, text, family, fit } = item;
  const multi = spec.max_lines > 1;
  return (
    <div style={{
      position: 'absolute', left: spec.x, top: spec.y, width: spec.w, height: spec.h,
      display: 'flex', alignItems: 'center', ...rotated(spec.angle),
    }}>
      <div style={{
        width: spec.w, fontFamily: family, fontWeight: spec.weight, fontSize: fit.fontSize,
        lineHeight: `${fit.lineHeight}px`, maxHeight: fit.maxHeight, overflow: 'hidden', color: spec.color,
        textAlign: spec.align,
        ...(multi
          ? { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: spec.max_lines, overflowWrap: 'break-word' }
          : { whiteSpace: 'pre', textOverflow: 'ellipsis' }),
      }}>
        {text}
      </div>
    </div>
  );
}

/** Bandeau d'impression de la borne (ResultView) : en haut, au centre, quand le plan n'a pas « État de l'impression ». */
function PrintBanner({ text }) {
  return (
    <div style={{
      position: 'absolute', top: 28, left: '50%', transform: 'translateX(-50%)', padding: '14px 28px',
      borderRadius: 28, background: KIOSK_COLORS.forest, color: KIOSK_COLORS.cream, pointerEvents: 'none',
      fontFamily: KIOSK_FONT_TEXT, fontSize: 22, fontWeight: 600, textAlign: 'center', maxWidth: 900 + 56,
      boxSizing: 'border-box', width: 'max-content',
    }}>{text}</div>
  );
}

/**
 * @param {object} p
 * @param {object} p.model        designedScreenModel
 * @param {object} p.image        boîte de la surface 1920×1080 en px de la surface (homeScreenGeometry().image)
 * @param {object} p.surface      surface de la borne (800 de haut)
 * @param {number} p.ox           décalage de la surface dans le cadre (ScreenFrame)
 * @param {number} p.oy
 * @param {object} [p.slotImages] image de chaque emplacement ({ last_photo, photo_preview }) : adresse ou canvas
 * @param {string} [p.underlayUrl] image de l'événement sous un fond transparent (accueil)
 */
export default function DesignedScreenPreview({ model, image, surface, ox, oy, slotImages = {}, underlayUrl = null }) {
  const [fontsReady, setFontsReady] = useState(null);
  const fonts = useMemo(() => [...new Map(model.texts.map(({ spec }) => [
    `${spec.font}|${spec.weight}|${spec.font_file ?? ''}`, spec,
  ])).entries()], [model.texts]);
  const fontsKey = fonts.map(([key]) => key).join(',');

  // Polices des textes vivants (LAB-331) : celle du plan, depuis son fichier publié quand il y en a un.
  useEffect(() => {
    let active = true;
    Promise.all([ensureKioskFonts(), ...fonts.map(([, spec]) => loadLiveFont(spec.font, spec.weight, spec.font_file))])
      .then(() => { if (active) setFontsReady(fontsKey); });
    return () => { active = false; };
  }, [fonts, fontsKey]);

  // Taille de chaque texte comme DesignedScreen.Fit, mesurée avec les polices de la borne.
  const texts = useMemo(() => {
    if (fontsReady !== fontsKey) return [];
    const context = document.createElement('canvas').getContext('2d');
    return model.texts.map(({ spec, text }) => {
      const family = `"${spec.font}", "DM Sans"`;
      return { spec, text, family, fit: fitScreenText(text, spec, canvasMeasure(context, family, spec.weight)) };
    });
  }, [model.texts, fontsReady, fontsKey]);

  const scale = image.width / SCREEN_W;
  return (
    <>
      <div style={{
        position: 'absolute', left: ox + image.left, top: oy + image.top, width: SCREEN_W, height: SCREEN_H,
        transform: `scale(${scale})`, transformOrigin: 'top left', overflow: 'hidden',
        background: model.underlay && !underlayUrl ? KIOSK_COLORS.cream : 'transparent',
      }}>
        {model.underlay && underlayUrl && (
          <img src={underlayUrl} alt="" draggable={false} style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%', maxWidth: 'none', objectFit: 'cover',
          }} />
        )}
        {model.background && (
          <img src={model.background} alt="" draggable={false}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', maxWidth: 'none' }} />
        )}
        {model.slots.map((slot, i) => <ScreenSlot key={`${slot.slot}-${i}`} slot={slot} src={slotImages[slot.slot] ?? null} />)}
        {texts.map((item, i) => <ScreenText key={`${item.spec.variable}-${i}`} item={item} />)}
        {model.buttons.map((button) => <ScreenButton key={button.action} button={button} />)}
      </div>
      <div style={{ position: 'absolute', left: ox, top: oy, width: surface.width, height: surface.height, pointerEvents: 'none' }}>
        {model.kind === 'home' && <HomePreview composed />}
        {model.kind === 'result' && model.printBanner && <PrintBanner text={model.printBanner} />}
      </div>
    </>
  );
}
