import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getGuestResponses, getAllGuestResponses, getGuestResponsesSummary, getGuestResponsePhotos,
  deleteGuestResponse, deleteAllGuestResponses, markGuestResponsesExported,
} from '../../lib/supabase';
import {
  buildExportTable, exportFileName, formatParisDate, formatParisDateTime, formatPhone,
  photosBySession, responsePhotos, toGuestCsv, toXlsx, EXPORT_KINDS,
} from '../../lib/guestResponsesExport';
import { Download, Loader2, Search, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Card } from '../ui/card';
import { Skeleton } from '../ui/skeleton';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '../ui/dialog';
import { toast } from 'sonner';

const APP_URL = (import.meta.env.VITE_APP_URL ?? window.location.origin).replace(/\/$/, '');
const PAGE_SIZE = 20;

const FORMATS = [
  { value: 'xlsx', label: 'Excel (.xlsx)' },
  { value: 'csv', label: 'CSV' },
];

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-xl font-semibold text-gray-900 mt-0.5">{value}</p>
    </div>
  );
}

/**
 * Réponses au questionnaire de la borne (LAB-221) : compteurs, liste paginée, recherche,
 * suppression et export .xlsx / CSV. `event` : id, name, client_name, access_code, start_date,
 * form_config, guest_responses_exported_at. `onExported(iso)` : appelé après chaque export.
 * `onSummary(summary)` : résumé relu (chargement, suppression), pour le rappel d'export (LAB-224).
 */
export default function GuestResponsesPanel({ event, onExported, onSummary }) {
  const eventId = event.id;

  const [summary, setSummary] = useState(null);
  const [photos,  setPhotos]  = useState([]);
  const [rows,    setRows]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [reload,  setReload]  = useState(0);

  const [searchInput, setSearchInput] = useState('');
  const [search,      setSearch]      = useState('');

  const [format,     setFormat]     = useState('xlsx');
  const [exporting,  setExporting]  = useState('');
  const [exportedAt, setExportedAt] = useState(event.guest_responses_exported_at ?? null);

  const [toDelete,    setToDelete]    = useState(null);
  const [deleting,    setDeleting]    = useState(false);
  const [showWipe,    setShowWipe]    = useState(false);
  const [wipeCode,    setWipeCode]    = useState('');

  useEffect(() => { setExportedAt(event.guest_responses_exported_at ?? null); }, [event.guest_responses_exported_at]);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getGuestResponsesSummary(eventId), getGuestResponsePhotos(eventId)])
      .then(([s, p]) => { if (!cancelled) { setSummary(s); setPhotos(p); } })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [eventId, reload]);

  useEffect(() => { onSummary?.(summary); }, [summary, onSummary]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getGuestResponses(eventId, { page, pageSize: PAGE_SIZE, search })
      .then(({ rows: r, total: t }) => { if (!cancelled) { setRows(r); setTotal(t); setError(''); } })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [eventId, page, search, reload]);

  const sessions = useMemo(() => photosBySession(photos), [photos]);
  const refresh = useCallback(() => setReload((n) => n + 1), []);

  const responseCount = summary?.response_count ?? 0;
  const consentCount  = summary?.consent_count ?? 0;
  const consentRate   = responseCount ? `${Math.round((consentCount / responseCount) * 100)} %` : '—';
  const participation = photos.length ? `${Math.round((responseCount / photos.length) * 100)} %` : '—';
  const totalPages    = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function handleExport(kind) {
    setExporting(kind);
    const startedAt = new Date();
    try {
      const [responses, allPhotos] = await Promise.all([getAllGuestResponses(eventId), getGuestResponsePhotos(eventId)]);
      const table = buildExportTable({
        responses,
        configQuestions: event.form_config?.kiosk?.questionnaire?.questions ?? [],
        photos: allPhotos,
        galleryUrl: event.access_code ? `${APP_URL}/photos/${event.access_code}` : '',
        kind,
      });
      if (!table.rows.length) {
        toast.message(kind === EXPORT_KINDS.consent ? 'Aucun contact n\'a accepté la prospection' : 'Aucune réponse à exporter');
        return;
      }
      const blob = format === 'csv'
        ? new Blob([toGuestCsv(table)], { type: 'text/csv;charset=utf-8' })
        : await toXlsx(table);
      downloadBlob(blob, exportFileName(event, { kind, format }));
      const at = await markGuestResponsesExported(eventId, startedAt);
      setExportedAt(at);
      onExported?.(at);
      toast.success(`${table.rows.length} ligne${table.rows.length > 1 ? 's' : ''} exportée${table.rows.length > 1 ? 's' : ''}`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setExporting('');
    }
  }

  async function confirmDelete() {
    setDeleting(true);
    try {
      await deleteGuestResponse(toDelete.id);
      toast.success('Réponse supprimée');
      setToDelete(null);
      if (rows.length === 1 && page > 1) setPage((p) => p - 1);
      refresh();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setDeleting(false);
    }
  }

  const wipeCodeOk = !!event.access_code && wipeCode.trim().toUpperCase() === event.access_code.toUpperCase();

  async function confirmWipe() {
    if (!wipeCodeOk || deleting) return;
    setDeleting(true);
    try {
      const n = await deleteAllGuestResponses(eventId);
      toast.success(`${n} réponse${n > 1 ? 's' : ''} supprimée${n > 1 ? 's' : ''}`);
      setShowWipe(false);
      setWipeCode('');
      setPage(1);
      refresh();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card className="p-5 rounded-2xl shadow-sm">
      {/* En-tête */}
      <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
        <div>
          <h2 className="font-semibold text-gray-800">
            Réponses des invités
            {responseCount > 0 && <span className="ml-2 px-2 py-0.5 bg-primary/15 text-primary text-xs font-semibold rounded-full">{responseCount}</span>}
          </h2>
          {summary?.purge_at && (
            <p className="text-sm text-gray-500 mt-1">
              Suppression automatique à partir du {formatParisDate(summary.purge_at)}
            </p>
          )}
        </div>
        {exportedAt && (
          <p className="text-xs text-gray-400">Dernier export le {formatParisDateTime(exportedAt)}</p>
        )}
      </div>

      {/* Compteurs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <Stat label="Réponses" value={responseCount} />
        <Stat label="Consentements prospection" value={`${consentCount} · ${consentRate}`} />
        <Stat label="Taux de participation (réponses / photos)" value={participation} />
      </div>

      {/* Export */}
      <div id="guest-export" className="rounded-xl border border-gray-100 p-4 mb-5 space-y-3 scroll-mt-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-gray-700">Format</span>
          <div className="inline-flex rounded-lg border border-gray-200 p-0.5" role="radiogroup" aria-label="Format du fichier">
            {FORMATS.map((f) => (
              <button key={f.value} type="button" role="radio" aria-checked={format === f.value}
                onClick={() => setFormat(f.value)}
                className={`px-3 py-1 text-sm rounded-md transition-colors ${format === f.value ? 'bg-primary text-primary-foreground' : 'text-gray-600 hover:bg-gray-50'}`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => handleExport(EXPORT_KINDS.consent)} disabled={!!exporting || consentCount === 0} className="rounded-xl">
            {exporting === EXPORT_KINDS.consent ? <Loader2 className="animate-spin" /> : <Download />}
            Contacts ayant accepté la prospection
          </Button>
          <Button variant="outline" onClick={() => handleExport(EXPORT_KINDS.all)} disabled={!!exporting || responseCount === 0} className="rounded-xl">
            {exporting === EXPORT_KINDS.all ? <Loader2 className="animate-spin" /> : <Download />}
            Toutes les réponses
          </Button>
        </div>
        <p className="text-xs text-gray-500">
          Le fichier « contacts » ne contient que les invités qui ont coché la case de prospection (une ligne par envoi).
          Téléchargez-le puis envoyez-le vous-même au client.
        </p>
      </div>

      {/* Recherche */}
      <div className="relative mb-3">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <Input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Rechercher un e-mail ou un téléphone" className="pl-9" aria-label="Rechercher un e-mail ou un téléphone" />
      </div>

      {error && <p className="text-sm bg-red-50 text-red-700 rounded-lg px-3 py-2 mb-3">{error}</p>}

      {/* Liste */}
      {loading && rows.length === 0 ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-8 rounded-lg w-full" />)}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">
          {search ? 'Aucune réponse ne correspond à cette recherche.' : 'Aucune réponse pour le moment.'}
        </p>
      ) : (
        <>
          <Table className={loading ? 'opacity-60' : ''}>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Téléphone</TableHead>
                <TableHead>Prospection</TableHead>
                <TableHead className="text-right">Photos</TableHead>
                <TableHead className="w-10"><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-gray-500">{formatParisDateTime(r.answered_at)}</TableCell>
                  <TableCell className="text-gray-900">{r.email || <span className="text-gray-300">—</span>}</TableCell>
                  <TableCell className="whitespace-nowrap text-gray-900">{r.phone ? formatPhone(r.phone) : <span className="text-gray-300">—</span>}</TableCell>
                  <TableCell>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.marketing_consent ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                      {r.marketing_consent ? 'Oui' : 'Non'}
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-gray-500">{responsePhotos(r, sessions).length}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-red-600"
                      onClick={() => setToDelete(r)} aria-label="Supprimer la réponse">
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
            <span className="text-xs text-gray-400">
              {total} réponse{total > 1 ? 's' : ''}{totalPages > 1 && ` · page ${page} / ${totalPages}`}
            </span>
            {totalPages > 1 && (
              <div className="flex gap-1">
                <Button variant="outline" size="sm" className="h-8" onClick={() => setPage((p) => p - 1)} disabled={page === 1 || loading}>← Précédent</Button>
                <Button variant="outline" size="sm" className="h-8" onClick={() => setPage((p) => p + 1)} disabled={page === totalPages || loading}>Suivant →</Button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Tout supprimer */}
      {responseCount > 0 && (
        <div className="mt-5 flex justify-end">
          <Button variant="outline" size="sm" onClick={() => { setWipeCode(''); setShowWipe(true); }}
            className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700">
            <Trash2 /> Tout supprimer
          </Button>
        </div>
      )}

      {/* Suppression d'une réponse */}
      <Dialog open={!!toDelete} onOpenChange={(o) => !o && !deleting && setToDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Supprimer cette réponse ?</DialogTitle>
            <DialogDescription>
              {toDelete && [toDelete.email, toDelete.phone && formatPhone(toDelete.phone), formatParisDateTime(toDelete.answered_at)].filter(Boolean).join(' · ')}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-gray-500">
            La réponse disparaît de la liste et des exports. Les photos de l'invité ne sont pas supprimées.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToDelete(null)} disabled={deleting}>Annuler</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting && <Loader2 className="animate-spin" />}
              Supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Suppression de toutes les réponses */}
      <Dialog open={showWipe} onOpenChange={(o) => !o && !deleting && setShowWipe(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Supprimer toutes les réponses ?</DialogTitle>
            <DialogDescription>
              {responseCount} réponse{responseCount > 1 ? 's' : ''} de cet événement seront supprimées définitivement.
              Les photos ne sont pas supprimées.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="guest-wipe-code">
              Pour confirmer, tapez le code de l'événement : <span className="font-mono font-semibold">{event.access_code}</span>
            </Label>
            <Input id="guest-wipe-code" value={wipeCode} onChange={(e) => setWipeCode(e.target.value)}
              autoComplete="off" className="font-mono uppercase"
              onKeyDown={(e) => { if (e.key === 'Enter') confirmWipe(); }} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowWipe(false)} disabled={deleting}>Annuler</Button>
            <Button variant="destructive" onClick={confirmWipe} disabled={deleting || !wipeCodeOk}>
              {deleting && <Loader2 className="animate-spin" />}
              Tout supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
