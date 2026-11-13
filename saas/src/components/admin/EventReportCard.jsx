// Carte « Bilan client » de la fiche événement (LAB-238, spec LAB-209 SAAS-2) : préparer, état des
// bornes, choix des photos, aperçu (la vraie page), envoyer, renvoyer, révoquer. Tous les chiffres
// viennent de build_event_report ; l'envoi passe par l'edge function send-event-report.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Check, Copy, Eye, Images, Loader2, RefreshCw, Send, Unlink } from 'lucide-react';
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
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '../ui/dialog';

const KIOSK_DOT = { ok: 'bg-emerald-500', pending: 'bg-amber-500', unknown: 'bg-amber-500', not_seen: 'bg-red-500' };
const STATUS_BADGE = {
  sent: 'bg-emerald-50 text-emerald-700',
  draft: 'bg-gray-100 text-gray-600',
  revoked: 'bg-red-50 text-red-700',
};
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
  const [copied, setCopied] = useState(false);

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

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Copie impossible : sélectionnez le lien à la main.');
    }
  }

  const sendLabel = status === 'sent' ? 'Actualiser et renvoyer' : 'Envoyer au client';

  return (
    <Card className="p-5 rounded-2xl shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
            <BarChart3 className="w-4 h-4 text-violet-600" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2 flex-wrap">
              Bilan client
              {statusInfo.label && (
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_BADGE[statusInfo.tone] ?? ''}`}>{statusInfo.label}</span>
              )}
            </h3>
            <p className="text-xs text-gray-400">
              {statusInfo.detail || (proposed
                ? 'Page de bilan à envoyer au client : séances, impressions, partages et photos choisies.'
                : 'Pas proposé d’office pour ce client (voir Réglages). Vous pouvez le préparer à la main.')}
            </p>
          </div>
        </div>
        {!prepared && (
          <Button onClick={() => prepare()} disabled={initLoading || preparing}
            variant={proposed ? 'default' : 'outline'} className="rounded-xl shrink-0">
            {preparing ? <Loader2 className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />}
            {preparing ? 'Préparation…' : 'Préparer le bilan'}
          </Button>
        )}
        {prepared && (
          <Button variant="outline" onClick={() => prepare({ keepSelection: true })} disabled={preparing || sending}
            className="rounded-xl shrink-0" title="Recalculer les chiffres et l’état des bornes">
            {preparing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Actualiser
          </Button>
        )}
      </div>

      {prepareError && <p className="mt-3 text-sm rounded-xl px-3 py-2 bg-red-50 text-red-700">{prepareError}</p>}

      {prepared && (
        <div className="mt-4 space-y-4">
          {/* État des bornes */}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-1.5">Bornes de l’événement</p>
            {kiosks.length === 0 ? (
              <p className="text-xs text-gray-400">Aucune borne vue pour cet événement.</p>
            ) : (
              <ul className="space-y-1">
                {kiosks.map((k, i) => (
                  <li key={`${k.label}-${i}`} className="flex items-center gap-2 text-xs text-gray-600">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${KIOSK_DOT[k.state]}`} />
                    <span className="font-medium text-gray-800">{k.label}</span>
                    <span className="text-gray-500">{k.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Photos */}
          <div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-gray-500">
                Photos du bilan : {selected.length}/{MAX_PHOTOS}
                {candidates.length === 0 && ' (aucune photo approuvée)'}
              </p>
              {candidates.length > 0 && (
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowPhotos((v) => !v)}>
                  <Images className="w-3.5 h-3.5" />
                  {showPhotos ? 'Fermer le choix' : 'Choisir les photos'}
                </Button>
              )}
            </div>
            {selected.length > 0 && !showPhotos && (
              <div className="mt-2 flex gap-2 flex-wrap">
                {selected.map((id) => {
                  const p = candidates.find((c) => c.id === id);
                  return p ? <img key={id} src={photoThumb(p)} alt="" className="w-12 h-12 object-cover rounded-lg border border-gray-100" /> : null;
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
                        className={`relative aspect-square rounded-lg overflow-hidden border-2 ${on ? 'border-violet-600' : 'border-transparent hover:border-gray-200'}`}
                        aria-pressed={on} aria-label={on ? `Retirer la photo ${order + 1}` : 'Ajouter cette photo'}>
                        <img src={photoThumb(p)} alt="" loading="lazy" className="w-full h-full object-cover" />
                        {on && (
                          <span className="absolute top-1 left-1 w-5 h-5 rounded-full bg-violet-600 text-white text-[11px] font-semibold flex items-center justify-center">
                            {order + 1}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <Button variant="outline" size="sm" className="h-8 rounded-lg" onClick={handleDefaultPhotos} disabled={savingPhotos}>
                    6 photos réparties dans la soirée
                  </Button>
                  {status === 'sent' && !sameIds(selected, savedSelection) && (
                    <Button size="sm" className="h-8 rounded-lg" onClick={() => persistSelection(selected)} disabled={savingPhotos}>
                      {savingPhotos && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      Mettre à jour les photos en ligne
                    </Button>
                  )}
                  {status === 'sent' && (
                    <span className="text-xs text-gray-400">Le bilan déjà envoyé montre ces photos dès la mise à jour.</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Lien envoyé */}
          {link && (
            <div className="flex items-center gap-2 rounded-xl bg-gray-50 px-3 py-2">
              <a href={link} target="_blank" rel="noreferrer" className="text-xs text-violet-700 truncate flex-1 hover:underline">{link}</a>
              <Button variant="ghost" size="sm" className="h-7 text-xs shrink-0" onClick={handleCopy}>
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copié' : 'Copier'}
              </Button>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <Button variant="outline" className="rounded-xl" onClick={() => setShowPreview(true)}>
              <Eye className="w-4 h-4" />
              Aperçu
            </Button>
            <Button className="rounded-xl" onClick={() => { setSendError(''); setConfirmSend(true); }} disabled={!canSend}>
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {sending ? 'Envoi…' : sendLabel}
            </Button>
            {status === 'sent' && (
              <Button variant="ghost" className="rounded-xl text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => setConfirmRevoke(true)} disabled={revoking}>
                <Unlink className="w-4 h-4" />
                Couper le lien
              </Button>
            )}
          </div>

          {reasons.length > 0 && (
            <ul className="space-y-1">
              {reasons.map((r) => <li key={r} className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">{r}</li>)}
            </ul>
          )}
          {sendError && <p className="text-sm rounded-xl px-3 py-2 bg-red-50 text-red-700">{sendError}</p>}
        </div>
      )}

      {/* Aperçu : la vraie page du client, avec les photos choisies */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="block max-w-4xl w-[95vw] h-[90vh] p-0 overflow-y-auto print:hidden">
          <DialogTitle className="sr-only">Aperçu du bilan client</DialogTitle>
          <DialogDescription className="sr-only">La page telle que le client la verra.</DialogDescription>
          <p className="sticky top-0 z-10 bg-amber-50 text-amber-800 text-xs text-center px-10 py-2">
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
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
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
              {revoking && <Loader2 className="w-4 h-4 animate-spin" />}
              Couper le lien
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
