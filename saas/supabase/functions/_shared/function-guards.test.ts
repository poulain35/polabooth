// Inventaire des gardes d'autorisation par edge function (LAB-113) : lit les sources et config.toml.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const FUNCTIONS_DIR = fileURLToPath(new URL('..', import.meta.url));
const CONFIG = readFileSync(fileURLToPath(new URL('../../config.toml', import.meta.url)), 'utf8');

const functions = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_') && existsSync(join(FUNCTIONS_DIR, d.name, 'index.ts')))
  .map((d) => d.name);
const source = (fn: string) => readFileSync(join(FUNCTIONS_DIR, fn, 'index.ts'), 'utf8');

// Dépôt public (export open core) : sans _shared/modules/, les fonctions des fonctionnalités privées
// ne sont pas livrées (et le manifeste exporté ne les cite plus) : seules les fonctions présentes comptent.
const PRIVATE_INSTALLED = existsSync(join(FUNCTIONS_DIR, '_shared', 'modules'));
const installed = (fn: string) => PRIVATE_INSTALLED || functions.includes(fn);

function verifyJwtDisabled(fn: string): boolean {
  const block = CONFIG.split(/^\[functions\./m).find((b) => b.startsWith(`${fn}]`));
  return !!block && /^\s*verify_jwt\s*=\s*false/m.test(block);
}

// Jobs pg_cron (cron.job en dev) qui appellent une edge function.
const CRON = [
  'booking-reminders', 'booking-slot-reminders', 'check-kiosk-alerts', 'payment-reconcile', 'pennylane-sync',
  'send-access-emails', 'send-balance-invoices', 'send-delivery', 'send-design-reminders',
  'check-cron-alerts', 'media-expiry',
];
// Pas d'égalité stricte avec SUPABASE_SERVICE_ROLE_KEY : le cron envoie le JWT du Vault (LAB-119).
const SERVICE_ROLE_GUARD = /cronOnly\(|isServiceRoleJwt\(|isServiceRoleRequest\(|requireServiceOrOrgAdmin\(/;

// Fonctions admin (JWT + client service_role) : propriétaire de l'org exigé ;
// fonctions d'administration de l'application : appartenance à app_admins exigée (LAB-197).
const ORG_GUARD = /requireAppAdmin\(|requireOrgAccess\(|requireOrgAdmin\(|requireServiceOrOrgAdmin\(|requireAnyOrgOwner\(|forbiddenOrg\(|\.eq\('owner_id', user\.id\)|owner_id/;

test('crons : chaque fonction appelée par pg_cron vérifie service_role', () => {
  for (const fn of CRON.filter(installed)) assert.match(source(fn), SERVICE_ROLE_GUARD, fn);
});

test('les gardes service_role ne tournent que derrière verify_jwt = true (claim role non signée sinon)', () => {
  for (const fn of functions) {
    if (/cronOnly\(|isServiceRoleJwt\(|isServiceRoleRequest\(|requireServiceOrOrgAdmin\(/.test(source(fn))) {
      assert.equal(verifyJwtDisabled(fn), false, `${fn} : verify_jwt = false incompatible avec isServiceRoleJwt`);
    }
  }
});

test('admin : toute fonction qui authentifie un utilisateur vérifie la propriété de l’organisation', () => {
  const authenticated = functions.filter((fn) => /auth\.getUser\(\)|sessionUser\b/.test(source(fn)));
  assert.ok(authenticated.length >= (PRIVATE_INSTALLED ? 15 : 8), `${authenticated.length} fonctions authentifiées`);
  for (const fn of authenticated) assert.match(source(fn), ORG_GUARD, fn);
});

test('fonctions admin LAB-113 : garde partagé appliqué', () => {
  const expected: Record<string, RegExp> = {
    'delete-photo': /requireOrgAccess\(db, auth\.user\.id, \{ kind: 'photo'/,
    'get-photo-upload-url': /requireOrgAccess\(db, auth\.user\.id, \{ kind: 'event'/,
    'delete-audio-track': /kind: 'audio_track'/,
    'generate-audio-title': /kind: 'audio_track'/,
    'get-audio-upload-url': /requireOrgAccess\(adminClient\(\), auth\.user\.id, \{ kind: 'event'/,
    'generate-background': /requireAnyOrgOwner\(/,
    'remove-background': /requireAnyOrgOwner\(/,
    'convert-lead': /forbiddenOrg\(\)/,
    'resend-access-email': /forbiddenOrg\(\)/,
    'review-design': /forbiddenOrg\(\)/,
    'send-delivery': /forbiddenOrg\(\)/,
    'send-event-report': /forbiddenOrg\(\)/,
    'pennylane-sync': /requireServiceOrOrgAdmin\(/,
    'gcal-sync': /requireServiceOrOrgAdmin\(/,
    // Open core L3b : module privé de réservation, appels internes (service_role) seulement.
    'booking-gcal-sync': /if \(!isServiceRoleRequest\(req\.headers\.get\('Authorization'\), Deno\.env\.get\('SUPABASE_SERVICE_ROLE_KEY'\)\)\)/,
    // LAB-242 : super-admin (app_admins) ou propriétaire du compte de la borne.
    'kiosk-admin-pin': /\.from\('app_admins'\)[\s\S]*\.eq\('user_id', userId\)[\s\S]*\.eq\('owner_id', userId\)[\s\S]*if \(!org\) return corsResponse\(403/,
  };
  for (const [fn, re] of Object.entries(expected)) if (installed(fn)) assert.match(source(fn), re, fn);
});

test('limites de débit : generate-background par utilisateur, assistant-chat plafond global', () => {
  assert.match(source('generate-background'), /LIMITS\.generateBgUser, auth\.user\.id\]/);
  assert.match(source('generate-background'), /LIMITS\.generateBgUserDay, auth\.user\.id\]/);
  assert.match(source('assistant-chat'), /LIMITS\.assistantGlobalDay, GLOBAL_KEY\]/);
});

test('send-kiosk-photo : événement actif et photo rattachée vérifiés', () => {
  const src = source('send-kiosk-photo');
  assert.match(src, /isActiveEventStatus\(event\.status\)/);
  assert.match(src, /verifyKioskPhoto\(/);
});

test('get-kiosk-upload-url : licence et code d’accès vérifiés avant toute signature R2 (LAB-213)', () => {
  const src = source('get-kiosk-upload-url');
  const resolve = src.indexOf('resolveKioskUpload(adminClient()');
  assert.ok(resolve > 0, 'resolveKioskUpload appelé');
  assert.ok(resolve < src.indexOf('getSignedUrl('), 'autorisation avant la signature');
  assert.match(src, /if \(!upload\.ok\) return corsResponse\(upload\.status/);
  assert.equal(verifyJwtDisabled('get-kiosk-upload-url'), false);
});

test('get-release-upload-url : administrateur de l’application exigé avant la signature (LAB-269)', () => {
  const src = source('get-release-upload-url');
  const guard = src.indexOf('requireAppAdmin(adminClient(), auth.user.id)');
  assert.ok(guard > 0, 'requireAppAdmin appelé');
  assert.ok(guard < src.indexOf('getSignedUrl('), 'autorisation avant la signature');
  assert.equal(verifyJwtDisabled('get-release-upload-url'), false);
});
