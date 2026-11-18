// Fiche de l'événement (/admin/events/:id, LAB-337). Ce fichier ne garde que l'en-tête (nom,
// pastille d'étape, code, dates, lieu, borne), la barre d'étapes, l'encadré « Prochaine étape », le
// chargement et les onglets. Chaque onglet est un composant de event/ :
//   ?tab=resume     ResumeTab      ?tab=creation   CreationTab    ?tab=borne   BorneTab
//   ?tab=jour-j     JourJTab       ?tab=livraison  LivraisonTab (&partie=photos|envoi|questionnaire…)
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useOrg } from './AdminLayout';
import { useFeatures } from '../../hooks/useFeatures';
import { supabase, getEmailLogs, duplicateEvent, fetchLicenses, getEventStats, syncEventToGoogleCalendar } from '../../lib/supabase';
import { ArrowRight, CalendarDays, Check, ChevronRight, Copy, FileText, Loader2, MapPin, Monitor, Pencil } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Card, CardTitle } from '../../components/ui/card';
import { IconCircle } from '../../components/ui/icon-circle';
import { Initials } from '../../components/ui/initials';
import { Input } from '../../components/ui/input';
import { Skeleton } from '../../components/ui/skeleton';
import { StatusPill } from '../../components/ui/status-pill';
import PageTabs from '../../components/admin/PageTabs';
import { mediaPurgeInfo } from '../../lib/mediaExpiry';
import { BRAND } from '../../lib/instanceBrand';
import { mainFrame } from '../../lib/clientDesigns';
import { eventStage, eventSteps, nextEventAction, STAGE_BADGES } from '../../lib/eventStages';
import { moduleHook, moduleSlot } from '../../features/modules';
import { pickTab } from '../../features/adminRoutes';
import { timeAgo } from './event/eventTabUtils';
import { useKioskConfig } from './event/useKioskConfig';
import ResumeTab from './event/ResumeTab';
import CreationTab from './event/CreationTab';
import BorneTab from './event/BorneTab';
import JourJTab from './event/JourJTab';
import LivraisonTab from './event/LivraisonTab';
import { PAGE_TITLE_CLASS, PageContainer } from '../../components/admin/AdminPage';
import { EventSteps } from './event/shared';
import { formatShortDate } from '../../lib/dates';
import { useCopy } from '../../hooks/useCopy';

// Pastille d'étape : un ton par état (ambre = à préparer, vert = prêt, violet = en cours, bleu = à livrer,
// gris = terminé). Le libellé porte l'état.
const STAGE_TONES = {
  'a-preparer': 'amber',
  prets: 'green',
  'en-cours': 'violet',
  'a-livrer': 'blue',
  livre: 'gray',
  archives: 'gray',
};

// ── Encadré « Prochaine étape » ───────────────────────────────────────────────

function NextStep({ next, onArchive }) {
  if (!next) return null;
  const button = next.action === 'archive'
    ? <Button variant="outline" onClick={onArchive}>{next.button}</Button>
    : (
      <Button asChild>
        <Link to={next.to}>{next.button}</Link>
      </Button>
    );
  return (
    <Card tone="sky" role="region" aria-label="Prochaine étape" className="flex flex-wrap items-center gap-x-[18px] gap-y-3 p-card">
      <IconCircle tone="white" className="h-12 w-12"><ArrowRight /></IconCircle>
      <div className="min-w-0 flex-1 basis-[200px]">
        <p className="text-xs font-medium text-pastel-sky-ink">Prochaine étape</p>
        <CardTitle as="h2" className="mt-0.5">{next.label}</CardTitle>
        {next.hint && <p className="mt-0.5 text-[13px] text-muted-foreground">{next.hint}</p>}
      </div>
      <div className="shrink-0">{button}</div>
    </Card>
  );
}

// ── Page principale ───────────────────────────────────────────────────────────

export default function AdminEventDetail() {
  const { id }         = useParams();
  const navigate       = useNavigate();
  const [searchParams] = useSearchParams();
  const org            = useOrg();
  const companyName    = org.contact_company || org.name || BRAND.name;
  const { isAvailable } = useFeatures();
  const requestedTab = searchParams.get('tab');

  const [event,     setEvent]     = useState(null);
  const [designs,   setDesigns]   = useState([]); // cadres du client, modèles photo triés par slot (LAB-314)
  const design = mainFrame(designs); // cadre principal : validé au plus petit slot
  const [homeDesign, setHomeDesign] = useState(null); // écran d'accueil du client (LAB-290)
  const [loading,   setLoading]   = useState(true);
  const [stats,     setStats]     = useState({ photosCount: 0, printCopies: 0 });
  const [emailLogs, setEmailLogs] = useState([]);
  const [photobooths, setPhotobooths] = useState([]);
  const [duplicating, setDuplicating] = useState(false);
  const [place,     setPlace]     = useState(null); // lieu de la demande liée (module booking)
  const [origin,    setOrigin]    = useState(null); // demande ou devis à l'origine de l'événement, { label, href } (module booking, LAB-374)

  // Édition inline du nom (depuis le titre du header)
  const [editingName, setEditingName] = useState(false);
  const [nameInput,   setNameInput]   = useState('');
  const [savingName,  setSavingName]  = useState(false);
  const [nameErr,     setNameErr]     = useState('');
  const { copied: codeCopied, copy: copyCode } = useCopy(1500);

  // Réglages de la borne (form_config.kiosk) et habillage : brouillon partagé par les onglets.
  const kiosk = useKioskConfig({
    event, setEvent, companyName, isAvailable,
    showSection: (section) => navigate({ search: '?tab=borne', hash: `#${section}` }, { replace: true }),
  });

  useEffect(() => { load(); }, [id]);

  async function load() {
    const [{ data: ev }, { data: ds }, { data: hd }, logs] = await Promise.all([
      supabase.from('events').select('*').eq('id', id).single(),
      supabase.from('client_designs').select('*').eq('event_id', id).eq('kind', 'print').order('slot', { ascending: true }),
      supabase.from('client_designs').select('*').eq('event_id', id).eq('kind', 'home').maybeSingle(),
      getEmailLogs(id).catch(() => []),
    ]);
    setEvent(ev);
    setDesigns(ds ?? []);
    setHomeDesign(hd);
    setEmailLogs(logs);
    if (ev) kiosk.resetKiosk(ev);
    setLoading(false);
    refreshPhotobooths();
    getEventStats(id).then(setStats).catch(() => {});
    const locationHook = moduleHook('event.location');
    setPlace(null);
    if (locationHook && isAvailable(locationHook.feature)) {
      locationHook.run(id).then(setPlace).catch(() => {});
    }
    const leadHook = moduleHook('event.lead');
    setOrigin(null);
    if (leadHook && isAvailable(leadHook.feature)) {
      leadHook.run(id).then(setOrigin).catch(() => {});
    }
  }

  // Bornes retirées comprises : une borne assignée puis retirée reste affichée dans le choix (LAB-245).
  function refreshPhotobooths() {
    fetchLicenses({ includeRetired: true }).then(setPhotobooths).catch(() => {});
  }

  function handleLicenseUpdate(licenseId, columns) {
    if (columns) setPhotobooths(list => list.map(pb => pb.id === licenseId ? { ...pb, ...columns } : pb));
  }

  async function handleArchive() {
    if (!confirm('Archiver cet événement ? Le client ne pourra plus y accéder.')) return;
    await supabase.from('events').update({ status: 'archived' }).eq('id', id);
    setEvent(e => ({ ...e, status: 'archived' }));
  }

  async function handleDuplicate() {
    if (!confirm('Dupliquer cet événement ?')) return;
    setDuplicating(true);
    try {
      const created = await duplicateEvent(event.id);
      navigate(`/admin/events/${created.id}`);
    } catch (err) {
      alert(`Erreur : ${err.message}`);
    } finally {
      setDuplicating(false);
    }
  }

  function startEditName() {
    setNameInput(event.name ?? '');
    setNameErr('');
    setEditingName(true);
  }

  async function saveEventName() {
    const name = nameInput.trim();
    setSavingName(true);
    setNameErr('');
    try {
      const { error } = await supabase.from('events').update({ name }).eq('id', id);
      if (error) throw error;
      setEvent(e => ({ ...e, name }));
      setEditingName(false);
      if (isAvailable('google_calendar')) syncEventToGoogleCalendar(id);
    } catch (err) {
      setNameErr(err.message);
    } finally {
      setSavingName(false);
    }
  }

  function handleReviewed(frameId, action, feedback) {
    setDesigns(list => list.map(d => (d.id !== frameId ? d : { ...d, status: action === 'approve' ? 'approved' : 'rejected', reviewed_at: new Date().toISOString(), review_feedback: action === 'reject' ? feedback : null })));
    if (action === 'reject') setEvent(e => ({ ...e, status: 'active' }));
    // La revue écrit une ligne design_approved / design_rejected (statut « error » si Brevo refuse).
    getEmailLogs(id).then(setEmailLogs).catch(() => {});
  }

  // Écran d'accueil : la revue ne touche pas au statut de l'événement (LAB-290).
  function handleHomeReviewed(action, feedback) {
    setHomeDesign(d => ({ ...d, status: action === 'approve' ? 'approved' : 'rejected', reviewed_at: new Date().toISOString(), review_feedback: action === 'reject' ? feedback : null }));
    getEmailLogs(id).then(setEmailLogs).catch(() => {});
  }

  // ── Loading ──
  if (loading) return (
    <PageContainer>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-52 rounded-card" />
      <Skeleton className="h-24 rounded-card" />
      <Skeleton className="h-10 w-full max-w-xl rounded-full" />
      {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-card" />)}
    </PageContainer>
  );

  if (!event) return (
    <PageContainer>
      <p className="py-8 text-center text-muted-foreground">
        Événement introuvable.{' '}
        <button onClick={() => navigate(-1)} className="text-primary-ink underline">Retour</button>
      </p>
    </PageContainer>
  );

  // Étapes, pastille et prochaine action : même calcul que les filtres de la liste (eventStages.js).
  const homePending = homeDesign?.status === 'submitted' && isAvailable('client_design');
  const stageCtx = {
    frames: designs,
    homePending,
    deliverySent: emailLogs.some(log => log.type === 'delivery'),
    isAvailable,
  };
  const steps = eventSteps(event, stageCtx);
  const stage = eventStage(event, stageCtx);
  const next  = nextEventAction(event, stageCtx);
  const mediaPurge = mediaPurgeInfo(event);

  // Machine en ligne si vue récemment (heartbeat kiosk toutes les 2 min → tolérance 5 min)
  const currentPb = photobooths.find(p => p.id === event.photobooth_id);
  const machineOnline = currentPb?.last_seen_at
    ? (Date.now() - new Date(currentPb.last_seen_at).getTime()) < 5 * 60 * 1000
    : false;

  // Onglets : Résumé, Borne et Jour J font partie du socle ; les autres suivent leurs fonctionnalités.
  const pendingCount = designs.filter(d => d.status === 'submitted').length + (homePending ? 1 : 0);
  const deliveryFeatures = ['gallery', 'delivery_email', 'event_report', 'guest_form',
    ...moduleSlot('event.delivery').map(item => item.feature)];
  const TABS = [
    { id: 'resume', label: 'Résumé', available: true },
    { id: 'creation', label: 'Création du client', available: isAvailable('client_design') || isAvailable('guest_form'),
      count: isAvailable('client_design') ? pendingCount : 0 },
    { id: 'borne', label: 'Réglages de la borne', available: true },
    { id: 'jour-j', label: 'Jour J', available: true },
    { id: 'livraison', label: 'Photos et livraison', available: deliveryFeatures.some(f => isAvailable(f)) },
  ].filter(tab => tab.available);
  const currentTab = pickTab(requestedTab ?? 'resume', TABS.map(tab => tab.id));

  return (
    <PageContainer>

      {/* ── Fil d'Ariane ── */}
      <nav aria-label="Fil d'Ariane" className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
        <Link to="/admin/events" className="shrink-0 transition-colors hover:text-foreground">Événements</Link>
        <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span aria-current="page" className="truncate text-foreground">{event.name || 'Sans nom'}</span>
      </nav>

      {/* ── En-tête : nom, pastille d'étape, date, lieu, borne, code, actions, étapes ── */}
      <Card className="flex flex-col gap-card p-card">
        <div className="flex flex-wrap items-start gap-4">
          <Initials name={event.name} tone="lilac" aria-hidden="true" className="hidden h-14 w-14 text-lg ring-0 sm:inline-flex" />

          <div className="min-w-0 flex-1 basis-[260px]">
            {editingName ? (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="text"
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveEventName(); if (e.key === 'Escape') setEditingName(false); }}
                  placeholder="Nom de l'événement"
                  aria-label="Nom de l'événement"
                  autoFocus
                  className="min-w-0 flex-1 basis-[14rem] text-base"
                />
                <Button onClick={saveEventName} disabled={savingName}>
                  {savingName && <Loader2 className="animate-spin" />}
                  {savingName ? 'Enregistrement…' : 'Enregistrer'}
                </Button>
                <Button variant="ghost" onClick={() => setEditingName(false)} disabled={savingName}>Annuler</Button>
                {nameErr && <span className="text-xs text-destructive">{nameErr}</span>}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <button onClick={startEditName} title="Modifier le nom"
                  className="group flex min-w-0 items-center gap-2 text-left">
                  <h1 className={PAGE_TITLE_CLASS}>{event.name || <span className="italic text-muted-foreground">Sans nom</span>}</h1>
                  <Pencil className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary-ink" aria-hidden="true" />
                </button>
                <StatusPill tone={STAGE_TONES[stage]}>{STAGE_BADGES[stage]}</StatusPill>
              </div>
            )}

            {/* Date, lieu, borne et code d'accès */}
            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
                {event.start_date ? (
                  <span className="text-ink">
                    {formatShortDate(event.start_date)}
                    {event.end_date && event.end_date !== event.start_date && <> → {formatShortDate(event.end_date)}</>}
                  </span>
                ) : <span className="italic">Date non définie</span>}
                {mediaPurge.purgedAt && <span>· fichiers supprimés le {formatShortDate(mediaPurge.purgedAt)}</span>}
              </span>
              {place && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="text-ink">{place}</span>
                </span>
              )}
              {origin && (
                <Link
                  to={origin.href}
                  className="inline-flex items-center gap-1.5 rounded-full transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="text-ink underline-offset-4 hover:underline">{origin.label}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                </Link>
              )}
              <span className="inline-flex items-center gap-1.5">
                <Monitor className="h-4 w-4 shrink-0" aria-hidden="true" />
                {currentPb ? (
                  <>
                    <span className="text-ink">{currentPb.label ?? currentPb.machine_id}</span>
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${machineOnline ? 'bg-state-green-fg' : 'bg-muted-foreground/50'}`} aria-hidden="true" />
                    <span>{machineOnline ? 'En ligne' : currentPb.last_seen_at ? `Vue ${timeAgo(currentPb.last_seen_at)}` : 'Jamais vue'}</span>
                  </>
                ) : <StatusPill tone="amber">Aucune borne</StatusPill>}
              </span>
              {event.access_code && (
                <button
                  type="button"
                  onClick={() => copyCode(event.access_code)}
                  title="Copier le code d'accès"
                  className="inline-flex h-[26px] items-center gap-1.5 rounded-full bg-state-gray px-2.5 text-xs text-state-gray-fg transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <code className="font-mono font-medium">{event.access_code}</code>
                  {codeCopied
                    ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    : <Copy className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                  <span>{codeCopied ? 'Copié' : 'Copier'}</span>
                </button>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {event.status === 'active' && (
              <Button variant="outline" onClick={handleArchive}>
                Archiver
              </Button>
            )}
            <Button variant="outline" onClick={handleDuplicate} disabled={duplicating}>
              {duplicating && <Loader2 className="animate-spin" />}
              {duplicating ? 'Duplication…' : 'Dupliquer'}
            </Button>
          </div>
        </div>

        <EventSteps steps={steps} />
      </Card>

      {/* ── Prochaine étape ── */}
      <NextStep next={next} onArchive={handleArchive} />

      {/* ── Onglets ── */}
      <PageTabs
        label="Onglets de l'événement"
        active={currentTab}
        tabs={TABS.map(tab => ({ id: tab.id, label: tab.label, count: tab.count, to: `?tab=${tab.id}` }))}
      />

      {/* ── Contenu de l'onglet ── */}
      <div className="space-y-5">
        {currentTab === 'resume' && (
          <ResumeTab key={event.id} event={event} setEvent={setEvent} steps={steps}
            emailLogs={emailLogs} setEmailLogs={setEmailLogs} kiosk={kiosk} />
        )}
        {currentTab === 'creation' && (
          <CreationTab key={event.id} event={event} setEvent={setEvent} designs={designs} homeDesign={homeDesign} kiosk={kiosk}
            onReviewed={handleReviewed} onHomeReviewed={handleHomeReviewed} />
        )}
        {currentTab === 'borne' && (
          <BorneTab key={event.id} event={event} setEvent={setEvent} design={design} kiosk={kiosk}
            photobooths={photobooths} companyName={companyName} />
        )}
        {currentTab === 'jour-j' && (
          <JourJTab key={event.id} event={event} setEvent={setEvent} design={design} kioskCfg={kiosk.kioskCfg} stats={stats}
            photobooths={photobooths} refreshPhotobooths={refreshPhotobooths} handleLicenseUpdate={handleLicenseUpdate} />
        )}
        {currentTab === 'livraison' && (
          <LivraisonTab key={event.id} event={event} setEvent={setEvent} onEmailLogs={setEmailLogs} />
        )}
      </div>
    </PageContainer>
  );
}
