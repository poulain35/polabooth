import { Suspense, useRef, useEffect, useLayoutEffect, useState, forwardRef, useImperativeHandle } from 'react';
import Toolbar from './Toolbar';
import PropertiesPanel from './PropertiesPanel';
import TemplatesSidebar from './TemplatesSidebar';
import StickerPanel from './StickerPanel';
import BatchImportModal from './BatchImportModal';
import { FORMATS, isHomeFormat, isKioskFormat } from '../utils/formats';
import { isTransparentBackground, ALLOWED } from '../lib/kioskScreenLayout';
import { BLANK_TEMPLATE } from '../templates/index';
import { exportAsHighResPNG } from '../utils/export';
import { fetchDecorations, fetchDbTemplateById } from '../lib/supabase';
import { submitButtonLabels } from '../lib/editorMobile';
import { moduleHook, moduleSlot } from '../features/modules';
// Découpage de l'éditeur (LAB-404) : réglages du canvas, hooks et morceaux de l'écran dans ./editor/.
import {
  ADMIN_CANVAS_ACCENT, CLIENT_CANVAS_ACCENT, ADMIN_DEFAULT_GRADIENT, CLIENT_DEFAULT_GRADIENT, DEFAULT_BG_COLOR,
  setCanvasAccent,
} from './editor/canvasStyle';
import { serializeState } from './editor/canvasState';
import { useEditorZoom, useWheelZoom } from './editor/useEditorZoom';
import { useEditorHistory } from './editor/useEditorHistory';
import { useFabricCanvas } from './editor/useFabricCanvas';
import { useObjectActions } from './editor/useObjectActions';
import { useBackgroundActions } from './editor/useBackgroundActions';
import { useImageActions } from './editor/useImageActions';
import { useEditorOutput } from './editor/useEditorOutput';
import { useEditorShortcuts } from './editor/useEditorShortcuts';
import WelcomeCard from './editor/WelcomeCard';
import { ConfirmModal, SubmitConfirmDialog } from './editor/EditorDialogs';
import ContextMenu from './editor/ContextMenu';
import FloatingObjectToolbar from './editor/FloatingObjectToolbar';
import EditorHeader from './editor/EditorHeader';
import CanvasStage from './editor/CanvasStage';
import { EditorStatusBar, MobileZoomBar } from './editor/EditorStatusBar';
import MobilePropertiesSheet from './editor/MobilePropertiesSheet';

// IA visuelle (fond généré, détourage) : module privé « ai_visuals » (LAB-422). Sans lui, aucun bouton.
const AIBackgroundPanel = moduleSlot('editor.aiBackground')[0]?.Component ?? null;
const REMOVE_BACKGROUND = moduleHook('editor.removeBackground');

// ─── Editor ───────────────────────────────────────────────────────────────────

const Editor = forwardRef(function Editor({
  eventCode        = null,
  initialFormat    = null,
  initialCanvasJson = null,
  initialTemplate  = null,  // admin : modèle de la base à précharger { id, name, canvas_json }
  onSubmitSuccess  = null,
  onSaveTemplate   = null,  // admin only: ({ name, canvasJson, previewUrl, formatId }) => Promise
  onSaveRequest    = null,  // client: () => void — ouvre la modale de sauvegarde dans EditorPage
  onDirtyChange    = null,  // client: (isDirty: boolean) => void
  onHistoryOpen    = null,  // client: () => void — ouvre le panneau historique
  onEditAnswers    = null,  // client: () => void — retour au formulaire de l'événement (menu ⋯)
  formatBleedOverrides = {}, // { [formatId]: bleedMm } — surcharge admin par format
  aiVisuals        = true,  // fonctionnalité ai_visuals : détourage et fond généré (si le module est installé)
  onReady          = null,  // () => void — contenu chargé et polices prêtes (LAB-298 : publication)
  onSubmitRequest  = null,  // client, plusieurs cadres (LAB-313) : le bouton d'envoi appelle la page
  submitLabel      = null,  // libellé du bouton d'envoi quand onSubmitRequest est donné
  welcome          = true,  // carte d'accueil du client (non répétée sur les cadres suivants, LAB-313)
  onChange         = null,  // () => void — contenu modifié, annulé ou rétabli (LAB-317 : contrôles, garde)
} = {}, ref) {
  const isClientMode = Boolean(eventCode);
  const defaultBgGradient = isClientMode ? CLIENT_DEFAULT_GRADIENT : ADMIN_DEFAULT_GRADIENT;
  // Poignées de sélection, zones photo et repères en noyer pour le client (LAB-355).
  useLayoutEffect(() => {
    if (!isClientMode) return undefined;
    setCanvasAccent(CLIENT_CANVAS_ACCENT);
    return () => setCanvasAccent(ADMIN_CANVAS_ACCENT);
  }, [isClientMode]);

  const [currentFormat,   setCurrentFormat]   = useState(initialFormat ?? FORMATS.portrait);
  const [currentTemplate, setCurrentTemplate] = useState(initialTemplate ?? BLANK_TEMPLATE);
  // LAB-289 : écran d'accueil de la borne (1920×1080) : pas de zone photo ni de fond perdu.
  const homeMode = isHomeFormat(currentFormat);
  // LAB-296 : écrans de la borne composés par l'admin (accueil par défaut, partage).
  const kioskMode = isKioskFormat(currentFormat);
  const kioskKind = kioskMode ? currentFormat.screenKind : null;
  // LAB-348 : images rangées dans le bucket `designs` dès leur ajout (client par son code, admin
  // de la bibliothèque de modèles). Les écrans de la borne ont leur propre rangement à la publication.
  const storesImages = !kioskMode && (isClientMode || Boolean(onSaveTemplate));
  const imagePrefetchTimerRef = useRef(null);
  const kioskAllowed = kioskKind ? ALLOWED[kioskKind] : null;
  // Aperçu « neutre » de l'accueil : masque les objets « Seulement si l'accueil est personnalisé ».
  const [neutralPreview, setNeutralPreview] = useState(false);
  const neutralPreviewRef = useRef(false);
  const [activePanel,    setActivePanel]     = useState(
    isClientMode && !initialCanvasJson ? 'templates' : null
  );
  // Afficher la card d'accueil si le client n'a pas encore de design sauvegardé pour cet événement
  const [showWelcome, setShowWelcome] = useState(
    () => isClientMode && welcome && !initialCanvasJson
  );
  const [pendingChange,   setPendingChange]   = useState(null);
  const [decorations,     setDecorations]     = useState(null); // null = chargement

  // Chargement unique des décorations au montage du composant
  useEffect(() => {
    fetchDecorations().then(setDecorations).catch(() => setDecorations([]));
  }, []);

  // Submit state
  const [isSubmitting,      setIsSubmitting]      = useState(false);
  const [submitError,       setSubmitError]       = useState('');
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);

  const [isSavingTemplate,  setIsSavingTemplate]  = useState(false);
  const [isSavingClient,    setIsSavingClient]    = useState(false);
  const [showBatchImport,   setShowBatchImport]   = useState(false);
  const [showPropertiesSheet, setShowPropertiesSheet] = useState(false);
  // Double-clic sur un bouton de la borne : champ du texte à mettre au premier plan (LAB-324).
  const [buttonTextFocus,   setButtonTextFocus]   = useState(null);
  const [isRemovingBg,      setIsRemovingBg]      = useState(false);
  const [removeBgError,     setRemoveBgError]     = useState('');

  // Unsaved changes
  const [isDirty, setIsDirty] = useState(false);

  // Canvas refs
  const canvasElRef      = useRef(null);
  const fabricRef        = useRef(null);
  const historyRef       = useRef([]);
  const historyIdxRef    = useRef(-1);
  const isSavingRef      = useRef(false);
  const onChangeRef      = useRef(onChange);
  onChangeRef.current    = onChange;
  const clipboardRef     = useRef(null);
  const initialLoadedRef = useRef(false); // true après le 1er chargement du design sauvegardé

  // Canvas-related state
  const [selectedObject, setSelectedObject] = useState(null); // actual Fabric object
  const [objectVersion,  setObjectVersion]  = useState(0);    // increments to trigger re-render
  const [bgColor,    setBgColor]    = useState(DEFAULT_BG_COLOR);
  const [bgType,     setBgType]     = useState('solid');
  const [bgGradient, setBgGradient] = useState(defaultBgGradient);
  const bgTypeRef     = useRef('solid');
  const bgGradientRef = useRef(null);
  const [canUndo,  setCanUndo]  = useState(false);
  const [canRedo,  setCanRedo]  = useState(false);
  const [isExporting,    setIsExporting]    = useState(false);
  const [exportProgress, setExportProgress] = useState('');
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  // Snap guides & context menu
  const [snapGuides,  setSnapGuides]  = useState([]); // [{ type: 'h'|'v', pos: number }]
  const [contextMenu, setContextMenu] = useState(null); // { x, y }
  const [snapGrid,    setSnapGrid]    = useState(false);
  const snapGridRef = useRef(false);

  // ── Close context menu on outside click ─────────────────────────────────────
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [contextMenu]);

  // ── Zoom du modèle (ajustement, boutons, pincement) ─────────────────────────
  const {
    cssZoom, setCssZoom, cssZoomRef, fitScaleRef, canvasAreaRef, canvasInnerDivRef, handleCanvasTouchStart,
    applyFitZoom, applyZoom, handleCanvasTouchMove, handleCanvasTouchEnd, resetCanvasZoom, zoomIn, zoomOut,
  } = useEditorZoom({
    currentFormat, showPropertiesSheet,
  });

  // ── Dirty tracking ───────────────────────────────────────────────────────────
  function markDirty() {
    if (!isClientMode) return;
    setIsDirty(true);
    onDirtyChange?.(true);
  }

  // ── History ──────────────────────────────────────────────────────────────────
  const {
    saveHistorySnapshot, undo, redo,
  } = useEditorHistory({
    eventCode, defaultBgGradient, currentFormat, storesImages, imagePrefetchTimerRef, fabricRef, historyRef,
    historyIdxRef, isSavingRef, onChangeRef, setSelectedObject, setBgColor, setBgType, setBgGradient,
    bgTypeRef, bgGradientRef, setCanUndo, setCanRedo, markDirty,
  });

  // ── Canvas initialization ────────────────────────────────────────────────────
  useFabricCanvas({
    initialCanvasJson, onReady, defaultBgGradient, currentFormat, currentTemplate, neutralPreviewRef,
    setShowPropertiesSheet, setButtonTextFocus, canvasElRef, fabricRef, historyRef, historyIdxRef,
    isSavingRef, initialLoadedRef, setSelectedObject, setObjectVersion, setBgColor, setBgType, setBgGradient,
    bgTypeRef, bgGradientRef, setCanUndo, setCanRedo, setCssZoom, cssZoomRef, fitScaleRef, canvasAreaRef,
    setSnapGuides, snapGridRef, saveHistorySnapshot, applyFitZoom,
  });

  // ── Aperçu « Personnalisé / neutre » de l'accueil (LAB-296) ─────────────────
  useEffect(() => {
    neutralPreviewRef.current = neutralPreview;
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas._kioskNeutral = kioskKind === 'home' && neutralPreview;
    const active = canvas.getActiveObject();
    if (canvas._kioskNeutral && active) {
      const members = active.type === 'activeSelection' ? active.getObjects() : [active];
      if (members.some((o) => o.personalizedOnly === true)) {
        canvas.discardActiveObject();
        setSelectedObject(null);
      }
    }
    canvas.requestRenderAll();
  }, [neutralPreview, kioskKind, currentFormat.id]);

  // Envoi différé des images (useEditorHistory) : minuterie arrêtée au démontage.
  useEffect(() => () => clearTimeout(imagePrefetchTimerRef.current), []);

  // ── Template selection ───────────────────────────────────────────────────────
  async function handleSelectTemplate(template, format) {
    let tpl = template;
    if (!tpl.canvas_json) {
      try { tpl = await fetchDbTemplateById(tpl.id); }
      catch { return; }
    }
    setPendingChange({ template: tpl, format, currentFormatId: currentFormat.id });
  }
  function confirmReplaceTemplate() {
    if (!pendingChange) return;
    // Un modèle photo ne remplace jamais un écran d'accueil, et inversement.
    if (isHomeFormat(pendingChange.format) !== homeMode) { setPendingChange(null); return; }
    setCurrentFormat(pendingChange.format);
    setCurrentTemplate(pendingChange.template);
    setPendingChange(null);
  }
  function cancelReplaceTemplate() { setPendingChange(null); }

  // ── Objets, fond, images, sorties ────────────────────────────────────────────
  const {
    addObjectToCanvas, addText, addRect, addCircle, addLine, handleImageUpload, addKioskButton,
    addKioskVariable, addKioskSlot, addPhotoZone, deleteSelected, bringForward, sendBackward, bringToFront,
    sendToBack, alignLeft, alignRight, alignTop, alignBottom, centerH, centerV, copyObject, pasteObject,
    duplicateObject, groupSelected, ungroupSelected, toggleLock, toggleSnapGrid, handleObjectChange,
    handleCanvasContextMenu,
  } = useObjectActions({
    currentFormat, homeMode, kioskMode, storesImages, kioskAllowed, setActivePanel, fabricRef, isSavingRef,
    clipboardRef, setSelectedObject, setObjectVersion, setContextMenu, setSnapGrid, snapGridRef,
    saveHistorySnapshot,
  });
  const {
    handleBgColorChange, handleBgTypeChange, handleBgGradientChange, applyAIBackground,
  } = useBackgroundActions({
    currentFormat, setActivePanel, fabricRef, isSavingRef, bgColor, setBgColor, setBgType, bgGradient,
    setBgGradient, bgTypeRef, bgGradientRef, saveHistorySnapshot,
  });
  const {
    addSticker, applyStickerColor, handleRemoveBackground,
  } = useImageActions({
    eventCode, currentFormat, isRemovingBg, setIsRemovingBg, setRemoveBgError, fabricRef, addObjectToCanvas,
    handleObjectChange, removeBackground: REMOVE_BACKGROUND?.run ?? null,
  });
  const {
    handleSaveAllFormats, handleClientSave, handleSaveTemplateClick, handleSubmit, handleExport,
  } = useEditorOutput({
    eventCode, onSubmitSuccess, onSaveTemplate, onSaveRequest, currentFormat, homeMode, storesImages,
    isSubmitting, setIsSubmitting, setSubmitError, setIsSavingTemplate, isSavingClient, setIsSavingClient,
    isDirty, fabricRef, bgTypeRef, bgGradientRef, isExporting, setIsExporting, setExportProgress,
    setExportMenuOpen,
  });

  // ── Raccourcis clavier ──────────────────────────────────────────────────────
  useEditorShortcuts({
    undo, redo, copyObject, pasteObject, duplicateObject, groupSelected, ungroupSelected, resetCanvasZoom,
    zoomIn, zoomOut,
  });

  // ── Wheel zoom (desktop) ─────────────────────────────────────────────────────
  useWheelZoom({
    cssZoomRef, canvasAreaRef, applyZoom,
  });

  // ── Exposition via ref ───────────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    getState: () => {
      if (!fabricRef.current) return null;
      const json = serializeState(fabricRef.current, { bgType: bgTypeRef.current, bgGradient: bgGradientRef.current });
      return { canvasJson: JSON.parse(json), formatId: currentFormat.id };
    },
    // LAB-298 : canvas Fabric pour l'export par parties des écrans de la borne (null avant le montage).
    getCanvas: () => fabricRef.current,
    // LAB-313 : PNG d'envoi d'un cadre (même export que le bouton « Valider »), null avant le montage.
    exportPng: () => (fabricRef.current ? exportAsHighResPNG(fabricRef.current, currentFormat) : null),
    markDirty,
    markClean: () => {
      setIsDirty(false);
      onDirtyChange?.(false);
    },
  }), [currentFormat.id]);

  useEffect(() => {
    if (!isClientMode) return;
    // Le changement de format marque le design comme modifié
    markDirty();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFormat.id]);

  const transparentKioskBg = kioskMode && bgType !== 'gradient' && isTransparentBackground(bgColor);
  const submitText = submitButtonLabels({ isSubmitting, submitLabel, homeMode });

  // Props communes du panneau des propriétés (grand écran et feuille du téléphone).
  const panelProps = {
    selectedObject,
    objectVersion,
    format: currentFormat,
    kioskKind,
    bgColor,
    onBgColorChange: handleBgColorChange,
    bgType,
    bgGradient,
    onBgTypeChange: handleBgTypeChange,
    onBgGradientChange: handleBgGradientChange,
    onObjectChange: handleObjectChange,
    buttonTextFocus,
    onButtonTextFocused: () => setButtonTextFocus(null),
    onCenterH: centerH,
    onCenterV: centerV,
    onToggleLock: toggleLock,
    onStickerColorChange: applyStickerColor,
    onRemoveBackground: aiVisuals && REMOVE_BACKGROUND ? handleRemoveBackground : null,
    isRemovingBackground: isRemovingBg,
    removeBackgroundError: removeBgError,
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <>
    <div className="flex flex-col h-full overflow-hidden bg-editor-workspace">

      <EditorHeader
        onSaveTemplate={onSaveTemplate} onHistoryOpen={onHistoryOpen} onEditAnswers={onEditAnswers}
        onSubmitRequest={onSubmitRequest} isClientMode={isClientMode} currentFormat={currentFormat}
        kioskMode={kioskMode} kioskKind={kioskKind} neutralPreview={neutralPreview}
        setNeutralPreview={setNeutralPreview} activePanel={activePanel} setActivePanel={setActivePanel}
        isSubmitting={isSubmitting} setShowSubmitConfirm={setShowSubmitConfirm}
        isSavingTemplate={isSavingTemplate} isSavingClient={isSavingClient}
        setShowBatchImport={setShowBatchImport} isDirty={isDirty} canUndo={canUndo} canRedo={canRedo}
        isExporting={isExporting} exportProgress={exportProgress} exportMenuOpen={exportMenuOpen}
        setExportMenuOpen={setExportMenuOpen} snapGrid={snapGrid} undo={undo} redo={redo}
        handleClientSave={handleClientSave} handleSaveTemplateClick={handleSaveTemplateClick}
        toggleSnapGrid={toggleSnapGrid} handleExport={handleExport} submitText={submitText}
      />

      {/* ── Body ── */}
      {/* pb-[58px] réserve de l'espace pour la Toolbar fixe en bas sur mobile */}
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden pb-[58px] md:pb-0">

        <Toolbar
          activePanel={activePanel}
          onToggleTemplates={() => setActivePanel(activePanel === 'templates' ? null : 'templates')}
          onToggleStickers={() => setActivePanel(activePanel === 'stickers' ? null : 'stickers')}
          onToggleAIBackground={() => setActivePanel(activePanel === 'ai-background' ? null : 'ai-background')}
          showAIBackground={!isClientMode && aiVisuals && !kioskMode && !!AIBackgroundPanel}
          onAddPhotoZone={addPhotoZone}
          showPhotoZone={!homeMode && !kioskMode}
          showTemplates={!kioskMode}
          adminMode={!isClientMode}
          kioskKind={kioskKind}
          onAddKioskButton={addKioskButton}
          onAddKioskVariable={addKioskVariable}
          onAddKioskSlot={addKioskSlot}
          onAddText={addText}
          onAddRect={addRect}
          onAddCircle={addCircle}
          onAddLine={addLine}
          onUploadImage={handleImageUpload}
          onDeleteSelected={deleteSelected}
          onBringForward={bringForward}
          onSendBackward={sendBackward}
          onCenterH={centerH}
          onCenterV={centerV}
          onDuplicate={duplicateObject}
          onGroup={groupSelected}
          onUngroup={ungroupSelected}
          onToggleLock={toggleLock}
          snapGrid={snapGrid}
          onToggleSnapGrid={toggleSnapGrid}
          hasSelection={!!selectedObject}
          isLocked={!!selectedObject?.locked}
          hasMultiSelection={selectedObject?.type === 'activeSelection'}
          selectionIsGroup={selectedObject?.type === 'group'}
        />

        {activePanel === 'templates' && (
          <TemplatesSidebar
            currentFormat={currentFormat}
            onSelectTemplate={handleSelectTemplate}
            onClose={() => setActivePanel(null)}
            adminMode={!isClientMode}
          />
        )}

        {activePanel === 'stickers' && (
          <StickerPanel
            decorations={decorations}
            onAddSticker={addSticker}
            onClose={() => setActivePanel(null)}
          />
        )}

        {activePanel === 'ai-background' && !isClientMode && aiVisuals && AIBackgroundPanel && (
          <Suspense fallback={null}>
            <AIBackgroundPanel
              formatId={currentFormat.id}
              onApply={applyAIBackground}
              onSaveAllFormats={onSaveTemplate ? handleSaveAllFormats : null}
              onClose={() => setActivePanel(null)}
            />
          </Suspense>
        )}

        <CanvasStage
          formatBleedOverrides={formatBleedOverrides} currentFormat={currentFormat}
          currentTemplate={currentTemplate} homeMode={homeMode} kioskMode={kioskMode}
          canvasElRef={canvasElRef} cssZoom={cssZoom} canvasAreaRef={canvasAreaRef}
          canvasInnerDivRef={canvasInnerDivRef} snapGuides={snapGuides}
          handleCanvasContextMenu={handleCanvasContextMenu} handleCanvasTouchStart={handleCanvasTouchStart}
          handleCanvasTouchMove={handleCanvasTouchMove} handleCanvasTouchEnd={handleCanvasTouchEnd}
          transparentKioskBg={transparentKioskBg}
        />

        {/* Desktop : panneau latéral */}
        <div className="hidden md:contents">
          <PropertiesPanel {...panelProps} />
        </div>

      </div>

      {/* Status bar — cachée sur mobile (remplacée par la Toolbar fixe) */}
      <EditorStatusBar
        currentFormat={currentFormat} selectedObject={selectedObject} cssZoom={cssZoom}
        resetCanvasZoom={resetCanvasZoom} zoomIn={zoomIn} zoomOut={zoomOut}
        fitScale={fitScaleRef.current}
      />

      {/* Barre de zoom mobile (masquée sous un panneau plein écran, LAB-353) */}
      <MobileZoomBar
        activePanel={activePanel} cssZoom={cssZoom} resetCanvasZoom={resetCanvasZoom} zoomIn={zoomIn}
        zoomOut={zoomOut}
        fitScale={fitScaleRef.current}
      />

      {/* Welcome card — première visite client */}
      {showWelcome && (
        <WelcomeCard homeMode={homeMode} submitWord={submitButtonLabels({ submitLabel, homeMode }).short} onClose={() => setShowWelcome(false)} />
      )}

      {/* Modales */}
      <ConfirmModal
        pending={pendingChange}
        onConfirm={confirmReplaceTemplate}
        onCancel={cancelReplaceTemplate}
        adminMode={!isClientMode}
      />

      {/* Confirmation d'envoi (client) : pas de fermeture pendant l'envoi */}
      <SubmitConfirmDialog
        homeMode={homeMode} isSubmitting={isSubmitting} submitError={submitError}
        setSubmitError={setSubmitError} showSubmitConfirm={showSubmitConfirm}
        setShowSubmitConfirm={setShowSubmitConfirm} handleSubmit={handleSubmit}
      />

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          pos={contextMenu}
          onClose={() => setContextMenu(null)}
          actions={{
            onCopy:        copyObject,
            onPaste:       pasteObject,
            hasPaste:      !!clipboardRef.current,
            isPhotoZone:   !!selectedObject?.isPhotoZone,
            onDuplicate:   duplicateObject,
            onToggleLock:  toggleLock,
            isLocked:      !!selectedObject?.locked,
            onBringToFront: bringToFront,
            onBringForward: bringForward,
            onSendBackward: sendBackward,
            onSendToBack:   sendToBack,
            onAlignLeft:    alignLeft,
            onAlignCenterH: centerH,
            onAlignRight:   alignRight,
            onAlignTop:     alignTop,
            onAlignCenterV: centerV,
            onAlignBottom:  alignBottom,
            onDelete:       deleteSelected,
          }}
        />
      )}
    </div>

      {/* ── Mobile : toolbar flottante + bottom sheet propriétés ──────────────────
           Placés EN DEHORS de tous les divs overflow-hidden pour éviter le clipping
           iOS Safari qui affecte position:fixed à l'intérieur de overflow:hidden ── */}
      {/* Pas de barre d'édition par-dessus un panneau plein écran (LAB-353) */}
      <FloatingObjectToolbar
        obj={activePanel ? null : selectedObject}
        version={objectVersion}
        cssZoom={cssZoom}
        canvasDivRef={canvasInnerDivRef}
        onDelete={deleteSelected}
        onDuplicate={duplicateObject}
        onToggleLock={toggleLock}
        onOpenProperties={() => setShowPropertiesSheet(true)}
      />

      {showPropertiesSheet && selectedObject && (
        <MobilePropertiesSheet onClose={() => setShowPropertiesSheet(false)}>
          <PropertiesPanel {...panelProps} mobile />
        </MobilePropertiesSheet>
      )}

      {showBatchImport && (
        <BatchImportModal onClose={() => setShowBatchImport(false)} />
      )}

    </>
  );
});

export default Editor;