// LAB-327 : panneau des journaux de la borne (logique pure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTEXT_GROUPS,
  EVENT_DELETED,
  EVENT_HIDDEN,
  EVENT_OTHER_ORG,
  acceptLinkedEvent,
  buildLogFilters,
  buildLogsText,
  parseEventParam,
  cleanSearch,
  combineBranches,
  compareLogs,
  contextGroup,
  countText,
  cursorBranch,
  describeFilters,
  edsdkErrorCode,
  eventLabel,
  eventLogsSummaryText,
  eventOptions,
  explainLog,
  formatExactTime,
  formatTimeRange,
  groupBySession,
  groupLogs,
  kioskOptions,
  kioskText,
  kioskWindows,
  latestCreatedAt,
  logCursor,
  logsFileName,
  mergeLogs,
  missingEventIds,
  periodStart,
  pgQuote,
  resolveKiosk,
  sessionLabel,
  timeAgo,
  timeMicros,
  withBranch,
} from './kioskLogs.js';

const NOW = Date.parse('2026-11-15T12:00:00Z');
const M1 = 'b2c56bac-fd65-4406-8e3b-eb9ad11e07f1';
const M2 = '9f0e1d2c-0000-4000-8000-000000000002';

const LIC_A = { id: 'lic-a', label: 'Borne bois', machine_name: 'SALLE-1', machine_id: M1, color: '#4f46e5', retired_at: null };
const LIC_B = { id: 'lic-b', label: '', machine_name: 'ANCIEN-PC', machine_id: null, color: '#10b981', retired_at: '2026-10-01T00:00:00Z' };

let seq = 0;
const log = (over = {}) => ({
  id: over.id ?? `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
  machine_id: M1, level: 'error', context: 'camera', message: 'Aucun appareil Canon détecté.',
  stack_trace: null, app_version: '1.0.16', occurred_at: '2026-11-15T11:00:00Z', created_at: '2026-11-15T11:00:05Z',
  event_id: null, session_id: null, ...over,
});

// ── Types et périodes ──────────────────────────────────────────────────────────────────────

test('contextGroup : contextes de la borne rangés par type, le reste en Application', () => {
  assert.equal(contextGroup('camera-evf'), 'camera');
  assert.equal(contextGroup('capture'), 'camera');
  assert.equal(contextGroup('print'), 'print');
  assert.equal(contextGroup('photo_upload'), 'upload');
  assert.equal(contextGroup('sync-kiosk-logs'), 'upload');
  assert.equal(contextGroup('sync-design'), 'sync');
  assert.equal(contextGroup('event-setup'), 'sync');
  assert.equal(contextGroup('heartbeat'), 'app');
  assert.equal(contextGroup(null), 'app');
  const all = CONTEXT_GROUPS.flatMap((g) => g.contexts ?? []);
  assert.equal(new Set(all).size, all.length, 'un contexte dans un seul type');
});

test('periodStart : 24 h, 7 et 30 jours, Tout = null', () => {
  assert.equal(periodStart('24h', NOW), '2026-11-14T12:00:00.000Z');
  assert.equal(periodStart('7d', NOW), '2026-11-08T12:00:00.000Z');
  assert.equal(periodStart('30d', NOW), '2026-10-16T12:00:00.000Z');
  assert.equal(periodStart('all', NOW), null);
});

// ── Bornes ─────────────────────────────────────────────────────────────────────────────────

test('kioskWindows : comme kiosk_log_visible (début à l’association seulement après une autre borne)', () => {
  const history = [
    { license_id: 'lic-b', machine_id: M1, machine_name: 'ANCIEN-PC', associated_at: '2026-01-01T00:00:00Z', replaced_at: '2026-06-01T00:00:00Z' },
    { license_id: 'lic-a', machine_id: M1, machine_name: 'SALLE-1', associated_at: '2026-06-01T00:00:00Z', replaced_at: null },
  ];
  const w = kioskWindows([LIC_A, LIC_B], history);
  assert.deepEqual(w.map((x) => [x.licenseId, x.start, x.end]), [
    ['lic-b', null, '2026-06-01T00:00:00Z'],
    ['lic-a', '2026-06-01T00:00:00Z', null],
  ]);
  assert.equal(w[1].license, LIC_A);
});

test('kioskWindows : sans historique lisible, une fenêtre ouverte par borne qui a un PC', () => {
  const w = kioskWindows([LIC_A, LIC_B], null);
  assert.deepEqual(w.map((x) => [x.licenseId, x.machineId, x.start, x.end]), [['lic-a', M1, null, null]]);
});

test('resolveKiosk : nom, couleur et PC ; borne retirée gardée ; PC inconnu', () => {
  const history = [
    { license_id: 'lic-b', machine_id: M1, machine_name: 'ANCIEN-PC', associated_at: '2026-01-01T00:00:00Z', replaced_at: '2026-06-01T00:00:00Z' },
    { license_id: 'lic-a', machine_id: M1, machine_name: 'SALLE-1', associated_at: '2026-06-01T00:00:00Z', replaced_at: null },
  ];
  const w = kioskWindows([LIC_A, LIC_B], history);
  const now = resolveKiosk(log(), w);
  assert.equal(now.name, 'Borne bois');
  assert.equal(now.color, '#4f46e5');
  assert.equal(now.machineName, 'SALLE-1');
  assert.equal(kioskText(now), 'Borne bois (PC SALLE-1)');

  const old = resolveKiosk(log({ created_at: '2026-03-01T00:00:00Z' }), w);
  assert.equal(old.name, 'ANCIEN-PC');
  assert.equal(old.retired, true);
  assert.equal(kioskText(old), 'ANCIEN-PC · retirée', 'le nom du PC n’est pas répété');

  const unknown = resolveKiosk(log({ machine_id: M2 }), w);
  assert.equal(unknown.known, false);
  assert.equal(unknown.name, 'PC inconnu');
  assert.equal(kioskText(unknown), 'PC inconnu 9f0e1d2c');
});

test('kioskOptions : toutes les bornes (une seule comprise), retirées après, puis PC inconnus', () => {
  const w = kioskWindows([LIC_A], null);
  assert.deepEqual(kioskOptions([LIC_A], [], w).map((o) => o.label), ['Borne bois']);
  const opts = kioskOptions([LIC_B, LIC_A], [log({ machine_id: M2 }), log({ machine_id: M2 }), log()], w);
  assert.deepEqual(opts.map((o) => [o.value, o.label]), [
    ['lic:lic-a', 'Borne bois'], ['lic:lic-b', 'ANCIEN-PC'], [`machine:${M2}`, 'PC inconnu 9f0e1d2c'],
  ]);
});

// ── Filtres serveur ────────────────────────────────────────────────────────────────────────

test('pgQuote et cleanSearch', () => {
  assert.equal(pgQuote('a"b\\c'), '"a\\"b\\\\c"');
  assert.equal(cleanSearch('  *cam%  era  '), 'cam era');
  assert.equal(cleanSearch('x'.repeat(150)).length, 100);
});

test('buildLogFilters : rien de choisi = aucun filtre', () => {
  const f = buildLogFilters({}, { now: NOW });
  assert.deepEqual(f, { eq: [], is: [], in: [], gte: [], branches: [], or: null });
});

test('buildLogFilters : borne d’après ses fenêtres, événement, séance, période, type, niveau', () => {
  const history = [
    { license_id: 'lic-b', machine_id: M1, machine_name: 'ANCIEN-PC', associated_at: '2026-01-01T00:00:00Z', replaced_at: '2026-06-01T00:00:00Z' },
    { license_id: 'lic-a', machine_id: M1, machine_name: 'SALLE-1', associated_at: '2026-06-01T00:00:00Z', replaced_at: null },
    { license_id: 'lic-a', machine_id: M2, machine_name: 'PC-2', associated_at: '2025-01-01T00:00:00Z', replaced_at: '2026-06-01T00:00:00Z' },
  ];
  const windows = kioskWindows([LIC_A, LIC_B], history);
  const f = buildLogFilters({
    kiosk: 'lic:lic-a', event: 'ev-1', session: 'se-1', period: '7d', group: 'camera', level: 'error',
  }, { windows, now: NOW });
  assert.deepEqual(f.eq, [['event_id', 'ev-1'], ['session_id', 'se-1'], ['level', 'error']]);
  assert.deepEqual(f.gte, [['occurred_at', '2026-11-08T12:00:00.000Z']]);
  assert.deepEqual(f.in, [['context', ['camera', 'camera-evf', 'camera-evt', 'capture', 'composite']]]);
  assert.equal(f.or,
    `and(machine_id.eq."${M1}",created_at.gte."2026-06-01T00:00:00Z"),`
    + `and(machine_id.eq."${M2}",created_at.lt."2026-06-01T00:00:00Z")`);

  const old = buildLogFilters({ kiosk: 'lic:lic-b' }, { windows });
  assert.equal(old.or, `and(machine_id.eq."${M1}",created_at.lt."2026-06-01T00:00:00Z")`);
  assert.equal(buildLogFilters({ kiosk: `machine:${M2}` }).or, `machine_id.eq."${M2}"`);
  assert.equal(buildLogFilters({ kiosk: 'lic:sans-pc' }, { windows }).or, 'id.is.null');
});

test('buildLogFilters : sans événement, événement imposé par le panneau', () => {
  assert.deepEqual(buildLogFilters({ event: 'none' }).is, [['event_id', null]]);
  assert.deepEqual(buildLogFilters({ event: 'ev-1' }, { eventId: 'ev-9' }).eq, [['event_id', 'ev-9']]);
});

test('buildLogFilters : Application = contexte vide ou hors des autres types', () => {
  const f = buildLogFilters({ group: 'app' });
  assert.match(f.or, /^context\.is\.null,context\.not\.in\.\(camera,camera-evf,.*,home\)$/);
  assert.deepEqual(f.in, []);
});

test('buildLogFilters : recherche dans le message et le contexte, plusieurs conditions réunies par and()', () => {
  assert.equal(buildLogFilters({ search: 'Canon, R100' }).or,
    'message.ilike."*Canon, R100*",context.ilike."*Canon, R100*"');
  const f = buildLogFilters({ search: 'x', group: 'app', kiosk: `machine:${M2}` });
  assert.equal(f.or,
    `and(machine_id.eq."${M2}",or(context.is.null,context.not.in.(${CONTEXT_GROUPS.flatMap((g) => g.contexts ?? []).join(',')})),`
    + 'or(message.ilike."*x*",context.ilike."*x*"))');
});

test('combineBranches et withBranch : curseur ajouté aux filtres', () => {
  assert.equal(combineBranches([]), null);
  assert.equal(combineBranches(['a.eq.1']), 'a.eq.1');
  assert.equal(combineBranches(['or(a.eq.1,b.eq.2)']), 'a.eq.1,b.eq.2');
  const cursor = { occurred_at: '2026-11-15T10:00:00.123456+00:00', id: 'id-9' };
  const page = withBranch(buildLogFilters({}), cursorBranch(cursor));
  assert.equal(page.or,
    'occurred_at.lt."2026-11-15T10:00:00.123456+00:00",'
    + 'and(occurred_at.eq."2026-11-15T10:00:00.123456+00:00",id.lt."id-9")');
  const both = withBranch(buildLogFilters({ kiosk: `machine:${M2}` }), cursorBranch(cursor));
  assert.match(both.or, /^and\(machine_id\.eq\."[^"]+",or\(occurred_at\.lt\./);
});

test('describeFilters : en clair pour l’export', () => {
  assert.equal(describeFilters({}), 'aucun');
  assert.equal(
    describeFilters({ kiosk: 'lic:a', event: 'e', session: '3f2a9999', period: '24h', group: 'print', level: 'warning', search: ' papier ' },
      { kioskLabel: 'Borne bois', eventLabel: 'Mariage' }),
    'Borne Borne bois · Événement Mariage · séance 3f2a · Période 24 h · Type Impression · Niveau Alerte · Recherche « papier »');
});

// ── Tri, pagination, fusion ────────────────────────────────────────────────────────────────

test('compareLogs : plus récent d’abord, microsecondes comprises, puis id décroissant', () => {
  const a = log({ id: 'a', occurred_at: '2026-11-15T10:00:00.000100+00:00' });
  const b = log({ id: 'b', occurred_at: '2026-11-15T10:00:00.000200+00:00' });
  const c = log({ id: 'c', occurred_at: '2026-11-15T10:00:00.000200+00:00' });
  assert.deepEqual([a, b, c].sort(compareLogs).map((l) => l.id), ['c', 'b', 'a']);
  assert.ok(timeMicros('2026-11-15T10:00:00.000200Z') - timeMicros('2026-11-15T10:00:00.0001Z') === 100);
});

test('logCursor et latestCreatedAt', () => {
  assert.equal(logCursor([]), null);
  const page = [log({ id: 'x', occurred_at: '2026-11-15T11:00:00Z' }), log({ id: 'y', occurred_at: '2026-11-15T09:00:00Z', created_at: '2026-11-15T11:30:00Z' })];
  assert.deepEqual(logCursor(page), { occurred_at: '2026-11-15T09:00:00Z', id: 'y' });
  assert.equal(latestCreatedAt(page), '2026-11-15T11:30:00Z');
  assert.equal(latestCreatedAt([]), null);
});

test('mergeLogs : sans doublon, trié ; un journal plus ancien que le curseur attend « Voir plus »', () => {
  const list = [log({ id: 'b', occurred_at: '2026-11-15T11:00:00Z' }), log({ id: 'a', occurred_at: '2026-11-15T10:00:00Z' })];
  const cursor = logCursor(list);
  const fresh = log({ id: 'c', occurred_at: '2026-11-15T11:30:00Z' });
  const late = log({ id: 'z', occurred_at: '2026-11-15T08:00:00Z' });
  assert.deepEqual(mergeLogs(list, [fresh, list[0], late], { cursor, hasMore: true }).map((l) => l.id), ['c', 'b', 'a']);
  assert.deepEqual(mergeLogs(list, [late], { cursor, hasMore: false }).map((l) => l.id), ['b', 'a', 'z']);
});

// ── Événement, séance, dates ───────────────────────────────────────────────────────────────

test('eventLabel : nom, autre organisation, supprimé, cause inconnue', () => {
  const events = {
    e1: { state: 'visible', name: 'Mariage Clarisse & Hugo' },
    e2: { state: 'visible', name: '', client_name: 'Société X' },
    e3: { state: 'other_org' },
    e4: { state: 'deleted' },
    e5: { state: 'hidden' },
    e6: { state: 'visible', name: ' ' },
  };
  assert.equal(eventLabel(null, events), null);
  assert.equal(eventLabel('e1', events), 'Mariage Clarisse & Hugo');
  assert.equal(eventLabel('e2', events), 'Société X');
  assert.equal(eventLabel('e3', events), EVENT_OTHER_ORG);
  assert.equal(eventLabel('e3', events), "Événement d'une autre organisation");
  assert.equal(eventLabel('e4', events), EVENT_DELETED);
  assert.equal(eventLabel('e4', events), 'Événement supprimé');
  assert.equal(eventLabel('e5', events), EVENT_HIDDEN);
  assert.equal(eventLabel('e6', events), 'Événement sans nom');
  assert.equal(eventLabel('e7', events), null, 'pas encore lu');
});

test('sessionLabel, missingEventIds, eventOptions', () => {
  assert.equal(sessionLabel('3f2a1b2c-0000'), 'séance 3f2a');
  assert.equal(sessionLabel(null), null);
  const logs = [log({ event_id: 'e1' }), log({ event_id: 'e2' }), log({ event_id: 'e1' }), log()];
  assert.deepEqual(missingEventIds(logs, { e1: { state: 'visible', name: 'A' } }), ['e2']);
  const opts = eventOptions(logs, { e1: { state: 'visible', name: 'A' }, e2: { state: 'deleted' } },
    [{ id: 'e1', name: 'A' }, { id: 'e3', name: '', client_name: 'B' }]);
  assert.deepEqual(opts, [
    { value: 'e1', label: 'A' }, { value: 'e2', label: 'Événement supprimé' }, { value: 'e3', label: 'B' },
  ]);
});

test('formatExactTime et timeAgo (heure de Paris)', () => {
  assert.equal(formatExactTime('2026-11-15T13:03:27Z'), '15/11/2026 14:03:27');
  assert.equal(formatExactTime('2026-07-01T10:00:00Z'), '01/07/2026 12:00:00');
  assert.equal(formatExactTime(null), '');
  assert.equal(timeAgo('2026-11-15T11:59:40Z', NOW), "à l'instant");
  assert.equal(timeAgo('2026-11-15T11:55:00Z', NOW), 'il y a 5 min');
  assert.equal(timeAgo('2026-11-15T09:00:00Z', NOW), 'il y a 3 h');
  assert.equal(timeAgo('2026-11-13T09:00:00Z', NOW), 'il y a 2 j');
  assert.equal(logsFileName(NOW), 'journaux-bornes-2026-11-15.txt');
});

// ── Regroupement ───────────────────────────────────────────────────────────────────────────

test('groupLogs : 15 erreurs caméra identiques à la suite = une entrée ×15', () => {
  const same = Array.from({ length: 15 }, (_, i) =>
    log({ occurred_at: new Date(Date.parse('2026-11-15T11:00:00Z') - i * 60000).toISOString() }));
  const other = log({ context: 'print', message: "L'imprimante ne répond pas. Vérifiez le papier et la connexion.", occurred_at: '2026-11-15T10:00:00Z' });
  const groups = groupLogs([...same, other].sort(compareLogs));
  assert.equal(groups.length, 2);
  assert.equal(groups[0].count, 15);
  assert.equal(groups[0].last, '2026-11-15T11:00:00.000Z');
  assert.equal(groups[0].first, '2026-11-15T10:46:00.000Z');
  assert.equal(groups[0].logs.length, 15);
  assert.equal(groups[1].count, 1);
});

test('groupLogs : pas de regroupement si la borne, le niveau, le contexte ou le message change, ou si ce n’est pas consécutif', () => {
  const a = log({ occurred_at: '2026-11-15T11:00:00Z' });
  const variants = [
    log({ machine_id: M2, occurred_at: '2026-11-15T10:59:00Z' }),
    log({ level: 'warning', occurred_at: '2026-11-15T10:58:00Z' }),
    log({ context: 'camera-evf', occurred_at: '2026-11-15T10:57:00Z' }),
    log({ message: 'Appareil photo éteint ou débranché.', occurred_at: '2026-11-15T10:56:00Z' }),
    log({ occurred_at: '2026-11-15T10:55:00Z' }),
  ];
  assert.equal(groupLogs([a, ...variants]).length, 6);
});

// ── Messages clairs (messages réellement écrits par la borne) ──────────────────────────────

const clear = (message, over = {}) => explainLog(log({ message, ...over }));

test('explainLog : clé absente ou invalide (401 de la passerelle)', () => {
  for (const m of [
    'Lecture de la demande de mise à jour échouée : Lecture de la demande de mise à jour : 401 Unauthorized. {"message":"No API key found in request","hint":"No `apikey` request header or url param was found."}',
    'URL d\'envoi photo : 401 Unauthorized. {"code":"UNAUTHORIZED_INVALID_JWT_FORMAT","message":"Auth header is not \'Bearer {token}\'"}',
    'Clé API Supabase invalide ou manquante — vérifiez AnonKey dans appsettings.local.json',
  ]) {
    const c = clear(m, { context: 'photo_upload', level: 'warning' });
    assert.equal(c?.id, 'missing-key', m);
    assert.match(c.advice, /Adresse du SaaS/);
  }
  assert.equal(clear('Échec de la sync du design approuvé (event x) : Response status code does not indicate success: 401 (Unauthorized).', { context: 'sync-design' })?.id, 'unauthorized');
});

test('explainLog : licence refusée, adresse du SaaS absente, trop de demandes', () => {
  assert.equal(clear('kiosk_record_logs : licence kiosk invalide ou inactive')?.id, 'license');
  assert.equal(clear("Licence refusée par le serveur. Vérifiez la licence dans l'admin.")?.id, 'license');
  assert.equal(clear("Tentative 3/3 échouée (code '8CMPPE') : An invalid request URI was provided. Either the request URI must be an absolute URI or BaseAddress must be set.", { context: 'event-setup' })?.id, 'saas-address');
  assert.equal(clear("Connexion impossible après 3 tentatives (code '8CMPPE') : An invalid request URI was provided. Either the request URI must be an absolute URI or BaseAddress must be set.")?.id, 'saas-address');
  assert.equal(clear('Trop de demandes de code. Réessayez dans quelques minutes.')?.id, 'rate-limit');
});

test('explainLog : réseau (messages .NET et Windows en français)', () => {
  for (const m of [
    'SyncAsync a échoué (event x) : No such host is known. (abc.supabase.co:443)',
    'Hôte inconnu. (abc.supabase.co:443)',
    'An error occurred while sending the request.',
    'The request was canceled due to the configured HttpClient.Timeout of 30 seconds elapsing.',
    'The SSL connection could not be established, see inner exception.',
    "Une tentative de connexion a échoué car le parti connecté n'a pas répondu convenablement",
  ]) assert.equal(clear(m, { context: 'sync' })?.id, 'network', m);
  assert.equal(clear('Erreur Supabase (503) : upstream connect error', { context: 'sync' })?.id, 'server-error');
});

test('explainLog : appareil photo absent ou muet', () => {
  for (const m of ['Aucun appareil Canon détecté.', 'Init caméra échouée (tentative 1/3) : Aucun appareil Canon détecté.',
    'Appareil photo éteint ou débranché.', 'Appareil photo non détecté : la borne affiche « Problème technique ».',
    "L'appareil photo s'est éteint ou a été débranché."]) {
    const c = clear(m);
    assert.equal(c?.id, 'camera-missing', m);
    assert.ok(c.title && c.advice);
  }
  assert.equal(clear("La caméra n'a pas répondu lors de la capture.", { context: 'capture' })?.id, 'camera-timeout');
  assert.equal(clear('Échec du compositing (event x) : Impossible de lire la photo : C:\\temp\\a.jpg', { context: 'capture' })?.id, 'compositing');
});

test('explainLog : codes EDSDK lus dans les messages caméra', () => {
  assert.equal(edsdkErrorCode('EDSDK error in EdsOpenSession: 0x00000080'), 0x80);
  assert.equal(edsdkErrorCode('Activation du live view refusée (0xA005).'), 0xa005);
  assert.equal(edsdkErrorCode('Taille des photos 0x0013FF0F refusée par l\'appareil (0x7).'), 0x7);
  assert.equal(edsdkErrorCode("Échec de l'ordre de capture : 0x8D01"), 0x8d01);
  assert.equal(edsdkErrorCode('EdsDownloadComplete a renvoyé 0x81.'), 0x81);
  assert.equal(edsdkErrorCode('Live view toujours indisponible après 5 s (dernier code 0xA102).'), 0xa102);
  assert.equal(edsdkErrorCode('ObjectEvent 0x208'), null);

  const af = clear("Échec de l'ordre de capture : 0x8D01", { context: 'capture' });
  assert.equal(af.id, 'edsdk-0x8D01');
  assert.match(af.title, /mise au point.*\(code 0x8D01\)/);
  assert.equal(clear('EDSDK error in EdsOpenSession: 0x000000C1')?.id, 'edsdk-0xC1');
  assert.equal(clear('Activation du live view refusée (0x1234).', { context: 'camera-evf', level: 'warning' })?.id, 'edsdk-unknown');
  assert.equal(clear('ObjectEvent 0x208', { context: 'camera-evt', level: 'info' }), null, 'événement, pas une erreur');
  assert.equal(clear('Réglage refusé (0x81).', { context: 'camera', level: 'info' }), null, 'info ignorée');
  assert.equal(clear('Code 0x81 reçu.', { context: 'sync', level: 'error' }), null, 'hors caméra');
});

test('explainLog : impression, PC, événement', () => {
  assert.equal(clear("L'imprimante ne répond pas. Vérifiez le papier et la connexion.", { context: 'print' })?.id, 'printer-not-responding');
  assert.equal(clear('Imprimante "DS620" introuvable ou non disponible sur ce PC.', { context: 'print' })?.id, 'printer-missing');
  assert.equal(clear('Papier 10x15 introuvable sur « DS620 ».', { context: 'print' })?.id, 'paper-missing');
  assert.equal(clear('Une impression est encore en cours. Patientez quelques instants.', { context: 'print' })?.id, 'print-busy');
  assert.equal(clear('Fichier composite introuvable.', { context: 'print' })?.id, 'composite-missing');
  assert.equal(clear('Composite introuvable.', { context: 'photo_upload' })?.id, 'composite-missing');
  assert.equal(clear('There is not enough space on the disk.', { context: 'capture' })?.id, 'disk-full');
  assert.equal(clear('Quota insuffisant pour traiter cette commande.', { context: 'ui-recovery' })?.id, 'windows-resources');
  assert.equal(clear('Not enough quota is available to process this command.')?.id, 'windows-resources');
  assert.equal(clear("Événement 'Gala' (8CMPPE) connecté SANS design approuvé — les photos seront sans cadre.", { context: 'event-push', level: 'warning' })?.id, 'no-design');
  assert.equal(clear("Code événement introuvable : 'ZZZZZZ'.", { context: 'event-setup' })?.id, 'event-code');
  assert.equal(clear('Adresse du SaaS enregistrée : https://exemple.test', { level: 'info', context: 'saas-address' }), null);
  assert.equal(explainLog(log({ message: '' })), null);
});

// ── Export ─────────────────────────────────────────────────────────────────────────────────

test('buildLogsText : borne, événement, séance, heure exacte, message clair et original', () => {
  const logs = [
    ...Array.from({ length: 15 }, (_, i) => log({
      occurred_at: new Date(Date.parse('2026-11-15T11:00:00Z') - i * 1000).toISOString(),
      event_id: 'e1', session_id: '3f2a0000-0000-4000-8000-000000000000',
    })),
    log({ level: 'info', context: 'session', message: 'Séance démarrée', occurred_at: '2026-11-15T10:00:00Z', stack_trace: 'at A\nat B' }),
  ];
  const text = buildLogsText(logs, {
    resolve: (l) => ({ kiosk: 'Borne bois (PC SALLE-1)', event: l.event_id ? 'Mariage Clarisse & Hugo' : null }),
    filtersText: 'Type Caméra', now: NOW,
  });
  assert.match(text, /^Journaux des bornes\nExporté le 15\/11\/2026 13:00:00 \(heure de Paris\)\nFiltres : Type Caméra\n16 journaux, 2 entrées\n/);
  assert.match(text, /\[15\/11\/2026 12:00:00\] ERREUR · Borne bois \(PC SALLE-1\) · Mariage Clarisse & Hugo · séance 3f2a · camera · v1\.0\.16\n {2}×15, du 15\/11\/2026 11:59:46 au 15\/11\/2026 12:00:00\n {2}En clair : L'appareil photo n'est pas détecté par la borne\.\n {2}Que faire : .+\n {2}Message : Aucun appareil Canon détecté\./);
  assert.match(text, /\[15\/11\/2026 11:00:00\] INFO · Borne bois \(PC SALLE-1\) · session · v1\.0\.16\n {2}Message : Séance démarrée\n {2}Trace :\n {4}at A\n {4}at B\n/);
  assert.doesNotMatch(text, /×1,/);
});

test('lien ?event= : uuid accepté en minuscules, le reste ignoré', () => {
  assert.equal(parseEventParam(' 4BE15EFD-1781-4C15-BE6B-DCC44DA3C109 '), '4be15efd-1781-4c15-be6b-dcc44da3c109');
  for (const bad of [null, undefined, '', 'abc', '4be15efd-1781-4c15-be6b', "4be15efd-1781-4c15-be6b-dcc44da3c109'or", '../x']) {
    assert.equal(parseEventParam(bad), null, String(bad));
  }
});

test('lien ?event= : appliqué seulement si l’événement est connu', () => {
  const id = '4be15efd-1781-4c15-be6b-dcc44da3c109';
  assert.equal(acceptLinkedEvent(id, { [id]: { state: 'visible', name: 'Mariage' } }), true);
  assert.equal(acceptLinkedEvent(id, { [id]: { state: 'other_org' } }), true);
  assert.equal(acceptLinkedEvent(id, { [id]: { state: 'deleted' } }), true);
  assert.equal(acceptLinkedEvent(id, { [id]: { state: 'hidden' } }), false);
  assert.equal(acceptLinkedEvent(id, {}), false);
  assert.equal(acceptLinkedEvent(null, {}), false);
});

// ── Fiche de l'événement (LAB-328) ─────────────────────────────────────────────────────────

const S1 = '3f2a0000-0000-4000-8000-000000000001';
const S2 = '7b1c0000-0000-4000-8000-000000000002';

test('groupBySession : une entrée par séance, la plus récente d’abord, journaux sans séance à part', () => {
  const logs = [
    log({ session_id: S1, occurred_at: '2026-11-15T10:00:00Z' }),
    log({ session_id: S1, occurred_at: '2026-11-15T10:00:01Z' }),
    log({ session_id: S1, level: 'warning', context: 'print', message: 'Papier bas', occurred_at: '2026-11-15T10:02:00Z' }),
    log({ session_id: S2, level: 'info', context: 'sync', message: 'Synchro', occurred_at: '2026-11-15T11:00:00Z', machine_id: M2 }),
    log({ session_id: null, level: 'info', context: 'app', message: 'Démarrage', occurred_at: '2026-11-15T09:00:00Z' }),
  ];
  const sessions = groupBySession(logs);
  assert.deepEqual(sessions.map((s) => s.sessionId), [S2, S1, null]);
  const s1 = sessions[1];
  assert.equal(s1.key, S1);
  assert.equal(s1.count, 3);
  assert.equal(s1.errors, 2);
  assert.equal(s1.warnings, 1);
  assert.equal(s1.first, '2026-11-15T10:00:00Z');
  assert.equal(s1.last, '2026-11-15T10:02:00Z');
  assert.deepEqual(s1.machineIds, [M1]);
  // Dans la séance, les erreurs identiques à la suite sont réunies.
  assert.deepEqual(s1.groups.map((g) => g.count), [1, 2]);
  assert.equal(sessions[2].key, 'none');
  assert.deepEqual(groupBySession([]), []);
});

test('formatTimeRange : même jour = heure de fin seule, sinon deux dates (heure de Paris)', () => {
  assert.equal(formatTimeRange('2026-11-15T13:03:27Z', '2026-11-15T13:05:10Z'), '15/11/2026 14:03:27 → 14:05:10');
  assert.equal(formatTimeRange('2026-11-15T22:30:00Z', '2026-11-15T23:30:00Z'), '15/11/2026 23:30:00 → 16/11/2026 00:30:00');
  assert.equal(formatTimeRange('2026-11-15T13:03:27Z', '2026-11-15T13:03:27Z'), '15/11/2026 14:03:27');
});

test('countText et eventLogsSummaryText : résumé de la section repliée', () => {
  assert.equal(countText(1, 'erreur'), '1 erreur');
  assert.equal(countText(3, 'journal'), '3 journaux');
  assert.equal(countText(0, 'alerte'), '0 alerte');
  assert.equal(eventLogsSummaryText(null), 'Aucun journal reçu pour cet événement');
  assert.equal(eventLogsSummaryText({ total: 0, errors: 0, warnings: 0, machines: [] }), 'Aucun journal reçu pour cet événement');
  assert.equal(
    eventLogsSummaryText({ total: 42, errors: 3, warnings: 1, machines: [{}, {}], last: '2026-11-13T12:00:00Z' }, NOW),
    '3 erreurs · 1 alerte · 2 bornes · 42 journaux · dernière activité il y a 2 j');
  assert.equal(
    eventLogsSummaryText({ total: 5, errors: 0, warnings: 0, machines: [{}], last: '2026-11-15T11:55:00Z' }, NOW),
    'Aucune erreur · 1 borne · 5 journaux · dernière activité il y a 5 min');
});

test('buildLogsText et logsFileName : export de la fiche de l’événement', () => {
  const text = buildLogsText([log()], { title: 'Journaux de la borne · Mariage Clarisse & Hugo', now: NOW });
  assert.match(text, /^Journaux de la borne · Mariage Clarisse & Hugo\n/);
  assert.equal(logsFileName(NOW, { eventName: 'Mariage Clarisse & Hugo' }), 'journaux-borne-mariage-clarisse-hugo-2026-11-15.txt');
  assert.equal(logsFileName(NOW, { eventName: 'Été à Noël !!' }), 'journaux-borne-ete-a-noel-2026-11-15.txt');
  assert.equal(logsFileName(NOW, { eventName: '   ' }), 'journaux-bornes-2026-11-15.txt');
});

test('parseLogPageSize : une des tailles proposées, 25 par défaut', async () => {
  const { parseLogPageSize, LOG_PAGE_SIZES } = await import('./kioskLogs.js');
  assert.deepEqual(LOG_PAGE_SIZES, [25, 50, 100]);
  assert.equal(parseLogPageSize(null), 25);
  assert.equal(parseLogPageSize('50'), 50);
  assert.equal(parseLogPageSize(100), 100);
  assert.equal(parseLogPageSize('30'), 25);
  assert.equal(parseLogPageSize('abc', 100), 100);
});
