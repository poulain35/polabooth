import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_LOOKUP_ERROR, eventByCode, eventColumns, findEventByCode, normalizeAccessCode, type EventByCodeOptions } from './event-by-code.ts';
import { mediaLinkExpired, templateLinkExpired } from './expiry.ts';

const NOW = new Date('2027-06-15T12:00:00Z');
const ORG = 'org-1';

type Row = Record<string, unknown>;

/** Faux client supabase-js : events (par access_code) et organizations (features). */
function fakeDb(events: Row[], opts: { features?: Record<string, unknown>; eventError?: boolean; throws?: boolean } = {}) {
  const db = {
    selects: [] as string[],
    from(table: string) {
      if (opts.throws) throw new Error('réseau coupé');
      let filter: [string, unknown] | null = null;
      const q = {
        select(cols: string) { if (table === 'events') db.selects.push(cols); return q; },
        eq(col: string, v: unknown) { filter = [col, v]; return q; },
        maybeSingle() {
          if (table === 'events') {
            if (opts.eventError) return Promise.resolve({ data: null, error: { message: 'statement timeout' } });
            const row = events.find((e) => filter && e[filter[0]] === filter[1]) ?? null;
            return Promise.resolve({ data: row, error: null });
          }
          assert.equal(table, 'organizations');
          return Promise.resolve({ data: { features: opts.features ?? {} }, error: null });
        },
      };
      return q;
    },
  };
  return db;
}

function fakeGuard() {
  return { failures: 0, async codeFailed() { this.failures++; } };
}

const EVENT = {
  id: 'ev-1', org_id: ORG, access_code: 'ABC123', status: 'active',
  end_date: '2027-06-20', expires_at: '2027-08-20T00:00:00Z', name: 'Mariage',
};

function opts(extra: Partial<EventByCodeOptions> = {}): EventByCodeOptions {
  return {
    fn: 'test',
    columns: ['name'],
    notFound: { status: 404, error: 'Code inconnu' },
    archived: { status: 403, error: 'Clôturé' },
    expiry: { rule: 'template', refusal: { status: 403, error: 'Lien expiré' } },
    feature: 'client_design',
    now: () => NOW,
    ...extra,
  };
}

async function quiet<T>(run: () => Promise<T>): Promise<{ result: T; errors: string[] }> {
  const errors: string[] = [];
  const { error } = console;
  console.error = (...a: unknown[]) => { errors.push(a.map(String).join(' ')); };
  try { return { result: await run(), errors }; } finally { console.error = error; }
}

async function refusal(r: { response?: Response }) {
  assert.ok(r.response, 'refus attendu');
  return { status: r.response.status, body: await r.response.json() };
}

test('normalizeAccessCode : majuscules, espaces retirés, vide ou non-chaîne = null', () => {
  assert.equal(normalizeAccessCode('  abc123 '), 'ABC123');
  assert.equal(normalizeAccessCode(''), null);
  assert.equal(normalizeAccessCode('   '), null);
  assert.equal(normalizeAccessCode(42), null);
  assert.equal(normalizeAccessCode(undefined), null);
});

test('eventColumns : id, org_id et colonnes des contrôles ajoutés, sans doublon', () => {
  assert.equal(eventColumns({ columns: ['name'] }), 'id, org_id, name');
  assert.equal(
    eventColumns({
      columns: ['id', 'status', 'form_config'],
      archived: { status: 403, error: 'x' },
      expiry: { rule: 'template', refusal: { status: 403, error: 'y' } },
    }),
    'id, org_id, status, form_config, end_date',
  );
  assert.equal(
    eventColumns({ columns: [], expiry: { rule: 'media', refusal: { status: 410, error: 'y' } } }),
    'id, org_id, expires_at',
  );
});

test('événement valide : renvoyé avec les colonnes demandées, aucun échec compté', async () => {
  const db = fakeDb([EVENT]);
  const guard = fakeGuard();
  const r = await eventByCode(db, 'ABC123', opts({ guard }));
  assert.equal(r.response, undefined);
  assert.equal(r.event?.id, 'ev-1');
  assert.equal(guard.failures, 0);
  assert.equal(db.selects[0], 'id, org_id, name, status, end_date');
});

test('code inconnu : refus de la fonction et échec compté pour l\'IP', async () => {
  const guard = fakeGuard();
  const r = await eventByCode(fakeDb([EVENT]), 'ZZZZZZ', opts({ guard, notFound: { status: 401, error: 'Code invalide' } }));
  assert.deepEqual(await refusal(r), { status: 401, body: { error: 'Code invalide' } });
  assert.equal(guard.failures, 1);
});

test('code inconnu sans garde : refus sans compter', async () => {
  const r = await eventByCode(fakeDb([]), 'ZZZZZZ', opts());
  assert.deepEqual(await refusal(r), { status: 404, body: { error: 'Code inconnu' } });
});

test('lecture en échec : 500 générique, détail en journal, aucun échec de code compté', async () => {
  const guard = fakeGuard();
  const { result, errors } = await quiet(() => eventByCode(fakeDb([EVENT], { eventError: true }), 'ABC123', opts({ guard })));
  const { status, body } = await refusal(result);
  assert.equal(status, 500);
  assert.deepEqual(body, { error: EVENT_LOOKUP_ERROR });
  assert.doesNotMatch(JSON.stringify(body), /timeout/);
  assert.match(errors[0], /test : lecture de l'événement par code impossible/);
  assert.equal(guard.failures, 0);

  const thrown = await quiet(() => eventByCode(fakeDb([EVENT], { throws: true }), 'ABC123', opts({ guard })));
  assert.equal((await refusal(thrown.result)).status, 500);
  assert.equal(guard.failures, 0);
});

test('archivé : refus de la fonction ; sans option `archived`, accepté', async () => {
  const archived = { ...EVENT, status: 'archived' };
  assert.deepEqual(await refusal(await eventByCode(fakeDb([archived]), 'ABC123', opts())), { status: 403, body: { error: 'Clôturé' } });
  const r = await eventByCode(fakeDb([archived]), 'ABC123', opts({ archived: undefined }));
  assert.equal(r.event?.id, 'ev-1');
});

test('expiration du modèle : fin du jour de end_date ; sans end_date, jamais', async () => {
  const ended = { ...EVENT, end_date: '2027-06-14' };
  assert.deepEqual(await refusal(await eventByCode(fakeDb([ended]), 'ABC123', opts())), { status: 403, body: { error: 'Lien expiré' } });
  const today = { ...EVENT, end_date: '2027-06-15' };
  assert.equal((await eventByCode(fakeDb([today]), 'ABC123', opts())).event?.id, 'ev-1');
  const noEnd = { ...EVENT, end_date: null };
  assert.equal((await eventByCode(fakeDb([noEnd]), 'ABC123', opts())).event?.id, 'ev-1');
  const noRule = await eventByCode(fakeDb([ended]), 'ABC123', opts({ expiry: undefined }));
  assert.equal(noRule.event?.id, 'ev-1');
});

test('expiration des médias : expires_at atteint (borne incluse) ; null = jamais', async () => {
  const media = opts({ expiry: { rule: 'media', refusal: { status: 410, error: 'Cet événement a expiré' } } });
  const past = { ...EVENT, expires_at: '2027-06-15T11:59:59Z' };
  assert.deepEqual(await refusal(await eventByCode(fakeDb([past]), 'ABC123', media)), { status: 410, body: { error: 'Cet événement a expiré' } });
  const exact = { ...EVENT, expires_at: NOW.toISOString() };
  assert.equal((await refusal(await eventByCode(fakeDb([exact]), 'ABC123', media))).status, 410);
  const future = { ...EVENT, expires_at: '2027-06-15T12:00:01Z' };
  assert.equal((await eventByCode(fakeDb([future]), 'ABC123', media)).event?.id, 'ev-1');
  const never = { ...EVENT, expires_at: null };
  assert.equal((await eventByCode(fakeDb([never]), 'ABC123', media)).event?.id, 'ev-1');
});

test('ordre des contrôles : archivé avant expiré, expiré avant fonctionnalité', async () => {
  const both = { ...EVENT, status: 'archived', end_date: '2027-01-01' };
  const off = { features: { client_design: false } };
  assert.equal((await refusal(await eventByCode(fakeDb([both], off), 'ABC123', opts()))).body.error, 'Clôturé');
  const expired = { ...EVENT, end_date: '2027-01-01' };
  assert.equal((await refusal(await eventByCode(fakeDb([expired], off), 'ABC123', opts()))).body.error, 'Lien expiré');
});

test('fonctionnalité coupée pour l\'organisation : 404 fonctionnalite_desactivee ; sans option, aucun contrôle', async () => {
  const off = await eventByCode(fakeDb([EVENT], { features: { client_design: false } }), 'ABC123', opts());
  assert.deepEqual(await refusal(off), { status: 404, body: { error: 'fonctionnalite_desactivee' } });
  const noFeature = await eventByCode(fakeDb([EVENT], { features: { client_design: false } }), 'ABC123', opts({ feature: undefined }));
  assert.equal(noFeature.event?.id, 'ev-1');
});

test('findEventByCode : recherche seule, null si inconnu, erreur remontée', async () => {
  assert.equal((await findEventByCode(fakeDb([EVENT]), 'ABC123', 'id')).event?.id, 'ev-1');
  assert.deepEqual(await findEventByCode(fakeDb([EVENT]), 'NOPE', 'id'), { event: null, error: null });
  const failed = await findEventByCode(fakeDb([EVENT], { eventError: true }), 'ABC123', 'id');
  assert.equal(failed.event, null);
  assert.ok(failed.error);
});

test('expiry.ts : templateLinkExpired et mediaLinkExpired acceptent une date de référence', () => {
  assert.equal(templateLinkExpired('2027-06-14', NOW), true);
  assert.equal(templateLinkExpired('2027-06-15', NOW), false);
  assert.equal(mediaLinkExpired('2027-06-15T12:00:00Z', NOW), true);
  assert.equal(mediaLinkExpired('pas une date', NOW), false);
  assert.equal(mediaLinkExpired(undefined, NOW), false);
});
