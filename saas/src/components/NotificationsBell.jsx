import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { IconCircle } from './ui/icon-circle';
import { StatusPill } from './ui/status-pill';
import {
  supabase, dismissKioskAlert, dismissNotification, fetchKioskAlerts, fetchNotifications, markNotificationRead,
} from '../lib/supabase';

function timeAgo(iso) {
  if (!iso) return '';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1)  return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h}h`;
  return `il y a ${Math.floor(h / 24)}j`;
}

const ALERT_META = {
  machine_offline:  { label: 'Borne hors ligne',  icon: 'M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M5.636 5.636a9 9 0 000 12.728m0 0l2.829-2.829m-2.829 2.829L3 21M9 12a3 3 0 116 0 3 3 0 01-6 0z' },
  printer_problem:  { label: 'Problème imprimante', icon: 'M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z' },
  camera_problem:   { label: 'Appareil photo débranché', icon: 'M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z M15 13a3 3 0 11-6 0 3 3 0 016 0z' },
  print_quota_near: { label: "Quota d'impressions", icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  paper_low:        { label: 'Papier bientôt vide', icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
  // LAB-329 : plantage ou erreurs répétées de l'appareil photo pendant un événement
  kiosk_errors:     { label: 'Erreurs sur la borne', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
};

// Cloche : bouton du haut, et icône des notifications dont la sorte n'est pas connue (rond jamais vide).
const BELL_ICON = 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9';

// Page Kiosks ; les erreurs de la borne ouvrent ses journaux sur l'événement (LAB-329).
const alertTarget = (a) => (a.alert_type === 'kiosk_errors' && a.event_id
  ? `/admin/bornes?event=${encodeURIComponent(a.event_id)}`
  : '/admin/bornes');

// Notifications commerciales (pipeline de vente). type libre côté base.
const NOTIF_META = {
  nouveau_client:     { label: 'Nouveau client signé',   icon: 'M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z' },
  acompte_non_regle:  { label: 'Acompte non réglé',      icon: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z' },
  solde_a_envoyer:    { label: 'Solde à envoyer',        icon: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
  retrait_a_caler:    { label: 'Retrait à caler',         icon: 'M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1' },
  borne_non_assignee: { label: 'Borne non assignée',      icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
  // Réservation en ligne (LAB-62)
  devis_signe:        { label: 'Devis signé',             icon: 'M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z' },
  acompte_regle:      { label: 'Réservation confirmée',   icon: 'M5 13l4 4L19 7' },
  email_erreur:       { label: 'Email non envoyé',        icon: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
  retractation:       { label: 'Rétractation',            icon: 'M6 18L18 6M6 6l12 12' },
  accord_image:       { label: 'Accord photos',           icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
  // Rapprochement bancaire (LAB-64)
  virement_non_rattache: { label: 'Virement à rattacher',  icon: 'M3 10h18M5 10v8m4-8v8m6-8v8m4-8v8M3 21h18M12 3l9 5H3l9-5z' },
  cheque_a_rattacher:    { label: 'Chèque à rattacher',    icon: 'M3 10h18M5 10v8m4-8v8m6-8v8m4-8v8M3 21h18M12 3l9 5H3l9-5z' },
  virement_partiel:      { label: 'Paiement partiel',      icon: 'M3 10h18M5 10v8m4-8v8m6-8v8m4-8v8M3 21h18M12 3l9 5H3l9-5z' },
  trop_percu:            { label: 'Trop-perçu',            icon: 'M3 10h18M5 10v8m4-8v8m6-8v8m4-8v8M3 21h18M12 3l9 5H3l9-5z' },
  facture_annulee:       { label: 'Facture annulée (avoir)', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
  solde_deja_regle:      { label: 'Solde déjà encaissé',   icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
  solde_a_verifier:      { label: 'Solde à facturer à la main', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
  virement_sur_expiree:  { label: 'Acompte sur réservation expirée', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
  conversion_erreur:     { label: 'Événement non créé',    icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
  // Relances et expirations (LAB-65)
  devis_expire:          { label: 'Devis expiré',              icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
  devis_date_complete:   { label: 'Date complète (devis ouvert)', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
  devis_reactive:        { label: 'Devis réactivé',            icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15' },
  reactivation_demandee: { label: 'Réactivation demandée',     icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15' },
  acompte_prolonge:      { label: 'Délai d’acompte prolongé',  icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
  acompte_impaye:        { label: 'Acompte impayé : à décider', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
  acompte_expire:        { label: 'Réservation expirée',       icon: 'M6 18L18 6M6 6l12 12' },
  // LAB-75 : acompte non reçu après la prolongation automatique → expiration automatique, date libérée.
  acompte_expire_auto:   { label: 'Acompte non reçu : date libérée', icon: 'M6 18L18 6M6 6l12 12' },
  expiration_suspendue:  { label: 'Expiration suspendue',      icon: 'M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z' },
  indemnite_a_verser:    { label: 'Indemnité à verser',        icon: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z' },
  solde_impaye:          { label: 'Solde impayé',              icon: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z' },
  facture_solde:         { label: 'Facture de solde envoyée',  icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
  // Acompte demandé après coup à un pro confirmé à 0 % (LAB-148).
  acompte_demande:        { label: 'Facture d’acompte envoyée', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
  acompte_demande_regle:  { label: 'Acompte reçu',              icon: 'M5 13l4 4L19 7' },
  acompte_demande_impaye: { label: 'Acompte demandé non reçu',  icon: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z' },
  // Créneaux de retrait / retour (LAB-72, LAB-74)
  creneaux_a_fixer:       { label: 'Créneaux à fixer',          icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
  creneau_modifie:        { label: 'Créneau modifié',           icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
  creneaux_indisponibles: { label: 'Créneaux indisponibles',    icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
  // Message libre de la page /contact/ du site (LAB-79) : le détail est dans l'email admin.
  message_contact:        { label: 'Message du site',           icon: 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z' },
};

// Notifications de virement : l'action se fait dans « Virements à traiter » (liste des devis).
const PAYMENT_TYPES = new Set(['virement_non_rattache', 'cheque_a_rattacher']);

function notifTarget(n) {
  if (n.type === 'message_contact' && n.payload?.email) return `mailto:${n.payload.email}`;
  if (PAYMENT_TYPES.has(n.type)) return '/admin/ventes?tab=devis&virements=1';
  if (n.event_id) return `/admin/events/${n.event_id}`;
  const leadId = n.lead_id ?? n.payload?.lead_id;
  return leadId ? `/admin/demandes/${leadId}` : '/admin/events';
}

export default function NotificationsBell() {
  const [alerts, setAlerts] = useState([]);   // kiosk_alerts (monitoring parc)
  const [notifs, setNotifs] = useState([]);   // notifications commerciales
  const [open,   setOpen]   = useState(false);
  const ref = useRef(null);
  // Nom de channel unique par instance : le composant est monté 2x (barre mobile + sidebar),
  // un nom partagé provoque « cannot add postgres_changes callbacks after subscribe() ».
  const channelName = useRef(`notifs-bell-${Math.random().toString(36).slice(2)}`);
  const navigate = useNavigate();

  async function loadAlerts() {
    try { setAlerts(await fetchKioskAlerts(20, { hideDismissed: true })); } catch { /* non bloquant */ }
  }
  async function loadNotifs() {
    try { setNotifs(await fetchNotifications(30)); } catch { /* non bloquant */ }
  }

  useEffect(() => {
    loadAlerts();
    loadNotifs();
    const channel = supabase
      .channel(channelName.current)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kiosk_alerts' }, loadAlerts)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, loadNotifs)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  // Fermeture au clic extérieur
  useEffect(() => {
    if (!open) return;
    function onClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // Liste fusionnée, triée par date, non-lues en tête.
  const items = [
    ...alerts.map(a => ({
      id: `alert-${a.id}`,
      rawId: a.id,
      kind: 'alert',
      meta: ALERT_META[a.alert_type] ?? { label: a.alert_type, icon: BELL_ICON },
      title: (ALERT_META[a.alert_type] ?? { label: a.alert_type }).label,
      subtitle: `${a.events?.name ?? '—'}${a.machine_id ? ` · ${a.machine_id.slice(0, 10)}` : ''}`,
      date: a.sent_at,
      unread: !a.resolved_at,
      to: alertTarget(a),
    })),
    ...notifs.map(n => ({
      id: `notif-${n.id}`,
      rawId: n.id,
      kind: 'notif',
      meta: NOTIF_META[n.type] ?? { label: n.type, icon: BELL_ICON },
      title: n.title || (NOTIF_META[n.type] ?? { label: n.type }).label,
      subtitle: n.events?.name || n.events?.client_name || n.payload?.booking_number || n.payload?.email || '—',
      date: n.created_at,
      unread: !n.read_at,
      to: notifTarget(n),
    })),
  ].sort((a, b) => {
    if (a.unread !== b.unread) return a.unread ? -1 : 1;
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });

  const openCount = items.filter(i => i.unread).length;

  // Croix : retire l'élément de la liste tout de suite, le remet si l'enregistrement échoue.
  async function handleDismiss(item) {
    const isAlert = item.kind === 'alert';
    const previous = isAlert ? alerts : notifs;
    if (isAlert) setAlerts(as => as.filter(a => a.id !== item.rawId));
    else setNotifs(ns => ns.filter(n => n.id !== item.rawId));
    try {
      if (isAlert) await dismissKioskAlert(item.rawId);
      else await dismissNotification(item.rawId, { unread: item.unread });
    } catch {
      if (isAlert) setAlerts(previous); else setNotifs(previous);
      toast.error("La notification n'a pas pu être supprimée. Réessayez.");
    }
  }

  async function handleClick(item) {
    setOpen(false);
    if (item.kind === 'notif' && item.unread) {
      try {
        await markNotificationRead(item.rawId);
        setNotifs(ns => ns.map(n => n.id === item.rawId ? { ...n, read_at: new Date().toISOString() } : n));
      } catch { /* non bloquant */ }
    }
    if (item.to.startsWith('mailto:')) window.location.assign(item.to);
    else navigate(item.to);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        title="Notifications"
        className="relative flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d={BELL_ICON} />
        </svg>
        {openCount > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground ring-2 ring-card">
            {openCount > 9 ? '9+' : openCount}
          </span>
        )}
      </button>

      {open && (
        // Mobile : sous la barre du haut, toute la largeur ; ordinateur : sous la cloche, aligné à droite.
        <div className="fixed inset-x-2 top-16 md:absolute md:inset-x-auto md:right-0 md:top-full md:mt-2 md:w-[30rem] md:max-w-[calc(100vw-2rem)] max-h-[70vh] overflow-y-auto bg-card rounded-card border border-border shadow-float z-[60]">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border sticky top-0 bg-card">
            <span className="text-sm font-medium text-foreground">Notifications</span>
            {openCount > 0 && (
              <StatusPill tone="red" dot={false}>{openCount} non lue{openCount > 1 ? 's' : ''}</StatusPill>
            )}
          </div>

          {items.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <svg className="w-9 h-9 mx-auto text-muted-foreground/60 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <p className="text-sm text-muted-foreground">Aucune notification. Tout va bien.</p>
            </div>
          ) : (
            <div>
              {items.map((item, i) => (
                <div key={item.id} className={`relative ${i > 0 ? 'border-t border-border' : ''}`}>
                  <button
                    onClick={() => handleClick(item)}
                    className={`w-full text-left flex items-start gap-3 pl-4 pr-12 py-3 hover:bg-soft transition-colors ${item.unread ? '' : 'opacity-60'}`}>
                    <IconCircle size="sm" tone={item.unread ? 'navy' : 'muted'}>
                      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d={item.meta.icon} />
                      </svg>
                    </IconCircle>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-foreground truncate">{item.title}</p>
                        {item.unread && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-destructive" />}
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{item.subtitle}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{timeAgo(item.date)}</p>
                    </div>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleDismiss(item)}
                    title="Supprimer la notification"
                    aria-label={`Supprimer la notification « ${item.title} »`}
                    className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
                  >
                    <X />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
