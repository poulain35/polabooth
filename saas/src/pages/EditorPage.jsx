import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useBlocker } from 'react-router-dom';
import {
  supabase,
  getEventByCode, getGlobalFormConfig, getEventFormEnabled,
  autosaveDesign, saveDesignVersion, listDesignVersions, getDesignVersion,
  getFormatBleed, setEventName, getPublicFeatures,
} from '../lib/supabase';
import { FEATURE_UNAVAILABLE_MESSAGE, hasPublicFeature, isFeatureDisabledError } from '../features/featureGate';
import Editor from '../components/Editor';
import ClientForm from '../components/ClientForm';
import { FORMATS } from '../utils/formats';
import BrandLogo from '../components/BrandLogo';

// ── Format picker ─────────────────────────────────────────────────────────────

const FORMAT_VISUALS = {
  portrait:  { w: 48, h: 72, sections: 1 },
  landscape: { w: 72, h: 48, sections: 1 },
  stripV:    { w: 28, h: 72, sections: 3, vertical: true },
  stripH:    { w: 72, h: 28, sections: 3, vertical: false },
};

function FormatPicker({ allowedFormats, onSelect }) {
  const formats = allowedFormats.map((id) => FORMATS[id]).filter(Boolean);
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
      <div className="mb-8"><BrandLogo variant="square" className="h-12 w-auto" /></div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-2 text-center">Choisissez votre format</h1>
      <p className="text-gray-400 text-sm mb-10 text-center">Vous pourrez personnaliser votre template dans l'étape suivante.</p>
      <div className={`grid gap-6 ${formats.length <= 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4'} max-w-2xl w-full`}>
        {formats.map((fmt) => {
          const v = FORMAT_VISUALS[fmt.id] ?? { w: 48, h: 64, sections: 1 };
          return (
            <button key={fmt.id} onClick={() => onSelect(fmt)}
              className="group flex flex-col items-center gap-4 p-5 bg-card border-2 border-gray-200
                rounded-2xl hover:border-primary hover:shadow-md transition-all">
              <div className="flex items-center justify-center" style={{ width: 80, height: 80 }}>
                <div className="border-2 border-gray-300 group-hover:border-primary bg-gray-50 group-hover:bg-primary/10
                  rounded transition-colors overflow-hidden flex"
                  style={{ width: v.w, height: v.h, flexDirection: v.vertical ? 'column' : 'row' }}>
                  {v.sections > 1
                    ? Array.from({ length: v.sections }).map((_, i) => (
                        <div key={i} className={`flex-1 bg-gray-200 group-hover:bg-primary/20 transition-colors ${
                          v.vertical
                            ? i < v.sections - 1 ? 'border-b border-gray-300 group-hover:border-primary' : ''
                            : i < v.sections - 1 ? 'border-r border-gray-300 group-hover:border-primary' : ''
                        }`} />
                      ))
                    : <div className="flex-1 bg-gray-200 group-hover:bg-primary/20 transition-colors rounded-sm" />}
                </div>
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-gray-800 group-hover:text-primary transition-colors">{fmt.label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{fmt.subtitle}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Modale "quitter sans sauvegarder" ────────────────────────────────────────

function UnsavedChangesModal({ onSave, onLeave, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onCancel} />
      <div className="relative bg-card rounded-2xl shadow-2xl p-6 w-80 mx-4">
        <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </div>
        <h3 className="font-semibold text-gray-900 mb-2 text-center">Modifications non sauvegardées</h3>
        <p className="text-sm text-gray-500 text-center mb-5">
          Vous avez des modifications qui n'ont pas encore été sauvegardées. Que souhaitez-vous faire ?
        </p>
        <div className="flex flex-col gap-2">
          <button onClick={onSave}
            className="w-full py-2.5 bg-primary hover:bg-primary text-white text-sm font-semibold rounded-xl transition-colors">
            Sauvegarder et quitter
          </button>
          <button onClick={onLeave}
            className="w-full py-2.5 border border-gray-200 text-sm text-red-600 hover:bg-red-50 rounded-xl transition-colors">
            Quitter sans sauvegarder
          </button>
          <button onClick={onCancel}
            className="w-full py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors">
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Panneau historique ────────────────────────────────────────────────────────

function HistoryPanel({ code, onRestore, onClose }) {
  const [versions, setVersions] = useState(null);
  const [restoring, setRestoring] = useState(null);

  useEffect(() => {
    if (!code) return;
    listDesignVersions(code)
      .then(setVersions)
      .catch(() => setVersions([]));
  }, [code]);

  async function handleRestore(v) {
    setRestoring(v.id);
    try {
      const full = await getDesignVersion(code, v.id);
      onRestore(full);
    } catch {
      alert('Erreur lors de la restauration.');
    } finally {
      setRestoring(null);
    }
  }

  function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
      + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-80 max-w-full bg-card shadow-2xl flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="font-semibold text-gray-900 text-sm">Historique des versions</h2>
            <p className="text-xs text-gray-400 mt-0.5">Cliquez sur une version pour la restaurer</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Liste */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {versions === null && (
            <div className="flex justify-center pt-8">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {versions?.length === 0 && (
            <p className="text-sm text-gray-400 text-center pt-8">
              Aucune version sauvegardée.<br />
              Utilisez le bouton "Sauvegarder" pour créer une version.
            </p>
          )}
          {versions?.map((v, i) => (
            <div key={v.id}
              className="bg-gray-50 border border-gray-100 rounded-xl p-3 hover:border-primary/20 hover:bg-primary/10 transition-colors">
              <div className="flex items-start gap-2">
                <div className="w-7 h-7 bg-primary/15 text-primary rounded-lg flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                  {versions.length - i}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">
                    {v.label || `Version ${versions.length - i}`}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{formatDate(v.created_at)}</p>
                  <span className="inline-block mt-1 text-[10px] bg-gray-200 text-gray-600 rounded px-1.5 py-0.5">
                    {v.format}
                  </span>
                </div>
                <button
                  onClick={() => handleRestore(v)}
                  disabled={restoring === v.id}
                  className="shrink-0 mt-1 px-2.5 py-1 text-xs font-medium bg-primary hover:bg-primary
                    text-white rounded-lg disabled:opacity-50 transition-colors flex items-center gap-1"
                >
                  {restoring === v.id
                    ? <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                    : null}
                  Restaurer
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Saisie du nom de l'événement (première connexion) ────────────────────────

function EventNameStep({ onSubmit }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      await onSubmit(name.trim());
    } catch (err) {
      setError(err.message ?? "Impossible d'enregistrer le nom, réessayez.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
      <div className="mb-8"><BrandLogo variant="square" className="h-12 w-auto" /></div>
      <div className="bg-card rounded-2xl shadow-lg p-8 max-w-sm w-full">
        <h1 className="text-xl font-semibold text-gray-900 mb-2 text-center">Bienvenue !</h1>
        <p className="text-gray-400 text-sm mb-6 text-center">
          Comment souhaitez-vous appeler votre événement ?
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex : Mariage Marie & Pierre"
            autoFocus
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none
              focus:border-primary focus:ring-2 focus:ring-primary/15 transition"
          />
          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
          )}
          <button
            type="submit"
            disabled={!name.trim() || saving}
            className="w-full py-3 bg-primary text-white text-sm font-semibold rounded-xl
              hover:bg-primary transition-colors disabled:opacity-50"
          >
            {saving ? 'Enregistrement…' : 'Continuer →'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── EditorPage ────────────────────────────────────────────────────────────────

export default function EditorPage() {
  const { code }   = useParams();
  const navigate   = useNavigate();

  const [state,           setState]          = useState('loading');
  const [event,           setEvent]          = useState(null);
  const [existingDesign,  setExistingDesign] = useState(null);
  const [globalForm,      setGlobalForm]     = useState(null);
  const [prevFormAnswers, setPrevFormAnswers]= useState(null);
  const [errorMsg,        setErrorMsg]       = useState('');
  const [chosenFormat,    setChosenFormat]   = useState(null);
  const [isAdmin,         setIsAdmin]        = useState(false);
  const [publicFeatures,  setPublicFeatures] = useState(null);

  // Zones perdues (bleed) — chargées depuis l'org
  const [formatBleedOverrides, setFormatBleedOverrides] = useState({});

  // Sauvegarde / historique
  const [isDirty,     setIsDirty]     = useState(false);
  const [isSaving,    setIsSaving]    = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Restauration : key force le remontage de Editor avec le nouveau JSON
  const [editorKey,        setEditorKey]        = useState(0);
  const [editorInitJson,   setEditorInitJson]   = useState(null);
  const [editorInitFormat, setEditorInitFormat] = useState(null);

  // Ref vers Editor pour récupérer son état courant
  const editorRef = useRef(null);

  // Callback "sauvegarder et quitter" (pour le garde de navigation)
  const saveAndProceedRef = useRef(null);

  // ── Chargement ──────────────────────────────────────────────────────────────

  useEffect(() => {
    getFormatBleed().then(setFormatBleedOverrides).catch(() => {});
  }, []);

  async function proceedToEditor(evt, design, admin = false) {
    // L'admin qui vérifie va directement à l'éditeur (pas de formulaire ni choix de format)
    if (admin) { setState('ready'); return; }

    const eventFormEnabled = await getEventFormEnabled(code).catch(() => false);
    if (eventFormEnabled) {
      const cfg = await getGlobalFormConfig().catch(() => null);
      if (cfg?.questions?.length) { setGlobalForm(cfg); setState('form'); return; }
    }
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
      .then(async ([{ event: evt, design, form_answers }, features]) => {
        // Design par le client désactivé pour l'organisation (fonctionnalité client_design).
        if (!hasPublicFeature(features, 'client_design')) { setState('unavailable'); return; }
        setPublicFeatures(features);
        // Le client voit l'écran "soumis" — l'admin connecté accède à l'éditeur pour vérifier
        if (evt.status === 'submitted' && !admin) { setState('submitted'); return; }
        setEvent(evt);
        setExistingDesign(design);
        setEditorInitJson(design?.canvas_json ?? null);
        if (form_answers) setPrevFormAnswers(form_answers);

        if (!evt.name?.trim() && !admin) { setState('collect_name'); return; }

        await proceedToEditor(evt, design, admin && !!design);
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

  // ── Sauvegarde manuelle ──────────────────────────────────────────────────────

  async function handleSave() {
    if (!editorRef.current || isSaving) return;
    const editorState = editorRef.current.getState();
    if (!editorState) return;
    const { canvasJson, formatId } = editorState;

    setIsSaving(true);
    try {
      await autosaveDesign({ code, canvasJson, format: formatId });
      await saveDesignVersion({ code, canvasJson, format: formatId, label: null });
      editorRef.current.markClean();
      setIsDirty(false);

      if (saveAndProceedRef.current) {
        saveAndProceedRef.current();
        saveAndProceedRef.current = null;
      }
    } catch (err) {
      alert(`Erreur lors de la sauvegarde : ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  }

  // ── Restauration d'une version ───────────────────────────────────────────────

  function handleRestore(version) {
    setEditorInitJson(version.canvas_json);
    setEditorInitFormat(FORMATS[version.format] ?? null);
    setEditorKey((k) => k + 1);   // force remontage Editor
    setIsDirty(true);              // la version restaurée n'est pas encore sauvegardée
    setShowHistory(false);
  }

  // ── Garde de navigation : "sauvegarder et quitter" ──────────────────────────

  function handleSaveAndLeave() {
    saveAndProceedRef.current = () => blocker.proceed?.();
    handleSave();
  }

  // ── États de la page ─────────────────────────────────────────────────────────

  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500 text-sm">Chargement de votre espace…</p>
        </div>
      </div>
    );
  }

  if (state === 'unavailable') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-card rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
          <p className="text-gray-700 text-sm">{FEATURE_UNAVAILABLE_MESSAGE}</p>
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-card rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
          <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Accès refusé</h2>
          <p className="text-gray-500 text-sm mb-6">{errorMsg}</p>
          <button onClick={() => navigate('/')}
            className="w-full py-2.5 bg-primary text-white rounded-lg font-medium hover:bg-primary transition-colors">
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
        onDone={() => {
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
      />
    );
  }

  if (state === 'submitted') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-emerald-50 p-4">
        <div className="bg-card rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
          <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Template soumis !</h2>
          <p className="text-gray-500 text-sm">
            Votre template a déjà été soumis et est en cours de traitement.
            Vous recevrez une confirmation par email.
          </p>
        </div>
      </div>
    );
  }

  const defaultFormatId = existingDesign?.format ?? event?.allowed_formats?.[0] ?? 'portrait';
  const defaultFormat   = editorInitFormat ?? chosenFormat ?? FORMATS[defaultFormatId] ?? FORMATS.portrait;

  const isVerifying = isAdmin && (event?.status === 'submitted' || existingDesign?.status === 'approved');

  return (
    <>
      {isVerifying && (
        <div className="fixed top-0 inset-x-0 z-40 bg-amber-500 text-white text-xs font-medium
          px-4 py-1.5 flex items-center justify-center gap-2 shadow">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          Mode admin — vérification du template soumis. Vos modifications écrasent le template du client.
        </div>
      )}
      <div className="h-screen">
        <Editor
          key={`${code}-${editorKey}`}
          ref={editorRef}
          eventCode={code}
          eventName={event?.name}
          allowedFormats={event?.allowed_formats ?? ['portrait', 'landscape', 'stripV', 'stripH']}
          initialFormat={defaultFormat}
          initialCanvasJson={editorInitJson}
          formatBleedOverrides={formatBleedOverrides}
          onSubmitSuccess={() => setState('submitted')}
          onDirtyChange={setIsDirty}
          onSaveRequest={handleSave}
          onHistoryOpen={() => setShowHistory(true)}
          aiVisuals={hasPublicFeature(publicFeatures, 'ai_visuals')}
        />
      </div>

      {/* Panneau historique */}
      {showHistory && (
        <HistoryPanel
          code={code}
          onRestore={handleRestore}
          onClose={() => setShowHistory(false)}
        />
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
