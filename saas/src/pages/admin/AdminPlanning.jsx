import { useEffect, useRef, useState, useCallback, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import frLocale from '@fullcalendar/core/locales/fr';
import {
  getPlanningData, fetchLicenses,
  updateLicenseColor,
  createPlanningEntry, updatePlanningEntry, deletePlanningEntry,
} from '../../lib/supabase';
import {
  isGoogleConnected, connectGoogle, disconnectGoogle,
  fetchGoogleEvents, createGoogleEvent, updateGoogleEvent, deleteGoogleEvent,
} from '../../lib/googleCalendar';
import DateTimePicker from '../../components/DateTimePicker';
import { ChevronLeft, ChevronRight, Pencil, Calendar } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Card, CardTitle } from '../../components/ui/card';
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog';
import { SegmentedControl } from '../../components/ui/segmented-control';
import { StatusPill } from '../../components/ui/status-pill';
import { moduleSlot } from '../../features/modules';
import { useFeatures } from '../../hooks/useFeatures';
import { addDays, mondayOf, parisDay, weekTitle } from '../../lib/logisticsAdmin';
import { CreateButton } from '../../components/admin/AdminPage';
import { formatDateWith, formatTime } from '../../lib/dates';
import { Spinner } from '../../components/ui/spinner';
import { Notice } from '../../components/admin/CardParts';

const todayParis = () => parisDay(new Date().toISOString());

const VIEWS = [
  { key: 'dayGridMonth',  label: 'Mois' },
  { key: 'timeGridWeek',  label: 'Semaine' },
  { key: 'timeGridDay',   label: 'Jour' },
];

const MODULE_VIEW = 'module';

// Valeur d'un <input type="color"> : forcément un code #rrggbb, enregistré tel quel avec l'entrée.
const DEFAULT_ENTRY_COLOR = '#6b7280';
// Une couleur choisie par l'utilisateur (borne, entrée) ne suit pas le thème : le texte posé dessus non plus.
const ON_CUSTOM_COLOR = '#fff';
const customColors = (color) => ({ backgroundColor: color, borderColor: color, textColor: ON_CUSTOM_COLOR });
// Blocs sans couleur choisie : couleurs du thème, en clair comme en sombre.
const UNASSIGNED_COLORS = {
  backgroundColor: 'hsl(var(--muted-foreground))',
  borderColor:     'hsl(var(--muted-foreground))',
  textColor:       'hsl(var(--card))',
};
const GOOGLE_COLORS = {
  backgroundColor: 'hsl(var(--primary))',
  borderColor:     'hsl(var(--primary))',
  textColor:       'hsl(var(--primary-foreground))',
};


function toIsoLocal(date) {
  if (!date) return '';
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// « lun. 16 novembre 14:05 »
const DAY_TIME = { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' };

// ── Rendu custom d'un événement dans le calendrier ────────────────────────────
function EventContent({ info }) {
  const { event } = info;
  const { type, startDate, endDate, displayName } = event.extendedProps;
  const isMonth = info.view.type === 'dayGridMonth';

  if (type === 'event') {
    return (
      <div className="px-1 py-0.5 overflow-hidden w-full">
        <div className="font-medium text-[11px] leading-tight truncate">{displayName}</div>
        {!isMonth && startDate && endDate && (
          <div className="text-[10px] opacity-80 mt-0.5">
            ↓ {formatTime(startDate)} &nbsp;·&nbsp; ↑ {formatTime(endDate)}
          </div>
        )}
      </div>
    );
  }

  if (type === 'google') {
    return (
      <div className="px-1 py-0.5 overflow-hidden w-full flex items-center gap-0.5">
        <span className="text-[9px] font-medium shrink-0 opacity-75">G</span>
        <span className="font-medium text-[11px] leading-tight truncate">{event.title}</span>
      </div>
    );
  }

  return (
    <div className="px-1 py-0.5 overflow-hidden w-full">
      <div className="font-medium text-[11px] leading-tight truncate">{event.title}</div>
    </div>
  );
}

// ── Modal pour un événement Google Agenda pur (non importé) ──────────────────
function GoogleEventModal({ event, onImport, onClose }) {
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');

  async function handleImport() {
    setImporting(true);
    setError('');
    try {
      await onImport(event);
    } catch (e) {
      setError(e.message);
      setImporting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <div className="flex min-w-0 items-center gap-2 pr-6">
          <StatusPill tone="blue" dot={false}>Google</StatusPill>
          <DialogTitle className="truncate">{event.title}</DialogTitle>
        </div>

        <div className="space-y-1.5">
          {event.startAt && (
            <p className="text-sm text-muted-foreground">
              <span className="text-muted-foreground text-xs mr-1">↓</span>{formatDateWith(event.startAt, DAY_TIME)}
            </p>
          )}
          {event.endAt && (
            <p className="text-sm text-muted-foreground">
              <span className="text-muted-foreground text-xs mr-1">↑</span>{formatDateWith(event.endAt, DAY_TIME)}
            </p>
          )}
          {event.description && (
            <p className="text-sm text-muted-foreground mt-2 whitespace-pre-line">{event.description}</p>
          )}
        </div>

        {error && <Notice tone="red">{error}</Notice>}

        <div className="flex gap-2 pt-1 flex-wrap">
          {event.htmlLink && (
            <Button variant="ghost" asChild className="text-primary-ink">
              <a href={event.htmlLink} target="_blank" rel="noopener noreferrer">Ouvrir dans Google Agenda</a>
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            Fermer
          </Button>
          <Button onClick={handleImport} disabled={importing}>
            {importing ? 'Import…' : 'Ajouter au planning'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Modal création / édition d'une entrée manuelle ────────────────────────────
function EntryModal({ entry, gcConnected, onSave, onDelete, onClose }) {
  const isNew = !entry?.id;
  const isSynced = !!entry?.googleEventId;

  const [form, setForm] = useState({
    title:         entry?.title   ?? '',
    startAt:       entry?.startAt ?? '',
    endAt:         entry?.endAt   ?? '',
    color:         entry?.color   ?? DEFAULT_ENTRY_COLOR,
    notes:         entry?.notes   ?? '',
    syncToGoogle:  isNew, // true par défaut pour les nouvelles entrées
  });
  const [saving,   setSaving]   = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error,    setError]    = useState('');

  function set(key, value) { setForm(f => ({ ...f, [key]: value })); }

  async function handleSave() {
    if (!form.title.trim()) { setError('Le titre est requis.'); return; }
    if (!form.startAt)       { setError('La date de début est requise.'); return; }
    if (!form.endAt)         { setError('La date de fin est requise.'); return; }
    setSaving(true);
    setError('');
    try {
      await onSave({ ...form, title: form.title.trim() });
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Supprimer cette entrée ?')) return;
    setDeleting(true);
    try { await onDelete(); } finally { setDeleting(false); }
  }

  const showGoogleCheckbox = gcConnected && !isSynced;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <DialogTitle className="pr-6">{isNew ? 'Nouvelle entrée' : 'Modifier l\'entrée'}</DialogTitle>

        <div className="space-y-1.5">
          <Label>Titre</Label>
          <Input
            autoFocus
            type="text"
            value={form.title}
            onChange={e => set('title', e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
            placeholder="Ex : Maintenance de la borne"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <DateTimePicker
            label="Début"
            value={form.startAt}
            onChange={v => set('startAt', v)}
            placeholder="Date de début"
          />
          <DateTimePicker
            label="Fin"
            value={form.endAt}
            min={form.startAt || undefined}
            onChange={v => set('endAt', v)}
            placeholder="Date de fin"
          />
        </div>

        <div className="flex items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Couleur</Label>
            <input
              type="color"
              value={form.color}
              onChange={e => set('color', e.target.value)}
              className="h-10 w-10 cursor-pointer rounded-control border border-input bg-card p-0.5"
            />
          </div>
          <div className="flex-1 space-y-1.5">
            <Label>Notes (optionnel)</Label>
            <Input
              type="text"
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="Informations complémentaires"
            />
          </div>
        </div>

        {isSynced && (
          <Notice tone="blue">
            Synchronisé avec Google Agenda
          </Notice>
        )}

        {showGoogleCheckbox && (
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.syncToGoogle}
              onChange={e => set('syncToGoogle', e.target.checked)}
              className="rounded border-input accent-primary"
            />
            <span className="text-sm text-muted-foreground">Ajouter à Google Agenda</span>
          </label>
        )}

        {error && <Notice tone="red">{error}</Notice>}

        <div className="flex gap-2 pt-1">
          {!isNew && (
            <Button
              variant="ghost"
              onClick={handleDelete}
              disabled={deleting}
              className="text-state-red-fg hover:bg-state-red hover:text-state-red-fg"
            >
              {deleting ? 'Suppression…' : 'Supprimer'}
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Enregistrement…' : (isNew ? 'Ajouter' : 'Enregistrer')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Page principale ───────────────────────────────────────────────────────────
export default function AdminPlanning() {
  const navigate       = useNavigate();
  const calendarRef    = useRef(null);

  const [loading,        setLoading]        = useState(true);
  const [loadError,      setLoadError]      = useState('');
  const [photobooths,    setPhotobooths]    = useState([]);
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [hiddenIds,      setHiddenIds]      = useState(new Set());
  const [currentView,    setCurrentView]    = useState('timeGridWeek');
  const [currentTitle,   setCurrentTitle]   = useState('');
  const [modal,          setModal]          = useState(null);
  const [googleModal,    setGoogleModal]    = useState(null);
  const [logiWeek,       setLogiWeek]       = useState(null); // lundi affiché par la vue « Logistique »

  const [gcConnected, setGcConnected] = useState(() => isGoogleConnected());
  const [gcLoading,   setGcLoading]   = useState(false);
  const [gcError,     setGcError]     = useState('');

  // Fonctionnalités activables : synchro Google (google_calendar), vue semaine d'un module
  // installé (ex. « Logistique » du module réservation).
  const { isAvailable } = useFeatures();
  const gcEnabled      = isAvailable('google_calendar');
  const gcActive       = gcEnabled && gcConnected;
  const weekView       = moduleSlot('planning.weekView').find((v) => isAvailable(v.feature)) ?? null;
  const showLogistics  = !!weekView;

  // ── Chargement ────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [{ events, entries }, licenses] = await Promise.all([
        getPlanningData(),
        fetchLicenses(), // sans les bornes retirées (LAB-243)
      ]);

      setPhotobooths(licenses);

      const evtEntries = events
        .filter(e => e.start_date)
        .map(e => {
          const pb = e.kiosk_licenses;
          const displayName = e.name || e.client_name || 'Sans nom';
          return {
            id:              `event-${e.id}`,
            title:           displayName,
            start:           e.start_date,
            end:             e.end_date ?? e.start_date,
            ...(pb?.color ? customColors(pb.color) : UNASSIGNED_COLORS),
            extendedProps: {
              type:         'event',
              eventId:      e.id,
              photoboothId: e.photobooth_id,
              displayName,
              startDate:    e.start_date,
              endDate:      e.end_date,
            },
          };
        });

      const manualEntries = entries.map(e => ({
        id:              `entry-${e.id}`,
        title:           e.title,
        start:           e.start_at,
        end:             e.end_at,
        ...customColors(e.color),
        extendedProps: {
          type:              'entry',
          entryId:           e.id,
          color:             e.color,
          notes:             e.notes,
          startAt:           e.start_at,
          endAt:             e.end_at,
          googleEventId:     e.google_event_id ?? null,
          googleCalendarId:  e.google_calendar_id ?? null,
        },
      }));

      // IDs Google déjà liés à une planning_entry (pour éviter les doublons)
      const syncedGcIds = new Set(
        entries.filter(e => e.google_event_id).map(e => e.google_event_id)
      );

      let googleEntries = [];
      if (gcEnabled && isGoogleConnected()) {
        try {
          const now = new Date();
          const timeMin = new Date(now.getFullYear(), now.getMonth() - 3, 1);
          const timeMax = new Date(now.getFullYear(), now.getMonth() + 10, 1);
          const items = await fetchGoogleEvents(timeMin.toISOString(), timeMax.toISOString());

          googleEntries = items
            .filter(item => !syncedGcIds.has(item.id))
            .map(item => {
              const start = item.start.dateTime ?? item.start.date;
              const end   = item.end.dateTime   ?? item.end.date;
              return {
                id:              `google-${item.id}`,
                title:           item.summary ?? '(sans titre)',
                start,
                end,
                ...GOOGLE_COLORS,
                extendedProps: {
                  type:            'google',
                  googleEventId:   item.id,
                  googleCalendarId: 'primary',
                  description:     item.description ?? '',
                  htmlLink:        item.htmlLink ?? '',
                  startAt:         start,
                  endAt:           end,
                },
              };
            });

          setGcConnected(true);
          setGcError('');
        } catch (e) {
          setGcConnected(false);
          setGcError(e.message);
        }
      }

      setCalendarEvents([...evtEntries, ...manualEntries, ...googleEntries]);
    } catch (e) {
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
  }, [gcEnabled]);

  useEffect(() => { load(); }, [load]);

  // ── Filtrage par photobooth caché ─────────────────────────────────────────
  const visibleEvents = calendarEvents.filter(e => {
    if (e.extendedProps.type !== 'event') return true;
    const pid = e.extendedProps.photoboothId;
    return !hiddenIds.has(pid ?? '__none__');
  });

  // ── Google Agenda connect/disconnect ──────────────────────────────────────
  async function handleGcConnect() {
    setGcLoading(true);
    setGcError('');
    try {
      await connectGoogle();
      setGcConnected(true);
      await load();
    } catch (e) {
      setGcError(e.message);
    } finally {
      setGcLoading(false);
    }
  }

  async function handleGcDisconnect() {
    await disconnectGoogle();
    setGcConnected(false);
    setGcError('');
    setCalendarEvents(prev => prev.filter(e => e.extendedProps.type !== 'google'));
  }

  // ── Handlers calendrier ───────────────────────────────────────────────────
  function handleEventClick(info) {
    const ep = info.event.extendedProps;
    if (ep.type === 'event') {
      navigate(`/admin/events/${ep.eventId}`);
    } else if (ep.type === 'entry') {
      setModal({
        mode: 'edit',
        data: {
          id:              ep.entryId,
          title:           info.event.title,
          startAt:         toIsoLocal(ep.startAt),
          endAt:           toIsoLocal(ep.endAt),
          color:           ep.color,
          notes:           ep.notes,
          googleEventId:   ep.googleEventId,
          googleCalendarId: ep.googleCalendarId,
        },
      });
    } else if (ep.type === 'google') {
      setGoogleModal({
        title:           info.event.title,
        startAt:         ep.startAt,
        endAt:           ep.endAt,
        description:     ep.description,
        htmlLink:        ep.htmlLink,
        googleEventId:   ep.googleEventId,
        googleCalendarId: ep.googleCalendarId,
      });
    }
  }

  function handleSelect(info) {
    setModal({
      mode: 'create',
      data: {
        startAt: toIsoLocal(info.start),
        endAt:   toIsoLocal(info.end),
      },
    });
  }

  async function handleSaveEntry(form) {
    if (modal.mode === 'create') {
      let googleEventId    = null;
      let googleCalendarId = null;

      if (gcActive && form.syncToGoogle) {
        try {
          googleEventId    = await createGoogleEvent(form);
          googleCalendarId = 'primary';
        } catch (e) {
          console.warn('Google Calendar sync:', e.message);
        }
      }

      const created = await createPlanningEntry({ ...form, googleEventId, googleCalendarId });
      setCalendarEvents(prev => [...prev, {
        id:              `entry-${created.id}`,
        title:           created.title,
        start:           created.start_at,
        end:             created.end_at,
        ...customColors(created.color),
        extendedProps: {
          type:              'entry',
          entryId:           created.id,
          color:             created.color,
          notes:             created.notes,
          startAt:           created.start_at,
          endAt:             created.end_at,
          googleEventId:     created.google_event_id ?? null,
          googleCalendarId:  created.google_calendar_id ?? null,
        },
      }]);
    } else {
      const { googleEventId: existingGcId, googleCalendarId: existingGcCal } = modal.data;

      if (existingGcId) {
        // Mettre à jour l'événement Google existant
        if (gcEnabled) {
          try {
            await updateGoogleEvent(existingGcId, form, existingGcCal ?? 'primary');
          } catch (e) {
            console.warn('Google Calendar sync:', e.message);
          }
        }
        await updatePlanningEntry(modal.data.id, form);
      } else if (gcActive && form.syncToGoogle) {
        // Ajouter à Google Calendar pour la première fois
        let newGcId = null;
        try {
          newGcId = await createGoogleEvent(form);
        } catch (e) {
          console.warn('Google Calendar sync:', e.message);
        }
        await updatePlanningEntry(modal.data.id, {
          ...form,
          googleEventId: newGcId,
          googleCalendarId: newGcId ? 'primary' : null,
        });
        setCalendarEvents(prev => prev.map(e =>
          e.id === `entry-${modal.data.id}`
            ? {
                ...e,
                title:           form.title,
                start:           form.startAt,
                end:             form.endAt,
                backgroundColor: form.color,
                borderColor:     form.color,
                extendedProps: {
                  ...e.extendedProps,
                  ...form,
                  googleEventId:    newGcId,
                  googleCalendarId: newGcId ? 'primary' : null,
                },
              }
            : e
        ));
        setModal(null);
        return;
      } else {
        await updatePlanningEntry(modal.data.id, form);
      }

      setCalendarEvents(prev => prev.map(e =>
        e.id === `entry-${modal.data.id}`
          ? {
              ...e,
              title:           form.title,
              start:           form.startAt,
              end:             form.endAt,
              backgroundColor: form.color,
              borderColor:     form.color,
              extendedProps: { ...e.extendedProps, ...form },
            }
          : e
      ));
    }
    setModal(null);
  }

  async function handleDeleteEntry() {
    const { googleEventId, googleCalendarId } = modal.data;
    if (googleEventId && gcEnabled) {
      try {
        await deleteGoogleEvent(googleEventId, googleCalendarId ?? 'primary');
      } catch (e) {
        console.warn('Google Calendar sync:', e.message);
      }
    }
    await deletePlanningEntry(modal.data.id);
    setCalendarEvents(prev => prev.filter(e => e.id !== `entry-${modal.data.id}`));
    setModal(null);
  }

  async function handleImportGoogleEvent(gEvent) {
    const entry = await createPlanningEntry({
      title:           gEvent.title,
      startAt:         toIsoLocal(gEvent.startAt),
      endAt:           toIsoLocal(gEvent.endAt),
      color:           DEFAULT_ENTRY_COLOR,
      notes:           gEvent.description || null,
      googleEventId:   gEvent.googleEventId,
      googleCalendarId: gEvent.googleCalendarId ?? 'primary',
    });

    setCalendarEvents(prev => [
      ...prev.filter(e => e.id !== `google-${gEvent.googleEventId}`),
      {
        id:              `entry-${entry.id}`,
        title:           entry.title,
        start:           entry.start_at,
        end:             entry.end_at,
        ...customColors(entry.color),
        extendedProps: {
          type:              'entry',
          entryId:           entry.id,
          color:             entry.color,
          notes:             entry.notes,
          startAt:           entry.start_at,
          endAt:             entry.end_at,
          googleEventId:     entry.google_event_id,
          googleCalendarId:  entry.google_calendar_id,
        },
      },
    ]);
    setGoogleModal(null);
  }

  async function handleColorChange(id, color) {
    setPhotobooths(prev => prev.map(p => p.id === id ? { ...p, color } : p));
    setCalendarEvents(prev => prev.map(e =>
      e.extendedProps.photoboothId === id
        ? { ...e, ...customColors(color) }
        : e
    ));
    await updateLicenseColor(id, color);
  }

  function togglePhotobooth(id) {
    setHiddenIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const api = () => calendarRef.current?.getApi();

  function selectView(view) {
    if (view === MODULE_VIEW) { setLogiWeek(mondayOf(todayParis())); return; }
    if (logiWeek) { setLogiWeek(null); requestAnimationFrame(() => api()?.updateSize()); }
    api()?.changeView(view);
  }

  const viewOptions = [
    ...VIEWS.map((v) => ({ value: v.key, label: v.label })),
    ...(showLogistics ? [{ value: MODULE_VIEW, label: weekView.label }] : []),
  ];

  return (
    <div className="flex h-full gap-4 px-4 pb-4 sm:px-6 lg:px-8">

      {/* ── Barre latérale ──────────────────────────────────────────────── */}
      <aside className="hidden w-56 shrink-0 lg:flex">
        <Card className="flex w-full flex-col overflow-hidden">
          <h2 className="px-4 pb-2 pt-4 text-[13px] font-medium text-foreground">Bornes</h2>
          <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
            {/* Événements sans borne */}
            <button
              onClick={() => togglePhotobooth('__none__')}
              className="flex w-full items-center gap-2.5 rounded-control px-2 py-1.5 text-left transition-colors hover:bg-muted"
            >
              <span className={`h-3 w-3 shrink-0 rounded-full border-2 ${hiddenIds.has('__none__') ? 'border-border bg-card' : 'border-transparent bg-muted-foreground'}`} />
              <span className={`truncate text-sm ${hiddenIds.has('__none__') ? 'text-muted-foreground/60 line-through' : 'text-muted-foreground'}`}>
                Non assigné
              </span>
            </button>

            {photobooths.map(pb => {
              const hidden = hiddenIds.has(pb.id);
              return (
                <div key={pb.id} className="group flex items-center gap-1.5 rounded-control px-2 py-1.5 hover:bg-muted">
                  <button
                    onClick={() => togglePhotobooth(pb.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span
                      className="h-3 w-3 shrink-0 rounded-full border-2 transition-all"
                      style={hidden
                        ? { backgroundColor: 'hsl(var(--card))', borderColor: pb.color }
                        : { backgroundColor: pb.color, borderColor: pb.color }}
                    />
                    <span className={`truncate text-sm ${hidden ? 'text-muted-foreground/60 line-through' : 'text-foreground'}`}>
                      {pb.label || pb.machine_name || 'Borne sans nom'}
                    </span>
                  </button>
                  <label
                    className="cursor-pointer opacity-0 transition-opacity group-hover:opacity-100"
                    title="Changer la couleur"
                  >
                    <input
                      type="color"
                      value={pb.color}
                      onChange={e => handleColorChange(pb.id, e.target.value)}
                      className="sr-only"
                    />
                    <Pencil className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                  </label>
                </div>
              );
            })}

            {photobooths.length === 0 && !loading && (
              <p className="px-2 py-2 text-xs italic text-muted-foreground">
                Aucune borne enregistrée.
              </p>
            )}
          </div>

          {/* Légende */}
          <div className="space-y-1.5 border-t border-border p-4">
            <p className="mb-2 text-[13px] font-medium text-foreground">Légende</p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium">↓</span> Livraison
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium">↑</span> Retrait
            </div>
          </div>

          {/* Google Agenda */}
          {gcEnabled && (
            <div className="space-y-2 border-t border-border p-4">
              <p className="text-[13px] font-medium text-foreground">Google Agenda</p>
              {gcConnected ? (
                <div className="flex flex-col items-start gap-1.5">
                  <StatusPill tone="green">Connecté</StatusPill>
                  <Button variant="ghost" size="xs" className="-ml-2 text-muted-foreground" onClick={handleGcDisconnect}>
                    Déconnecter
                  </Button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Button variant="outline" size="sm" onClick={handleGcConnect} disabled={gcLoading}>
                    <Calendar />
                    {gcLoading ? 'Connexion…' : 'Connecter'}
                  </Button>
                  {gcError && <p className="text-xs leading-tight text-state-red-fg">{gcError}</p>}
                </div>
              )}
            </div>
          )}
        </Card>
      </aside>

      {/* ── Zone calendrier ─────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col gap-4">

        {/* Barre d'outils */}
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle as="h2" className="min-w-0 flex-auto capitalize">{logiWeek && weekView ? `${weekView.label} · ${weekTitle(logiWeek)}` : currentTitle}</CardTitle>

          {/* Navigation */}
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="Précédent"
              onClick={() => (logiWeek ? setLogiWeek(addDays(logiWeek, -7)) : api()?.prev())}>
              <ChevronLeft />
            </Button>
            <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="Suivant"
              onClick={() => (logiWeek ? setLogiWeek(addDays(logiWeek, 7)) : api()?.next())}>
              <ChevronRight />
            </Button>
            <Button variant="outline" size="sm" className="ml-1"
              onClick={() => (logiWeek ? setLogiWeek(mondayOf(todayParis())) : api()?.today())}>
              Aujourd'hui
            </Button>
          </div>

          <SegmentedControl
            aria-label="Vue du calendrier"
            value={logiWeek ? MODULE_VIEW : currentView}
            onValueChange={selectView}
            options={viewOptions}
          />

          <CreateButton onClick={() => setModal({ mode: 'create', data: {} })}>Ajouter</CreateButton>
        </div>

        {/* Vue semaine du module (« Logistique », LAB-72) : le calendrier reste monté, masqué. */}
        {logiWeek && weekView && (
          <div className="flex min-h-0 flex-1">
            <Suspense fallback={null}>
              <weekView.Component monday={logiWeek} onOpenEvent={(id) => navigate(`/admin/events/${id}`)} />
            </Suspense>
          </div>
        )}

        {/* Calendrier + Prochains événements */}
        <div className={`min-h-0 flex-1 gap-4 ${logiWeek ? 'hidden' : 'flex'}`}>
          <Card className="h-full min-w-0 flex-1 overflow-hidden">
            {loading ? (
              <div className="flex h-full items-center justify-center">
                <Spinner />
              </div>
            ) : loadError ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-card">
                <Notice tone="red">{loadError}</Notice>
                <Button variant="outline" size="sm" onClick={load}>Réessayer</Button>
              </div>
            ) : (
              <FullCalendar
                ref={calendarRef}
                plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
                locale={frLocale}
                initialView="timeGridWeek"
                headerToolbar={false}
                height="100%"
                events={visibleEvents}
                eventContent={(info) => <EventContent info={info} />}
                eventClick={handleEventClick}
                selectable
                select={handleSelect}
                datesSet={(info) => {
                  setCurrentTitle(info.view.title);
                  setCurrentView(info.view.type);
                }}
                eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
                slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
                dayMaxEvents={4}
                nowIndicator
              />
            )}
          </Card>

          {/* Panneau « Prochains événements » */}
          <Card className="hidden h-full w-72 shrink-0 flex-col overflow-hidden xl:flex">
            <div className="shrink-0 px-4 pb-2 pt-4">
              <CardTitle as="h3">Prochains événements</CardTitle>
              <p className="text-[13px] text-muted-foreground">À venir dans le planning</p>
            </div>
            <div className="flex-1 space-y-1.5 overflow-y-auto p-3">
              {(() => {
                const now = Date.now();
                const upcoming = [...visibleEvents]
                  .filter(e => e.start && new Date(e.start).getTime() >= now - 12 * 3600 * 1000)
                  .sort((a, b) => new Date(a.start) - new Date(b.start))
                  .slice(0, 15);
                if (upcoming.length === 0) return (
                  <div className="flex h-full flex-col items-center justify-center gap-2 py-12 text-center">
                    <Calendar className="h-8 w-8 text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">Aucun événement à venir</p>
                  </div>
                );
                return upcoming.map(e => (
                  <button
                    key={e.id}
                    onClick={() => api()?.gotoDate(e.start)}
                    className="flex w-full items-start gap-2.5 rounded-xl bg-soft p-2.5 text-left transition-colors hover:bg-muted"
                  >
                    <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: e.backgroundColor }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{e.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(e.start).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}
                      </p>
                    </div>
                  </button>
                ));
              })()}
            </div>
          </Card>
        </div>
      </div>

      {/* ── Modals ───────────────────────────────────────────────────────── */}
      {modal && (
        <EntryModal
          entry={modal.data}
          gcConnected={gcActive}
          onSave={handleSaveEntry}
          onDelete={handleDeleteEntry}
          onClose={() => setModal(null)}
        />
      )}
      {googleModal && (
        <GoogleEventModal
          event={googleModal}
          onImport={handleImportGoogleEvent}
          onClose={() => setGoogleModal(null)}
        />
      )}
    </div>
  );
}
