import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appUrl, publicAppUrl } from './app-url.ts';

const envOf = (vars: Record<string, string>) => (k: string) => vars[k];

test('appUrl : APP_URL, sinon PUBLIC_APP_URL', () => {
  assert.equal(appUrl(envOf({ APP_URL: 'https://a.test', PUBLIC_APP_URL: 'https://p.test' })), 'https://a.test');
  assert.equal(appUrl(envOf({ PUBLIC_APP_URL: 'https://p.test' })), 'https://p.test');
});

test('publicAppUrl : PUBLIC_APP_URL, sinon APP_URL', () => {
  assert.equal(publicAppUrl(envOf({ APP_URL: 'https://a.test', PUBLIC_APP_URL: 'https://p.test' })), 'https://p.test');
  assert.equal(publicAppUrl(envOf({ APP_URL: 'https://a.test' })), 'https://a.test');
});

test('aucune variable : chaîne vide (plus d\'adresse codée en dur)', () => {
  assert.equal(appUrl(envOf({})), '');
  assert.equal(publicAppUrl(envOf({})), '');
});
