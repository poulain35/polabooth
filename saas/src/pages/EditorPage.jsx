import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useBlocker } from 'react-router-dom';
import {
  supabase,
  getEventByCode, getGlobalFormConfig, getEventFormEnabled,
  autosaveDesign,
  getFormatBleed, setEventName, getPublicFeatures, submitDesign, deleteDesignFrame, storeDesignImages,
} from '../lib/supabase';
import { FEATURE_UNAVAILABLE_MESSAGE, hasPublicFeature, isFeatureDisabledError } from '../features/featureGate';
import Editor from '../components/Editor';
import ClientForm from '../components/ClientForm';
import ClientFrameBar, { FramesSendModal } from '../components/ClientFrameBar';
import { FORMATS, HOME_FORMAT, formatById } from '../utils/formats';
import { HOME_LOCKED_MESSAGE, PRINT_LOCKED_MESSAGE, designTabView, formatAllowedForKind } from '../lib/designKind';
import { SAVE_RETRY_MESSAGE } from '../lib/saveQueue';
import { userErrorMessage } from '../lib/networkError';
import { clientFormNeeded } from '../lib/clientFormStep';
import {
  canAddFrame, canDeleteFrame, clampFrameLabel, designKey, editorFrameChoice, frameDisplayName, frameDraft,
  frameFormatChoices, frameLabelForRequest, framesToSubmit, initialFrames, newFrame, nextFrameSlot,
  parseDesignKey, slotAfterDelete,
} from '../lib/clientDesignFrames';
import UnsavedChangesModal from '../components/UnsavedChangesModal';
import { useClientEditorScope } from '../components/public/clientEditorStyles';
import DesignTabs from './editor/DesignTabs';
import { DesignStatusPanel, SuccessIcon } from './editor/DesignStatusPanel';
import FormatPicker from './editor/FormatPicker';
import HistoryPanel from './editor/HistoryPanel';
import EventNameStep from './editor/EventNameStep';
import { Spinner } from '../components/ui/spinner';

// ── EditorPage ────────────────────────────────────────────────────────────────

const EMPTY_DRAFT = { key: 0, json: null, format: null };

export default function EditorPage() {
  const { code }   = useParams();
  const navigate   = useNavigate();
  useClientEditorScope();

  const [state,           setState]          = useState('loading');
  const [event,           setEvent]          = useState(null);
  const [existingDesign,  setExistingDesign] = useState(null);
  const [globalForm,      setGlobalForm]     = useState(null);
  const [prevFormAnswers, setPrevFormAnswers]= useState(null);
  const [errorMsg,        setErrorMsg]       = useState('');
  const [chosenFormat,    setChosenFormat]   = useState(null);
  const [isAdmin,         setIsAdmin]        = useState(false);
  const [publicFeatures,  setPublicFeatures] = useState(null);

  // Écran d'accueil de la borne (LAB-289) : onglet affiché seulement si l'événement l'ouvre
  const [homeEditor, setHomeEditor] = useState(false);
  const [homeDesign, setHomeDesign] = useState(null);
  const [activeKind, setActiveKind] = useState('print');

  // Zones perdues (bleed) — chargées depuis l'org
  const [formatBleedOverrides, setFormatBleedOverrides] = useState({});

  // Plusieurs cadres (LAB-313) : seulement si get-event renvoie frame_choice.enabled et frames
  const [frameChoice, setFrameChoice] = useState({ enabled: false, max_frames: 1 });
  const [frames,      setFrames]      = useState([]);
  const [activeSlot,  setActiveSlot]  = useState(1);
  const [addingFrame, setAddingFrame] = useState(false);
  const [sendState,   setSendState]   = useState(null);
  const frameMode = frameChoice.enabled;

  // Sauvegarde / historique (un état par design, clé designKey : 'print:n' ou 'home' ;
  // l'éditeur inactif est démonté)
  const [dirty,       setDirty]       = useState({});
  const [isSaving,    setIsSaving]    = useState(false);
  // Nouvel essai ou échec de la sauvegarde (LAB-323) : { tone: 'warning' | 'error', message }
  const [saveNotice,  setSaveNotice]  = useState(null);
  // Nombre de modifications par design : une modification faite pendant l'envoi garde l'état « modifié ».
  const editRevRef = useRef({});
  const [showHistory, setShowHistory] = useState(false);
  const isDirty = Object.values(dirty).some(Boolean);

  // Contenu de départ de chaque éditeur : key force le remontage (restauration d'une version)
  const [drafts, setDrafts] = useState({ 'print:1': EMPTY_DRAFT, home: EMPTY_DRAFT });

  // Ref vers Editor pour récupérer son état courant
  const editorRef = useRef(null);
  // Envoi groupé des cadres : éditeur attendu ({ key, resolve }) et dernier éditeur prêt
  const readyRef = useRef(null);
  const lastReadyKeyRef = useRef(null);

  const currentKind = homeEditor ? activeKind : 'print';
  const activeKey = designKey(currentKind, frameMode && currentKind === 'print' ? activeSlot : 1);

  // Callback "sauvegarder et quitter" (pour le garde de navigation)
  const saveAndProceedRef = useRef(null);

  // ── Chargement ──────────────────────────────────────────────────────────────

  useEffect(() => {
    getFormatBleed().then(setFormatBleedOverrides).catch(() => {});
  }, []);

  // Formulaire de l'événement (null s'il n'en a pas) : gardé pour « Modifier mes réponses ».
  async function loadClientForm() {
    const eventFormEnabled = await getEventFormEnabled(code).catch(() => false);
    if (!eventFormEnabled) return null;
    const cfg = await getGlobalFormConfig().catch(() => null);
    if (cfg?.questions?.length) setGlobalForm(cfg);
    return cfg ?? {};
  }

  async function proceedToEditor(evt, design, admin = false, answers = prevFormAnswers) {
    // L'admin qui vérifie va directement à l'éditeur (pas de formulaire ni choix de format)
    if (admin) { setState('ready'); return; }

    const cfg = await loadClientForm();
    // Déjà rempli (réponses obligatoires présentes) : pas redemandé à chaque visite (LAB-354).
    if (cfg && clientFormNeeded({ enabled: true, questions: cfg.questions, answers })) { setState('form'); return; }
    const allowedFmts = evt?.allowed_formats ?? ['portrait', 'landscape', 'stripV', 'stripH'];
    if (!design && allowedFmts.length > 1) setState('format');
    else setState('ready');
  }

  useEffect(() => {
    let admin = false;
    supabase.auth.getSession()
      .then(({ data }) => { admin = !!data.session; setIsAdmin(admin); })
      .catch(() => {})
      .then(() => Promise.all([getEventByCode(code), getPublicFeatures(code)]))
      .then(async ([response, features]) => {
        const { event: evt, design, form_answers, home_editor, home_design } = response;
        // Design par le client désactivé pour l'organisation (fonctionnalité client_design).
        if (!hasPublicFeature(features, 'client_design')) { setState('unavailable'); return; }
        setPublicFeatures(features);
        // Le client voit l'écran "soumis" — l'admin connecté accède à l'éditeur pour vérifier.
        // Avec l'onglet écran d'accueil, le modèle photo soumis s'affiche dans son onglet seulement.
        // Un cadre unique validé s'affiche en lecture seule dans l'éditeur (LAB-294).
        const choice = editorFrameChoice(response);
        const printPending = evt.status === 'submitted' && !admin;
        const printLocked = !choice.enabled && design?.status === 'approved';
        if (printPending && !home_editor && !printLocked) { setState('submitted'); return; }
        setEvent(evt);
        setExistingDesign(design);
        setHomeEditor(Boolean(home_editor));
        setHomeDesign(home_design ?? null);
        setFrameChoice(choice);
        const printDrafts = { 'print:1': { ...EMPTY_DRAFT, json: design?.canvas_json ?? null } };
        if (choice.enabled) {
          setFrames(initialFrames(response.frames));
          for (const f of response.frames) printDrafts[designKey('print', f.slot)] = frameDraft(f, FORMATS);
        }
        setDrafts({ ...printDrafts, home: { ...EMPTY_DRAFT, json: home_design?.canvas_json ?? null } });
        if (form_answers) setPrevFormAnswers(form_answers);
        if (printPending) { loadClientForm().catch(() => {}); setState('ready'); return; }

        if (!evt.name?.trim() && !admin) { setState('collect_name'); return; }

        await proceedToEditor(evt, design, admin && !!design, form_answers ?? null);
      })
      .catch((err) => {
        if (isFeatureDisabledError(err)) { setState('unavailable'); return; }
        setErrorMsg(err.message ?? 'Code invalide'); setState('error');
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // ── Navigation guard (in-app) ────────────────────────────────────────────────

  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    isDirty && currentLocation.pathname !== nextLocation.pathname
  );

  // ── Navigation guard (browser close / refresh) ───────────────────────────────

  useEffect(() => {
    const handler = (e) => {
      if (!isDirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // ── Vue de chaque onglet ─────────────────────────────────────────────────────

  // Avec plusieurs cadres, l'onglet modèle photo suit events.status (comme avant) et un cadre
  // validé n'est plus modifiable par le client (il reste sur la borne).
  function designView(kind, slot = 1) {
    if (kind === 'print' && frameMode) {
      const view = designTabView({ kind, designStatus: null, eventStatus: event?.status, isAdmin });
      if (view !== 'editor') return view;
      const frame = frames.find((f) => f.slot === slot);
      // Validé : lecture seule pour tous, admin compris (le serveur refuse l'écriture, LAB-294).
      return frame?.status === 'approved' ? 'frameLocked' : 'editor';
    }
    return designTabView({
      kind,
      designStatus: kind === 'home' ? homeDesign?.status : existingDesign?.status,
      eventStatus:  event?.status,
      isAdmin,
    });
  }

  function keyWritable(key) {
    const { kind, slot } = parseDesignKey(key);
    if (kind === 'print' && frameMode && slot > frameChoice.max_frames) return false;
    return designView(kind, slot) === 'editor';
  }

  function setKeyDirty(key, value) {
    if (value) editRevRef.current[key] = (editRevRef.current[key] ?? 0) + 1;
    setDirty((prev) => (Boolean(prev[key]) === value ? prev : { ...prev, [key]: value }));
  }

  // Garde le travail de l'éditeur quitté (non sauvegardé) pour le retrouver au retour.
  function stashDraft(key) {
    const current = editorRef.current?.getState();
    if (!current) return;
    setDrafts((d) => ({
      ...d,
      [key]: { ...(d[key] ?? EMPTY_DRAFT), json: current.canvasJson, format: formatById(current.formatId) },
    }));
  }

  function switchTab(kind) {
    if (kind === activeKind) return;
    stashDraft(activeKey);
    lastReadyKeyRef.current = null;
    setShowHistory(false);
    setAddingFrame(false);
    setActiveKind(kind);
  }

  // ── Cadres (LAB-313) ─────────────────────────────────────────────────────────

  function selectFrame(slot) {
    if (slot === activeSlot && !addingFrame) return;
    if (!addingFrame) stashDraft(activeKey);
    lastReadyKeyRef.current = null;
    setShowHistory(false);
    setAddingFrame(false);
    setActiveSlot(slot);
  }

  function createFrame(format) {
    const slot = nextFrameSlot(frames, frameChoice.max_frames);
    if (slot === null || !format) return;
    setFrames((prev) => [...prev, newFrame(slot, format.id)].sort((a, b) => a.slot - b.slot));
    setDrafts((d) => ({ ...d, [designKey('print', slot)]: { ...EMPTY_DRAFT, format } }));
    lastReadyKeyRef.current = null;
    setAddingFrame(false);
    setActiveSlot(slot);
  }

  function handleAddFrame() {
    if (!canAddFrame(frames, frameChoice.max_frames)) return;
    const choices = frameFormatChoices(event?.allowed_formats);
    if (!addingFrame) stashDraft(activeKey);
    if (choices.length === 1) { createFrame(FORMATS[choices[0]]); return; }
    setShowHistory(false);
    setAddingFrame(true);
  }

  function handleRenameFrame(slot, value) {
    setFrames((prev) => prev.map((f) => (f.slot === slot ? { ...f, label: clampFrameLabel(value) } : f)));
    editorRef.current?.markDirty();   // le nom part avec la prochaine sauvegarde
  }

  async function handleDeleteFrame(slot) {
    const frame = frames.find((f) => f.slot === slot);
    if (!canDeleteFrame(frame)) return;
    if (!window.confirm(`Supprimer « ${frameDisplayName(frame)} » ? Ce cadre et son historique seront effacés.`)) return;
    try {
      if (frame.saved || frame.id) await deleteDesignFrame({ code, slot });
    } catch (err) {
      alert(err.message ?? 'Erreur lors de la suppression du cadre');
      return;
    }
    const key = designKey('print', slot);
    const next = slotAfterDelete(frames, slot);
    setFrames((prev) => prev.filter((f) => f.slot !== slot));
    setDrafts((d) => { const rest = { ...d }; delete rest[key]; return rest; });
    setDirty((prev) => { const rest = { ...prev }; delete rest[key]; return rest; });
    lastReadyKeyRef.current = null;
    setShowHistory(false);
    setAddingFrame(false);
    setActiveSlot(next);
  }

  // ── « Modifier mes réponses » (menu ⋯ de l'éditeur) ──────────────────────────

  // Le travail en cours est gardé (toujours « modifié ») et retrouvé au retour de formulaire.
  const answersFromEditorRef = useRef(false);
  function handleEditAnswers() {
    stashDraft(activeKey);
    lastReadyKeyRef.current = null;
    setShowHistory(false);
    answersFromEditorRef.current = true;
    setState('form');
  }

  // ── Sauvegarde manuelle ──────────────────────────────────────────────────────

  // Sans choix du cadre, slot et label restent undefined : corps des appels identiques à avant.
  // Un seul envoi (LAB-323) : autosave-design enregistre le brouillon et sa version d'historique.
  async function saveDesign(key, editorJson, formatId) {
    const { kind, slot: keySlot } = parseDesignKey(key);
    const slot = frameMode && kind === 'print' ? keySlot : undefined;
    const label = slot === undefined ? undefined : frameLabelForRequest(frames.find((f) => f.slot === slot)?.label);
    // LAB-348 : images rangées dans le stockage (déjà envoyées dès leur ajout, le plus souvent) ;
    // une image qui n'a pas pu partir reste intégrée, la sauvegarde passe quand même.
    const canvasJson = await storeDesignImages(editorJson, code);
    await autosaveDesign({
      code, canvasJson, format: formatId, kind, slot, label, withVersion: true,
      onRetry: () => setSaveNotice({ tone: 'warning', message: SAVE_RETRY_MESSAGE }),
    });
    setSaveNotice(null);
    if (slot !== undefined) {
      setFrames((prev) => prev.map((f) => (f.slot === slot ? { ...f, saved: true, format: formatId, status: 'draft' } : f)));
    }
  }

  // withOther : « sauvegarder et quitter » enregistre aussi les autres designs modifiés.
  async function handleSave({ withOther = false } = {}) {
    if (isSaving) return;
    const current = editorRef.current?.getState() ?? null;
    const others = withOther
      ? Object.keys(dirty).filter((key) => key !== activeKey && dirty[key]
        && drafts[key]?.json && drafts[key]?.format && keyWritable(key))
      : [];
    if (!current && !others.length) {
      saveAndProceedRef.current?.();
      saveAndProceedRef.current = null;
      return;
    }

    setIsSaving(true);
    setSaveNotice(null);
    const savedKey = activeKey;
    const editor = editorRef.current;
    const revisions = { ...editRevRef.current };
    // Modifié pendant l'envoi : le contenu envoyé n'est plus le dernier, l'état « modifié » reste.
    const unchanged = (key) => (editRevRef.current[key] ?? 0) === (revisions[key] ?? 0);
    try {
      if (current) {
        await saveDesign(savedKey, current.canvasJson, current.formatId);
        if (unchanged(savedKey)) {
          editor?.markClean();
          setKeyDirty(savedKey, false);
        }
      }
      for (const key of others) {
        await saveDesign(key, drafts[key].json, drafts[key].format.id);
        if (unchanged(key)) setKeyDirty(key, false);
      }

      if (saveAndProceedRef.current) {
        saveAndProceedRef.current();
        saveAndProceedRef.current = null;
      }
    } catch (err) {
      // Rien n'est effacé : le contenu reste dans l'éditeur, marqué « modifié ».
      setSaveNotice({ tone: 'error', message: userErrorMessage(err, 'Erreur lors de la sauvegarde.') });
      if (saveAndProceedRef.current) {
        saveAndProceedRef.current = null;
        if (blocker.state === 'blocked') blocker.reset();
      }
    } finally {
      setIsSaving(false);
    }
  }

  // ── Restauration d'une version ───────────────────────────────────────────────

  function handleRestore(version) {
    const format = formatById(version.format);
    setDrafts((d) => ({
      ...d,
      [activeKey]: {
        key:    (d[activeKey]?.key ?? 0) + 1,   // force remontage Editor
        json:   version.canvas_json,
        format: format && formatAllowedForKind(currentKind, format.id) ? format : null,
      },
    }));
    lastReadyKeyRef.current = null;
    setKeyDirty(activeKey, true);     // la version restaurée n'est pas encore sauvegardée
    setShowHistory(false);
  }

  function handleSubmitSuccess() {
    setKeyDirty(activeKey, false);
    if (activeKind === 'home') {
      setHomeDesign((d) => ({ ...d, status: 'submitted', final_png_url: null }));
    } else if (homeEditor) {
      setEvent((e) => ({ ...e, status: 'submitted' }));
    } else {
      setState('submitted');
    }
  }

  // ── « Envoyer mes cadres » (LAB-313) ─────────────────────────────────────────

  function handleEditorReady(key) {
    lastReadyKeyRef.current = key;
    const waiting = readyRef.current;
    if (waiting?.key === key) { readyRef.current = null; waiting.resolve(); }
  }

  function waitForEditor(key) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        readyRef.current = null;
        reject(new Error("Le cadre n'a pas pu être chargé. Réessayez."));
      }, 30000);
      readyRef.current = { key, resolve: () => { clearTimeout(timer); resolve(); } };
    });
  }

  // Chaque cadre non validé est ouvert dans l'éditeur, exporté puis envoyé (submit-design, slot = n).
  // Sur une erreur, l'envoi s'arrête ; « Réessayer » reprend aux cadres pas encore envoyés.
  // Un seul email à l'admin (LAB-322) : seul le dernier cadre de la file le demande.
  async function sendFrames() {
    const already = sendState?.sent ?? [];
    const queue = framesToSubmit(frames, frameChoice.max_frames).filter((s) => !already.includes(s));
    if (!queue.length) return;
    const labels = Object.fromEntries(frames.map((f) => [f.slot, f.label]));
    const sent = [...already];
    const total = sent.length + queue.length;
    let current = activeSlot;
    setShowHistory(false);
    try {
      for (const [index, slot] of queue.entries()) {
        setSendState({ phase: 'sending', sent: [...sent], done: sent.length, total });
        const key = designKey('print', slot);
        if (slot !== current || lastReadyKeyRef.current !== key) {
          const ready = waitForEditor(key);
          if (slot !== current) {
            stashDraft(designKey('print', current));
            lastReadyKeyRef.current = null;
            setActiveSlot(slot);
            current = slot;
          }
          await ready;
        }
        const editor = editorRef.current;
        const snapshot = editor?.getState();
        if (!snapshot) throw new Error("Le cadre n'a pas pu être chargé. Réessayez.");
        const pngBase64 = await editor.exportPng();
        const canvasJson = await storeDesignImages(snapshot.canvasJson, code);
        await submitDesign({
          code, canvasJson, format: snapshot.formatId, pngBase64,
          kind: 'print', slot, label: frameLabelForRequest(labels[slot]),
          notify: index === queue.length - 1,
        });
        editor.markClean();
        setKeyDirty(key, false);
        setFrames((prev) => prev.map((f) => (f.slot === slot
          ? { ...f, saved: true, status: 'submitted', format: snapshot.formatId } : f)));
        sent.push(slot);
      }
    } catch (err) {
      setSendState({ phase: 'error', sent, message: err.message ?? "L'envoi a échoué." });
      return;
    }
    setSendState(null);
    setDirty((prev) => Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, k === 'home' ? v : false])));
    if (homeEditor) setEvent((e) => ({ ...e, status: 'submitted' }));
    else setState('submitted');
  }

  // ── Garde de navigation : "sauvegarder et quitter" ──────────────────────────

  function handleSaveAndLeave() {
    saveAndProceedRef.current = () => blocker.proceed?.();
    handleSave({ withOther: true });
  }

  // ── États de la page ─────────────────────────────────────────────────────────

  if (state === 'loading') {
    return (
      <div className="pola-client pola-pf-page min-h-screen flex items-center justify-center">
        <div className="text-center" role="status">
          <Spinner className="mx-auto mb-4 block h-10 w-10 border-pf-noyer" aria-hidden="true" />
          <p className="text-pf-muted text-base">Chargement de votre espace…</p>
        </div>
      </div>
    );
  }

  if (state === 'unavailable') {
    return (
      <div className="pola-client pola-pf-page min-h-screen flex items-center justify-center p-4">
        <div className="pola-pf-card p-8 max-w-sm text-center">
          <p className="text-pf-text text-base">{FEATURE_UNAVAILABLE_MESSAGE}</p>
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="pola-client pola-pf-page min-h-screen flex items-center justify-center p-4">
        <div className="pola-pf-card p-8 max-w-sm text-center">
          <div className="w-14 h-14 bg-pola-error text-white rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="pola-pf-title text-[28px] mb-2">Accès refusé</h2>
          <p className="text-pf-muted text-base mb-6">{errorMsg}</p>
          <button onClick={() => navigate('/')} className="pola-pf-btn-primary w-full">
            Retour à l'accueil
          </button>
        </div>
      </div>
    );
  }

  if (state === 'collect_name') {
    return (
      <EventNameStep
        onSubmit={async (enteredName) => {
          const { name } = await setEventName({ code, name: enteredName });
          const updatedEvent = { ...event, name };
          setEvent(updatedEvent);
          await proceedToEditor(updatedEvent, existingDesign);
        }}
      />
    );
  }

  if (state === 'form') {
    return (
      <ClientForm
        code={code}
        event={event}
        formConfig={globalForm}
        initialAnswers={prevFormAnswers}
        onDone={(answers) => {
          setPrevFormAnswers(answers);
          if (answersFromEditorRef.current) { answersFromEditorRef.current = false; setState('ready'); return; }
          const allowedFmts = event?.allowed_formats ?? ['portrait', 'landscape', 'stripV', 'stripH'];
          if (!existingDesign && allowedFmts.length > 1) setState('format');
          else setState('ready');
        }}
      />
    );
  }

  if (state === 'format') {
    return (
      <FormatPicker
        allowedFormats={event?.allowed_formats ?? ['portrait', 'landscape', 'stripV', 'stripH']}
        onSelect={(fmt) => { setChosenFormat(fmt); setState('ready'); }}
        onEditAnswers={globalForm ? () => setState('form') : null}
      />
    );
  }

  if (state === 'submitted') {
    return (
      <div className="pola-client pola-pf-page min-h-screen flex items-center justify-center p-4">
        <div className="pola-pf-card p-8 max-w-sm text-center">
          <SuccessIcon />
          <h2 className="pola-pf-title text-[28px] mb-2">{frameMode ? 'Cadres envoyés !' : 'Cadre envoyé !'}</h2>
          <p className="text-pf-muted text-base">
            {frameMode
              ? 'Vos cadres ont été envoyés et sont en cours de validation.'
              : 'Votre cadre a bien été envoyé, nous le vérifions.'}
            {' '}Vous recevrez une confirmation par e-mail.
          </p>
        </div>
      </div>
    );
  }

  const kind = currentKind;
  const slot = frameMode && kind === 'print' ? activeSlot : 1;
  const view = designView(kind, slot);
  const draft = drafts[activeKey] ?? EMPTY_DRAFT;
  const activeFrame = frameMode && kind === 'print' ? frames.find((f) => f.slot === slot) ?? null : null;
  const showFrameBar = Boolean(activeFrame) && (view === 'editor' || view === 'frameLocked');
  const printDesign = frameMode ? activeFrame : existingDesign;

  const defaultFormatId = printDesign?.format ?? event?.allowed_formats?.[0] ?? 'portrait';
  const printFormat = draft.format ?? (slot === 1 ? chosenFormat : null) ?? FORMATS[defaultFormatId] ?? FORMATS.portrait;
  const initialFormat = kind === 'home' ? HOME_FORMAT : printFormat;

  // Un design validé n'est plus modifiable, admin compris : pas de bandeau de vérification.
  const isVerifying = isAdmin && view === 'editor' && (kind === 'home'
    ? homeDesign?.status === 'submitted'
    : event?.status === 'submitted');

  let content;
  if (view === 'locked' && kind === 'print') {
    content = <DesignStatusPanel title="Cadre validé" message={PRINT_LOCKED_MESSAGE} />;
  } else if (view === 'locked') {
    content = (
      <DesignStatusPanel
        title="Écran d'accueil validé"
        message={HOME_LOCKED_MESSAGE}
        previewUrl={homeDesign?.final_png_url}
      />
    );
  } else if (view === 'pending' && kind === 'home') {
    content = (
      <DesignStatusPanel
        title="Écran d'accueil envoyé !"
        message="Votre écran d'accueil est en attente de validation. Vous pouvez continuer votre modèle photo dans l'autre onglet."
        previewUrl={homeDesign?.final_png_url}
      />
    );
  } else if (view === 'pending') {
    content = frameMode ? (
      <DesignStatusPanel
        title="Cadres envoyés !"
        message="Vos cadres ont été envoyés et sont en cours de validation. Vous recevrez une confirmation par e-mail."
      />
    ) : (
      <DesignStatusPanel
        title="Cadre envoyé !"
        message="Votre cadre a bien été envoyé, nous le vérifions. Vous recevrez une confirmation par e-mail."
      />
    );
  } else if (addingFrame && activeFrame) {
    content = (
      <FormatPicker
        embedded
        allowedFormats={frameFormatChoices(event?.allowed_formats)}
        onSelect={createFrame}
        onCancel={() => { lastReadyKeyRef.current = null; setAddingFrame(false); }}
      />
    );
  } else if (view === 'frameLocked') {
    content = <DesignStatusPanel title="Cadre validé" message={PRINT_LOCKED_MESSAGE} />;
  } else {
    content = (
      <Editor
        key={`${code}-${activeKey}-${draft.key}`}
        ref={editorRef}
        eventCode={code}
        eventName={event?.name}
        allowedFormats={kind === 'home' ? [HOME_FORMAT.id] : (event?.allowed_formats ?? ['portrait', 'landscape', 'stripV', 'stripH'])}
        initialFormat={initialFormat}
        initialCanvasJson={draft.json}
        formatBleedOverrides={kind === 'home' ? {} : formatBleedOverrides}
        onSubmitSuccess={handleSubmitSuccess}
        onDirtyChange={(value) => setKeyDirty(activeKey, value)}
        onReady={() => handleEditorReady(activeKey)}
        onSubmitRequest={activeFrame ? () => setSendState({ phase: 'confirm', sent: [] }) : null}
        submitLabel={activeFrame ? 'Envoyer mes cadres' : null}
        welcome={!activeFrame || slot === 1}
        onSaveRequest={handleSave}
        onHistoryOpen={() => setShowHistory(true)}
        onEditAnswers={globalForm && !isAdmin ? handleEditAnswers : null}
        aiVisuals={hasPublicFeature(publicFeatures, 'ai_visuals')}
      />
    );
  }

  return (
    <>
      <div className="h-screen flex flex-col">
        {/* Bandeau dans le flux (plus en position fixe) : il masquait la barre des cadres (LAB-316). */}
        {isVerifying && (
          <div className="shrink-0 relative z-40 bg-editor-warning text-editor-warning-fg text-xs font-medium
            px-4 py-1.5 flex items-center justify-center gap-2 shadow">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            {kind === 'home'
              ? 'Mode admin — vérification de l\'écran d\'accueil soumis. Vos modifications écrasent celui du client.'
              : 'Mode admin — vérification du cadre photo soumis. Vos modifications écrasent celui du client.'}
          </div>
        )}
        {homeEditor && <DesignTabs active={kind} onChange={switchTab} />}
        {showFrameBar && (
          <ClientFrameBar
            frames={frames}
            activeSlot={addingFrame ? null : slot}
            maxFrames={frameChoice.max_frames}
            canAdd={canAddFrame(frames, frameChoice.max_frames)}
            canEdit={view === 'editor' && !addingFrame}
            disabled={sendState?.phase === 'sending'}
            onSelect={selectFrame}
            onAdd={handleAddFrame}
            onRename={handleRenameFrame}
            onDelete={handleDeleteFrame}
          />
        )}
        <div className="flex-1 min-h-0">{content}</div>
      </div>

      {/* Panneau historique */}
      {showHistory && view === 'editor' && (
        <HistoryPanel
          code={code}
          kind={kind}
          slot={activeFrame ? slot : undefined}
          onRestore={handleRestore}
          onClose={() => setShowHistory(false)}
        />
      )}

      {/* Envoi groupé des cadres (LAB-313) */}
      {sendState && activeFrame && (
        <FramesSendModal
          state={sendState}
          frames={frames}
          toSend={framesToSubmit(frames, frameChoice.max_frames).filter((s) => !sendState.sent.includes(s))}
          onConfirm={sendFrames}
          onClose={() => setSendState(null)}
        />
      )}

      {/* Sauvegarde : nouvel essai ou échec (LAB-323) */}
      {saveNotice && (
        <div
          role={saveNotice.tone === 'error' ? 'alert' : 'status'}
          data-testid="save-notice"
          className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-md flex items-start gap-3
            px-4 py-3 rounded-xl shadow-lg border text-sm
            ${saveNotice.tone === 'error' ? 'bg-pola-error-soft text-pola-error border-pola-error/20' : 'bg-editor-warning text-editor-warning-fg border-editor-line'}`}
        >
          <p className="flex-1">{saveNotice.message}</p>
          {saveNotice.tone === 'error' && (
            <button onClick={() => setSaveNotice(null)} aria-label="Fermer" className="shrink-0 opacity-70 hover:opacity-100">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Garde de navigation — modifications non sauvegardées */}
      {blocker.state === 'blocked' && (
        <UnsavedChangesModal
          onSave={handleSaveAndLeave}
          onLeave={() => blocker.proceed()}
          onCancel={() => blocker.reset()}
        />
      )}
    </>
  );
}
