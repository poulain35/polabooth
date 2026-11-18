import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Dialog, DialogOverlay, DialogPortal, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Spinner } from './ui/spinner';
import PrintPreview from './kiosk-preview/PrintPreview';
import { drawComposite } from './kiosk-preview/drawComposite';
import HomePreview from './kiosk-preview/HomePreview';
import DesignedScreenPreview from './kiosk-preview/DesignedScreenPreview';
import StandardSharePreview from './kiosk-preview/StandardSharePreview';
import { loadPreviewImage } from './kiosk-preview/previewImages';
import {
  DEFAULT_PREVIEW_SCREEN, PREVIEW_MESSAGES, PREVIEW_SCREENS, fitScale, homeScreenGeometry, homeSurfaceSize,
  nextSampleOffset, previewScreenById, samplePhotoOrder, userPhotoError,
} from '../lib/kioskPreview';
import { KIOSK_PREVIEW_PHOTOS } from '../lib/kioskPreviewPhotos';
import { SAMPLE_PREVIEW_CONTEXT } from '../lib/kioskPreviewContext';
import { NO_ZONE_MESSAGE } from '../lib/kioskComposite';
import {
  CUT_FEATURES, designedScreenModel, initialCutFeatures, screenSourceFromPlan, shareOptionsWithCuts,
} from '../lib/kioskDesignedScreen';
import {
  SHARE_PREVIEW_STATES, homeLastPhoto, shareActionStates, shareInputsForState, shareTexts, standardShareTexts,
} from '../lib/kioskScreenState';
import { ensureKioskFonts } from '../utils/kioskFonts';

// Aperçu sur la borne (spec docs/specs/apercu-borne.md, LAB-307). Fenêtre plein écran, non
// cliquable (D11). Elle ne reçoit que des images et des valeurs (`source`, préparée par
// prepareDesignPreview ou prepareScreenPreview), jamais le canvas de l'éditeur (D10). Vues :
//   - « Cadre photo » (source.kind 'print') : le tirage monté avec les photos d'exemple, seul
//     (« Tirage ») ou dans l'écran de partage (« Sur l'écran de partage », LAB-309) : celui que
//     l'organisation a publié (context.resultScreen), sinon l'écran standard de la borne
//     (StandardSharePreview, copie de ResultView.xaml, LAB-319) ;
//   - « Écran d'accueil » (source.kind 'home') : le design du client avec les éléments de la borne ;
//   - « Écran composé » (source.kind 'screen', LAB-309) : accueil ou partage composé par l'admin,
//     dans l'état choisi, avec les textes vivants et une photo d'exemple dans les emplacements.
// `context` (previewContext, LAB-308) : valeurs de l'événement, ou d'exemple sans événement (D6).
// `neutral` / `onNeutralChange` : accueil personnalisé ou neutre, partagé avec l'éditeur (D12).
// `showCutFunctions` : cases « Fonction coupée » (admin) ; elles ne changent que l'aperçu.
const VIEWS = {
  print: { title: 'Cadre photo', usesPhotos: true },
  home: { title: "Écran d'accueil", usesPhotos: false },
  screen: { title: 'Écran composé', usesPhotos: true },
};
const SCREEN_VIEW_TITLES = { home: "Écran d'accueil composé", result: 'Écran de partage composé' };
const PRINT_TABS = [{ id: 'print', label: 'Tirage' }, { id: 'share', label: "Sur l'écran de partage" }];
const STANDARD_SHARE_NOTE = "Écran de partage standard : votre organisation n'a pas publié le sien.";

const BEZEL = 14;
const HATCH = 'repeating-linear-gradient(135deg, rgba(220,38,38,0.55) 0 10px, rgba(255,255,255,0.35) 10px 20px)';

// Ref par callback : le contenu du Dialog Radix n'est monté qu'au second rendu (Portal), un ref
// objet lu au premier effet resterait vide et la surface ne serait jamais mesurée (LAB-310).
function useElementSize() {
  const [element, setElement] = useState(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    if (!element) return undefined;
    const update = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, size];
}


/**
 * Cadre d'écran : la surface de la borne (px de la borne) réduite pour tenir dans la fenêtre.
 * Avec `cut` (bandes coupées affichées), l'image déborde du cadre et les bandes hors écran sont
 * hachurées.
 */
function ScreenFrame({ available, surface, outer, children, showCut }) {
  const scale = fitScale(outer.width + BEZEL * 2, outer.height + BEZEL * 2, available.width, available.height);
  if (!scale) return null;
  const ox = (outer.width - surface.width) / 2;
  const oy = (outer.height - surface.height) / 2;
  return (
    <div className="light-island" style={{ width: (outer.width + BEZEL * 2) * scale, height: (outer.height + BEZEL * 2) * scale, position: 'relative' }}>
      <div style={{
        position: 'absolute', left: 0, top: 0, width: outer.width + BEZEL * 2, height: outer.height + BEZEL * 2,
        transform: `scale(${scale})`, transformOrigin: 'top left',
      }}>
        <div style={{
          position: 'absolute', left: BEZEL + ox - (showCut ? 0 : BEZEL), top: BEZEL + oy - (showCut ? 0 : BEZEL),
          width: surface.width + (showCut ? 0 : BEZEL * 2), height: surface.height + (showCut ? 0 : BEZEL * 2),
          // Liseré clair : sans lui, le cadre noir se confond avec le fond de l'admin en sombre.
          background: '#0B0B0C', borderRadius: showCut ? 0 : 22,
          boxShadow: '0 0 0 3px rgba(255,255,255,0.2), 0 20px 60px rgba(0,0,0,0.45)',
        }} />
        <div style={{
          position: 'absolute', left: BEZEL, top: BEZEL, width: outer.width, height: outer.height,
          overflow: showCut ? 'visible' : 'hidden',
        }}>
          {children({ ox, oy })}
        </div>
        {showCut && (
          <div style={{
            position: 'absolute', left: BEZEL + ox, top: BEZEL + oy, width: surface.width, height: surface.height,
            outline: '3px solid #FFFFFF', pointerEvents: 'none',
          }} />
        )}
      </div>
    </div>
  );
}

/** Bandes de l'image 1920×1080 que l'écran ne montre pas, hachurées. */
function CutBands({ geometry, ox, oy }) {
  const { surface, image } = geometry;
  return (
    <>
      {image.left < 0 && (
        <>
          <div style={{ position: 'absolute', top: oy, height: surface.height, left: ox + image.left, width: -image.left, background: HATCH }} />
          <div style={{ position: 'absolute', top: oy, height: surface.height, left: ox + surface.width, width: -image.left, background: HATCH }} />
        </>
      )}
      {image.top < 0 && (
        <>
          <div style={{ position: 'absolute', left: ox, width: surface.width, top: oy + image.top, height: -image.top, background: HATCH }} />
          <div style={{ position: 'absolute', left: ox, width: surface.width, top: oy + surface.height, height: -image.top, background: HATCH }} />
        </>
      )}
    </>
  );
}

function Segmented({ items, value, onChange, label }) {
  return (
    <div className="flex items-center rounded-full bg-muted p-0.5" role="group" aria-label={label}>
      {items.map((item) => (
        <button key={String(item.id)} type="button" onClick={() => onChange(item.id)} title={item.title}
          aria-pressed={item.id === value}
          className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
            item.id === value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

function Check({ checked, onChange, children, title }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer select-none" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="w-3.5 h-3.5 accent-primary" />
      {children}
    </label>
  );
}

export default function KioskPreview({
  status, source, onClose, context = SAMPLE_PREVIEW_CONTEXT, neutral, onNeutralChange, showCutFunctions = false,
}) {
  const view = source ? VIEWS[source.kind] : null;
  const [screenId, setScreenId] = useState(DEFAULT_PREVIEW_SCREEN.id);
  const [showCut, setShowCut] = useState(false);
  const [sampleOffset, setSampleOffset] = useState(0);
  const [samples, setSamples] = useState(null);
  const [userPhoto, setUserPhoto] = useState(null);
  const [photoMessage, setPhotoMessage] = useState('');
  const [renderFailed, setRenderFailed] = useState(false);
  const [printResult, setPrintResult] = useState(null);
  // Écrans composés (LAB-309)
  const [printTab, setPrintTab] = useState('print');
  const [shareStateId, setShareStateId] = useState(SHARE_PREVIEW_STATES[0].id);
  const [hasPhotos, setHasPhotos] = useState(true);
  const [localNeutral, setLocalNeutral] = useState(false);
  const [cut, setCut] = useState(() => ({
    ...initialCutFeatures('home', context?.share), ...initialCutFeatures('result', context?.share),
  }));
  const [composite, setComposite] = useState(null); // canvas du tirage monté, pour l'écran de partage
  const userPhotoUrlRef = useRef(null);
  const fileInputRef = useRef(null);
  const [stageRef, available] = useElementSize();

  const screen = previewScreenById(screenId);
  const isNeutral = typeof neutral === 'boolean' ? neutral : localNeutral;
  const setNeutral = (value) => {
    if (typeof neutral !== 'boolean') setLocalNeutral(value);
    onNeutralChange?.(value);
  };

  useEffect(() => { ensureKioskFonts(); }, []);

  // La photo de l'utilisateur ne quitte pas le navigateur : URL locale libérée à la fermeture.
  useEffect(() => () => {
    if (userPhotoUrlRef.current) URL.revokeObjectURL(userPhotoUrlRef.current);
    userPhotoUrlRef.current = null;
  }, []);

  useEffect(() => {
    if (!view?.usesPhotos || samples) return undefined;
    let active = true;
    Promise.all(KIOSK_PREVIEW_PHOTOS.map((p) => loadPreviewImage(p.src)))
      .then((images) => { if (active) setSamples(images); })
      .catch(() => { if (active) setRenderFailed(true); });
    return () => { active = false; };
  }, [view, samples]);

  const zoneCount = source?.zones?.length ?? 0;
  const photos = useMemo(() => {
    if (userPhoto) return [userPhoto.image];
    if (!samples) return null;
    return samplePhotoOrder(zoneCount, samples.length, sampleOffset).map((i) => samples[i]);
  }, [userPhoto, samples, zoneCount, sampleOffset]);

  // ── Écran composé affiché : celui de la source, ou le partage autour du tirage ──
  const isPrint = source?.kind === 'print';
  const onShareTab = isPrint && printTab === 'share';
  const orgShare = useMemo(() => screenSourceFromPlan(context?.resultScreen ?? null), [context]);
  const isStandardShare = onShareTab && !orgShare;

  // Tirage monté pour l'emplacement « photo_preview », comme le montage de la séance sur la borne.
  useEffect(() => {
    if (!onShareTab || !photos?.length) return undefined;
    let active = true;
    const canvas = document.createElement('canvas');
    drawComposite(canvas, { formatId: source.formatId, zones: source.zones, pngUrl: source.pngUrl, photos })
      .then((result) => { if (active) { setComposite(canvas); setPrintResult(result); } })
      .catch((err) => { console.error('Aperçu du tirage :', err); if (active) setRenderFailed(true); });
    return () => { active = false; };
  }, [onShareTab, photos, source]);

  let composed = null;
  if (source?.kind === 'screen') composed = source;
  else if (onShareTab) composed = orgShare;
  const composedKind = composed?.screenKind ?? null;
  const stateKind = isStandardShare ? 'result' : composedKind;

  const model = useMemo(() => (composed ? designedScreenModel({
    layout: composed.layout,
    stateId: shareStateId,
    share: context?.share ?? {},
    cut,
    texts: context?.texts ?? {},
    hasPhotos,
    personalized: !isNeutral,
  }) : null), [composed, shareStateId, context, cut, hasPhotos, isNeutral]);

  const standardShare = useMemo(() => {
    if (!isStandardShare) return null;
    const inputs = shareInputsForState(shareStateId, shareOptionsWithCuts(context?.share ?? {}, cut));
    return {
      inputs,
      actions: shareActionStates(inputs),
      texts: shareTexts(inputs),
      standardTexts: standardShareTexts(inputs, { formatId: source?.formatId, photoCount: zoneCount }),
    };
  }, [isStandardShare, shareStateId, context, cut, source, zoneCount]);

  const samplePhotoSrc = userPhoto ? userPhoto.url : photos?.[0]?.src ?? null;
  const slotImages = composedKind === 'home'
    ? { last_photo: homeLastPhoto(hasPhotos ? samplePhotoSrc : null, null) }
    : { photo_preview: onShareTab ? composite : samplePhotoSrc };

  const clearUserPhoto = useCallback(() => {
    if (userPhotoUrlRef.current) URL.revokeObjectURL(userPhotoUrlRef.current);
    userPhotoUrlRef.current = null;
    setUserPhoto(null);
  }, []);

  async function handleUserPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const error = userPhotoError(file);
    if (error) { setPhotoMessage(error); return; }
    const url = URL.createObjectURL(file);
    try {
      const image = await loadPreviewImage(url);
      clearUserPhoto();
      userPhotoUrlRef.current = url;
      setUserPhoto({ image, url });
      setPhotoMessage('');
    } catch {
      URL.revokeObjectURL(url);
      setPhotoMessage(PREVIEW_MESSAGES.photoUnreadable);
    }
  }

  function handleOtherPhotos() {
    if (userPhoto) clearUserPhoto();
    else setSampleOffset((o) => nextSampleOffset(o, zoneCount, KIOSK_PREVIEW_PHOTOS.length));
    setPhotoMessage('');
  }

  const onPrintRendered = useCallback((result) => { setPrintResult(result); setRenderFailed(false); }, []);
  const onPrintError = useCallback(() => setRenderFailed(true), []);

  const failed = status === 'error' || renderFailed;
  const ready = status === 'ready' && source && !failed;

  let surface = homeSurfaceSize(screen);
  let outer = surface;
  let geometry = null;
  const cutView = ready && (source.kind === 'home' || Boolean(composed));
  if (ready && (source.kind === 'home' || composed)) {
    geometry = homeScreenGeometry(screen);
    surface = geometry.surface;
    outer = showCut && cutView
      ? { width: Math.max(surface.width, geometry.image.width), height: Math.max(surface.height, geometry.image.height) }
      : surface;
  }
  const cutShown = Boolean(geometry && showCut && cutView);
  const title = source?.kind === 'screen' ? SCREEN_VIEW_TITLES[composedKind] ?? view.title : view?.title;
  const note = source?.kind === 'screen' ? source.note : isStandardShare ? STANDARD_SHARE_NOTE : null;

  function renderScreen({ ox, oy }) {
    if (source.kind === 'home') {
      return (
        <>
          <img src={source.pngUrl} alt="" draggable={false} style={{
            position: 'absolute', maxWidth: 'none',
            left: ox + geometry.image.left, top: oy + geometry.image.top, width: geometry.image.width, height: geometry.image.height,
          }} />
          {cutShown && <CutBands geometry={geometry} ox={ox} oy={oy} />}
          <div style={{ position: 'absolute', left: ox, top: oy, width: surface.width, height: surface.height }}>
            <HomePreview tiles={context.tiles} />
          </div>
        </>
      );
    }
    if (composed && model) {
      return (
        <>
          <DesignedScreenPreview model={model} image={geometry.image} surface={surface} ox={ox} oy={oy}
            slotImages={slotImages} underlayUrl={samplePhotoSrc} />
          {cutShown && <CutBands geometry={geometry} ox={ox} oy={oy} />}
        </>
      );
    }
    if (standardShare) {
      return <StandardSharePreview surface={surface} ox={ox} oy={oy} composite={composite} {...standardShare} />;
    }
    return (
      <div style={{ position: 'absolute', left: ox, top: oy, width: surface.width, height: surface.height }}>
        {photos
          ? <PrintPreview surface={surface} formatId={source.formatId} zones={source.zones} pngUrl={source.pngUrl}
              photos={photos} onRendered={onPrintRendered} onError={onPrintError} />
          : <div className="absolute inset-0 flex items-center justify-center" style={{ background: '#F7F1E7' }}><Spinner className="h-5 w-5" /></div>}
      </div>
    );
  }

  const cutFeatures = stateKind ? CUT_FEATURES[stateKind] : [];
  const showStateBar = ready && Boolean(stateKind);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogPortal>
        <DialogOverlay className="bg-black/70" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex flex-col bg-background outline-none"
        >
          <header className="flex flex-wrap items-center gap-2 px-3 py-2 bg-card border-b border-border min-h-[52px]">
            <DialogTitle className="text-sm font-medium text-foreground mr-2">
              Aperçu sur la borne{title ? ` · ${title}` : ''}
            </DialogTitle>

            <Segmented label="Écran de la borne" value={screenId} onChange={setScreenId}
              items={PREVIEW_SCREENS.map((s) => ({ id: s.id, label: s.label, title: `Écran ${s.label} (${s.detail})` }))} />

            {isPrint && (
              <Segmented label="Vue du cadre photo" value={printTab} onChange={setPrintTab}
                items={PRINT_TABS.map((t) => ({
                  ...t,
                  title: t.id === 'share' ? "Le tirage dans l'écran de partage de la borne, comme après la séance" : 'Le tirage seul',
                }))} />
            )}

            {(source?.kind === 'home' || composed) && (
              <Check checked={showCut} onChange={setShowCut}>Montrer les bandes coupées</Check>
            )}

            {view?.usesPhotos && (
              <>
                <Button type="button" size="xs" variant="outline" onClick={handleOtherPhotos} disabled={!ready}>
                  {userPhoto ? "Photos d'exemple" : 'Autres photos'}
                </Button>
                <Button type="button" size="xs" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={!ready}
                  title="Votre photo reste sur cet appareil : elle n'est ni envoyée ni enregistrée.">
                  Essayer avec ma photo
                </Button>
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                  onChange={handleUserPhoto} />
              </>
            )}

            <DialogPrimitive.Close asChild>
              <Button type="button" variant="ghost" size="icon-sm" className="ml-auto text-muted-foreground" aria-label="Fermer l'aperçu">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </Button>
            </DialogPrimitive.Close>
          </header>

          {showStateBar && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 bg-card border-b border-border">
              {stateKind === 'result' && (
                <Segmented label="État de l'écran de partage" value={shareStateId} onChange={setShareStateId}
                  items={SHARE_PREVIEW_STATES.map((s) => ({ id: s.id, label: s.label }))} />
              )}
              {composedKind === 'home' && (
                <>
                  <Segmented label="Accueil personnalisé ou neutre" value={isNeutral} onChange={setNeutral}
                    items={[
                      { id: false, label: 'Personnalisé', title: "Avec le nom de l'événement : tout est affiché" },
                      { id: true, label: 'Neutre', title: "Sans le nom de l'événement : les textes « personnalisé seulement » sont masqués" },
                    ]} />
                  <Check checked={!hasPhotos} onChange={(v) => setHasPhotos(!v)}
                    title="Sur la borne, « Photos » n'apparaît qu'après la première photo">
                    Aucune photo encore prise
                  </Check>
                </>
              )}
              {showCutFunctions && cutFeatures.length > 0 && (
                <div className="flex flex-wrap items-center gap-3"
                  title="Aperçu seulement : les réglages de l'événement ne changent pas.">
                  <span className="text-xs font-medium text-muted-foreground">Fonction coupée :</span>
                  {cutFeatures.map((f) => (
                    <Check key={f.id} checked={cut[f.id] === true} onChange={(v) => setCut((c) => ({ ...c, [f.id]: v }))}>
                      {f.label}
                    </Check>
                  ))}
                </div>
              )}
            </div>
          )}

          <div ref={stageRef} className="relative flex-1 min-h-0 flex items-center justify-center m-4">
            {status === 'preparing' && (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Spinner className="h-4 w-4" />
                {PREVIEW_MESSAGES.preparing}
              </div>
            )}
            {failed && (
              <p role="alert" className="max-w-md text-center text-sm bg-state-red text-state-red-fg rounded-control px-4 py-3">
                {PREVIEW_MESSAGES.failed}
              </p>
            )}
            {ready && (
              <ScreenFrame available={available} surface={surface} outer={outer} showCut={cutShown}>
                {renderScreen}
              </ScreenFrame>
            )}
          </div>

          {ready && (
            <footer className="px-4 pb-3 -mt-2 min-h-[28px] text-center text-xs text-muted-foreground space-y-1">
              {note && <p className="font-medium text-foreground">{note}</p>}
              {cutShown && (
                <p>{geometry.cut.x || geometry.cut.y
                  ? `Les bandes hachurées (${Math.round(geometry.cut.x || geometry.cut.y)} px de l'image de chaque côté) ne sont pas visibles sur cet écran.`
                  : "Rien n'est coupé sur cet écran."}</p>
              )}
              {model?.underlay && <p>Fond transparent : sur la borne, l'image de l'événement apparaît dessous (ici, une photo d'exemple).</p>}
              {isPrint && printResult?.fullFrame && <p>{NO_ZONE_MESSAGE}</p>}
              {view?.usesPhotos && userPhoto && <p>Votre photo reste sur cet appareil : elle n'est ni envoyée ni enregistrée.</p>}
              {photoMessage && <p role="alert" className="text-destructive">{photoMessage}</p>}
            </footer>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
