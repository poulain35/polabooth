// Outils communs aux onglets de la fiche de l'événement (/admin/events/:id, LAB-337).
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export const APP_URL = (import.meta.env.VITE_APP_URL ?? window.location.origin).replace(/\/$/, '');

// Expiration par défaut des liens photos & audio : fin d'événement + 2 mois (date seule).
export function mediaExpiryDefault(endIso) {
  if (!endIso) return '';
  const [y, mo, d] = endIso.split('T')[0].split('-').map(Number);
  const dt = new Date(y, mo - 1, d);
  dt.setMonth(dt.getMonth() + 2);
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

/** Durée relative compacte (« il y a 3 min », « il y a 2 h »). */
export function timeAgo(iso) {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1)  return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24)   return `il y a ${h} h`;
  const d = Math.round(h / 24);
  return `il y a ${d} j`;
}

// Classes des lignes de réglages (thème de l'admin). Champ de saisie : <Input> (components/ui/input).
export const rowCls   = 'flex items-center justify-between py-3 border-b border-border last:border-0';
export const labelCls = 'text-sm text-foreground';

/**
 * Fait défiler jusqu'à la section de l'ancre (`#capture`) quand l'adresse change, une fois l'onglet
 * affiché (`ready`). Sert aux liens du sommaire, aux anciennes adresses et à « Prochaine étape ».
 */
export function useHashScroll(ready = true) {
  const { hash } = useLocation();
  useEffect(() => {
    if (!ready || !hash || hash.length < 2) return;
    const target = document.getElementById(decodeURIComponent(hash.slice(1)));
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [hash, ready]);
}
