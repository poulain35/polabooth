// Onglet « Création du client » de la fiche de l'événement (?tab=creation, LAB-337) : cadres du client et
// leur validation, écran d'accueil du client (#ecran-accueil), choix du cadre par l'invité, formulaire
// pré-édition. À partir de 1024 px : cadres et écran d'accueil à gauche, réglages et formulaire à droite.
import { useEffect, useState } from 'react';
import { useFeatures } from '../../../hooks/useFeatures';
import { useAppAdmin } from '../../../hooks/useAppAdmin';
import { updateEventFormConfig, getFormResponses, getGlobalFormConfig, reviewDesign, saveDbTemplate, invalidateTemplatesCache } from '../../../lib/supabase';
import FrameChoiceCard from '../../../components/admin/FrameChoiceCard';
import ClientFramesSection from '../../../components/admin/ClientFramesSection';
import { FORMATS } from '../../../utils/formats';
import { hasAnswer } from '../../../utils/formQuestions';
import { renderDesignToPng } from '../../../utils/renderDesign';
import { downloadBlob, downloadUrl } from '../../../lib/download';
import { Pencil, X, Check, Download, Image as ImageIcon, Sparkles } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import EventKioskPreviewButton from '../../../components/admin/EventKioskPreviewButton';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Textarea } from '../../../components/ui/textarea';
import { Switch } from '../../../components/ui/switch';
import { Card, CardDescription, CardTitle } from '../../../components/ui/card';
import { Lightbox } from '../../../components/ui/lightbox';
import { Skeleton } from '../../../components/ui/skeleton';
import { IconCircle } from '../../../components/ui/icon-circle';
import { StatusPill } from '../../../components/ui/status-pill';
import { cn } from '../../../lib/utils';
import { toast } from 'sonner';
import { designReviewActions, HOME_DESIGN_STATUS, HOME_SAFE_SIDE_PERCENT, homeDesignShownOnKiosk, reviewPendingNotice } from '../../../lib/clientDesigns';
import { APP_URL, rowCls, labelCls, useHashScroll } from './eventTabUtils';
import { CardHeading, KioskSaveBar, Notice } from './shared';
import { formatAnswer } from '../../../lib/guestResponsesExport';

const STATUS_DESIGN = {
  draft:     { label: 'Brouillon' },
  submitted: { label: 'En attente de validation' },
  approved:  { label: 'Approuvé' },
  rejected:  { label: 'Refusé' },
};

// Ton de la pastille selon le statut du cadre ou de l'écran d'accueil.
const DESIGN_TONES = { draft: 'gray', submitted: 'amber', approved: 'green', rejected: 'red' };

// Lien vers l'éditeur du client (/e/{code}), dans un nouvel onglet. L'éditeur s'ouvre sur sa page
// d'accueil : il ne sait pas encore s'ouvrir directement sur un cadre ou sur l'écran d'accueil.
function ClientEditorLink({ event, label }) {
  return (
    <a href={`${APP_URL}/e/${event.access_code}`} target="_blank" rel="noreferrer"
      className="inline-flex items-center gap-1.5 text-[13px] font-medium text-primary-ink hover:underline">
      <Pencil className="w-3.5 h-3.5" />
      {label}
    </a>
  );
}

// ── Formulaire pré-édition toggle ─────────────────────────────────────────────
function FormToggle({ event, onSaved }) {
  const [enabled, setEnabled] = useState(event.form_config?.enabled ?? false);
  const [saving,  setSaving]  = useState(false);

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    setSaving(true);
    try {
      await updateEventFormConfig(event.id, { enabled: next });
      onSaved(next);
      toast.success(next ? 'Formulaire activé' : 'Formulaire désactivé');
    } catch (err) {
      setEnabled(!next);
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-card">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <CardTitle as="h2">Formulaire pré-édition</CardTitle>
          <CardDescription className="mt-0.5">
            {enabled ? 'Le client répondra aux questions avant d\'accéder à l\'éditeur.' : 'Le client accède directement à l\'éditeur.'}
            {' '}
            <a href="/admin/reglages#editeur" className="font-medium text-primary-ink hover:underline">Configurer →</a>
          </CardDescription>
        </div>
        <div className="flex items-center gap-3">
          <Switch checked={enabled} onCheckedChange={toggle} disabled={saving} />
        </div>
      </div>
    </Card>
  );
}

// ── Réponses formulaire ───────────────────────────────────────────────────────
const PAGE_SIZE = 5;

function FormResponses({ eventId }) {
  const [responses, setResponses] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [page,      setPage]      = useState(1);

  useEffect(() => {
    Promise.all([getFormResponses(eventId), getGlobalFormConfig()])
      .then(([resp, cfg]) => { setResponses(resp); setQuestions(cfg?.questions ?? []); })
      .catch(() => { setResponses([]); setQuestions([]); });
  }, [eventId]);

  if (responses === null) return (
    <Card className="p-card">
      <Skeleton className="h-4 rounded-full w-40 mb-4" />
      {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-3 rounded-full w-3/4 mb-2" />)}
    </Card>
  );

  const totalPages = Math.ceil(responses.length / PAGE_SIZE);
  const paged = responses.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <Card className="p-card">
      <CardTitle as="h2" className="mb-4 flex flex-wrap items-center gap-2">
        Réponses du formulaire
        {responses.length > 0 && <StatusPill tone="gray" dot={false}>{responses.length}</StatusPill>}
      </CardTitle>
      {responses.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">Aucune réponse pour le moment.</p>
      ) : (
        <>
          <div className="space-y-3">
            {paged.map((r) => (
              <div key={r.id} className="rounded-xl bg-muted p-4">
                <p className="text-xs text-muted-foreground mb-3">Soumis le {new Date(r.submitted_at).toLocaleString('fr-FR')}</p>
                <dl className="space-y-2">
                  {questions.map((q) => hasAnswer(r.answers[q.id]) ? (
                    <div key={q.id}>
                      <dt className="text-xs text-muted-foreground font-medium">{q.label}</dt>
                      <dd className="text-sm text-foreground mt-0.5">{formatAnswer(r.answers[q.id], { separator: ', ' })}</dd>
                    </div>
                  ) : null)}
                  {Object.entries(r.answers).filter(([k]) => hasAnswer(r.answers[k]) && !questions.find((q) => q.id === k)).map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-xs text-muted-foreground font-medium italic">{k}</dt>
                      <dd className="text-sm text-foreground mt-0.5">{formatAnswer(v, { separator: ', ' })}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
              <span className="text-xs text-muted-foreground">Page {page} / {totalPages}</span>
              <div className="flex gap-1">
                <Button variant="outline" size="sm"  onClick={() => setPage(p => p - 1)} disabled={page === 1}>← Précédent</Button>
                <Button variant="outline" size="sm"  onClick={() => setPage(p => p + 1)} disabled={page === totalPages}>Suivant →</Button>
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// ── Ajout à la bibliothèque de cadres photo ───────────────────────────────────
function PromoteToTemplateForm({ design, event, onDone }) {
  const [name,   setName]   = useState(event?.name ?? '');
  const [tags,   setTags]   = useState('');
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  async function handleSave() {
    if (!name.trim() || !design?.canvas_json) return;
    setSaving(true);
    setError('');
    try {
      const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
      await saveDbTemplate({ name: name.trim(), format_id: design.format, canvas_json: design.canvas_json, preview_url: design.final_png_url ?? null, tags: tagList, is_active: true });
      invalidateTemplatesCache();
      toast.success('Cadre photo ajouté à la bibliothèque.');
      onDone();
    } catch (err) {
      setError(err.message ?? 'Erreur lors de l’ajout à la bibliothèque.');
    } finally {
      setSaving(false);
    }
  }


  return (
    <div className="mt-4 space-y-3 rounded-xl bg-primary-soft p-4">
      <p className="text-[13px] font-medium text-primary-ink">Ajouter à la bibliothèque</p>
      <div className="space-y-1.5">
        <Label className="text-xs">Nom du cadre photo</Label>
        <Input type="text" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSave()} placeholder="ex: Mariage champêtre…" autoFocus />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Tags <span className="text-muted-foreground font-normal">(optionnel, séparés par des virgules)</span></Label>
        <Input type="text" value={tags} onChange={e => setTags(e.target.value)} placeholder="ex: mariage, floral, élégant" />
      </div>
      {error && <Notice tone="red">{error}</Notice>}
      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={!name.trim() || saving}>
          {saving ? 'Ajout…' : 'Ajouter à la bibliothèque'}
        </Button>
        <Button variant="outline" onClick={onDone}>Annuler</Button>
      </div>
    </div>
  );
}

// ── Design soumis ─────────────────────────────────────────────────────────────
// Plusieurs cadres (LAB-314) : une section par cadre, `title` = « Cadre n · nom », `kioskNote` = présence sur la borne.
function DesignSection({ design, event, onReviewed, title = 'Cadre photo du client', kioskNote = null }) {
  const [lightbox,       setLightbox]       = useState(false);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [showPromote,    setShowPromote]    = useState(false);
  // Les cadres photo de la bibliothèque sont un catalogue de l'application : ajout réservé à son administrateur (LAB-276).
  const { isAdmin: canPromote } = useAppAdmin();
  const [feedback,       setFeedback]       = useState('');
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState('');
  const [notice,         setNotice]         = useState('');
  const [downloading,    setDownloading]    = useState(false);
  const [downloadingFond, setDownloadingFond] = useState(false);
  const statusInfo = STATUS_DESIGN[design?.status] ?? STATUS_DESIGN.draft;
  // Cadre validé : lecture seule pour le client, « Rouvrir pour correction » le refuse (LAB-294).
  const { canApprove, canReject, reopen } = designReviewActions('print', design?.status);
  const fileBase = `template-${event?.name ?? 'client'}${design?.slot > 1 ? `-cadre${design.slot}` : ''}`;

  async function handleDownload() {
    setDownloading(true);
    setError('');
    try {
      // Régénère depuis canvas_json (source de vérité) pour garantir les bonnes
      // polices, y compris les polices custom. On ne retombe sur le PNG figé soumis
      // par le client que si le canvas_json est absent.
      const format = FORMATS[design.format];
      if (design.canvas_json && format) {
        const dataURL = await renderDesignToPng(design.canvas_json, format, { punchZones: true });
        downloadUrl(dataURL, `${fileBase}.png`);
        return;
      }
      if (!design.final_png_url) { setError('Aucun rendu disponible pour ce cadre photo.'); return; }
      const res = await fetch(design.final_png_url);
      if (!res.ok) throw new Error(`Téléchargement échoué (${res.status})`);
      downloadBlob(await res.blob(), `${fileBase}.png`);
    } catch (err) {
      setError(err.message ?? 'Erreur lors du téléchargement');
    } finally {
      setDownloading(false);
    }
  }

  // Regénère le PNG depuis le canvas_json sans percer les zones photo : le fond du
  // template reste visible aux emplacements photo (pour recadrer/ajouter les photos ailleurs).
  async function handleDownloadFondPlein() {
    if (!design.canvas_json) return;
    const format = FORMATS[design.format];
    if (!format) { setError('Format inconnu pour ce cadre photo.'); return; }
    setDownloadingFond(true);
    setError('');
    try {
      const dataURL = await renderDesignToPng(design.canvas_json, format, { punchZones: false });
      downloadUrl(dataURL, `${fileBase}-fond-plein.png`);
    } catch (err) {
      setError(err.message ?? 'Erreur lors de la génération du PNG fond plein');
    } finally {
      setDownloadingFond(false);
    }
  }

  async function handleReview(action) {
    if (action === 'reject' && !showRejectForm) { setShowRejectForm(true); return; }
    if (action === 'reject' && !feedback.trim()) { setError('Veuillez indiquer un retour au client avant de rejeter.'); return; }
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const result = await reviewDesign({ designId: design.id, action, feedback });
      setNotice(reviewPendingNotice(result));
      onReviewed(action, feedback);
      setShowRejectForm(false);
      setFeedback('');
    } catch (err) {
      // Refus Brevo : la décision est enregistrée, seul l'email au client a échoué.
      if (err.reviewed) {
        onReviewed(action, feedback);
        setShowRejectForm(false);
        setFeedback('');
      }
      setError(err.message ?? 'Erreur lors de la validation');
    } finally {
      setLoading(false);
    }
  }

  if (!design) return (
    <Card className="p-card">
      <CardTitle as="h2">{title}</CardTitle>
      <div className="py-8 text-center text-muted-foreground">
        <IconCircle tone="muted" className="mx-auto mb-3"><ImageIcon /></IconCircle>
        <p className="text-sm mb-3">Aucun cadre photo soumis pour le moment.</p>
        <ClientEditorLink event={event} label="Ouvrir l’éditeur du client" />
      </div>
    </Card>
  );

  return (
    <>
      <Card className="p-card">
        <CardHeading className="mb-3" title={title}
          actions={<StatusPill tone={DESIGN_TONES[design.status] ?? 'gray'}>{statusInfo.label}</StatusPill>} />
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mb-4">
          {design.submitted_at && <span>Soumis le {new Date(design.submitted_at).toLocaleString('fr-FR')}</span>}
          {design.reviewed_at  && <span>Relu le {new Date(design.reviewed_at).toLocaleString('fr-FR')}</span>}
          {design.format       && <span>Format : {design.format}</span>}
          {kioskNote           && <span>{kioskNote}</span>}
        </div>
        {design.final_png_url && (
          <div className="light-island relative mb-4 overflow-hidden rounded-xl border border-border bg-[#F0F0F0] cursor-zoom-in"
            onClick={() => setLightbox(true)}>
            <img src={design.final_png_url} alt="Aperçu du cadre photo" className="max-h-72 object-contain mx-auto block py-4 px-4" />
            <div className="absolute bottom-2 right-2 bg-black/40 text-white text-xs px-2 py-1 rounded-md backdrop-blur-sm">Cliquer pour agrandir</div>
          </div>
        )}
        {design.status === 'rejected' && design.review_feedback && (
          <Notice tone="red" as="div" className="mb-4 p-4">
            <p className="mb-1 text-xs font-medium">Retour envoyé au client</p>
            <p className="text-sm">{design.review_feedback}</p>
            <p className="mt-2 text-xs">Le client peut maintenant modifier et resoumettre son cadre photo.</p>
          </Notice>
        )}
        <EventKioskPreviewButton kind="print" design={design} event={event} />
        {(canApprove || canReject) && !showRejectForm && (
          <div className="flex gap-3">
            {canApprove && (
              <Button onClick={() => handleReview('approve')} disabled={loading} className="flex-1">
                <Check className="w-4 h-4" />
                Approuver
              </Button>
            )}
            {canReject && (
              <Button variant="outline" onClick={() => handleReview('reject')} disabled={loading}
                className="flex-1 text-destructive hover:text-destructive">
                <X className="w-4 h-4" />
                {reopen ? 'Rouvrir pour correction' : 'Refuser'}
              </Button>
            )}
          </div>
        )}
        {notice && (
          <Notice tone="gray" className="mt-3">{notice}</Notice>
        )}
        {error && !(canReject && showRejectForm) && (
          <Notice tone="red" className="mt-3">{error}</Notice>
        )}
        {canReject && showRejectForm && (
          <div className="space-y-3">
            <Label>Retour au client <span className="text-destructive">*</span></Label>
            <Textarea value={feedback} onChange={e => setFeedback(e.target.value)} rows={3}
              placeholder="Expliquez au client ce qu'il doit modifier…"
              className="min-h-0 resize-none" />
            {reopen && (
              <p className="text-xs text-muted-foreground">La borne n’aura plus ce cadre jusqu’à ce que vous validiez la nouvelle version.</p>
            )}
            {!event?.client_email && (
              <Notice tone="amber">Aucun email client renseigné — le retour ne sera pas envoyé par email.</Notice>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex gap-3">
              <Button variant="destructive" onClick={() => handleReview('reject')} disabled={loading} className="flex-1">
                {loading ? 'Envoi…' : (reopen ? 'Confirmer la réouverture' : 'Confirmer le refus')}
              </Button>
              <Button variant="outline" onClick={() => { setShowRejectForm(false); setFeedback(''); setError(''); }} disabled={loading}>Annuler</Button>
            </div>
          </div>
        )}
        {design.final_png_url && (
          <Button variant="outline" onClick={handleDownload} disabled={downloading} className="mt-4 w-full">
            <Download className="w-4 h-4" />
            {/* Sur téléphone, le libellé complet dépasse du bouton : « haute résolution » s'efface. */}
            {downloading
              ? 'Téléchargement…'
              : <span>PNG <span className="hidden sm:inline">haute résolution </span>· zones transparentes</span>}
          </Button>
        )}
        {design.canvas_json && (
          <Button variant="outline" onClick={handleDownloadFondPlein} disabled={downloadingFond} className="mt-2 w-full">
            <Download className="w-4 h-4" />
            {downloadingFond
              ? 'Génération…'
              : <span>PNG <span className="hidden sm:inline">haute résolution </span>· fond plein</span>}
          </Button>
        )}
        {canPromote && design.canvas_json && !showPromote && (
          <Button variant="outline" onClick={() => setShowPromote(true)}
            className="mt-3 w-full border-dashed">
            <Sparkles className="w-4 h-4" />
            Ajouter à la bibliothèque
          </Button>
        )}
        {canPromote && showPromote && <PromoteToTemplateForm design={design} event={event} onDone={() => setShowPromote(false)} />}
        <div className="mt-4"><ClientEditorLink event={event} label="Ouvrir l’éditeur du client" /></div>
      </Card>
      <Lightbox open={lightbox && Boolean(design.final_png_url)} onClose={() => setLightbox(false)}>
        <img src={design.final_png_url} alt="Aperçu du cadre photo" className="max-h-[90vh] max-w-[90vw] object-contain shadow-2xl rounded-lg" onClick={e => e.stopPropagation()} />
      </Lightbox>
    </>
  );
}


// ── Écran d'accueil créé par le client (LAB-290) ────────────────────────────
// Design 1920×1080 (client_designs.kind = 'home'). Un écran validé est en lecture seule pour le
// client : l'admin le rouvre en le refusant avec un motif (la borne cesse alors de l'afficher).
function HomeSafeFrame() {
  // Cadre 16:10 de l'écran de la borne, en pointillés, sur l'aperçu 16:9.
  return (
    <span aria-hidden="true" className="absolute inset-y-0 border-2 border-dashed border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.35)] pointer-events-none"
      style={{ left: `${HOME_SAFE_SIDE_PERCENT}%`, right: `${HOME_SAFE_SIDE_PERCENT}%` }} />
  );
}

function HomeDesignSection({ homeDesign, event, savedHome, onReviewed }) {
  const [lightbox,       setLightbox]       = useState(false);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [feedback,       setFeedback]       = useState('');
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState('');
  const statusInfo = HOME_DESIGN_STATUS[homeDesign?.status] ?? HOME_DESIGN_STATUS.draft;
  const { canApprove, canReject, reopen } = designReviewActions('home', homeDesign?.status);

  async function handleReview(action) {
    if (action === 'reject' && !showRejectForm) { setShowRejectForm(true); return; }
    if (action === 'reject' && !feedback.trim()) { setError('Indiquez au client ce qu’il doit corriger.'); return; }
    setLoading(true);
    setError('');
    try {
      await reviewDesign({ designId: homeDesign.id, action, feedback });
      onReviewed(action, feedback);
      setShowRejectForm(false);
      setFeedback('');
    } catch (err) {
      // Refus Brevo : la décision est enregistrée, seul l'email au client a échoué.
      if (err.reviewed) {
        onReviewed(action, feedback);
        setShowRejectForm(false);
        setFeedback('');
      }
      setError(err.message ?? 'Erreur lors de la validation');
    } finally {
      setLoading(false);
    }
  }

  const editorLink = <ClientEditorLink event={event} label="Ouvrir l’éditeur du client (écran d’accueil)" />;

  return (
    <>
      <Card className="p-card">
        <CardHeading className="mb-3" title="Écran d’accueil du client"
          actions={homeDesign && <StatusPill tone={DESIGN_TONES[homeDesign.status] ?? 'gray'}>{statusInfo.label}</StatusPill>} />

        {!homeDesign ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Le client n’a pas encore commencé son écran d’accueil.</p>
            {editorLink}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mb-4">
              {homeDesign.submitted_at && <span>Envoyé le {new Date(homeDesign.submitted_at).toLocaleString('fr-FR')}</span>}
              {homeDesign.reviewed_at  && <span>Relu le {new Date(homeDesign.reviewed_at).toLocaleString('fr-FR')}</span>}
            </div>

            {homeDesign.final_png_url ? (
              <>
                <button type="button" onClick={() => setLightbox(true)}
                  className="light-island relative block w-full aspect-video overflow-hidden rounded-xl border border-border bg-black cursor-zoom-in">
                  <img src={homeDesign.final_png_url} alt="Aperçu de l’écran d’accueil" className="absolute inset-0 w-full h-full object-cover" />
                  <HomeSafeFrame />
                </button>
                <p className="text-xs text-muted-foreground mt-2 mb-4">
                  Pointillés : partie visible sur un écran 16:10 (environ 96 px coupés à gauche et à droite).
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground mb-4">Pas encore d’aperçu : le client n’a pas envoyé son écran.</p>
            )}

            {homeDesign.status === 'rejected' && homeDesign.review_feedback && (
              <Notice tone="red" as="div" className="mb-4 p-4">
                <p className="mb-1 text-xs font-medium">Retour envoyé au client</p>
                <p className="text-sm">{homeDesign.review_feedback}</p>
                <p className="mt-2 text-xs">Le client peut modifier son écran et le renvoyer.</p>
              </Notice>
            )}

            {homeDesign.status === 'approved' && !homeDesignShownOnKiosk(savedHome, homeDesign) && (
              <Notice tone="amber" className="mb-4">
                Écran validé, mais la borne ne l’affichera pas : activez « Personnaliser l’accueil » et
                « Le client crée son écran d’accueil », puis enregistrez.
              </Notice>
            )}

            <EventKioskPreviewButton kind="home" design={homeDesign} event={event} />
            {(canApprove || canReject) && !showRejectForm && (
              <div className="flex gap-3">
                {canApprove && (
                  <Button onClick={() => handleReview('approve')} disabled={loading} className="flex-1">
                    <Check className="w-4 h-4" />
                    Valider
                  </Button>
                )}
                {canReject && (
                  <Button variant="outline" onClick={() => handleReview('reject')} disabled={loading}
                    className="flex-1 text-destructive hover:text-destructive">
                    <X className="w-4 h-4" />
                    {reopen ? 'Rouvrir pour correction' : 'Refuser'}
                  </Button>
                )}
              </div>
            )}
            {canReject && showRejectForm && (
              <div className="space-y-3">
                <Label htmlFor="home-design-feedback">Motif pour le client <span className="text-destructive">*</span></Label>
                <Textarea id="home-design-feedback" value={feedback} onChange={e => setFeedback(e.target.value)} rows={3}
                  placeholder="Expliquez au client ce qu'il doit modifier…"
                  className="min-h-0 resize-none" />
                {reopen && (
                  <p className="text-xs text-muted-foreground">La borne cessera d’afficher cet écran jusqu’à ce que vous validiez la nouvelle version.</p>
                )}
                {!event?.client_email && (
                  <Notice tone="amber">Aucun email client renseigné : le motif ne sera pas envoyé par email.</Notice>
                )}
                <div className="flex gap-3">
                  <Button variant="destructive" onClick={() => handleReview('reject')} disabled={loading} className="flex-1">
                    {loading ? 'Envoi…' : (reopen ? 'Confirmer la réouverture' : 'Confirmer le refus')}
                  </Button>
                  <Button variant="outline" onClick={() => { setShowRejectForm(false); setFeedback(''); setError(''); }} disabled={loading}>Annuler</Button>
                </div>
              </div>
            )}
            {error && <Notice tone="red" className="mt-3">{error}</Notice>}

            <div className="mt-4">{editorLink}</div>
          </>
        )}
      </Card>
      <Lightbox open={lightbox && Boolean(homeDesign?.final_png_url)} onClose={() => setLightbox(false)}>
        <div className="relative w-[min(90vw,160vh)] aspect-video shadow-2xl rounded-lg overflow-hidden" onClick={e => e.stopPropagation()}>
          <img src={homeDesign?.final_png_url} alt="Aperçu de l’écran d’accueil" className="absolute inset-0 w-full h-full object-cover" />
          <HomeSafeFrame />
        </div>
      </Lightbox>
    </>
  );
}


export default function CreationTab({ event, setEvent, designs, homeDesign, kiosk, onReviewed, onHomeReviewed }) {
  const { isAvailable } = useFeatures();
  const { kioskCfg, kioskSaving, setKiosk, handleKioskSave } = kiosk;
  useHashScroll(true);
  const formEnabled = event.form_config?.enabled === true;
  const showDesign = isAvailable('client_design');
  const showForm = isAvailable('guest_form');
  const hasSide = (showDesign && Boolean(kioskCfg)) || showForm;

  return (
    <div className={cn('grid grid-cols-1 gap-5', showDesign && hasSide && 'lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:items-start')}>
      {showDesign && (
        <div className="min-w-0 space-y-5">
          <ClientFramesSection frames={designs} kiosk={event.form_config?.kiosk} renderFrame={item => (
            <DesignSection design={item.frame} event={event} title={item.title ?? undefined} kioskNote={item.kioskNote}
              onReviewed={(action, feedback) => onReviewed(item.frame.id, action, feedback)} />
          )} />

          {(homeDesign || kioskCfg?.home?.client_design) && (
            <div id="ecran-accueil" className="scroll-mt-4">
              <HomeDesignSection homeDesign={homeDesign} event={event}
                savedHome={event.form_config?.kiosk?.home} onReviewed={onHomeReviewed} />
            </div>
          )}
        </div>
      )}

      {hasSide && (
        <div className="min-w-0 space-y-5">
          {showDesign && kioskCfg && (
            <div id="choix-cadre" className="scroll-mt-4">
              <FrameChoiceCard kioskCfg={kioskCfg} setKiosk={setKiosk} frames={designs} rowCls={rowCls} labelCls={labelCls} />
              <KioskSaveBar saving={kioskSaving} onSave={handleKioskSave} className="mt-3" />
            </div>
          )}

          {/* Questionnaire avant l'édition : event_form_responses, rattaché à guest_form (spec open core). */}
          {showForm && (
            <div id="formulaire" className="scroll-mt-4 space-y-5">
              <FormToggle
                event={event}
                onSaved={enabled => setEvent(e => ({ ...e, form_config: { ...e.form_config, enabled } }))}
              />
              {formEnabled && <FormResponses eventId={event.id} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
