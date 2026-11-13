// LAB-245 (spec LAB-241 §6) : envoyer l'événement sur la borne depuis le SaaS.
// - EventKioskPushCard : carte « Envoyer sur la borne » de la fiche événement (choix de la borne) ;
// - KioskEventPushSection : section de la carte borne, page Licences (choix de l'événement).
// La borne lit l'envoi au démarrage puis toutes les 20 s sur l'accueil ou la saisie du code (LAB-246),
// le charge dès qu'aucune séance invité n'est en cours (sans confirmation sur la borne) et le confirme.
// Le code d'accès et le .pola restent.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { cancelEventRequest, requestEventOnKiosk } from '../../lib/supabase';
import {
  canCancelEventPush, defaultPushKiosk, eventPushHint, eventPushMessage, eventPushStatus,
  eventPushStatusFor, isEventPushable, kioskLabel, pushableEvents, pushableKiosks,
} from '../../lib/kioskEventPush';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/select';

/** Relecture du suivi tant que la borne n'a pas chargé l'envoi (elle le lit toutes les 20 s). */
const PENDING_REFRESH_MS = 5_000;

const STATE_STYLE = {
  requested: 'text-amber-700',
  received:  'text-amber-700',
  applied:   'text-emerald-700',
  failed:    'text-red-600',
};

const isPending = (status) => status?.state === 'requested' || status?.state === 'received';

function confirmSend(eventName, lic) {
  return confirm(`Envoyer « ${eventName} » sur « ${kioskLabel(lic)} » ?\n`
    + 'La borne l\'affichera dès qu\'aucune séance invité n\'est en cours, sans confirmation sur place.');
}

/** Relit le suivi toutes les 5 s tant que l'envoi attend la borne ; renvoie l'heure courante. */
function usePendingRefresh(pending, onRefresh) {
  const [now, setNow] = useState(() => Date.now());
  const refreshRef = useRef(onRefresh);
  useEffect(() => { refreshRef.current = onRefresh; }, [onRefresh]);
  useEffect(() => {
    if (!pending) return undefined;
    const timer = setInterval(() => {
      setNow(Date.now());
      refreshRef.current?.();
    }, PENDING_REFRESH_MS);
    return () => clearInterval(timer);
  }, [pending]);
  return [now, setNow];
}

function PushStatus({ status, eventName, onCancel, cancelling }) {
  const message = eventPushMessage(status);
  if (!message) return null;
  const hint = eventPushHint(status);
  return (
    <div className="mt-2 space-y-1">
      <p className={`text-xs ${STATE_STYLE[status.state] ?? 'text-gray-500'}`}>
        {eventName ? <span className="text-gray-500">{eventName} · </span> : null}
        {message}
      </p>
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
      {canCancelEventPush(status) && (
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onCancel} disabled={cancelling}>
          {cancelling ? 'Annulation…' : 'Annuler l\'envoi'}
        </Button>
      )}
    </div>
  );
}

function useCancel(lic, onLicenseUpdate) {
  const [cancelling, setCancelling] = useState(false);
  async function cancel() {
    if (!lic) return;
    setCancelling(true);
    try {
      onLicenseUpdate(lic.id, await cancelEventRequest(lic.id));
      toast.success('Envoi annulé');
    } catch (err) {
      toast.error(err.message);
    } finally { setCancelling(false); }
  }
  return [cancel, cancelling];
}

/**
 * Fiche événement. licenses : bornes visibles (retirées comprises, filtrées ici).
 * onLicenseUpdate(id, colonnes) fusionne le suivi ; onRefresh relit les bornes.
 */
export function EventKioskPushCard({ event, licenses, designApproved, onLicenseUpdate, onRefresh }) {
  const kiosks = useMemo(() => pushableKiosks(licenses, event.org_id), [licenses, event.org_id]);
  const [choice, setChoice] = useState(null);
  const [sending, setSending] = useState(false);
  // Par défaut la borne assignée à l'événement, tant que l'admin n'en a pas choisi une autre.
  const kioskId = choice && kiosks.some(k => k.id === choice) ? choice : defaultPushKiosk(kiosks, event.photobooth_id);
  const lic = kiosks.find(k => k.id === kioskId) ?? null;

  const [now, setNow] = usePendingRefresh(isPending(lic && eventPushStatusFor(lic, event.id)), onRefresh);
  const status = lic ? eventPushStatusFor(lic, event.id, now) : null;
  const [cancel, cancelling] = useCancel(lic, onLicenseUpdate);
  const pushable = isEventPushable(event);

  async function send() {
    if (!lic || !confirmSend(event.name, lic)) return;
    setSending(true);
    try {
      onLicenseUpdate(lic.id, await requestEventOnKiosk(lic.id, event.id));
      setNow(Date.now());
      toast.success('Événement envoyé sur la borne');
    } catch (err) {
      toast.error(err.message);
    } finally { setSending(false); }
  }

  return (
    <Card className="p-5 rounded-2xl shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-xl bg-orange-100 flex items-center justify-center">
          <Send className="w-4 h-4 text-orange-600" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-gray-800">Envoyer sur la borne</h3>
          <p className="text-xs text-gray-400">Sans code à taper : la borne charge l'événement toute seule</p>
        </div>
      </div>

      {!pushable ? (
        <p className="text-xs text-gray-500">Événement archivé : il ne peut plus être envoyé sur une borne.</p>
      ) : kiosks.length === 0 ? (
        <p className="text-xs text-gray-500">
          Aucune borne active dans ce compte.{' '}
          <Link to="/admin/licenses" className="underline underline-offset-2">Voir les bornes</Link>
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={kioskId || undefined} onValueChange={setChoice}>
              <SelectTrigger className="flex-1 min-w-40" aria-label="Borne">
                <SelectValue placeholder="Choisir une borne" />
              </SelectTrigger>
              <SelectContent>
                {kiosks.map(k => <SelectItem key={k.id} value={k.id}>{kioskLabel(k)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={send} disabled={!lic || sending}>
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Envoyer sur la borne
            </Button>
          </div>
          {!designApproved && (
            <p className="text-xs text-amber-700 mt-2">
              Le design du client n'est pas encore approuvé : la borne imprimera sans cadre tant qu'il ne l'est pas.
            </p>
          )}
          {status?.otherPending && (
            <p className="text-xs text-gray-500 mt-2">
              Un autre événement attend d'être chargé sur cette borne : cet envoi le remplacera.
            </p>
          )}
          {status && <PushStatus status={status} onCancel={cancel} cancelling={cancelling} />}
        </>
      )}
    </Card>
  );
}

/**
 * Carte borne, page Licences. events : événements lisibles en cours (fetchPushableEvents),
 * filtrés ici sur le compte de la borne.
 */
export function KioskEventPushSection({ lic, events, onLicenseUpdate, onRefresh }) {
  const choices = useMemo(() => pushableEvents(events, lic.org_id, lic.id), [events, lic.org_id, lic.id]);
  const [choice, setChoice] = useState(null);
  const [sending, setSending] = useState(false);
  const [now, setNow] = usePendingRefresh(isPending(eventPushStatus(lic)), onRefresh);
  const status = eventPushStatus(lic, now);
  const [cancel, cancelling] = useCancel(lic, onLicenseUpdate);

  // Par défaut l'événement déjà envoyé, sinon le premier (ceux assignés à la borne d'abord).
  const eventId = [choice, status.eventId].find(id => id && choices.some(e => e.id === id)) ?? choices[0]?.id ?? '';
  const selected = choices.find(e => e.id === eventId) ?? null;
  const pushedName = status.eventId
    ? ((events ?? []).find(e => e.id === status.eventId)?.name ?? 'Événement envoyé')
    : null;

  async function send() {
    if (!selected || !confirmSend(selected.name, lic)) return;
    setSending(true);
    try {
      onLicenseUpdate(lic.id, await requestEventOnKiosk(lic.id, selected.id));
      setNow(Date.now());
      toast.success('Événement envoyé sur la borne');
    } catch (err) {
      toast.error(err.message);
    } finally { setSending(false); }
  }

  return (
    <div className="pt-3 border-t border-gray-50">
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Événement sur la borne</p>
      {!lic.is_active ? (
        <p className="text-xs text-gray-400">Borne désactivée : réactivez-la pour y envoyer un événement.</p>
      ) : choices.length === 0 ? (
        <p className="text-xs text-gray-400">Aucun événement en cours dans ce compte.</p>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={eventId || undefined} onValueChange={setChoice}>
            <SelectTrigger className="h-8 w-auto min-w-48 max-w-full text-sm" aria-label="Événement à envoyer">
              <SelectValue placeholder="Choisir un événement" />
            </SelectTrigger>
            <SelectContent>
              {choices.map(e => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name}{e.photobooth_id === lic.id ? ' (assigné)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" className="h-8" onClick={send} disabled={!selected || sending}>
            {sending ? 'Envoi…' : 'Envoyer sur la borne'}
          </Button>
        </div>
      )}
      <PushStatus status={status} eventName={pushedName} onCancel={cancel} cancelling={cancelling} />
    </div>
  );
}
