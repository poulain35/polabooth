// Écrans de la borne composés par l'admin (LAB-298) : accueil et partage, communs à tous les
// événements de l'organisation. Les deux cartes : onglet Écrans de /admin/bornes ; /admin/ecrans-borne/:kind :
// l'éditeur (format kiosk_home / kiosk_result), ?publier=1 publie dès que l'écran est chargé.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Loader2, OctagonX, RefreshCw, Upload } from 'lucide-react';
import { toast } from 'sonner';
import Editor from '../../components/Editor';
import KioskScreenPreviewButton from '../../components/admin/KioskScreenPreviewButton';
import UnsavedChangesModal from '../../components/UnsavedChangesModal';
import { Button } from '../../components/ui/button';
import { Card, CardTitle } from '../../components/ui/card';
import { StatusPill } from '../../components/ui/status-pill';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '../../components/ui/dialog';
import { useFeatures } from '../../hooks/useFeatures';
import {
  fetchCustomFonts, fetchScreenFonts, getKioskScreen, getKioskScreensContext, kioskScreenPreviewUrl, publishKioskScreen,
  saveKioskScreenDraft, unpublishKioskScreen,
} from '../../lib/supabase';
import { SCREEN_KINDS, buildScreenLayoutFromState } from '../../lib/kioskScreenLayout';
import {
  SCREEN_TITLES, fontFetchWarning, nextScreenVersion, screenAssetNames, screenStatus, withoutFonts,
} from '../../lib/kioskScreensPublish';
import { kioskScreenTemplateJson } from '../../lib/kioskScreenTemplates';
import { userErrorMessage } from '../../lib/networkError';
import { kioskFormatByKind } from '../../utils/formats';
import { exportScreenParts, exportScreenPreview } from '../../utils/export';
import { BackLink } from '../../components/admin/AdminPage';
import { Notice } from '../../components/admin/CardParts';
import { Spinner } from '../../components/ui/spinner';

const SCREEN_HELP = {
  home: 'Premier écran vu par les invités : bouton pour commencer, galerie, nom de l’événement.',
  result: 'Après la prise de vue : aperçu de la photo, impression, QR code, email, Terminer.',
};

// Fond crème sous les aperçus : un écran au fond transparent ne sort pas noir.
const PREVIEW_BACKDROP = '#F7F1E7';

// Toasts de l'éditeur en bas : en haut à droite, ils cachaient Vérifier et Publier (LAB-317).
const EDITOR_TOAST = { position: 'bottom-center' };
const CHECKS_DELAY_MS = 300;

/** Logo de la société avec sa taille naturelle (pour le modèle d'origine de l'accueil), ou null. */
function loadLogo(url) {
  return new Promise((resolve) => {
    if (!url) { resolve(null); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve({ url, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function useKioskScreensContext() {
  const [ctx, setCtx] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    getKioskScreensContext()
      .then((c) => { if (active) setCtx(c); })
      .catch((err) => { if (active) setError(userErrorMessage(err, 'Lecture des écrans impossible.')); });
    return () => { active = false; };
  }, []);
  const setRow = useCallback((kind, row) => {
    setCtx((c) => (c ? { ...c, screens: { ...c.screens, [kind]: row } } : c));
  }, []);
  return { ctx, error, setRow };
}

export default function AdminKioskScreens() {
  const { kind } = useParams();
  if (kind !== undefined) {
    return SCREEN_KINDS.includes(kind) ? <ScreenEditorView key={kind} kind={kind} /> : <UnknownScreen />;
  }
  return <ScreenCards />;
}

function UnknownScreen() {
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <Notice tone="red" role="alert">Écran inconnu.</Notice>
      <Link to="/admin/bornes?tab=ecrans" className="inline-block mt-4 text-sm text-primary hover:underline">Écrans de la borne</Link>
    </div>
  );
}

// ── Cartes ───────────────────────────────────────────────────────────────────────────────────

// Onglet Écrans de la page Bornes (/admin/bornes?tab=ecrans, LAB-335) : titre et onglets dans AdminBornes.
export function ScreenCards() {
  const { ctx, error, setRow } = useKioskScreensContext();
  const [confirm, setConfirm] = useState(null); // kind à dépublier
  const [busy, setBusy] = useState(false);

  async function unpublish() {
    const row = ctx?.screens?.[confirm];
    if (!row) return;
    setBusy(true);
    try {
      setRow(confirm, await unpublishKioskScreen(row.id));
      toast.success(`Écran ${SCREEN_TITLES[confirm].toLowerCase()} dépublié : les bornes reviendront à l’écran standard à leur prochaine synchro.`);
      setConfirm(null);
    } catch (err) {
      toast.error(userErrorMessage(err, 'Dépublication impossible.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[13px] text-muted-foreground">
        Composez l’accueil et l’écran de partage de vos bornes, pour tous vos événements. Le brouillon ne
        change rien sur les bornes : elles affichent la version publiée à leur prochaine synchro. Sans écran
        publié, elles gardent l’écran standard.
      </p>

      {error ? (
        <Notice tone="red" role="alert">{error}</Notice>
      ) : !ctx ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2">
          {SCREEN_KINDS.map((k) => (
            <ScreenCard key={k} kind={k} orgId={ctx.orgId} row={ctx.screens[k]} onUnpublish={() => setConfirm(k)} />
          ))}
        </div>
      )}

      {confirm && (
        <Dialog open onOpenChange={(open) => { if (!open && !busy) setConfirm(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Dépublier l’écran {SCREEN_TITLES[confirm].toLowerCase()} ?</DialogTitle>
              <DialogDescription>
                Les bornes reviendront à l’écran standard à leur prochaine synchro. Le brouillon est gardé : vous
                pourrez le publier à nouveau.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-3 sm:gap-3">
              <Button variant="outline" onClick={() => setConfirm(null)} disabled={busy}>Annuler</Button>
              <Button variant="destructive" onClick={unpublish} disabled={busy}>
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                Dépublier
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function ScreenCard({ kind, orgId, row, onUnpublish }) {
  const navigate = useNavigate();
  const status = screenStatus(row);
  const [previewFailed, setPreviewFailed] = useState(false);
  const previewUrl = row?.draft_updated_at
    ? `${kioskScreenPreviewUrl(orgId, kind)}?t=${encodeURIComponent(row.draft_updated_at)}`
    : null;

  return (
    <Card className="flex min-w-0 flex-col overflow-hidden">
      <div className="light-island aspect-video flex items-center justify-center" style={{ background: PREVIEW_BACKDROP }}>
        {previewUrl && !previewFailed ? (
          <img
            src={previewUrl}
            alt={`Aperçu de l’écran ${SCREEN_TITLES[kind].toLowerCase()}`}
            className="w-full h-full object-contain"
            onError={() => setPreviewFailed(true)}
          />
        ) : (
          <p className="text-sm text-muted-foreground px-6 text-center">
            {row?.draft_json ? 'Aperçu indisponible' : 'Modèle d’origine : ouvrez l’écran pour le composer.'}
          </p>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-4 p-card">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <CardTitle as="h2">{SCREEN_TITLES[kind]}</CardTitle>
            <StatusPill tone={status.published ? 'green' : 'gray'}>{status.label}</StatusPill>
          </div>
          <p className="mt-1 text-[13px] text-muted-foreground">{SCREEN_HELP[kind]}</p>
          {status.unpublishedChanges && (
            <p className="mt-1.5 text-xs text-state-amber-fg">Modifications enregistrées, pas encore publiées.</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap mt-auto">
          <Button size="sm" variant="outline" onClick={() => navigate(`/admin/ecrans-borne/${kind}`)}>Modifier</Button>
          <KioskScreenPreviewButton kind={kind} row={row} />
          <Button size="sm" onClick={() => navigate(`/admin/ecrans-borne/${kind}?publier=1`)}>
            <Upload className="w-4 h-4" />
            Publier
          </Button>
          {status.published && (
            <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={onUnpublish}>
              Dépublier
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── Éditeur ──────────────────────────────────────────────────────────────────────────────────

function ScreenChecks({ checks }) {
  if (!checks) return null;
  const { blocking, warnings } = checks;
  if (!blocking.length && !warnings.length) {
    return (
      <div className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-state-green text-state-green-fg text-xs border-b border-border shrink-0">
        <CheckCircle2 className="w-4 h-4 shrink-0" />
        Aucun problème détecté : l’écran peut être publié.
      </div>
    );
  }
  return (
    <div className="max-h-36 overflow-auto border-b border-border shrink-0 text-xs">
      {blocking.length > 0 && (
        <div className="px-3 sm:px-4 py-2 bg-state-red text-state-red-fg">
          <p className="flex items-center gap-2 font-medium">
            <OctagonX className="w-4 h-4 shrink-0" />
            Publication impossible tant que ces points ne sont pas corrigés (le brouillon peut être enregistré) :
          </p>
          <ul className="mt-1 ml-6 list-disc space-y-0.5">
            {blocking.map((c, i) => <li key={`${c.code}-${i}`}>{c.message}</li>)}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="px-3 sm:px-4 py-2 bg-state-amber text-state-amber-fg">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            À vérifier (la publication reste possible) :
          </p>
          <ul className="mt-1 ml-6 list-disc space-y-0.5">
            {warnings.map((c, i) => <li key={`${c.code}-${i}`}>{c.message}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function ScreenEditorView({ kind }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAvailable } = useFeatures();
  const { ctx, error, setRow } = useKioskScreensContext();
  const format = kioskFormatByKind(kind);
  const editorRef = useRef(null);
  const [initialJson, setInitialJson] = useState(null);
  const [checks, setChecks] = useState(null);
  const [publishing, setPublishing] = useState(false);

  // L'éditeur garde ses rappels du premier rendu : ils lisent l'état courant dans des refs.
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const autoPublishRef = useRef(searchParams.get('publier') === '1');

  // Garde « modifications non enregistrées » : contenu comparé à celui du dernier enregistrement
  // (une annulation qui revient au point de départ ne bloque pas la sortie).
  const baselineRef = useRef(null);
  const changedRef = useRef(false);
  // Images importées vues pendant la séance : gardées au nettoyage (une annulation peut les rappeler).
  const sessionAssetsRef = useRef(new Set());
  const checksTimerRef = useRef(null);
  // Polices importées : leur fichier part avec les textes vivants (TTF/OTF) ou un avertissement (WOFF).
  const customFontsRef = useRef([]);
  useEffect(() => {
    fetchCustomFonts().then((fonts) => { customFontsRef.current = fonts; }).catch(() => {});
  }, []);

  // Contenu de départ : le brouillon, sinon le modèle d'origine (accueil : nom ou logo de la société).
  useEffect(() => {
    if (!ctx || initialJson) return;
    const row = ctx.screens[kind];
    if (row?.draft_json) {
      setInitialJson(JSON.stringify(row.draft_json));
      return;
    }
    let active = true;
    (kind === 'home' ? loadLogo(ctx.logoUrl) : Promise.resolve(null)).then((logo) => {
      if (active) setInitialJson(kioskScreenTemplateJson(kind, { brandName: ctx.brandName, logo }));
    });
    return () => { active = false; };
  }, [ctx, kind, initialJson]);

  /** État courant de l'éditeur, sélection relâchée (sinon les coordonnées sont relatives à elle). */
  function currentState() {
    const canvas = editorRef.current?.getCanvas();
    if (!canvas) return null;
    canvas.discardActiveObject();
    canvas.renderAll();
    return { canvas, state: editorRef.current.getState()?.canvasJson ?? null };
  }

  function editorState() {
    return editorRef.current?.getState()?.canvasJson ?? null;
  }

  function rememberSaved(state, savedDraft = null) {
    baselineRef.current = JSON.stringify(state);
    changedRef.current = false;
    for (const name of screenAssetNames(savedDraft ?? state)) sessionAssetsRef.current.add(name);
  }

  function isDirtyNow() {
    if (!changedRef.current || baselineRef.current === null) return false;
    const state = editorState();
    return state !== null && JSON.stringify(state) !== baselineRef.current;
  }

  function runChecks(state) {
    const row = ctxRef.current?.screens?.[kind];
    const result = buildScreenLayoutFromState(state, kind, {
      version: nextScreenVersion(row), canvasWidth: format.canvasWidth, customFonts: customFontsRef.current,
    });
    setChecks({ blocking: result.blocking, warnings: result.warnings });
    return result;
  }

  function verify() {
    const cur = currentState();
    if (cur?.state) runChecks(cur.state);
  }

  // Contenu modifié, annulé ou rétabli : contrôles relancés peu après, sans relâcher la sélection.
  function handleChange() {
    changedRef.current = true;
    clearTimeout(checksTimerRef.current);
    checksTimerRef.current = setTimeout(() => {
      const state = editorState();
      if (state) runChecks(state);
    }, CHECKS_DELAY_MS);
  }
  useEffect(() => () => clearTimeout(checksTimerRef.current), []);

  async function saveDraft() {
    const cur = currentState();
    const c = ctxRef.current;
    if (!cur?.state || !c) return false;
    runChecks(cur.state);
    try {
      const saved = await saveKioskScreenDraft(c.orgId, kind, cur.state, {
        previewDataUrl: exportScreenPreview(cur.canvas, format),
        keepAssets: [...sessionAssetsRef.current],
      });
      setRow(kind, saved);
      rememberSaved(cur.state, saved.draft_json);
      toast.success('Brouillon enregistré : rien ne change sur les bornes tant que vous ne publiez pas.', EDITOR_TOAST);
      return true;
    } catch (err) {
      toast.error(userErrorMessage(err, 'Enregistrement du brouillon impossible.'), EDITOR_TOAST);
      return false;
    }
  }

  // Le numéro réservé par une publication échouée est perdu : relire la ligne, sinon la suivante
  // se croirait devancée (« publié ailleurs »).
  async function reloadRow() {
    const c = ctxRef.current;
    if (!c) return;
    try {
      setRow(kind, await getKioskScreen(c.orgId, kind));
    } catch (err) {
      console.warn('Relecture de l’écran impossible :', err?.message ?? err);
    }
  }

  async function publish() {
    const cur = currentState();
    const c = ctxRef.current;
    if (!cur?.state || !c || publishing) return false;
    const row = c.screens[kind];
    try { customFontsRef.current = await fetchCustomFonts(); } catch (_) { /* polices importées vues comme Google */ }
    const { blocking, parts, ...checked } = runChecks(cur.state);
    let { layout, warnings } = checked;
    if (blocking.length) {
      toast.error('Publication impossible : corrigez les points signalés en haut de l’éditeur.', EDITOR_TOAST);
      return false;
    }
    let images;
    let previewDataUrl;
    try {
      images = exportScreenParts(cur.canvas, format, parts);
      previewDataUrl = exportScreenPreview(cur.canvas, format);
    } catch (err) {
      console.error(err);
      toast.error('Export de l’écran impossible : une image ne se laisse pas exporter. Retirez-la, puis réessayez.', EDITOR_TOAST);
      return false;
    }
    setPublishing(true);
    try {
      // Police introuvable : publiée quand même, ses textes en DM Sans (comme la borne sans le fichier).
      const { files: fonts, failed } = await fetchScreenFonts(parts.fonts);
      if (failed.length) {
        layout = withoutFonts(layout, failed.map((f) => f.name));
        warnings = [...warnings, ...failed.map(fontFetchWarning)];
        setChecks({ blocking, warnings });
      }
      const saved = await publishKioskScreen({
        orgId: c.orgId, kind, row, state: cur.state, layout, images, fonts, previewDataUrl,
        keepAssets: [...sessionAssetsRef.current],
      });
      setRow(kind, saved);
      rememberSaved(cur.state, saved.draft_json);
      toast.success(
        `Écran ${SCREEN_TITLES[kind].toLowerCase()} publié (v${saved.published_version}) : les bornes l’afficheront à leur prochaine synchro.`,
        warnings.length
          ? { ...EDITOR_TOAST, description: `${warnings.length} point${warnings.length > 1 ? 's' : ''} à vérifier, voir en haut de l’éditeur.` }
          : EDITOR_TOAST,
      );
      return true;
    } catch (err) {
      toast.error(userErrorMessage(err, 'Publication impossible.'), EDITOR_TOAST);
      await reloadRow();
      return false;
    } finally {
      setPublishing(false);
    }
  }

  // Écran chargé (polices prêtes) : contrôles affichés, puis publication demandée depuis la carte.
  async function handleReady() {
    const cur = currentState();
    if (!cur?.state) return;
    rememberSaved(cur.state);
    if (!autoPublishRef.current) {
      runChecks(cur.state);
      return;
    }
    autoPublishRef.current = false;
    setSearchParams({}, { replace: true });
    if (await publish()) navigate('/admin/bornes?tab=ecrans');
  }
  const readyRef = useRef(handleReady);
  readyRef.current = handleReady;
  const onReady = useCallback(() => readyRef.current(), []);
  const saveRef = useRef(saveDraft);
  saveRef.current = saveDraft;
  const onSaveTemplate = useCallback(() => saveRef.current(), []);
  const changeRef = useRef(handleChange);
  changeRef.current = handleChange;
  const onChange = useCallback(() => changeRef.current(), []);

  // Menu, bouton retour, historique du navigateur : confirmation si le contenu a changé.
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    currentLocation.pathname !== nextLocation.pathname && isDirtyNow());
  // Onglet fermé ou rechargé : alerte du navigateur.
  useEffect(() => {
    const handler = (e) => {
      if (!isDirtyNow()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveAndLeave() {
    if (await saveDraft()) blocker.proceed?.();
    else blocker.reset?.();
  }

  const status = screenStatus(ctx?.screens?.[kind]);

  if (error) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <Notice tone="red" role="alert">{error}</Notice>
      </div>
    );
  }
  if (!ctx || !initialJson) {
    return (
      <div className="light-island min-h-screen flex items-center justify-center bg-background">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="light-island flex flex-col h-full relative bg-background text-foreground">
      {/* ── Barre du haut ── */}
      <div className="flex items-center gap-2 sm:gap-3 flex-wrap px-3 sm:px-4 py-2.5 bg-card border-b border-border shrink-0 min-h-[52px]">
        <BackLink to="/admin/bornes?tab=ecrans" className="shrink-0">Écrans de la borne</BackLink>
        <span className="text-border shrink-0">/</span>
        <span className="text-foreground text-sm font-medium">{SCREEN_TITLES[kind]}</span>
        <StatusPill tone={status.published ? 'green' : 'gray'}>{status.label}</StatusPill>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={verify} disabled={publishing}>
            <RefreshCw className="w-4 h-4" />
            Vérifier
          </Button>
          <Button size="sm" onClick={publish} disabled={publishing}>
            {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Publier
          </Button>
        </div>
      </div>

      <ScreenChecks checks={checks} />

      {/* ── Éditeur ── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <Editor
          ref={editorRef}
          key={kind}
          initialFormat={format}
          initialCanvasJson={initialJson}
          onSaveTemplate={onSaveTemplate}
          onReady={onReady}
          onChange={onChange}
          aiVisuals={isAvailable('ai_visuals')}
        />
      </div>

      {blocker.state === 'blocked' && (
        <UnsavedChangesModal
          onSave={saveAndLeave}
          onLeave={() => blocker.proceed()}
          onCancel={() => blocker.reset()}
        />
      )}

      {publishing && (
        <div className="absolute inset-0 z-[80] bg-black/30 flex items-center justify-center">
          <div role="status" className="bg-card rounded-dialog shadow-float px-6 py-5 flex items-center gap-3 text-sm font-medium text-foreground">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
            Publication de l’écran sur les bornes…
          </div>
        </div>
      )}
    </div>
  );
}
