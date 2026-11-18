// Identité de l'entreprise (open core L5) : champs saisis, champs vides (replis d'avant L5),
// organisation introuvable, et câblage de l'expéditeur dans les fonctions qui envoient des emails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getOrgIdentity, identityDefaults, identitySender, orgSender, orgSenderCache, resolveOrgIdentity,
  type IdentityDefaults,
} from './org-identity.ts';

const DEFAULTS: IdentityDefaults = {
  companyName: 'Expéditeur env', senderName: 'Expéditeur env', senderEmail: 'noreply@env.test',
};

const FULL_ORG = {
  id: 'org-1',
  name: 'Org interne',
  contact_company: 'Photobooth Martin',
  contact_phone: ' 06 12 34 56 78 ',
  contact_email: 'contact@martin.test',
  contact_address: '1 rue des Lilas\n35000 Rennes',
  logo_url: 'https://cdn.test/logo.png',
  email_sender_name: 'Martin Photobooth',
  email_sender_email: 'bonjour@martin.test',
  business_profile: { company_name: 'Martin Events', google_review_url: 'https://g.page/r/martin/review', delivery_auto: { enabled: true } },
};

/** Faux client : enregistre la requête et renvoie `result` (ou lève `throws`). */
function fakeDb(result: { data?: unknown; error?: { message: string } | null }, throws?: Error) {
  const calls: Array<{ table: string; columns: string; id: unknown }> = [];
  const db = {
    from(table: string) {
      return {
        select(columns: string) {
          return {
            eq(_col: string, id: unknown) {
              return {
                maybeSingle() {
                  calls.push({ table, columns, id });
                  if (throws) return Promise.reject(throws);
                  return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
                },
              };
            },
          };
        },
      };
    },
  };
  return { db, calls };
}

test('champs saisis : repris tels quels (espaces retirés), nom commercial du profil en priorité', async () => {
  const { db, calls } = fakeDb({ data: FULL_ORG });
  const identity = await getOrgIdentity(db, 'org-1', DEFAULTS);
  assert.deepEqual(identity, {
    companyName: 'Martin Events',
    phone: '06 12 34 56 78',
    email: 'contact@martin.test',
    address: '1 rue des Lilas\n35000 Rennes',
    logoUrl: 'https://cdn.test/logo.png',
    reviewUrl: 'https://g.page/r/martin/review',
    senderName: 'Martin Photobooth',
    senderEmail: 'bonjour@martin.test',
  });
  assert.deepEqual(calls, [{ table: 'organizations', columns: '*', id: 'org-1' }]);
  assert.deepEqual(identitySender(identity), { email: 'bonjour@martin.test', name: 'Martin Photobooth' });
});

test('champs vides ou absents : replis d\'avant L5 (expéditeur FROM_NAME / FROM_EMAIL), null pour le reste', () => {
  const empty = {
    id: 'org-1', name: '', contact_company: '  ', contact_phone: null, contact_email: '', contact_address: '',
    logo_url: null, email_sender_name: '', email_sender_email: '   ', business_profile: { company_name: '', google_review_url: '' },
  };
  assert.deepEqual(resolveOrgIdentity(empty, DEFAULTS), {
    companyName: 'Expéditeur env', phone: null, email: null, address: null, logoUrl: null, reviewUrl: null,
    senderName: 'Expéditeur env', senderEmail: 'noreply@env.test',
  });
  // Migration pas encore appliquée : colonnes email_sender_* et contact_address absentes de la ligne.
  const before = resolveOrgIdentity({ id: 'org-1', name: 'Org', contact_company: null, business_profile: null }, DEFAULTS);
  assert.equal(before.companyName, 'Org', 'nom de l\'organisation en dernier recours');
  assert.equal(before.senderName, 'Expéditeur env');
  assert.equal(before.senderEmail, 'noreply@env.test');
});

test('ordre du nom : profil, puis fiche contact, puis organisation (comme send-event-report)', () => {
  assert.equal(resolveOrgIdentity({ ...FULL_ORG, business_profile: {} }, DEFAULTS).companyName, 'Photobooth Martin');
  assert.equal(resolveOrgIdentity({ ...FULL_ORG, business_profile: {}, contact_company: '' }, DEFAULTS).companyName, 'Org interne');
});

test('expéditeur mal formé : adresse par défaut, le nom saisi est gardé', () => {
  const identity = resolveOrgIdentity({ ...FULL_ORG, email_sender_email: 'pas-une-adresse' }, DEFAULTS);
  assert.equal(identity.senderEmail, 'noreply@env.test');
  assert.equal(identity.senderName, 'Martin Photobooth');
});

test('organisation introuvable, id absent ou lecture en erreur : replis seulement, sans lever', async () => {
  const expected = resolveOrgIdentity(null, DEFAULTS);
  assert.equal(expected.senderEmail, 'noreply@env.test');
  assert.equal(expected.companyName, 'Expéditeur env');

  assert.deepEqual(await getOrgIdentity(fakeDb({ data: null }).db, 'inconnue', DEFAULTS), expected);

  const noId = fakeDb({ data: FULL_ORG });
  assert.deepEqual(await getOrgIdentity(noId.db, null, DEFAULTS), expected);
  assert.equal(noId.calls.length, 0, 'aucune requête sans organisation');

  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(await getOrgIdentity(fakeDb({ data: null, error: { message: 'boom' } }).db, 'org-1', DEFAULTS), expected);
    assert.deepEqual(await getOrgIdentity(fakeDb({}, new Error('réseau')).db, 'org-1', DEFAULTS), expected);
  } finally {
    console.warn = warn;
  }
});

test('identityDefaults : FROM_NAME / FROM_EMAIL, sinon vide (plus de marque en dur, open core L7)', () => {
  const env = (vars: Record<string, string>) => (k: string) => vars[k];
  assert.deepEqual(identityDefaults(env({ FROM_NAME: 'Nom env', FROM_EMAIL: 'env@x.test' })), {
    companyName: 'Nom env', senderName: 'Nom env', senderEmail: 'env@x.test',
  });
  assert.deepEqual(identityDefaults(env({})), { companyName: '', senderName: '', senderEmail: '' });
});

test('sans FROM_NAME : le nom de l\'entreprise sert d\'expéditeur', () => {
  const identity = resolveOrgIdentity({ ...FULL_ORG, email_sender_name: '' }, { companyName: '', senderName: '', senderEmail: 'e@x.test' });
  assert.equal(identity.senderName, 'Martin Events');
});

test('orgSender et orgSenderCache : une seule lecture par organisation', async () => {
  // deno-lint-ignore no-explicit-any
  const g = globalThis as any;
  const previous = g.Deno;
  g.Deno = { env: { get: (k: string) => ({ FROM_NAME: 'Nom env', FROM_EMAIL: 'env@x.test' } as Record<string, string>)[k] } };
  try {
    const { db, calls } = fakeDb({ data: FULL_ORG });
    assert.deepEqual(await orgSender(db, 'org-1'), { email: 'bonjour@martin.test', name: 'Martin Photobooth' });
    const senderOf = orgSenderCache(db);
    await senderOf('org-1');
    await senderOf('org-1');
    assert.equal(calls.length, 2, '1 (orgSender) + 1 (cache)');
    assert.deepEqual(await orgSender(fakeDb({ data: null }).db, 'x'), { email: 'env@x.test', name: 'Nom env' });
  } finally {
    g.Deno = previous;
  }
});

// ── Câblage ─────────────────────────────────────────────────────────────────────────────────

const FUNCTIONS = fileURLToPath(new URL('../', import.meta.url));
const read = (rel: string) => readFileSync(join(FUNCTIONS, rel), 'utf8');

test('email.ts : expéditeur par défaut lu par identityDefaults, plus de FROM_* en dur', () => {
  const src = read('_shared/email.ts');
  assert.match(src, /const \{ senderEmail: FROM_EMAIL, senderName: FROM_NAME \} = identityDefaults\(\);/);
  assert.doesNotMatch(src, /Deno\.env\.get\('FROM_(EMAIL|NAME)'\)/);
});

test('inventaire : toute fonction qui envoie un email de email.ts passe l\'expéditeur de l\'organisation', () => {
  // check-cron-alerts : alerte d'infrastructure (BOOKING_ORG_ID retiré par le lot L3), expéditeur par défaut.
  const EXEMPT = new Set(['check-cron-alerts/index.ts']);
  const SEND = /\b(sendAccessCodeEmail|sendApprovalEmail|sendRejectionEmail|sendKioskAlertEmail|sendSupportNotificationEmail|sendDesignReminderEmail|sendSubmitNotificationEmail|sendDeliveryEmail|sendEventReportEmail|sendHtmlEmail)\(\{/g;
  const sourceFiles = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
  });
  const missing: string[] = [];
  let checked = 0;
  for (const file of sourceFiles(FUNCTIONS)) {
    const rel = file.slice(FUNCTIONS.length).replace(/\\/g, '/').replace(/^\//, '');
    if (rel.startsWith('_shared/') || EXEMPT.has(rel)) continue;
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(SEND)) {
      checked++;
      const call = src.slice(m.index!, src.indexOf('})', m.index!));
      if (!/\bsender\b/.test(call)) missing.push(`${rel} : ${m[1]}`);
    }
  }
  assert.deepEqual(missing, []);
  assert.ok(checked >= 12, `${checked} envois vérifiés`);
});

test('send-kiosk-photo : expéditeur de l\'événement, puis de l\'entreprise, puis son nom', () => {
  const src = read('send-kiosk-photo/index.ts');
  assert.match(src, /getOrgIdentity\(db, event\.org_id, \{ \.\.\.identityDefaults\(\), senderName: '' \}\)/);
  // Expéditeur choisi par _shared/kiosk-email.ts (LAB-300), partagé avec kiosk-email-preview.
  const shared = read('_shared/kiosk-email.ts');
  assert.match(shared, /email: text\(email\.sender_email\) \|\| p\.identity\.senderEmail,/);
  assert.match(shared, /name: text\(email\.sender_name\) \|\| p\.identity\.senderName \|\| p\.identity\.companyName,/);
});
