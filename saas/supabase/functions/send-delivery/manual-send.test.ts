// Tests de la décision d'envoi de la livraison et du message de refus Brevo (LAB-126).
// Exécution : `npm test` (runner natif Node, strip-types — aucune dépendance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emailLogRow } from '../_shared/email-log.ts';
import { BREVO_REFUSED_STATUS, brevoRefusedBody, deliveryDecision } from './manual-send.ts';

const source = (fn: string) => readFileSync(new URL(`../${fn}/index.ts`, import.meta.url), 'utf8');

test('aucune livraison tracée : envoi, en manuel comme en cron', () => {
  assert.equal(deliveryDecision('manual', []), 'send');
  assert.equal(deliveryDecision('cron', []), 'send');
});

test('livraison déjà envoyée (sent, puis suivi Brevo) : jamais de second envoi', () => {
  for (const status of ['sent', 'delivered', 'opened', 'clicked', 'soft_bounce', 'hard_bounce', null]) {
    assert.equal(deliveryDecision('manual', [{ status }]), 'already_sent', `manuel ${status}`);
    assert.equal(deliveryDecision('cron', [{ status }]), 'already_sent', `cron ${status}`);
  }
});

test('manuel après un refus Brevo : le nouveau clic relance l\'envoi', () => {
  assert.equal(deliveryDecision('manual', [{ status: 'error' }]), 'send');
  assert.equal(deliveryDecision('manual', [{ status: 'error' }, { status: 'error' }]), 'send');
});

test('manuel : un envoi réussi après des refus bloque les clics suivants', () => {
  assert.equal(deliveryDecision('manual', [{ status: 'error' }, { status: 'delivered' }]), 'already_sent');
});

test('cron après un refus Brevo : pas de nouvel essai automatique', () => {
  assert.equal(deliveryDecision('cron', [{ status: 'error' }]), 'already_sent');
});

test('cron sans doublon : une livraison réussie, même après une relance manuelle, bloque le cron', () => {
  assert.equal(deliveryDecision('cron', [{ status: 'error' }, { status: 'sent' }]), 'already_sent');
});

test('brevoRefusedBody : 502, message français avec le motif, code brevo_refused', () => {
  assert.equal(BREVO_REFUSED_STATUS, 502);
  const body = brevoRefusedBody("L'email de livraison", 'Brevo 400 : invalid email', 'Réessayez.');
  assert.equal(body.code, 'brevo_refused');
  assert.equal(body.error, "L'email de livraison n'a pas été envoyé : Brevo a refusé l'envoi (Brevo 400 : invalid email). Réessayez.");
});

// Scénario de bout en bout sur la vraie ligne écrite (emailLogRow) : SentEmail → status → décision.
test('scénario : refus manuel, cron, relance manuelle réussie, cron et clic suivants', () => {
  const logs: { status: string | null }[] = [];
  const write = (error: string | null) => logs.push(emailLogRow({
    scope: { eventId: 'ev' }, recipient: 'c@x.fr', type: 'delivery', subject: 'Vos photos',
    messageId: error ? null : '<id@brevo>', error,
  }));

  // 1. Clic manuel refusé par Brevo : ligne « error ».
  assert.equal(deliveryDecision('manual', logs), 'send');
  write('Brevo 400 : invalid email');
  assert.equal(logs[0].status, 'error');

  // 2. Le cron passe après ce refus : pas d'envoi automatique.
  assert.equal(deliveryDecision('cron', logs), 'already_sent');

  // 3. Nouveau clic manuel : relancé, cette fois accepté.
  assert.equal(deliveryDecision('manual', logs), 'send');
  write(null);
  assert.equal(logs[1].status, 'sent');

  // 4. Ni le cron ni un clic suivant ne renvoient.
  assert.equal(deliveryDecision('cron', logs), 'already_sent');
  assert.equal(deliveryDecision('manual', logs), 'already_sent');
});

test('scénario : sans BREVO_API_KEY ou bloqué par EMAIL_ALLOWLIST (messageId null, sans erreur) ⇒ compte comme envoyé', () => {
  const row = emailLogRow({
    scope: { eventId: 'ev' }, recipient: 'c@x.fr', type: 'delivery', subject: 's', messageId: null, error: null,
  });
  assert.equal(row.status, 'sent');
  assert.equal(deliveryDecision('cron', [row]), 'already_sent');
});

// Garde-fous sur les sources : les trois envois manuels signalent le refus, le cron reste idempotent.
test('sources : chaque envoi manuel répond BREVO_REFUSED_STATUS quand sentEmail.error est renseigné', () => {
  for (const fn of ['send-delivery', 'resend-access-email', 'review-design']) {
    const src = source(fn);
    assert.match(src, /from '\.\.?\/(send-delivery\/)?manual-send\.ts'/, `${fn} : import de manual-send.ts`);
    assert.match(src, /if \(sentEmail\.error\) \{\s*return corsResponse\(BREVO_REFUSED_STATUS,/, `${fn} : 502 sur refus`);
  }
  assert.match(source('review-design'), /reviewed: true/);
});

test('sources : send-delivery décide en mode manual pour l\'admin, cron pour le cron, refus non compté dans sent', () => {
  const src = source('send-delivery');
  assert.match(src, /deliveryDecisionFor\(db, event\.id, 'manual'\)/);
  assert.match(src, /deliveryDecisionFor\(db, ev\.id, 'cron'\) === 'already_sent'\) continue;/);
  assert.match(src, /if \(sentEmail\.error\) console\.error\([^)]*\);\s*else sent\+\+;/);
  // Lecture email_logs en échec : levée (et non « aucune livraison », qui doublerait l'envoi).
  assert.match(src, /if \(error\) throw new Error\(`email_logs/);
});

test('manual-send.ts reste sans import (exécutable sous node --test et partageable entre fonctions)', () => {
  const src = readFileSync(new URL('./manual-send.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^\s*import\s/m);
});
