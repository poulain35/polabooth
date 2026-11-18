// Onglet « Jour J » de la fiche de l'événement (LAB-337) : borne assignée et son état en direct,
// compteurs, envoi sur la borne, historique des impressions, journal de la borne, fichier .pola.
// À partir de 1024 px : la borne et les compteurs dans une colonne à droite.
import { useEffect, useState } from 'react';
import { exportPolaFile, getEventPrintLogs, updateEventPhotobooth } from '../../../lib/supabase';
import EventKioskLogsSection from '../../../components/admin/EventKioskLogsSection';
import { EventKioskPushCard } from '../../../components/admin/KioskEventPush';
import { kioskChoices } from '../../../lib/kioskEventPush';
import { Download, Loader2, Monitor } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../../../components/ui/select';
import { Card } from '../../../components/ui/card';
import { Spinner } from '../../../components/ui/spinner';
import { Meter } from '../../../components/ui/meter';
import { StatusPill } from '../../../components/ui/status-pill';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../../components/ui/table';
import { toast } from 'sonner';
import { timeAgo } from './eventTabUtils';
import { safeHttpUrl } from '../../../lib/urls';
import { CardHeading, Notice } from './shared';
import { formatDateTime } from '../../../lib/dates';

// Statut matériel de l'imprimante remonté par la borne (kiosk_licenses.printer_status)
const PRINTER_STATUS = {
  ready:     { label: 'Prête',           tone: 'green' },
  offline:   { label: 'Hors ligne',      tone: 'gray'  },
  paper_out: { label: 'Plus de papier',  tone: 'red'   },
  paper_jam: { label: 'Bourrage papier', tone: 'red'   },
  error:     { label: 'Erreur',          tone: 'red'   },
  not_found: { label: 'Introuvable',     tone: 'amber' },
  unknown:   { label: 'Inconnu',         tone: 'gray'  },
};

// État de l'appareil photo remonté par la borne (kiosk_licenses.camera_status, LAB-263)
const CAMERA_STATUS = {
  ok:           { label: 'OK',        tone: 'green' },
  disconnected: { label: 'Débranché', tone: 'red'   },
};

// ── Historique impressions ────────────────────────────────────────────────────
function PrintHistorySection({ eventId }) {
  const [logs,    setLogs]    = useState(null);
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getEventPrintLogs(eventId).then(setLogs).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [eventId]);

  const totalCopies = logs ? logs.reduce((s, l) => s + l.copies, 0) : 0;

  return (
    <Card className="p-card">
      <CardHeading
        className="mb-4"
        title="Historique des impressions"
        description="Chaque impression effectuée depuis la borne."
        actions={logs && logs.length > 0 && (
          <StatusPill tone="gray" dot={false}>{totalCopies} impression{totalCopies > 1 ? 's' : ''}</StatusPill>
        )}
      />
      {loading && <div className="flex justify-center py-6"><Spinner /></div>}
      {error && <Notice tone="red">{error}</Notice>}
      {!loading && !error && logs?.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">Aucune impression enregistrée pour cet événement.</p>}
      {!loading && !error && logs && logs.length > 0 && (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date &amp; heure</TableHead>
                <TableHead>Photo</TableHead>
                <TableHead className="text-center">Copies</TableHead>
                <TableHead>Borne</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map(log => (
                <TableRow key={log.id}>
                  <TableCell className="text-foreground whitespace-nowrap">{formatDateTime(log.printed_at)}</TableCell>
                  <TableCell>
                    {safeHttpUrl(log.composite_url) ? (
                      <a href={safeHttpUrl(log.composite_url)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-primary-ink hover:underline">
                        <img src={safeHttpUrl(log.composite_url)} alt="" className="h-8 w-8 rounded-sm border border-border object-cover" />
                        <span className="text-xs">Voir</span>
                      </a>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">{log.copies}</span>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs font-mono">{log.machine_id ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}


// ── Onglet Jour J ─────────────────────────────────────────────────────────────

export default function JourJTab({ event, setEvent, design, kioskCfg, stats, photobooths, refreshPhotobooths, handleLicenseUpdate }) {
  const [selectedPb, setSelectedPb] = useState(event.photobooth_id ?? '');
  const [savingPb,   setSavingPb]   = useState(false);
  const [exporting,   setExporting]   = useState(false);
  const [exportError, setExportError] = useState('');

  async function handlePhotoboothChange(pbId) {
    setSelectedPb(pbId);
    setSavingPb(true);
    try {
      await updateEventPhotobooth(event.id, pbId || null);
      setEvent(e => ({ ...e, photobooth_id: pbId || null }));
      toast.success('Borne enregistrée');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSavingPb(false);
    }
  }

  async function handleExportPola() {
    setExporting(true);
    setExportError('');
    try {
      const { fileName, warnings } = await exportPolaFile(event.id);
      // Avertissements (logo, cadre non téléchargé…) : plus longtemps à l'écran pour être lus.
      if (warnings.length) toast.warning(`${fileName} téléchargé`, { description: `À noter : ${warnings.join(' ; ')}`, duration: 8000 });
      else toast.success(`${fileName} téléchargé`);
    } catch (err) {
      // Reste affiché : l'admin doit agir (approuver le design) avant de réessayer.
      setExportError(err.message);
    } finally {
      setExporting(false);
    }
  }

  const currentPb    = photobooths.find(p => p.id === selectedPb);

  // Quota d'impressions : consommées / max autorisé pour l'événement (config kiosk)
  const printMax     = kioskCfg?.result?.max_prints_per_event ?? null;
  const printUsed    = stats.printCopies;
  const printPct     = printMax ? Math.min(100, Math.round((printUsed / printMax) * 100)) : 0;
  // Jauge : rouge à partir de 90 %, ambre à partir de 75 %.
  const printAlert   = printPct >= 90;
  const printWarning = !printAlert && printPct >= 75;

  // Machine en ligne si vue récemment (heartbeat kiosk toutes les 2 min → tolérance 5 min)
  const machineOnline = currentPb?.last_seen_at
    ? (Date.now() - new Date(currentPb.last_seen_at).getTime()) < 5 * 60 * 1000
    : false;
  const printerInfo   = currentPb ? (PRINTER_STATUS[currentPb.printer_status] ?? null) : null;
  const cameraInfo    = currentPb ? (CAMERA_STATUS[currentPb.camera_status] ?? null) : null;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:items-start">
      {/* Colonne latérale (en premier sur téléphone) : borne assignée et compteurs */}
      <div className="min-w-0 space-y-5 lg:order-2">
        {/* Borne assignée et son état en direct */}
        <Card className="p-card">
          <CardHeading
            className="mb-4"
            icon={<Monitor />}
            tone="peach"
            title="Borne assignée"
            description="Code couleur dans le planning"
          />
          <div className="flex items-center gap-2">
            {currentPb && <span className="h-4 w-4 shrink-0 rounded-full" style={{ backgroundColor: currentPb.color }} />}
            <Select value={selectedPb || 'none'} onValueChange={v => handlePhotoboothChange(v === 'none' ? '' : v)} disabled={savingPb}>
              <SelectTrigger className="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Aucune borne —</SelectItem>
                {kioskChoices(photobooths, selectedPb).map(pb => <SelectItem key={pb.id} value={pb.id}>{pb.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {currentPb && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
              <StatusPill tone={machineOnline ? 'green' : 'gray'}>
                {machineOnline ? 'En ligne' : currentPb.last_seen_at ? `Vue ${timeAgo(currentPb.last_seen_at)}` : 'Jamais vue'}
              </StatusPill>
              {printerInfo && <StatusPill tone={printerInfo.tone}>Imprimante : {printerInfo.label}</StatusPill>}
              {cameraInfo && <StatusPill tone={cameraInfo.tone}>Appareil photo : {cameraInfo.label}</StatusPill>}
            </div>
          )}
        </Card>

        {/* Compteurs */}
        <div className="grid grid-cols-2 gap-5">
          <Card className="p-card">
            <p className="text-[13px] text-muted-foreground">Impressions</p>
            <p className="mt-1 text-figure text-foreground">
              {printUsed}
              {printMax != null && <span className="text-base tracking-normal text-muted-foreground"> / {printMax}</span>}
            </p>
            {printMax != null ? (
              <div className="mt-3">
                <Meter value={printUsed} max={printMax} tone={printAlert ? 'red' : printWarning ? 'amber' : 'brand'}
                  aria-label="Impressions consommées" />
                <p className="mt-1.5 text-xs text-muted-foreground">{Math.max(0, printMax - printUsed)} restantes</p>
              </div>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">Pas de quota défini</p>
            )}
          </Card>
          <Card className="p-card">
            <p className="text-[13px] text-muted-foreground">Photos</p>
            <p className="mt-1 text-figure text-foreground">{stats.photosCount}</p>
            <p className="mt-1 text-xs text-muted-foreground">capturées</p>
          </Card>
        </div>
      </div>

      <div className="min-w-0 space-y-5 lg:order-1">
        {/* Envoi de l'événement sur la borne (LAB-245) */}
        <EventKioskPushCard
          event={event}
          licenses={photobooths}
          designApproved={design?.status === 'approved'}
          onLicenseUpdate={handleLicenseUpdate}
          onRefresh={refreshPhotobooths}
        />

        <PrintHistorySection eventId={event.id} />

        {/* Journal de la borne (LAB-328) : repliée, journaux lus à l'ouverture */}
        <EventKioskLogsSection key={event.id} eventId={event.id} eventName={event.name || event.client_name} />

        {/* Export .pola */}
        <Card className="p-card">
          <CardHeading
            icon={<Download />}
            tone="muted"
            title="Fichier hors-ligne (.pola)"
            description={design?.status === 'approved'
              ? 'Tout l’événement pour une borne sans réseau : réglages, cadre photo approuvé, écran d’accueil du client s’il est validé, écrans de la borne publiés, fonds, contact.'
              : 'Disponible une fois le cadre photo du client approuvé (sinon la borne imprimerait sans cadre).'}
            actions={(
              <Button variant="outline" onClick={handleExportPola} disabled={exporting || design?.status !== 'approved'}>
                {exporting && <Loader2 className="animate-spin" />}
                {exporting ? 'Génération…' : 'Télécharger .pola'}
              </Button>
            )}
          />
          {exportError && <Notice tone="red" className="mt-3">{exportError}</Notice>}
        </Card>
      </div>
    </div>
  );
}
