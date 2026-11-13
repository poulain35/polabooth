import { useEffect, useState } from 'react';
import { isAppAdmin, getPhotoConsents, getAllPhotoConsents } from '../../lib/supabase';
import { formatParisDateTime } from '../../lib/guestResponsesExport';
import {
  buildPhotoConsentsTable, machineLabel, photoConsentsFileName, photoConsentsRetentionLabel, toPhotoConsentsCsv,
} from '../../lib/photoConsents';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Skeleton } from '../ui/skeleton';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../ui/table';
import { toast } from 'sonner';

const PAGE_SIZE = 50;

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Consentements photo donnés sur la borne (LAB-226) : nombre, liste paginée, export CSV de preuve.
 * Rendu seulement pour les administrateurs de l'application (seuls lecteurs autorisés par la RLS) :
 * rien du tout pour un propriétaire d'organisation. `event` : id, name, client_name, access_code,
 * start_date, expires_at, form_config. `licenses` : licences kiosk (nom des bornes).
 */
export default function PhotoConsentsPanel({ event, licenses = [] }) {
  const eventId = event.id;

  const [isAdmin,   setIsAdmin]   = useState(false);
  const [rows,      setRows]      = useState([]);
  const [total,     setTotal]     = useState(0);
  const [page,      setPage]      = useState(1);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [expanded,  setExpanded]  = useState(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    isAppAdmin()
      .then((admin) => { if (!cancelled) setIsAdmin(admin); })
      .catch(() => { if (!cancelled) setIsAdmin(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { setPage(1); }, [eventId]);

  useEffect(() => {
    if (!isAdmin) return undefined;
    let cancelled = false;
    setLoading(true);
    getPhotoConsents(eventId, { page, pageSize: PAGE_SIZE })
      .then(({ rows: r, total: t }) => { if (!cancelled) { setRows(r); setTotal(t); setError(''); } })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isAdmin, eventId, page]);

  if (!isAdmin) return null;

  const rgpdEnabled = event.form_config?.kiosk?.rgpd?.enabled === true;
  const totalPages  = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function handleExport() {
    setExporting(true);
    try {
      const table = buildPhotoConsentsTable(await getAllPhotoConsents(eventId), { licenses });
      if (!table.rows.length) {
        toast.message('Aucun consentement à exporter');
        return;
      }
      downloadBlob(new Blob([toPhotoConsentsCsv(table)], { type: 'text/csv;charset=utf-8' }), photoConsentsFileName(event));
      toast.success(`${table.rows.length} consentement${table.rows.length > 1 ? 's' : ''} exporté${table.rows.length > 1 ? 's' : ''}`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <Card className="p-5 rounded-2xl shadow-sm">
      {/* En-tête */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="font-semibold text-gray-800">
            Consentements photo
            {total > 0 && <span className="ml-2 px-2 py-0.5 bg-primary/15 text-primary text-xs font-semibold rounded-full">{total}</span>}
          </h2>
          <p className="text-sm text-gray-500 mt-1">{photoConsentsRetentionLabel(event.expires_at)}</p>
          <p className="text-xs text-gray-400 mt-1">Preuve qu'un invité a accepté le message affiché avant sa séance. Visible par les administrateurs seulement.</p>
        </div>
        <Button variant="outline" onClick={handleExport} disabled={exporting || total === 0} className="rounded-xl">
          {exporting ? <Loader2 className="animate-spin" /> : <Download />}
          Exporter en CSV
        </Button>
      </div>

      {error && <p className="text-sm bg-red-50 text-red-700 rounded-lg px-3 py-2 mb-3">{error}</p>}

      {/* Liste */}
      {loading && rows.length === 0 ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-8 rounded-lg w-full" />)}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">
          {rgpdEnabled
            ? 'Aucun consentement reçu pour le moment. La borne envoie chaque consentement dès qu\'elle a du réseau.'
            : 'La borne ne demande pas de consentement photo pour cet événement (écran de consentement désactivé).'}
        </p>
      ) : (
        <>
          <Table className={loading ? 'opacity-60' : ''}>
            <TableHeader>
              <TableRow>
                <TableHead>Date et heure</TableHead>
                <TableHead>Séance</TableHead>
                <TableHead>Borne</TableHead>
                <TableHead>Texte accepté</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => {
                const open = expanded === c.id;
                return (
                  <TableRow key={c.id} className="align-top">
                    <TableCell className="whitespace-nowrap text-gray-500">{formatParisDateTime(c.consented_at)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span className="font-mono text-xs text-gray-700" title={c.session_id}>{String(c.session_id).slice(0, 8)}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-gray-900" title={c.machine_id}>{machineLabel(c.machine_id, licenses)}</TableCell>
                    <TableCell className="min-w-[16rem] whitespace-normal">
                      {c.consent_text ? (
                        <button type="button" onClick={() => setExpanded(open ? null : c.id)}
                          aria-expanded={open} title={open ? 'Réduire' : 'Afficher tout le texte'}
                          className={`text-left text-xs text-gray-600 hover:text-gray-900 ${open ? 'whitespace-pre-line' : 'line-clamp-2'}`}>
                          {c.consent_text}
                        </button>
                      ) : (
                        <span className="text-xs italic text-gray-400">Texte vide</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
            <span className="text-xs text-gray-400">
              {total} consentement{total > 1 ? 's' : ''}{totalPages > 1 && ` · page ${page} / ${totalPages}`} · heure de Paris
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
    </Card>
  );
}
