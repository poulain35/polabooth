import { useEffect, useState } from 'react';
import { isAppAdmin, getPhotoConsents, getAllPhotoConsents } from '../../lib/supabase';
import { formatParisDateTime } from '../../lib/guestResponsesExport';
import {
  buildPhotoConsentsTable, machineLabel, photoConsentsFileName, photoConsentsRetentionLabel, toPhotoConsentsCsv,
} from '../../lib/photoConsents';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { CardHeading, Notice } from './CardParts';
import { Skeleton } from '../ui/skeleton';
import { StatusPill } from '../ui/status-pill';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../ui/table';
import { toast } from 'sonner';
import { downloadBlob } from '../../lib/download';

const PAGE_SIZE = 50;

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
    <Card className="p-card">
      {/* En-tête */}
      <CardHeading
        className="mb-4"
        titleClassName="flex flex-wrap items-center gap-2"
        title={<>
          Consentements photo
          {total > 0 && <StatusPill tone="gray" dot={false}>{total}</StatusPill>}
        </>}
        description={<>
          {photoConsentsRetentionLabel(event.expires_at)}
          <span className="mt-1 block text-xs">Preuve qu'un invité a accepté le message affiché avant sa séance. Visible par les administrateurs seulement.</span>
        </>}
        actions={(
          <Button variant="outline" onClick={handleExport} disabled={exporting || total === 0} >
            {exporting ? <Loader2 className="animate-spin" /> : <Download />}
            Exporter en CSV
          </Button>
        )}
      />

      {error && <Notice tone="red" className="mb-3">{error}</Notice>}

      {/* Liste */}
      {loading && rows.length === 0 ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-8 w-full rounded-control" />)}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
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
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatParisDateTime(c.consented_at)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span className="font-mono text-xs text-foreground" title={c.session_id}>{String(c.session_id).slice(0, 8)}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-foreground" title={c.machine_id}>{machineLabel(c.machine_id, licenses)}</TableCell>
                    <TableCell className="min-w-[16rem] whitespace-normal">
                      {c.consent_text ? (
                        <button type="button" onClick={() => setExpanded(open ? null : c.id)}
                          aria-expanded={open} title={open ? 'Réduire' : 'Afficher tout le texte'}
                          className={`text-left text-xs text-muted-foreground hover:text-foreground ${open ? 'whitespace-pre-line' : 'line-clamp-2'}`}>
                          {c.consent_text}
                        </button>
                      ) : (
                        <span className="text-xs italic text-muted-foreground">Texte vide</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
            <span className="text-xs text-muted-foreground">
              {total} consentement{total > 1 ? 's' : ''}{totalPages > 1 && ` · page ${page} / ${totalPages}`} · heure de Paris
            </span>
            {totalPages > 1 && (
              <div className="flex gap-1">
                <Button variant="outline" size="sm"  onClick={() => setPage((p) => p - 1)} disabled={page === 1 || loading}>← Précédent</Button>
                <Button variant="outline" size="sm"  onClick={() => setPage((p) => p + 1)} disabled={page === totalPages || loading}>Suivant →</Button>
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
