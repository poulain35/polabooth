// Carte « Bilan client » de la fiche événement (LAB-238, spec LAB-209 SAAS-2) : préparer, état des
// bornes, choix des photos, aperçu (la vraie page), envoyer, renvoyer, révoquer. Tous les chiffres
// viennent de build_event_report ; l'envoi passe par l'edge function send-event-report.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Eye, Images, Loader2, RefreshCw, Send, Unlink } from 'lucide-react';
import { toast } from 'sonner';
import { buildEventReport, fetchPhotos, getEventReportRow, revokeEventReport, sendEventReport, updateEventReportSelection } from '../../lib/supabase';
import { moduleHook } from '../../features/modules';
import { MAX_PHOTOS } from '../../lib/eventReport';
import {
  defaultReportPhotos, eventReportDefaultFor, initialReportSelection, isReportProposed, kioskStatusLines, photoThumb,
  previewReport, reportErrorMessage, reportLink, reportPhotoCandidates, reportStatus, sendState, toggleReportPhoto,
} from '../../lib/eventReportAdmin';
import EventReportView from '../report/EventReportView';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { CardHeading, Notice } from './CardParts';
import { StatusPill } from '../ui/status-pill';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '../ui/dialog';
import { CopyButton } from '../ui/copy-button';

// Point d'état d'une borne : le texte de la ligne dit l'état, le point l'appuie.
const KIOSK_DOT = { ok: 'bg-state-green-fg', pending: 'bg-state-amber-fg', unknown: 'bg-state-amber-fg', not_seen: 'bg-destructive' };
const STATUS_TONE = { sent: 'green', draft: 'gray', revoked: 'red' };
const sameIds = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);

export default function EventReportCard({ event, org, appUrl }) {
  const [initLoading, setInitLoading] = useState(true);
  const [clientType, setClientType] = useState(null);
  const [prepared, setPrepared] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState('');
  const [photos, setPhotos] = useState([]);
  const [selected, setSelected] = useState([]);
  const [savedSelection, setSavedSelection] = useState([]);
  const [showPhotos, setShowPhotos] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [revoking, setRevoking] = useState(false);
  const [savingPhotos, setSavingPhotos] = useState(false);

  const report = prepared?.report ?? null;
  const status = report?.status ?? null;
  const proposed = prepared ? !!prepared.proposed : isReportProposed(eventReportDefaultFor(org?.business_profile), clientType);
  const candidates = useMemo(() => reportPhotoCandidates(photos), [photos]);
  const link = status === 'sent' ? reportLink(appUrl, report?.token) : '';
  const { canSend, reasons } = sendState(prepared, { busy: sending || preparing });
  const statusInfo = reportStatus(report);
  const kiosks = kioskStatusLines(prepared?.kiosks);

  const prepare = useCallback(async ({ keepSelection = false } = {}) => {
    setPreparing(true);
    setPrepareError('');
    try {
      const [data, list] = await Promise.all([buildEventReport(event.id), fetchPhotos(event.id)]);
      setPrepared(data);
      setPhotos(list);
      const saved = Array.isArray(data?.report?.selected_photo_ids) ? data.report.selected_photo_ids : [];
      setSavedSelection(saved);
      setSelected((current) => initialReportSelection(keepSelection && current.length ? current : saved, list));
    } catch (err) {
      setPrepareError(reportErrorMessage(err));
    } finally {
      setPreparing(false);
    }
  }, [event.id]);

  // Lecture seule au chargement : on ne crée pas de brouillon tant que l'admin n'a rien demandé.
  useEffect(() => {
    let alive = true;
    Promise.all([
      getEventReportRow(event.id).catch(() => null),
      // Type de client de la demande liée (module réservation) ; sans module : inconnu.
      moduleHook('eventClientType')?.run(event.id).catch(() => null) ?? null,
    ]).then(([row, type]) => {
      if (!alive) return;
      setClientType(type);
      setInitLoading(false);
      if (row) prepare();
    });
    return () => { alive = false; };
  }, [event.id, prepare]);

  // Brouillon ou lien coupé : le choix est enregistré au fil de l'eau (rien n'est en ligne).
  function handleToggle(id) {
    const next = toggleReportPhoto(selected, id, MAX_PHOTOS);
    if (next === selected) {
      toast.error(`${MAX_PHOTOS} photos au plus : retirez-en une d'abord.`);
      return;
    }
    setSelected(next);
    if (status !== 'sent') persistSelection(next, { silent: true });
  }

  function handleDefaultPhotos() {
    const next = defaultReportPhotos(photos);
    setSelected(next);
    if (status !== 'sent') persistSelection(next, { silent: true });
  }

  async function persistSelection(ids, { silent = false } = {}) {
    setSavingPhotos(true);
    try {
      await updateEventReportSelection(event.id, ids);
      setSavedSelection(ids);
      if (!silent) toast.success('Photos du bilan mises à jour');
    } catch (err) {
      toast.error(err.message ?? 'Les photos n’ont pas pu être enregistrées');
    } finally {
      setSavingPhotos(false);
    }
  }

  async function handleSend() {
    setSending(true);
    setSendError('');
    try {
      await sendEventReport(event.id, selected);
      setConfirmSend(false);
      toast.success(`Bilan envoyé à ${event.client_email}`);
      await prepare({ keepSelection: true });
    } catch (err) {
      setConfirmSend(false);
      setSendError(reportErrorMessage(err, prepared?.kiosks));
      // Un blocage apparu entre-temps (borne, e-mail) : l'état affiché est remis à jour.
      if (err.code === 'blocked' || err.code === 'nothing_to_report') prepare({ keepSelection: true });
    } finally {
      setSending(false);
    }
  }

  async function handleRevoke() {
    setRevoking(true);
    try {
      await revokeEventReport(event.id);
      setConfirmRevoke(false);
      toast.success('Lien du bilan coupé');
      await prepare({ keepSelection: true });
    } catch (err) {
      toast.error(err.message ?? 'Le lien n’a pas pu être coupé');
    } finally {
      setRevoking(false);
    }
  }

  const sendLabel = status === 'sent' ? 'Actualiser et renvoyer' : 'Envoyer au client';

  return (
    <Card className="p-card">
      <CardHeading
        as="h3"
        icon={<BarChart3 />}
        tone="navy"
        titleClassName="flex flex-wrap items-center gap-2"
        title={<>
          Bilan client
          {statusInfo.label && (
            <StatusPill tone={STATUS_TONE[statusInfo.tone] ?? 'gray'}>{statusInfo.label}</StatusPill>
          )}
        </>}
        description={statusInfo.detail || (proposed
          ? 'Page de bilan à envoyer au client : séances, impressions, partages et photos choisies.'
          : 'Pas proposé d’office pour ce client (voir Réglages). Vous pouvez le préparer à la main.')}
        actions={prepared ? (
          <Button variant="outline" onClick={() => prepare({ keepSelection: true })} disabled={preparing || sending}
            title="Recalculer les chiffres et l’état des bornes">
            {preparing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Actualiser
          </Button>
        ) : (
          <Button onClick={() => prepare()} disabled={initLoading || preparing}
            variant={proposed ? 'default' : 'outline'}>
            {preparing ? <Loader2 className="animate-spin" /> : <BarChart3 />}
            {preparing ? 'Préparation…' : 'Préparer le bilan'}
          </Button>
        )}
      />

      {prepareError && <Notice tone="red" className="mt-3">{prepareError}</Notice>}

      {prepared && (
        <div className="mt-4 space-y-4">
          {/* État des bornes */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1.5">Bornes de l’événement</p>
            {kiosks.length === 0 ? (
              <p className="text-xs text-muted-foreground">Aucune borne vue pour cet événement.</p>
            ) : (
              <ul className="space-y-1">
                {kiosks.map((k, i) => (
                  <li key={`${k.label}-${i}`} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${KIOSK_DOT[k.state]}`} />
                    <span className="font-medium text-foreground">{k.label}</span>
                    <span className="text-muted-foreground">{k.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Photos */}
          <div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-muted-foreground">
                Photos du bilan : {selected.length}/{MAX_PHOTOS}
                {candidates.length === 0 && ' (aucune photo approuvée)'}
              </p>
              {candidates.length > 0 && (
                <Button variant="ghost" size="xs"  onClick={() => setShowPhotos((v) => !v)}>
                  <Images />
                  {showPhotos ? 'Fermer le choix' : 'Choisir les photos'}
                </Button>
              )}
            </div>
            {selected.length > 0 && !showPhotos && (
              <div className="mt-2 flex gap-2 flex-wrap">
                {selected.map((id) => {
                  const p = candidates.find((c) => c.id === id);
                  return p ? <img key={id} src={photoThumb(p)} alt="" className="h-12 w-12 rounded-control border border-border object-cover" /> : null;
                })}
              </div>
            )}
            {showPhotos && (
              <div className="mt-2">
                <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2 max-h-80 overflow-y-auto p-1">
                  {candidates.map((p) => {
                    const order = selected.indexOf(p.id);
                    const on = order >= 0;
                    return (
                      <button key={p.id} type="button" onClick={() => handleToggle(p.id)}
                        className={`relative aspect-square overflow-hidden rounded-control border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${on ? 'border-primary' : 'border-transparent hover:border-input'}`}
                        aria-pressed={on} aria-label={on ? `Retirer la photo ${order + 1}` : 'Ajouter cette photo'}>
                        <img src={photoThumb(p)} alt="" loading="lazy" className="w-full h-full object-cover" />
                        {on && (
                          <span className="absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-medium text-primary-foreground">
                            {order + 1}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <Button variant="outline" size="sm"  onClick={handleDefaultPhotos} disabled={savingPhotos}>
                    6 photos réparties dans la soirée
                  </Button>
                  {status === 'sent' && !sameIds(selected, savedSelection) && (
                    <Button size="sm" onClick={() => persistSelection(selected)} disabled={savingPhotos}>
                      {savingPhotos && <Loader2 className="animate-spin" />}
                      Mettre à jour les photos en ligne
                    </Button>
                  )}
                  {status === 'sent' && (
                    <span className="text-xs text-muted-foreground">Le bilan déjà envoyé montre ces photos dès la mise à jour.</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Lien envoyé */}
          {link && (
            <div className="flex items-center gap-2 rounded-xl bg-muted py-1.5 pl-3 pr-1.5">
              <a href={link} target="_blank" rel="noreferrer" className="flex-1 truncate text-xs text-primary-ink hover:underline">{link}</a>
              <CopyButton value={link} variant="ghost" className="shrink-0"
                errorMessage="Copie impossible : sélectionnez le lien à la main." />
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <Button variant="outline"  onClick={() => setShowPreview(true)}>
              <Eye />
              Aperçu
            </Button>
            <Button onClick={() => { setSendError(''); setConfirmSend(true); }} disabled={!canSend}>
              {sending ? <Loader2 className="animate-spin" /> : <Send />}
              {sending ? 'Envoi…' : sendLabel}
            </Button>
            {status === 'sent' && (
              <Button variant="ghost" className="text-destructive hover:bg-state-red hover:text-destructive" onClick={() => setConfirmRevoke(true)} disabled={revoking}>
                <Unlink />
                Couper le lien
              </Button>
            )}
          </div>

          {reasons.length > 0 && (
            <ul className="space-y-1">
              {reasons.map((r) => <Notice as="li" key={r} tone="amber">{r}</Notice>)}
            </ul>
          )}
          {sendError && <Notice tone="red">{sendError}</Notice>}
        </div>
      )}

      {/* Aperçu : la vraie page du client, avec les photos choisies */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="light-island block max-w-4xl w-[95vw] h-[90vh] p-0 overflow-y-auto print:hidden">
          <DialogTitle className="sr-only">Aperçu du bilan client</DialogTitle>
          <DialogDescription className="sr-only">La page telle que le client la verra.</DialogDescription>
          <p className="sticky top-0 z-10 bg-state-amber text-state-amber-fg text-xs text-center px-10 py-2">
            Aperçu : le client verra cette page{status === 'sent' ? '' : ' après l’envoi'}. Les chiffres seront arrêtés au moment de l’envoi.
          </p>
          {report && <EventReportView report={previewReport(report, photos, selected)} appUrl={appUrl} />}
        </DialogContent>
      </Dialog>

      {/* Confirmation d'envoi ou de renvoi */}
      <Dialog open={confirmSend} onOpenChange={(o) => !o && !sending && setConfirmSend(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{status === 'sent' ? 'Actualiser et renvoyer le bilan ?' : 'Envoyer le bilan au client ?'}</DialogTitle>
            <DialogDescription>
              {status === 'sent'
                ? `Les chiffres sont recalculés et arrêtés à aujourd’hui. Le même lien est renvoyé à ${event.client_email}.`
                : `Les chiffres sont arrêtés à aujourd’hui et le lien est envoyé à ${event.client_email}. Il reste valable 12 mois.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmSend(false)} disabled={sending}>Annuler</Button>
            <Button onClick={handleSend} disabled={sending}>
              {sending ? <Loader2 className="animate-spin" /> : <Send />}
              {sending ? 'Envoi…' : sendLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Révocation */}
      <Dialog open={confirmRevoke} onOpenChange={(o) => !o && !revoking && setConfirmRevoke(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Couper le lien du bilan ?</DialogTitle>
            <DialogDescription>
              Le client verra « Ce bilan n’est plus disponible ». Un nouvel envoi créera un nouveau lien.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRevoke(false)} disabled={revoking}>Annuler</Button>
            <Button variant="destructive" onClick={handleRevoke} disabled={revoking}>
              {revoking && <Loader2 className="animate-spin" />}
              Couper le lien
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
