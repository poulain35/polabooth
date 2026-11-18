import { useEffect, useRef } from 'react';
import { Eraser, Loader2, Lock, Unlock } from 'lucide-react';
import ColorInput from './ColorInput';
import TextEffectPanel from './TextEffectPanel';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from './ui/select';
import { SegmentedControl } from './ui/segmented-control';
import {
  ALLOWED, ACTION_LABELS, ACTION_EVENT_NOTES, VARIABLE_LABELS, SLOT_LABELS, EMBEDDED_FONTS, MIN_BUTTON_SIZE,
  embeddedFontName, nearestWeight,
} from '../lib/kioskScreenLayout';
import { loadLiveFont } from '../utils/kioskFonts';
import { KIOSK_COLORS } from '../lib/kioskScreenTemplates';
import {
  applyButtonShapeChange, applyButtonTextChange, buttonShapeStyle, buttonTextFields,
  colorForInput, isKioskButton,
} from '../lib/kioskButton';
// Découpage (LAB-404) : sélecteur de police et petits champs dans ./editor/panel/.
import FontPicker from './editor/panel/FontPicker';
import {
  Label, Section, NumberInput, IconInput, RangeInput, MultiToggleGroup, ActionButtonGroup, ButtonTextField,
} from './editor/panel/panelControls';
import { TEXT_WEIGHT_OPTIONS, weightValue } from './editor/panel/textWeights';

const WEIGHT_LABELS = { 400: 'Normal', 500: 'Medium', 600: 'Semi Bold', 700: 'Bold' };
// Contour proposé à l'activation, en px d'export (ceux des modèles font 2 à 3 px).
const DEFAULT_BUTTON_STROKE = 3;
const NO_ACTION = 'none';

// Texte vivant : polices embarquées dans la borne, en tête de la liste.
const KIOSK_FONT_GROUP = { label: 'Polices de la borne', fonts: Object.keys(EMBEDDED_FONTS) };

/**
 * Props:
 *  selectedObject   — actual Fabric.js object (or null)
 *  objectVersion    — increments on each property change to trigger re-render
 *  bgColor          — canvas background color
 *  onBgColorChange  — callback(color)
 *  onObjectChange   — callback() after obj.set()
 *  onCenterH        — center object horizontally
 *  onCenterV        — center object vertically
 */
export default function PropertiesPanel({
  selectedObject,
  // eslint-disable-next-line no-unused-vars
  objectVersion,
  bgColor,
  onBgColorChange,
  bgType        = 'solid',
  bgGradient    = { direction: 'to-b', color1: '#DCEEFB', color2: '#FCE0E8' },
  onBgTypeChange,
  onBgGradientChange,
  onObjectChange,
  onCenterH,
  onCenterV,
  onToggleLock,
  onStickerColorChange = null,
  onRemoveBackground = null,
  isRemovingBackground = false,
  removeBackgroundError = '',
  mobile        = false,
  // Format courant : tailles affichées en px d'export (impression ×6, écran de la borne ×2).
  format        = null,
  // Écrans de la borne (LAB-296) : 'home' | 'result' affiche la section « Borne ».
  kioskKind     = null,
  // Double-clic sur un bouton de la borne : {target, index} du texte dont le champ prend le focus.
  buttonTextFocus = null,
  onButtonTextFocused = null,
}) {
  const obj = selectedObject; // actual Fabric object — obj.set() works
  // Facteur d'échelle éditeur → export (canvasWidth × S = exportWidth).
  const S = format?.exportWidth > 0 && format?.canvasWidth > 0 ? format.exportWidth / format.canvasWidth : 6;
  const isPhotoZone = obj?.isPhotoZone === true;
  const isSticker   = !isPhotoZone && obj?.isSticker === true;
  const isText  = !isPhotoZone && !isSticker && (obj?.type === 'i-text' || obj?.type === 'text' || obj?.type === 'textbox');
  const isShape = !isPhotoZone && !isSticker && (obj?.type === 'rect' || obj?.type === 'circle' || obj?.type === 'ellipse');
  const isLine  = !isPhotoZone && !isSticker && obj?.type === 'line';
  const isImage = !isPhotoZone && !isSticker && obj?.type === 'image';
  const kioskAllowed = kioskKind ? ALLOWED[kioskKind] : null;
  const isSlot  = !!kioskAllowed && !!obj?.kioskSlot;
  const isLive  = !!kioskAllowed && !isSlot && isText && !!obj?.kioskVariable;
  // Texte vivant en Fraunces ou DM Sans : seulement les graisses embarquées dans la borne.
  const liveEmbedded = isLive ? embeddedFontName(obj.fontFamily) : null;
  const isButton = !!kioskAllowed && isKioskButton(obj);
  const buttonFields = isButton ? buttonTextFields(obj) : [];
  const buttonShapeProps = isButton ? buttonShapeStyle(obj) : null;
  const buttonInputs = useRef({});

  useEffect(() => {
    if (!buttonTextFocus || buttonTextFocus.target !== obj) return;
    const el = buttonInputs.current[buttonTextFocus.index];
    // Panneau masqué (celui du bureau pendant la feuille mobile, ou l'inverse) : l'autre s'en charge.
    if (!el || el.offsetParent === null) return;
    el.focus();
    el.select();
    el.scrollIntoView({ block: 'nearest' });
    onButtonTextFocused?.();
  }, [buttonTextFocus, obj, onButtonTextFocused]);

  function update(props) {
    if (!obj || typeof obj.set !== 'function') return;
    obj.set(props);
    if (obj.type === 'i-text' || obj.type === 'text' || obj.type === 'textbox') {
      obj.initDimensions?.();
      obj.setCoords();
    }
    obj.canvas?.renderAll();
    onObjectChange?.();
  }

  // Bouton de la borne : texte et forme se règlent dans le groupe, qui se recalcule autour.
  function updateButtonText(index, props) {
    if (!applyButtonTextChange(obj, index, props, { minSize: MIN_BUTTON_SIZE / S })) return;
    obj.setCoords();
    obj.canvas?.renderAll();
    onObjectChange?.();
  }

  async function updateButtonFont(index, { family, weight }) {
    const text = obj?._objects?.[index];
    if (!text) return;
    const fontFamily = family ?? text.fontFamily ?? 'Roboto';
    const fontWeight = weight ?? text.fontWeight ?? 'normal';
    try { await document.fonts.load(`${fontWeight} ${text.fontSize || 20}px "${fontFamily}"`); } catch (_) {}
    updateButtonText(index, { fontFamily, fontWeight });
  }

  function updateButtonShape(props) {
    if (!applyButtonShapeChange(obj, props)) return;
    obj.setCoords();
    obj.canvas?.renderAll();
    onObjectChange?.();
  }

  // Marque de la borne : une valeur vide devient undefined, donc absente du canvas_json.
  function setKioskProp(name, value) {
    if (!obj || typeof obj.set !== 'function') return;
    const empty = value === null || value === undefined || value === false || value === '';
    obj.set(name, empty ? undefined : value);
    // Un bouton est toujours affiché sur la borne : la marque « personnalisé seulement » ne s'applique pas.
    if (name === 'kioskAction' && !empty) obj.set('personalizedOnly', undefined);
    obj.canvas?.renderAll();
    onObjectChange?.();
  }

  // Texte vivant : toute police des modèles photos ; Fraunces et DM Sans gardent leurs graisses embarquées.
  async function updateLiveFont({ family, weight }) {
    if (!obj) return;
    const fontFamily = family ?? obj.fontFamily ?? 'DM Sans';
    const embedded = embeddedFontName(fontFamily);
    const fontWeight = embedded
      ? String(nearestWeight(EMBEDDED_FONTS[embedded], weight ?? obj.fontWeight))
      : weight ?? obj.fontWeight ?? 'normal';
    await loadLiveFont(fontFamily, fontWeight);
    update({ fontFamily: embedded ?? fontFamily, fontWeight });
  }

  async function updateFont(fontName) {
    if (!obj || typeof obj.set !== 'function') return;
    const size   = obj.fontSize || 20;
    const weight = obj.fontWeight || 'normal';
    try { await document.fonts.load(`${weight} ${size}px "${fontName}"`); } catch (_) {}
    obj.set({ fontFamily: fontName });
    obj.initDimensions?.();
    obj.setCoords();
    obj.canvas?.renderAll();
    onObjectChange?.();
  }

  function applyTextTransform(transform) {
    if (!obj) return;
    let text = obj._rawText ?? obj.text ?? '';
    if (!obj._rawText) obj._rawText = text;
    if (transform === 'uppercase')  text = text.toUpperCase();
    else if (transform === 'lowercase')  text = text.toLowerCase();
    else if (transform === 'capitalize') text = text.replace(/\b\w/g, (c) => c.toUpperCase());
    else text = obj._rawText; // 'none' → restore
    obj.set({ text, textTransform: transform });
    obj.initDimensions?.();
    obj.setCoords();
    obj.canvas?.renderAll();
    onObjectChange?.();
  }

  return (
    <aside className={`bg-card flex flex-col overflow-y-auto shrink-0 ${mobile ? 'w-full' : 'w-64 border-l border-border'}`}>
      <div className="px-4 py-3 border-b border-muted flex items-center justify-between">
        <h3 className="text-sm font-editor-strong text-foreground">
          {obj ? (
            isPhotoZone ? 'Zone photo' :
            isSlot      ? 'Emplacement' :
            isLive      ? 'Texte vivant' :
            kioskAllowed && obj.kioskAction ? 'Bouton de la borne' :
            isSticker   ? 'Décoration' :
            isText  ? 'Texte' :
            isShape ? (obj.type === 'rect' ? 'Rectangle' : 'Cercle') :
            isLine  ? 'Ligne' :
            obj?.type === 'group' ? 'Groupe' :
            isImage ? 'Image' : 'Élément'
          ) : 'Propriétés'}
        </h3>
        {obj && onToggleLock && (
          <button
            onClick={onToggleLock}
            title={obj.locked ? 'Déverrouiller' : 'Verrouiller'}
            className={`p-1.5 rounded-[0.5rem] transition-colors
              ${obj.locked
                ? 'bg-editor-warning text-editor-warning-fg'
                : 'text-editor-faint hover:bg-editor-hover hover:text-editor-fg'}`}
          >
            {obj.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      {/* Canvas background — masqué si un élément est sélectionné */}
      {!obj && <Section title="Fond">
        {/* Mode toggle */}
        <div>
          <Label>Type</Label>
          <SegmentedControl
            variant="editor"
            aria-label="Type de fond"
            itemClassName="text-xs"
            value={bgType}
            onValueChange={(id) => onBgTypeChange?.(id)}
            options={[{ value: 'solid', label: 'Uni' }, { value: 'gradient', label: 'Dégradé' }]}
          />
        </div>

        {bgType === 'solid' && (
          <ColorInput label="Couleur" value={bgColor} onChange={onBgColorChange} />
        )}

        {bgType === 'gradient' && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <ColorInput label="Couleur 1" value={bgGradient.color1}
                onChange={(c) => onBgGradientChange?.({ ...bgGradient, color1: c })} />
              <ColorInput label="Couleur 2" value={bgGradient.color2}
                onChange={(c) => onBgGradientChange?.({ ...bgGradient, color2: c })} />
            </div>
            <div>
              <Label>Direction</Label>
              <div className="flex gap-1 flex-wrap">
                {[
                  {
                    id: 'to-b', title: 'Vers le bas',
                    icon: <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="2" x2="8" y2="11"/><polyline points="5,8 8,11 11,8"/></svg>,
                  },
                  {
                    id: 'to-r', title: 'Vers la droite',
                    icon: <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="2" y1="8" x2="11" y2="8"/><polyline points="8,5 11,8 8,11"/></svg>,
                  },
                  {
                    id: 'to-br', title: 'Diagonal bas-droite',
                    icon: <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="3" x2="12" y2="12"/><polyline points="7,12 12,12 12,7"/></svg>,
                  },
                  {
                    id: 'to-bl', title: 'Diagonal bas-gauche',
                    icon: <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="13" y1="3" x2="4" y2="12"/><polyline points="9,12 4,12 4,7"/></svg>,
                  },
                  {
                    id: 'radial', title: 'Radial (du centre)',
                    icon: <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="none" opacity="0.7"/><circle cx="8" cy="8" r="4.5"/><circle cx="8" cy="8" r="7"/></svg>,
                  },
                ].map(({ id, icon, title }) => (
                  <button
                    key={id}
                    title={title}
                    onClick={() => onBgGradientChange?.({ ...bgGradient, direction: id })}
                    className={`flex-1 min-w-[28px] flex items-center justify-center py-1.5 rounded-xl transition-colors
                      ${bgGradient.direction === id
                        ? 'bg-editor-selected text-editor-accent-fg'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </Section>}

      {/* Photo zone info */}
      {isPhotoZone && (
        <Section>
          <div className="flex items-start gap-2.5 p-2.5 bg-editor-selected rounded-xl">
            <svg className="w-4 h-4 text-editor-accent-fg shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <p className="text-xs text-editor-accent-fg leading-relaxed">
              Zone photo — transparente à l'export. Déplacez et redimensionnez librement.
            </p>
          </div>
        </Section>
      )}

      {/* Écrans de la borne : action, texte vivant, emplacement, « personnalisé seulement » */}
      {kioskAllowed && obj && obj.type !== 'activeSelection' && (
        <Section title="Borne">
          {isSlot && (
            <p className="text-xs text-primary-ink bg-primary-soft rounded-control p-2.5 leading-relaxed">
              Emplacement « {SLOT_LABELS[obj.kioskSlot] ?? obj.kioskSlot} » : la borne y affiche la photo,
              recadrée pour remplir le cadre. Il ne fait pas partie du fond publié sur la borne.
            </p>
          )}
          {isLive && (
            <p className="text-xs text-primary-ink bg-primary-soft rounded-control p-2.5 leading-relaxed">
              Texte vivant « {VARIABLE_LABELS[obj.kioskVariable] ?? obj.kioskVariable} » : le texte ci-dessous
              est un exemple, la borne écrit la vraie valeur avec cette police, cette taille et cette couleur.
            </p>
          )}
          {!isSlot && !isLive && (
            <div>
              <Label>Action sur la borne</Label>
              <Select
                value={obj.kioskAction && kioskAllowed.actions.includes(obj.kioskAction) ? obj.kioskAction : NO_ACTION}
                onValueChange={(v) => setKioskProp('kioskAction', v === NO_ACTION ? null : v)}
              >
                <SelectTrigger className="h-auto py-1.5 rounded-xl text-[12px] font-medium">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ACTION}>Aucune (décor)</SelectItem>
                  {kioskAllowed.actions.map((a) => (
                    <SelectItem key={a} value={a}>{ACTION_LABELS[a] ?? a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {obj.kioskAction && !kioskAllowed.actions.includes(obj.kioskAction) && (
                <p className="text-[10px] text-state-amber-fg mt-1">
                  Action « {obj.kioskAction} » inconnue sur cet écran : l'objet reste dans le décor.
                </p>
              )}
              <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
                L'objet (ou le groupe) devient un bouton : touché sur la borne, il lance l'action.
              </p>
              {obj.kioskAction && kioskAllowed.actions.includes(obj.kioskAction) && ACTION_EVENT_NOTES[obj.kioskAction] && (
                <p className="text-[10px] text-state-amber-fg bg-state-amber rounded-sm px-2 py-1.5 mt-1.5 leading-relaxed">
                  {ACTION_EVENT_NOTES[obj.kioskAction]}
                </p>
              )}
            </div>
          )}
          {kioskKind === 'home' && !isSlot && !obj.kioskAction && (
            <label className="flex items-start gap-2 text-[12px] text-foreground cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 accent-primary"
                checked={!!obj.personalizedOnly}
                onChange={(e) => setKioskProp('personalizedOnly', e.target.checked)}
              />
              <span>
                Seulement si l'accueil est personnalisé
                <span className="block text-[10px] text-muted-foreground leading-relaxed">
                  Masqué sur la borne quand l'accueil n'affiche pas le nom de l'événement.
                </span>
              </span>
            </label>
          )}
        </Section>
      )}

      {isButton && buttonFields.length > 0 && (
        <Section title={buttonFields.length > 1 ? 'Textes du bouton' : 'Texte du bouton'}>
          {buttonFields.map((f, i) => (
            <div key={f.index} className={i > 0 ? 'pt-3 border-t border-border' : ''}>
              <ButtonTextField
                label={f.label}
                text={obj._objects[f.index]}
                S={S}
                inputRef={(el) => { buttonInputs.current[f.index] = el; }}
                onChange={(props) => updateButtonText(f.index, props)}
                onFontChange={(change) => updateButtonFont(f.index, change)}
              />
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Le bouton s'agrandit si le texte ne tient plus. Double-cliquez sur un bouton pour arriver ici.
          </p>
        </Section>
      )}
      {isButton && buttonShapeProps && (
        <Section title="Forme du bouton">
          <ColorInput
            label="Remplissage"
            value={colorForInput(buttonShapeProps.fill)}
            onChange={(v) => updateButtonShape({ fill: v })}
          />
          {buttonShapeProps.hasRadius && (
            <NumberInput
              label="Arrondi des angles (px)"
              value={buttonShapeProps.radius * S}
              onChange={(v) => updateButtonShape({ radius: v / S })}
              min={0} max={Math.floor(buttonShapeProps.radiusMax * S)}
            />
          )}
          <label className="flex items-center gap-2 text-[12px] font-medium text-foreground cursor-pointer">
            <input
              type="checkbox"
              className="accent-primary"
              checked={!!buttonShapeProps.stroke}
              onChange={(e) => updateButtonShape(e.target.checked
                ? { stroke: KIOSK_COLORS.forest, strokeWidth: Math.min(DEFAULT_BUTTON_STROKE / S, buttonShapeProps.strokeMax) }
                : { stroke: null })}
            />
            Contour
          </label>
          {buttonShapeProps.stroke && (
            <>
              <ColorInput
                label="Couleur du contour"
                value={colorForInput(buttonShapeProps.stroke)}
                onChange={(v) => updateButtonShape({ stroke: v })}
                showTransparent={false}
              />
              <NumberInput
                label="Épaisseur du contour (px)"
                value={buttonShapeProps.strokeWidth * S}
                onChange={(v) => { if (v >= 1) updateButtonShape({ strokeWidth: v / S }); }}
                min={1} max={Math.max(1, Math.floor(buttonShapeProps.strokeMax * S))}
              />
            </>
          )}
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Le contour est tracé à l'intérieur du bouton : sa taille ne change pas.
          </p>
        </Section>
      )}

      {/* Sticker color */}
      {isSticker && (
        <Section title="Couleur">
          <ColorInput
            label="Teinte"
            value={obj.stickerTintColor || 'transparent'}
            onChange={(color) => onStickerColorChange?.(obj, color)}
          />
        </Section>
      )}

      {/* Image — suppression d'arrière-plan */}
      {isImage && onRemoveBackground && (
        <Section title="Image">
          <Button size="sm"
            onClick={onRemoveBackground}
            disabled={isRemovingBackground}
            className="w-full text-xs"
          >
            {isRemovingBackground ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" />Suppression…</>
            ) : (
              <><Eraser className="w-4 h-4" />Supprimer l'arrière-plan</>
            )}
          </Button>
          {removeBackgroundError && (
            <p className="text-[10px] text-destructive bg-destructive/10 rounded-lg px-2.5 py-2">{removeBackgroundError}</p>
          )}
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Détourage automatique par IA · ~10–30s
          </p>
        </Section>
      )}

      {/* No selection */}
      {!obj && (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center">
            <svg className="w-10 h-10 text-editor-line mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5" />
            </svg>
            <p className="text-xs text-editor-faint">Sélectionnez un élément pour éditer ses propriétés</p>
          </div>
        </div>
      )}

      {/* Text properties */}
      {isText && (
        <>
          <Section title="Texte">
            <Textarea
              value={obj.text || ''}
              onChange={(e) => { obj._rawText = e.target.value; update({ text: e.target.value }); }}
              placeholder="Contenu du texte"
              className="min-h-0 text-[13px] rounded-xl resize-none"
              rows={2}
            />
            {isLive && (
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Valeur d'exemple : la borne affiche la vraie valeur.
              </p>
            )}
            {isLive ? (
              <FontPicker value={obj.fontFamily || 'DM Sans'} onChange={(f) => updateLiveFont({ family: f })}
                extraGroups={[KIOSK_FONT_GROUP]} />
            ) : (
              <FontPicker value={obj.fontFamily || 'Roboto'} onChange={(f) => updateFont(f)} />
            )}
          </Section>

          <Section title="Typographie">
            {/* Graisse + Taille en grille */}
            <div className="grid grid-cols-2 gap-2">
              {liveEmbedded ? (
                <Select
                  value={String(nearestWeight(EMBEDDED_FONTS[liveEmbedded], obj.fontWeight))}
                  onValueChange={(v) => updateLiveFont({ weight: v })}
                  disabled={EMBEDDED_FONTS[liveEmbedded].length < 2}
                >
                  <SelectTrigger className="h-auto py-1.5 rounded-xl text-[12px] font-medium">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EMBEDDED_FONTS[liveEmbedded].map((w) => (
                      <SelectItem key={w} value={String(w)}>{WEIGHT_LABELS[w] ?? w}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
              <Select value={weightValue(obj.fontWeight)}
                onValueChange={(v) => (isLive ? updateLiveFont({ weight: v }) : update({ fontWeight: v }))}>
                <SelectTrigger className="h-auto py-1.5 rounded-xl text-[12px] font-medium">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEXT_WEIGHT_OPTIONS.map((w) => (
                    <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              )}
              <div className="flex items-center gap-1.5 border border-border rounded-xl px-2 py-1.5
                focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15 transition-colors bg-card">
                <span className="text-[11px] font-black text-editor-faint shrink-0 select-none leading-none">Aa</span>
                <input
                  type="number" min={6} max={1800} step={S}
                  value={Math.round((obj.fontSize || 20) * S)}
                  onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v >= 6) update({ fontSize: Math.round(v / S) }); }}
                  className="flex-1 w-0 text-[12px] font-medium text-foreground focus:outline-none bg-transparent tabular-nums"
                />
                <span className="text-[10px] text-editor-faint shrink-0">px</span>
              </div>
            </div>

            {/* Style (la borne n'écrit pas les textes vivants en italique) */}
            {!isLive && <SegmentedControl
              variant="editor"
              aria-label="Style du texte"
              value={obj.fontStyle || 'normal'}
              onValueChange={(v) => update({ fontStyle: v })}
              options={[
                { value: 'normal',  label: 'Normal', title: 'Normal' },
                { value: 'italic',  title: 'Italique',
                  icon: <span className="font-editor-bold" style={{ fontStyle: 'italic' }}>Italic</span> },
                { value: 'oblique', title: 'Oblique',
                  icon: <span className="font-editor-bold" style={{ fontStyle: 'oblique' }}>Oblique</span> },
              ]}
            />}

            {/* Transformer (texte vivant : la borne ne sait que mettre en majuscules) */}
            <SegmentedControl
              variant="editor"
              aria-label="Casse du texte"
              value={obj.textTransform || 'none'}
              onValueChange={applyTextTransform}
              options={isLive ? [
                { value: 'none',       title: 'Normal',      label: '—' },
                { value: 'uppercase',  title: 'Majuscules',  label: 'AA' },
              ] : [
                { value: 'none',       title: 'Normal',      label: '—' },
                { value: 'uppercase',  title: 'Majuscules',  label: 'AA' },
                { value: 'lowercase',  title: 'Minuscules',  label: 'aa' },
                { value: 'capitalize', title: 'Capitaliser', label: 'Aa' },
              ]}
            />

            {/* Décoration */}
            {!isLive && <MultiToggleGroup options={[
              {
                key: 'none',
                active: !obj.underline && !obj.overline && !obj.linethrough,
                title: 'Aucune',
                label: '—',
                onClick: () => update({ underline: false, overline: false, linethrough: false }),
              },
              {
                key: 'underline',
                active: !!obj.underline,
                title: 'Souligné',
                label: <span style={{ textDecoration: 'underline' }}>U</span>,
                onClick: () => update({ underline: !obj.underline }),
              },
              {
                key: 'overline',
                active: !!obj.overline,
                title: 'Surligné',
                label: <span style={{ textDecoration: 'overline' }}>U</span>,
                onClick: () => update({ overline: !obj.overline }),
              },
              {
                key: 'linethrough',
                active: !!obj.linethrough,
                title: 'Barré',
                label: <span style={{ textDecoration: 'line-through' }}>S</span>,
                onClick: () => update({ linethrough: !obj.linethrough }),
              },
            ]} />}

            {/* Alignement — grands boutons icônes */}
            <SegmentedControl
              variant="editor"
              aria-label="Alignement du texte"
              itemClassName="py-1.5"
              value={obj.textAlign || 'left'}
              onValueChange={(value) => update({ textAlign: value })}
              options={[
                { value: 'left',    title: 'Gauche',
                  icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h6a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h9a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" /></svg> },
                { value: 'center',  title: 'Centré',
                  icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM5 10a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1zM4 15a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1z" clipRule="evenodd" /></svg> },
                { value: 'right',   title: 'Droite',
                  icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM9 10a1 1 0 011-1h6a1 1 0 110 2h-6a1 1 0 01-1-1zM7 15a1 1 0 011-1h8a1 1 0 110 2H8a1 1 0 01-1-1z" clipRule="evenodd" /></svg> },
                { value: 'justify', title: 'Justifié',
                  icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" /></svg> },
              ]}
            />

            {/* Espacement lettres — icône AV inline */}
            <div className="flex items-center gap-2.5">
              <span
                className="text-[11px] font-editor-bold text-editor-faint shrink-0 select-none tracking-tight"
                title="Espacement des caractères"
              >AV</span>
              <input
                type="range" min={-50} max={500}
                value={obj.charSpacing || 0}
                onChange={(e) => update({ charSpacing: Number(e.target.value) })}
                className="flex-1 h-1 rounded-full appearance-none cursor-pointer"
                style={{ background: `linear-gradient(to right, var(--editor-accent, hsl(var(--primary))) ${((obj.charSpacing || 0) + 50) / 550 * 100}%, var(--editor-track) ${((obj.charSpacing || 0) + 50) / 550 * 100}%)` }}
              />
              <span className="text-[12px] font-editor-strong text-foreground tabular-nums w-8 text-right shrink-0">{obj.charSpacing || 0}</span>
            </div>
          </Section>

          <Section title="Couleur">
            <ColorInput
              label="Couleur"
              value={obj.fill}
              onChange={(v) => update({ fill: v })}
            />
          </Section>

          {!isLive && (
            <Section title="Effets">
              <TextEffectPanel obj={obj} onObjectChange={onObjectChange} />
            </Section>
          )}
        </>
      )}

      {/* Shape properties */}
      {(isShape || isLine) && (
        <Section title="Couleurs">
          {!isLine && (
            <ColorInput
              label="Fond"
              value={typeof obj.fill === 'string' ? obj.fill : 'transparent'}
              onChange={(v) => update({ fill: v })}
            />
          )}
          <ColorInput
            label="Bordure"
            value={obj.stroke || 'transparent'}
            onChange={(v) => update({ stroke: v })}
          />
          <NumberInput
            label="Épaisseur bordure"
            value={(obj.strokeWidth || 0) * S}
            onChange={(v) => update({ strokeWidth: v / S })}
            min={0} max={300} step={S}
          />
        </Section>
      )}

      {/* Common: position, size, align, opacity */}
      {obj && (
        <>
          <Section title="Position &amp; taille">
            <div className="grid grid-cols-2 gap-2">
              <IconInput
                icon={<svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="2" x2="1" y2="12"/><line x1="1" y1="7" x2="11" y2="7"/><polyline points="8,4 11,7 8,10"/></svg>}
                value={(obj.left || 0) * S} onChange={(v) => update({ left: v / S })} min={-59994} max={59994}
              />
              <IconInput
                icon={<svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="2" y1="1" x2="12" y2="1"/><line x1="7" y1="1" x2="7" y2="11"/><polyline points="4,8 7,11 10,8"/></svg>}
                value={(obj.top  || 0) * S} onChange={(v) => update({ top: v / S })} min={-59994} max={59994}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <IconInput
                icon={<svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="2" y1="7" x2="12" y2="7"/><polyline points="5,4 2,7 5,10"/><polyline points="9,4 12,7 9,10"/><line x1="2" y1="3" x2="2" y2="11" strokeOpacity="0.4"/><line x1="12" y1="3" x2="12" y2="11" strokeOpacity="0.4"/></svg>}
                value={obj.type === 'circle' ? (obj.radius || 0) * 2 * S : ((obj.width * (obj.scaleX || 1)) || 0) * S}
                onChange={(v) => {
                  if (obj.type === 'circle') update({ radius: (v / S) / 2 });
                  // Textbox : la largeur fixe le retour à la ligne, sans étirer les lettres.
                  else if (obj.type === 'textbox') update({ width: (v / S) / (obj.scaleX || 1) });
                  else update({ scaleX: (v / S) / (obj.width || 1) });
                }}
                min={1} max={59994}
              />
              <IconInput
                icon={<svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="7" y1="2" x2="7" y2="12"/><polyline points="4,5 7,2 10,5"/><polyline points="4,9 7,12 10,9"/><line x1="3" y1="2" x2="11" y2="2" strokeOpacity="0.4"/><line x1="3" y1="12" x2="11" y2="12" strokeOpacity="0.4"/></svg>}
                value={obj.type === 'circle' ? (obj.radius || 0) * 2 * S : ((obj.height * (obj.scaleY || 1)) || 0) * S}
                onChange={(v) => { if (obj.type === 'circle') update({ radius: (v / S) / 2 }); else update({ scaleY: (v / S) / (obj.height || 1) }); }}
                min={1} max={59994}
              />
            </div>
            <IconInput
              icon={<svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4A5 5 0 104.5 10.5"/><polyline points="11,1 11,4 8,4"/></svg>}
              value={obj.angle || 0}
              onChange={(v) => update({ angle: v })}
              min={-360} max={360} unit="°"
            />

            <ActionButtonGroup options={[
              {
                onClick: onCenterH,
                title: 'Centrer horizontalement',
                icon: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v18M4 12h16" /></svg>,
                label: 'Centrer H',
              },
              {
                onClick: onCenterV,
                title: 'Centrer verticalement',
                icon: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 12h18M12 4v16" /></svg>,
                label: 'Centrer V',
              },
            ]} />
          </Section>

          {!isPhotoZone && (
            <Section title="Opacité">
              <RangeInput
                label="Opacité"
                value={obj.opacity ?? 1}
                onChange={(v) => update({ opacity: v })}
              />
            </Section>
          )}
        </>
      )}

      {/* Padding bas pour que le dernier élément soit atteignable au scroll */}
      <div className="shrink-0 h-6" />
    </aside>
  );
}
