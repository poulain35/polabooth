// LAB-354 : le formulaire avant l'éditeur n'est plus redemandé une fois rempli.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientFormNeeded } from './clientFormStep.js';

const questions = [
  { id: 'q_lieu', label: 'Lieu', type: 'text', required: true },
  { id: 'q_tel', label: 'Téléphone', type: 'tel', required: false },
  { id: 'q_type', label: 'Type', type: 'multi', required: true, options: ['Mariage', 'Autre'] },
];

test('formulaire désactivé ou sans question : jamais demandé', () => {
  assert.equal(clientFormNeeded({ enabled: false, questions, answers: null }), false);
  assert.equal(clientFormNeeded({ enabled: true, questions: [], answers: null }), false);
  assert.equal(clientFormNeeded({ enabled: true, questions: undefined, answers: null }), false);
});

test('première visite (aucune réponse enregistrée) : demandé', () => {
  assert.equal(clientFormNeeded({ enabled: true, questions, answers: null }), true);
  assert.equal(clientFormNeeded({ enabled: true, questions, answers: undefined }), true);
});

test('première visite, questions toutes facultatives : demandé quand même', () => {
  const optional = questions.map((q) => ({ ...q, required: false }));
  assert.equal(clientFormNeeded({ enabled: true, questions: optional, answers: null }), true);
});

test('visite suivante, réponses obligatoires présentes : pas de formulaire', () => {
  const answers = { q_lieu: 'Rennes', q_type: ['Mariage'] };
  assert.equal(clientFormNeeded({ enabled: true, questions, answers }), false);
});

test('réponses déjà envoyées sans rien aux questions facultatives : pas de formulaire', () => {
  const optional = questions.map((q) => ({ ...q, required: false }));
  assert.equal(clientFormNeeded({ enabled: true, questions: optional, answers: {} }), false);
});

test('question obligatoire sans réponse (ajoutée après coup) : demandé', () => {
  assert.equal(clientFormNeeded({ enabled: true, questions, answers: { q_lieu: 'Rennes' } }), true);
  assert.equal(clientFormNeeded({ enabled: true, questions, answers: { q_lieu: '  ', q_type: ['Autre'] } }), true);
  assert.equal(clientFormNeeded({ enabled: true, questions, answers: { q_lieu: 'Rennes', q_type: [] } }), true);
});
