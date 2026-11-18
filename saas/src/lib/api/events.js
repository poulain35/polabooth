// Événements (admin) : recherche, duplication, statistiques, historique des impressions.
import { sessionsNeedingThumbnail, withPrintThumbnails } from '../printThumbnails.js';
import { sumCopies } from '../printCopies.js';
import { generateAccessCode, isUniqueViolation } from '../accessCode.js';
import { supabase } from './client.js';

// ── Recherche (header admin) ─────────────────────────────────────────────────

/** Recherche d'événements pour l'autocomplétion du header admin (nom / client / code).
 *  Insensible aux accents via le RPC search_events (extension unaccent). */
export async function searchEvents(query, limit = 8) {
  const q = query.trim();
  if (q.length < 2) return [];
  const { data, error } = await supabase.rpc('search_events', { search_query: q, max_results: limit });
  if (error) throw error;
  return data ?? [];
}

// Recherche Ctrl+K (LAB-339, components/CommandPalette.jsx) : requêtes courtes, limitées, filtrées par la
// RLS (org de l'utilisateur). Le filtre `or` vient de ilikeAny (lib/commandSearch.js), déjà nettoyé.

/** Événement dont le code d'accès est exactement `code` (6 caractères), ou null. */
export async function findEventByAccessCode(code) {
  const { data, error } = await supabase
    .from('events')
    .select('id, name, client_name, access_code, start_date, status')
    .eq('access_code', code.trim().toUpperCase())
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Événements dont le client (nom ou email) contient le mot : groupés en clients par la palette. */
export async function searchEventClients(orFilter, limit = 20) {
  const { data, error } = await supabase
    .from('events')
    .select('id, name, client_name, client_email, start_date')
    .or(orFilter)
    .order('start_date', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function duplicateEvent(eventId) {
  const { data: source, error: fetchErr } = await supabase
    .from('events').select('*').eq('id', eventId).single();
  if (fetchErr) throw fetchErr;

  // Nouveau code d'accès : un autre tirage si le code est déjà pris (clé unique).
  for (let attempt = 1; ; attempt++) {
    const { data: created, error: insertErr } = await supabase
      .from('events')
      .insert({
        name:            `Copie — ${source.name}`,
        client_name:     null,
        client_email:    null,
        start_date:      null,
        end_date:        null,
        expires_at:      null,
        access_code:     generateAccessCode(),
        status:          'active',
        // On copie uniquement la config kiosk, pas les autres options (formulaire, audio)
        form_config:     { kiosk: source.form_config?.kiosk ?? null },
      })
      .select()
      .single();
    if (insertErr && isUniqueViolation(insertErr) && attempt < 5) continue;
    if (insertErr) throw insertErr;
    return created;
  }
}

export async function getDashboardStats() {
  const now        = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const todayIso   = now.toISOString();
  const in7Days    = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { data: activeEvents },
    { count: photosCount },
    { data: printRows },
    { data: pendingDesigns },
    { data: upcomingEvents },
    { data: recentPhotos },
    { data: recentPrints },
  ] = await Promise.all([
    supabase.from('events').select('id, name, client_name, start_date, end_date, status, photobooth_id').eq('status', 'active').order('start_date', { ascending: true }),
    supabase.from('photos').select('id', { count: 'exact', head: true }).gte('created_at', monthStart),
    supabase.from('print_logs').select('copies').gte('printed_at', monthStart),
    // Templates et écrans d'accueil envoyés (LAB-290), distingués par kind dans le tableau de bord.
    supabase.from('client_designs').select('id, event_id, kind, submitted_at').in('kind', ['print', 'home']).eq('status', 'submitted').order('submitted_at', { ascending: false }),
    supabase.from('events').select('id, name, client_name, start_date, end_date, photobooth_id, status').neq('status', 'archived').gte('end_date', todayIso).lte('start_date', in7Days).order('start_date', { ascending: true }).limit(10),
    supabase.from('photos').select('id, photo_url, thumbnail_url, created_at, event_id').order('created_at', { ascending: false }).limit(6),
    supabase.from('print_logs').select('id, copies, printed_at, machine_id, event_id').order('printed_at', { ascending: false }).limit(5),
  ]);

  const printsThisMonth = sumCopies(printRows);

  // Jointure JS : enrichit pendingDesigns + recentPrints avec le nom de l'événement.
  // On réutilise les events déjà chargés (actifs + agenda) et on ne requête que les IDs manquants.
  const eventsMap = Object.fromEntries(
    [...(activeEvents ?? []), ...(upcomingEvents ?? [])].map(e => [e.id, e])
  );
  const referencedIds = [...(pendingDesigns ?? []), ...(recentPrints ?? [])]
    .map(r => r.event_id)
    .filter(id => id && !eventsMap[id]);
  const missingIds = [...new Set(referencedIds)];
  if (missingIds.length > 0) {
    const { data: extraEvents } = await supabase
      .from('events').select('id, name, client_name').in('id', missingIds);
    for (const e of extraEvents ?? []) eventsMap[e.id] = e;
  }
  const enriched = rows => (rows ?? []).map(r => ({ ...r, events: eventsMap[r.event_id] ?? null }));

  return {
    activeEventsCount: activeEvents?.length ?? 0,
    photosThisMonth:   photosCount ?? 0,
    printsThisMonth,
    pendingDesigns:    enriched(pendingDesigns),
    upcomingEvents:    upcomingEvents ?? [],
    activeEvents:      activeEvents ?? [],
    recentPhotos:      recentPhotos ?? [],
    recentPrints:      enriched(recentPrints),
  };
}

/** Stats légères pour le bandeau du détail événement : photos capturées + impressions consommées. */
export async function getEventStats(eventId) {
  const [{ count: photosCount }, { data: prints }] = await Promise.all([
    supabase.from('photos').select('id', { count: 'exact', head: true }).eq('event_id', eventId),
    supabase.from('print_logs').select('copies').eq('event_id', eventId),
  ]);
  const printCopies = sumCopies(prints);
  return { photosCount: photosCount ?? 0, printCopies };
}

// ── Historique impressions kiosk ─────────────────────────────────────────────

export async function getEventPrintLogs(eventId) {
  const { data, error } = await supabase
    .from('print_logs')
    .select('id, session_id, composite_url, copies, machine_id, printed_at')
    .eq('event_id', eventId)
    .order('printed_at', { ascending: false });
  if (error) throw error;
  const logs = data ?? [];
  // LAB-227 : la borne n'envoie plus composite_url ; miniature = photo kiosk de la séance, en une
  // seule requête sur les photos kiosk de l'événement. Une erreur ici n'empêche pas la liste.
  const sessions = sessionsNeedingThumbnail(logs);
  if (sessions.length === 0) return logs;
  const { data: photos, error: photosError } = await supabase
    .from('photos')
    .select('storage_path, photo_url, created_at')
    .eq('event_id', eventId)
    .eq('source', 'kiosk');
  if (photosError) return logs;
  return withPrintThumbnails(logs, photos ?? []);
}
