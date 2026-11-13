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
import { X, ChevronLeft, ChevronRight, Plus, Pencil, Calendar } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Card } from '../../components/ui/card';
import { moduleSlot } from '../../features/modules';
import { useFeatures } from '../../hooks/useFeatures';
import { addDays, mondayOf, parisDay, weekTitle } from '../../lib/logisticsAdmin';

const todayParis = () => parisDay(new Date().toISOString());

const VIEWS = [
  { key: 'dayGridMonth',  label: 'Mois' },
  { key: 'timeGridWeek',  label: 'Semaine' },
  { key: 'timeGridDay',   label: 'Jour' },
];

const DEFAULT_ENTRY_COLOR = '#6b7280';
const GOOGLE_BLUE = '#4285F4';

function toIsoLocal(date) {
  if (!date) return '';
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function fmtDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('fr-FR', {
    weekday: 'short', day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── Rendu custom d'un événement dans le calendrier ────────────────────────────
function EventContent({ info }) {
  const { event } = info;
  const { type, startDate, endDate, displayName } = event.extendedProps;
  const isMonth = info.view.type === 'dayGridMonth';

  if (type === 'event') {
    return (
      <div className="px-1 py-0.5 overflow-hidden w-full">
        <div className="font-semibold text-[11px] leading-tight truncate">{displayName}</div>
        {!isMonth && startDate && endDate && (
          <div className="text-[10px] opacity-80 mt-0.5">
            ↓ {fmtTime(startDate)} &nbsp;·&nbsp; ↑ {fmtTime(endDate)}
          </div>
        )}
      </div>
    );
  }

  if (type === 'google') {
    return (
      <div className="px-1 py-0.5 overflow-hidden w-full flex items-center gap-0.5">
        <span className="text-[8px] font-bold shrink-0 opacity-75">G</span>
        <span className="font-semibold text-[11px] leading-tight truncate">{event.title}</span>
      </div>
    );
  }

  return (
    <div className="px-1 py-0.5 overflow-hidden w-full">
      <div className="font-semibold text-[11px] leading-tight truncate">{event.title}</div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-card rounded-2xl shadow-xl w-full max-w-md mx-4 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded"
              style={{ color: GOOGLE_BLUE, backgroundColor: '#EBF2FF' }}
            >
              Google
            </span>
            <h2 className="font-semibold text-gray-900 truncate">{event.title}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors shrink-0 ml-2">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-1.5">
          {event.startAt && (
            <p className="text-sm text-gray-600">
              <span className="text-gray-400 text-xs mr-1">↓</span>{fmtDateTime(event.startAt)}
            </p>
          )}
          {event.endAt && (
            <p className="text-sm text-gray-600">
              <span className="text-gray-400 text-xs mr-1">↑</span>{fmtDateTime(event.endAt)}
            </p>
          )}
          {event.description && (
            <p className="text-sm text-gray-500 mt-2 whitespace-pre-line">{event.description}</p>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2 pt-1 flex-wrap">
          {event.htmlLink && (
            <a
              href={event.htmlLink}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-2 text-sm hover:bg-blue-50 rounded-lg transition-colors"
              style={{ color: GOOGLE_BLUE }}
            >
              Ouvrir dans Google Agenda
            </a>
          )}
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            Fermer
          </Button>
          <Button onClick={handleImport} disabled={importing}>
            {importing ? 'Import…' : 'Ajouter au planning'}
          </Button>
        </div>
      </div>
    </div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-card rounded-2xl shadow-xl w-full max-w-md mx-4 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">{isNew ? 'Nouvelle entrée' : 'Modifier l\'entrée'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-1.5">
          <Label>Titre</Label>
          <Input
            autoFocus
            type="text"
            value={form.title}
            onChange={e => set('title', e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
            placeholder="Ex : Maintenance Pola 1"
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
          <div className="space-y-1.5">
            <Label>Couleur</Label>
            <input
              type="color"
              value={form.color}
              onChange={e => set('color', e.target.value)}
              className="w-10 h-10 rounded-md border border-input cursor-pointer p-0.5"
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
          <div
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg"
            style={{ color: GOOGLE_BLUE, backgroundColor: '#EBF2FF' }}
          >
            <span className="text-[10px] font-bold">G</span>
            Synchronisé avec Google Agenda
          </div>
        )}

        {showGoogleCheckbox && (
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.syncToGoogle}
              onChange={e => set('syncToGoogle', e.target.checked)}
              className="rounded border-gray-300 accent-primary"
            />
            <span className="text-sm text-gray-600">Ajouter à Google Agenda</span>
          </label>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2 pt-1">
          {!isNew && (
            <Button
              variant="ghost"
              onClick={handleDelete}
              disabled={deleting}
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
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
      </div>
    </div>
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

      const defaultColor = '#94a3b8';

      const evtEntries = events
        .filter(e => e.start_date)
        .map(e => {
          const pb = e.kiosk_licenses;
          const color = pb?.color ?? defaultColor;
          const displayName = e.name || e.client_name || 'Sans nom';
          return {
            id:              `event-${e.id}`,
            title:           displayName,
            start:           e.start_date,
            end:             e.end_date ?? e.start_date,
            backgroundColor: color,
            borderColor:     color,
            textColor:       '#fff',
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
        backgroundColor: e.color,
        borderColor:     e.color,
        textColor:       '#fff',
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
                backgroundColor: GOOGLE_BLUE,
                borderColor:     GOOGLE_BLUE,
                textColor:       '#fff',
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
        backgroundColor: created.color,
        borderColor:     created.color,
        textColor:       '#fff',
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
        backgroundColor: entry.color,
        borderColor:     entry.color,
        textColor:       '#fff',
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
        ? { ...e, backgroundColor: color, borderColor: color }
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

  return (
    <div className="flex h-full">

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside className="hidden md:flex w-52 shrink-0 bg-card border-r border-gray-100 flex-col">
        <div className="p-4 border-b border-gray-100">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Photobooths</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {/* Entrée "Sans photobooth" */}
          <button
            onClick={() => togglePhotobooth('__none__')}
            className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors text-left"
          >
            <span className={`w-3 h-3 rounded-full shrink-0 border-2 ${hiddenIds.has('__none__') ? 'border-gray-300 bg-card' : 'bg-gray-400 border-gray-400'}`} />
            <span className={`text-sm truncate ${hiddenIds.has('__none__') ? 'text-gray-300 line-through' : 'text-gray-600'}`}>
              Non assigné
            </span>
          </button>

          {photobooths.map(pb => {
            const hidden = hiddenIds.has(pb.id);
            return (
              <div key={pb.id} className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-gray-50 group">
                <button
                  onClick={() => togglePhotobooth(pb.id)}
                  className="flex items-center gap-2 flex-1 text-left min-w-0"
                >
                  <span
                    className="w-3 h-3 rounded-full shrink-0 border-2 transition-all"
                    style={hidden
                      ? { backgroundColor: 'white', borderColor: pb.color }
                      : { backgroundColor: pb.color, borderColor: pb.color }}
                  />
                  <span className={`text-sm truncate ${hidden ? 'text-gray-300 line-through' : 'text-gray-700'}`}>
                    {pb.label || pb.machine_name || 'Borne sans nom'}
                  </span>
                </button>
                <label
                  className="opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  title="Changer la couleur"
                >
                  <input
                    type="color"
                    value={pb.color}
                    onChange={e => handleColorChange(pb.id, e.target.value)}
                    className="sr-only"
                  />
                  <Pencil className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600" />
                </label>
              </div>
            );
          })}

          {photobooths.length === 0 && !loading && (
            <p className="text-xs text-gray-400 px-2 py-2 italic">
              Aucun photobooth enregistré.
            </p>
          )}
        </div>

        {/* Légende */}
        <div className="p-3 border-t border-gray-100 space-y-1.5">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Légende</p>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="font-medium">↓</span> Livraison
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="font-medium">↑</span> Retrait
          </div>
        </div>

        {/* Google Agenda */}
        {gcEnabled && <div className="p-3 border-t border-gray-100 space-y-2">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Google Agenda</p>
          {gcConnected ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs text-gray-600">
                <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                Connecté
              </div>
              <button
                onClick={handleGcDisconnect}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                Déconnecter
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <button
                onClick={handleGcConnect}
                disabled={gcLoading}
                className="flex items-center gap-1.5 text-xs text-primary hover:text-primary
                  disabled:opacity-50 transition-colors"
              >
                <Calendar className="w-3.5 h-3.5 shrink-0" />
                {gcLoading ? 'Connexion…' : 'Connecter Google Agenda'}
              </button>
              {gcError && <p className="text-xs text-destructive leading-tight">{gcError}</p>}
            </div>
          )}
        </div>}
      </aside>

      {/* ── Zone calendrier ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 bg-muted/30">

        {/* Toolbar custom */}
        <div className="flex flex-wrap items-center gap-3 sm:gap-4 px-4 sm:px-6 py-3 sm:py-4 bg-card border-b border-gray-100">
          {/* Titre */}
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-gray-900 capitalize leading-tight">{logiWeek && weekView ? `${weekView.label} · ${weekTitle(logiWeek)}` : currentTitle}</h2>
          </div>

          {/* Navigation */}
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="w-8 h-8 text-gray-500" aria-label="Précédent"
              onClick={() => (logiWeek ? setLogiWeek(addDays(logiWeek, -7)) : api()?.prev())}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" className="w-8 h-8 text-gray-500" aria-label="Suivant"
              onClick={() => (logiWeek ? setLogiWeek(addDays(logiWeek, 7)) : api()?.next())}>
              <ChevronRight className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="sm" className="h-8 ml-1"
              onClick={() => (logiWeek ? setLogiWeek(mondayOf(todayParis())) : api()?.today())}>
              Aujourd'hui
            </Button>
          </div>

          {/* Sélecteur de vue */}
          <div className="flex items-center bg-gray-100 rounded-xl p-1 gap-0.5">
            {VIEWS.map(v => (
              <button key={v.key} onClick={() => {
                  if (logiWeek) { setLogiWeek(null); requestAnimationFrame(() => api()?.updateSize()); }
                  api()?.changeView(v.key);
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                  !logiWeek && currentView === v.key
                    ? 'bg-card text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}>
                {v.label}
              </button>
            ))}
            {showLogistics && (
              <button onClick={() => setLogiWeek(mondayOf(todayParis()))}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                  logiWeek ? 'bg-card text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}>
                {weekView.label}
              </button>
            )}
          </div>

          {/* Bouton ajouter */}
          <Button className="rounded-xl" onClick={() => setModal({ mode: 'create', data: {} })}>
            <Plus className="w-4 h-4" />
            Ajouter
          </Button>
        </div>

        {/* Vue semaine du module (« Logistique », LAB-72) : le calendrier reste monté, masqué. */}
        {logiWeek && weekView && (
          <div className="flex-1 overflow-hidden p-4 flex min-h-0">
            <Suspense fallback={null}>
              <weekView.Component monday={logiWeek} onOpenEvent={(id) => navigate(`/admin/events/${id}`)} />
            </Suspense>
          </div>
        )}

        {/* Calendrier + Prochains événements */}
        <div className={`flex-1 overflow-hidden p-4 gap-4 min-h-0 ${logiWeek ? 'hidden' : 'flex'}`}>
          <Card className="overflow-hidden h-full flex-1 min-w-0">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <span className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : loadError ? (
              <div className="flex flex-col items-center justify-center h-full gap-2">
                <p className="text-sm text-destructive">{loadError}</p>
                <button onClick={load} className="text-xs text-primary hover:underline">Réessayer</button>
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
          <Card className="hidden xl:flex w-72 shrink-0 h-full flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-border shrink-0">
              <h3 className="font-semibold text-foreground text-sm">Prochains événements</h3>
              <p className="text-xs text-muted-foreground">À venir dans le planning</p>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
              {(() => {
                const now = Date.now();
                const upcoming = [...visibleEvents]
                  .filter(e => e.start && new Date(e.start).getTime() >= now - 12 * 3600 * 1000)
                  .sort((a, b) => new Date(a.start) - new Date(b.start))
                  .slice(0, 15);
                if (upcoming.length === 0) return (
                  <div className="flex flex-col items-center justify-center text-center h-full py-12 gap-2">
                    <Calendar className="w-8 h-8 text-muted-foreground/30" />
                    <p className="text-sm text-muted-foreground">Aucun événement à venir</p>
                  </div>
                );
                return upcoming.map(e => (
                  <button
                    key={e.id}
                    onClick={() => api()?.gotoDate(e.start)}
                    className="w-full text-left flex items-start gap-2.5 p-2.5 rounded-xl border border-border hover:bg-muted/50 transition-colors"
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0 mt-1" style={{ backgroundColor: e.backgroundColor }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{e.title}</p>
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
