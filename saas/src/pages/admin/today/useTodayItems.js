// Liste « À faire » de la page Aujourd'hui (LAB-336), chargée une fois par le layout de l'admin :
// le badge du menu et la page lisent les mêmes éléments (buildTodayItems), donc le même nombre.
// Les actions reportées ou masquées (today_dismissals) sont retirées de `items` et rangées dans
// `hiddenItems` : elles ne comptent pas dans le badge.
// Mise en route (LAB-344) : étapes de la carte (setupSteps.js), reportées dans « À faire » seulement
// quand la carte est masquée (today_dismissals `setup:card`).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  supabase, clearTodayDismissal, fetchLicenses, fetchServiceStatus, fetchSetupInputs, fetchTodayDismissals,
  getGuestExportReminders, markNotificationRead, setTodayDismissal,
} from '../../../lib/supabase';
import { DESIGN_KINDS } from '../../../lib/clientDesigns';
import { buildTodayItems, splitDismissed } from '../../../lib/todayItems';
import { SETUP_CARD_KEY, buildSetupSteps, isSetupCardHidden, setupTodayItems } from '../../../lib/setupSteps';
import { useFeatures } from '../../../hooks/useFeatures';
import { useAppAdmin } from '../../../hooks/useAppAdmin';
import { isFeatureEnabled } from '../../../features/catalog';
import { INSTALLED_MODULES, moduleHook } from '../../../features/modules';

const DAY_MS = 24 * 60 * 60 * 1000;
// Relecture au changement de page, au plus une fois par période.
const RELOAD_EVERY_MS = 60_000;

/** Alertes ouvertes des bornes, avec l'événement concerné. */
async function fetchOpenAlerts() {
  const { data, error } = await supabase
    .from('kiosk_alerts')
    .select('id, event_id, machine_id, alert_type, detail, sent_at, resolved_at, events(name, start_date)')
    .is('resolved_at', null)
    .order('sent_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return data ?? [];
}

/** Cadres photo et écrans d'accueil soumis par les clients, avec leur événement. */
async function fetchSubmittedDesigns() {
  const { data, error } = await supabase
    .from('client_designs')
    .select('id, event_id, kind, submitted_at')
    .in('kind', DESIGN_KINDS)
    .eq('status', 'submitted');
  if (error) throw error;
  const designs = data ?? [];
  const ids = [...new Set(designs.map((d) => d.event_id).filter(Boolean))];
  if (!ids.length) return designs;
  const { data: events } = await supabase.from('events').select('id, name, client_name, start_date').in('id', ids);
  const byId = new Map((events ?? []).map((e) => [e.id, e]));
  return designs.map((d) => ({ ...d, events: byId.get(d.event_id) ?? null }));
}

/** Événements qui commencent dans les 7 prochains jours sans borne assignée. */
async function fetchEventsWithoutBorne() {
  const now = new Date();
  const { data, error } = await supabase
    .from('events')
    .select('id, name, client_name, start_date')
    .neq('status', 'archived')
    .is('photobooth_id', null)
    .gte('start_date', now.toISOString())
    .lte('start_date', new Date(now.getTime() + 7 * DAY_MS).toISOString())
    .order('start_date', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Étapes fournies par les modules (crochet `setup.steps`) pour l'organisation, si leur fonctionnalité est active. */
async function loadModuleSetupSteps(org) {
  const hook = moduleHook('setup.steps');
  if (!org?.id || !hook || !isFeatureEnabled(org.features, hook.feature)) return [];
  try {
    const steps = await hook.run(org.id);
    return Array.isArray(steps) ? steps : [];
  } catch {
    return [];
  }
}

const EMPTY = {
  items: [],
  hiddenItems: [],
  alertCount: 0,
  sales: null,
  licenses: [],
  loading: true,
  error: '',
  reload: () => {},
  refreshIfStale: () => {},
  ack: () => {},
  dismiss: async () => {},
  restore: async () => {},
  setup: null,
  setupHidden: false,
  hideSetup: async () => {},
  showSetup: async () => {},
};

export const TodayContext = createContext(EMPTY);
export const useToday = () => useContext(TodayContext);

/**
 * Charge les sources de la liste « À faire » et renvoie { items, hiddenItems, alertCount, sales,
 * licenses, loading, error, reload, refreshIfStale, ack, dismiss, restore }. `sales` : données du module réservation (crochet `dashboard.load`),
 * aussi lues par le tunnel de vente. `ack(id)` : accuse réception d'une notification (nouveau client).
 * `dismiss(item, until)` : reporte l'action jusqu'à `until` (ISO) ou la masque (null) ;
 * `restore(item)` : la remet dans la liste. Les deux rejettent en cas d'erreur (liste rétablie).
 * Mise en route : `setup` (résultat de buildSetupSteps, null tant que la première lecture n'est pas
 * finie ou sans organisation à soi), `setupHidden`, `hideSetup()` et `showSetup()` (mêmes règles).
 */
export function useTodayItems() {
  const { isAvailable, features, loading: featuresLoading, error: featuresError } = useFeatures();
  const { isAdmin, loading: adminLoading } = useAppAdmin();
  const [alerts, setAlerts] = useState([]);
  const [designs, setDesigns] = useState([]);
  const [eventsWithoutBorne, setEventsWithoutBorne] = useState([]);
  const [guestReminders, setGuestReminders] = useState([]);
  const [licenses, setLicenses] = useState([]);
  const [sales, setSales] = useState(null);
  const [dismissals, setDismissals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [setupInputs, setSetupInputs] = useState(null);
  const [moduleSetupSteps, setModuleSetupSteps] = useState([]);
  const [setupRead, setSetupRead] = useState(false);
  const [serviceStatus, setServiceStatus] = useState(null);
  const [statusRead, setStatusRead] = useState(false);
  const lastLoad = useRef(0);
  const alive = useRef(true);
  // reload n'a pas de dépendances : il lit le rôle par une référence.
  const isAdminRef = useRef(false);

  // Fonctionnalités avec lesquelles les étapes des modules ont été lues (voir l'effet plus bas).
  const stepsFeatures = useRef(null);
  const statusPending = useRef(null);
  const statusReadAt = useRef(0);

  // Une seule lecture à la fois, et pas de nouvelle lecture dans les 10 s qui suivent la précédente :
  // au démarrage, le rôle et la première lecture de la liste la demandent tous les deux.
  const loadServiceStatus = useCallback(() => {
    if (statusPending.current) return statusPending.current;
    if (Date.now() - statusReadAt.current < 10_000) return Promise.resolve();
    statusPending.current = fetchServiceStatus()
      .then((status) => {
        statusReadAt.current = Date.now();
        if (!alive.current) return;
        setServiceStatus(status);
        setStatusRead(true);
      })
      .finally(() => { statusPending.current = null; });
    return statusPending.current;
  }, []);

  const loadAlerts = useCallback(async () => {
    try { const a = await fetchOpenAlerts(); if (alive.current) setAlerts(a); } catch { /* non bloquant */ }
  }, []);
  const loadDesigns = useCallback(async () => {
    try { const d = await fetchSubmittedDesigns(); if (alive.current) setDesigns(d); } catch { /* non bloquant */ }
  }, []);

  const reload = useCallback(async () => {
    lastLoad.current = Date.now();
    const salesLoad = moduleHook('dashboard.load');
    const results = await Promise.allSettled([
      fetchOpenAlerts(),
      fetchSubmittedDesigns(),
      fetchEventsWithoutBorne(),
      getGuestExportReminders(),
      fetchLicenses({ includeRetired: true }),
      salesLoad ? salesLoad.run() : Promise.resolve(null),
      fetchTodayDismissals(),
      fetchSetupInputs(),
    ]);
    if (!alive.current) return;
    const [a, d, e, g, l, s, h, si] = results.map((r) => (r.status === 'fulfilled' ? r.value : undefined));
    if (a) setAlerts(a);
    if (d) setDesigns(d);
    if (e) setEventsWithoutBorne(e);
    if (g) setGuestReminders(g);
    if (l) setLicenses(l);
    if (s !== undefined) setSales(s);
    if (h) setDismissals(h);
    const failed = results.filter((r) => r.status === 'rejected');
    setError(failed.length ? 'Une partie de la liste n’a pas pu être chargée.' : '');
    setLoading(false);
    // Mise en route : étapes des modules (il faut l'organisation) et état des services, après la liste.
    if (isAdminRef.current) loadServiceStatus();
    if (si) {
      const steps = await loadModuleSetupSteps(si.org);
      if (!alive.current) return;
      stepsFeatures.current = JSON.stringify(si.org?.features ?? {});
      setSetupInputs(si);
      setModuleSetupSteps(steps);
    }
    setSetupRead(true);
  }, [loadServiceStatus]);

  // Le rôle arrive après la première lecture : l'état des services est lu dès qu'il est connu.
  useEffect(() => {
    isAdminRef.current = isAdmin;
    if (isAdmin) loadServiceStatus();
  }, [isAdmin, loadServiceStatus]);

  // Fonctionnalités changées (Réglages › Fonctionnalités) : les étapes des modules sont relues tout de
  // suite, sans attendre la prochaine lecture de la liste (étape Réservation dès son activation).
  useEffect(() => {
    if (featuresLoading || featuresError || !setupInputs?.org) return;
    const key = JSON.stringify(features ?? {});
    if (key === stepsFeatures.current) return;
    stepsFeatures.current = key;
    let cancelled = false;
    loadModuleSetupSteps({ ...setupInputs.org, features }).then((steps) => {
      if (!cancelled && alive.current) setModuleSetupSteps(steps);
    });
    return () => { cancelled = true; };
  }, [features, featuresLoading, featuresError, setupInputs]);

  /** Relit la liste si la dernière lecture date de plus de `maxAgeMs` (une minute par défaut). */
  const refreshIfStale = useCallback((maxAgeMs = RELOAD_EVERY_MS) => {
    if (Date.now() - lastLoad.current > maxAgeMs) reload();
  }, [reload]);

  const ack = useCallback(async (notificationId) => {
    if (!notificationId) return;
    setSales((prev) => prev && { ...prev, newClients: (prev.newClients ?? []).filter((n) => n.id !== notificationId) });
    try { await markNotificationRead(notificationId); } catch { /* non bloquant */ }
  }, []);

  const dismiss = useCallback(async (item, until = null) => {
    const key = item?.dismissKey;
    if (!key) return;
    let previous;
    setDismissals((prev) => {
      previous = prev;
      return [...prev.filter((d) => d.item_key !== key), { item_key: key, until }];
    });
    try {
      await setTodayDismissal(key, until);
    } catch (err) {
      if (alive.current) setDismissals(previous);
      throw err;
    }
  }, []);

  const restore = useCallback(async (item) => {
    const key = item?.dismissKey;
    if (!key) return;
    let previous;
    setDismissals((prev) => {
      previous = prev;
      return prev.filter((d) => d.item_key !== key);
    });
    try {
      await clearTodayDismissal(key);
    } catch (err) {
      if (alive.current) setDismissals(previous);
      throw err;
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    // Première lecture : par le layout (changement de page) ou par la page Aujourd'hui (refreshIfStale).
    // Temps réel : un cadre soumis ou une alerte de borne met la liste à jour sans recharger la page.
    const channel = supabase
      .channel('today-items-watch')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_designs' }, loadDesigns)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kiosk_alerts' }, loadAlerts)
      .subscribe();
    return () => { alive.current = false; supabase.removeChannel(channel); };
  }, [loadAlerts, loadDesigns]);

  // Carte affichée seulement quand tout est lu (rôle, et état des services pour l'administrateur).
  const setupReady = setupRead && !adminLoading && (!isAdmin || statusRead);
  const setup = useMemo(() => {
    if (!setupReady || !setupInputs?.org) return null;
    // Choix des fonctionnalités : ceux du hook, à jour dès l'enregistrement (« Garder ces choix »).
    // Hook en erreur : ses `features` valent {} ; on garde alors celles lues avec l'organisation.
    const org = featuresLoading || featuresError ? setupInputs.org : { ...setupInputs.org, features };
    return buildSetupSteps({
      org,
      installed: INSTALLED_MODULES,
      isAppAdmin: isAdmin,
      serviceStatus,
      activeTemplates: setupInputs.activeTemplates,
      licenses,
      kioskPhotos: setupInputs.kioskPhotos,
      eventCount: setupInputs.eventCount,
      moduleSteps: moduleSetupSteps,
    });
  }, [setupReady, setupInputs, featuresLoading, featuresError, features, isAdmin, serviceStatus, licenses, moduleSetupSteps]);

  const setupHidden = useMemo(() => isSetupCardHidden(dismissals), [dismissals]);

  const allItems = useMemo(() => {
    const itemsHook = moduleHook('dashboard.items');
    const moduleItems = itemsHook && isAvailable(itemsHook.feature) ? itemsHook.run(sales, isAvailable) : [];
    const setupItems = setupHidden ? setupTodayItems(setup) : [];
    return buildTodayItems(
      { alerts, licenses, designs, eventsWithoutBorne, guestReminders, moduleItems, setupItems },
      { isAvailable },
    );
  }, [alerts, licenses, designs, eventsWithoutBorne, guestReminders, sales, isAvailable, setupHidden, setup]);

  const { visible: items, hidden: hiddenItems } = useMemo(
    () => splitDismissed(allItems, dismissals),
    [allItems, dismissals],
  );

  // Pastille de Bornes : toutes les alertes ouvertes, même masquées dans « À faire ».
  const alertCount = useMemo(() => allItems.filter((item) => item.kind === 'alert').length, [allItems]);

  // Masquer / réafficher la carte : même écriture que le report d'une action (`setup:card`).
  const hideSetup = useCallback(() => dismiss({ dismissKey: SETUP_CARD_KEY }, null), [dismiss]);
  const showSetup = useCallback(() => restore({ dismissKey: SETUP_CARD_KEY }), [restore]);

  return useMemo(
    () => ({
      items, hiddenItems, alertCount, sales, licenses, loading, error, reload, refreshIfStale, ack, dismiss, restore,
      setup, setupHidden, hideSetup, showSetup,
    }),
    [
      items, hiddenItems, alertCount, sales, licenses, loading, error, reload, refreshIfStale, ack, dismiss, restore,
      setup, setupHidden, hideSetup, showSetup,
    ],
  );
}
