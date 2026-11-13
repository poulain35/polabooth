// Logo de la société (LAB-257).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ORG_LOGO_MAX_BYTES, orgLogoExtension, orgLogoPath, orgLogoPaths, orgLogoProblem, orgLogoUrl,
} from './orgLogo.js';
import { PRIVATE_HISTORY } from '../../scripts/private-history.mjs';

const file = (over = {}) => ({ name: 'logo.png', type: 'image/png', size: 120_000, ...over });

test('PNG et JPG acceptés, extension du fichier rangé', () => {
  assert.equal(orgLogoProblem(file()), null);
  assert.equal(orgLogoExtension(file()), 'png');
  assert.equal(orgLogoProblem(file({ name: 'logo.jpeg', type: 'image/jpeg' })), null);
  assert.equal(orgLogoExtension(file({ name: 'logo.jpeg', type: 'image/jpeg' })), 'jpg');
  // Type absent (certains navigateurs) : l'extension décide.
  assert.equal(orgLogoExtension(file({ name: 'Logo.JPG', type: '' })), 'jpg');
});

test('SVG, WebP, GIF et autres refusés avec un message clair', () => {
  for (const f of [
    file({ name: 'logo.svg', type: 'image/svg+xml' }),
    file({ name: 'logo.webp', type: 'image/webp' }),
    file({ name: 'logo.gif', type: 'image/gif' }),
    file({ name: 'logo.pdf', type: 'application/pdf' }),
    file({ name: 'logo.svg', type: '' }),
  ]) {
    assert.equal(orgLogoExtension(f), null, f.name);
    assert.match(orgLogoProblem(f), /PNG ou JPG \(pas de SVG\)/);
  }
  assert.equal(orgLogoProblem(null), 'Aucun fichier choisi.');
});

test('2 Mo au maximum', () => {
  assert.equal(ORG_LOGO_MAX_BYTES, 2 * 1024 * 1024);
  assert.equal(orgLogoProblem(file({ size: ORG_LOGO_MAX_BYTES })), null);
  assert.equal(orgLogoProblem(file({ size: 3.4 * 1024 * 1024 })),
    'Image trop lourde (3,4 Mo) : 2 Mo au maximum. Réduisez sa taille et réessayez.');
});

test('chemins dans kiosk-backgrounds et URL versionnée', () => {
  assert.equal(orgLogoPath('org-1', 'png'), 'org/org-1/logo.png');
  assert.deepEqual(orgLogoPaths('org-1'), ['org/org-1/logo.png', 'org/org-1/logo.jpg']);
  assert.equal(orgLogoUrl('https://cdn/kiosk-backgrounds/org/org-1/logo.png', 42),
    'https://cdn/kiosk-backgrounds/org/org-1/logo.png?v=42');
  assert.equal(orgLogoUrl('https://cdn/logo.png?t=1', 42), 'https://cdn/logo.png?t=1&v=42');
});

test('migration : colonne logo_url et RPC get_org_contact_by_event rejouables, droits gardés', { skip: PRIVATE_HISTORY }, () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20261207000000_org_logo.sql', import.meta.url), 'utf8');
  assert.match(sql, /ALTER TABLE public\.organizations ADD COLUMN IF NOT EXISTS logo_url text;/);
  assert.match(sql, /DROP FUNCTION IF EXISTS public\.get_org_contact_by_event\(uuid\);\s+CREATE FUNCTION public\.get_org_contact_by_event\(p_event_id uuid\)/);
  assert.match(sql, /SECURITY DEFINER\s+STABLE\s+SET search_path = public, pg_temp/);
  assert.match(sql, /'contact_company', COALESCE\(o\.contact_company, o\.name\)/);
  assert.match(sql, /'logo_url',\s+o\.logo_url/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.get_org_contact_by_event\(uuid\) TO anon;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.get_org_contact_by_event\(uuid\) TO authenticated;/);
});
