import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDefaultQuestionnaire, withQuestionnaireDefaults, cleanQuestionnaire, validateKioskQuestionnaire,
  DEFAULT_HOME_NOTICE, CONTROLLER_NAME_REQUIRED, QUESTIONNAIRE_LIMITS,
} from './kioskQuestionnaire.js';
import { KIOSK_QUESTION_TYPES, QUESTION_TYPES } from '../utils/formQuestions.js';

const codes = (cfg) => validateKioskQuestionnaire(cfg).map((e) => e.code);
const valid = (patch = {}) => ({
  ...buildDefaultQuestionnaire(),
  enabled: true,
  controller: { name: 'Salon Pro', contact_email: 'contact@salon.fr' },
  ...patch,
});

test('défauts : désactivé, obligatoire pour la photo, textes de la spec', () => {
  const d = buildDefaultQuestionnaire();
  assert.equal(d.enabled, false);
  assert.equal(d.required_for_photo, true);
  assert.equal(d.home_notice, DEFAULT_HOME_NOTICE);
  assert.equal(d.home_notice, 'Pour recevoir votre photo, quelques questions vous seront posées.');
  assert.match(d.intro, /^Quelques questions rapides pendant que votre photo se prépare/);
  assert.match(d.notice, /1 mois après l'événement/);
  assert.equal(d.cancel_label, 'Annuler');
  assert.equal(d.skip_label, 'Passer');
  assert.ok(!('allow_skip' in d));
  assert.ok(!('retention_days' in d));
});

test('types de la borne = types du formulaire + case à cocher', () => {
  assert.deepEqual(KIOSK_QUESTION_TYPES.map((t) => t.value), [...QUESTION_TYPES.map((t) => t.value), 'checkbox']);
  assert.ok(!QUESTION_TYPES.some((t) => t.value === 'checkbox'));
});

test('fusion : clés abandonnées et réglages de la case de prospection retirés', () => {
  const merged = withQuestionnaireDefaults({
    enabled: true, allow_skip: true, retention_days: 90, required_for_photo: false,
    marketing_consent: { enabled: false, required: true, checked: true, default_checked: true },
    questions: [],
  });
  assert.ok(!('allow_skip' in merged));
  assert.ok(!('retention_days' in merged));
  assert.equal(merged.required_for_photo, false);
  assert.deepEqual(merged.marketing_consent, { enabled: false, label: buildDefaultQuestionnaire().marketing_consent.label });
  assert.deepEqual(merged.questions, []);
  assert.equal(withQuestionnaireDefaults(undefined).required_for_photo, true);
  assert.equal(withQuestionnaireDefaults({}).questions.length, 1);
});

test('nettoyage : options vides retirées, options supprimées hors choix', () => {
  const cleaned = cleanQuestionnaire(valid({
    questions: [
      { id: 'a', label: ' Profil ', type: 'select', required: true, options: [' Pro ', '', 'Particulier'] },
      { id: 'b', label: 'Nom', type: 'text', options: ['x'] },
    ],
  }));
  assert.deepEqual(cleaned.questions[0].options, ['Pro', 'Particulier']);
  assert.equal(cleaned.questions[0].label, 'Profil');
  assert.ok(!('options' in cleaned.questions[1]));
  assert.equal(cleaned.questions[1].required, false);
});

test('questionnaire désactivé : jamais bloquant', () => {
  assert.deepEqual(validateKioskQuestionnaire(buildDefaultQuestionnaire()), []);
  assert.deepEqual(validateKioskQuestionnaire({ enabled: false, questions: [], home_notice: '' }), []);
});

test('config valide par défaut une fois le responsable renseigné', () => {
  assert.deepEqual(validateKioskQuestionnaire(valid()), []);
});

test('activé sans nom du responsable : refusé avec le message de la spec', () => {
  const errors = validateKioskQuestionnaire(valid({ controller: { name: '  ', contact_email: '' } }));
  assert.deepEqual(errors.map((e) => e.code), ['controller_name']);
  assert.equal(errors[0].message, CONTROLLER_NAME_REQUIRED);
  assert.ok(codes(valid({ controller: { name: 'X', contact_email: 'pas-un-email' } })).includes('controller_email'));
});

test('défauts : une seule question, obligatoire', () => {
  const { questions } = buildDefaultQuestionnaire();
  assert.equal(questions.length, 1);
  assert.equal(questions[0].required, true);
});

test('les deux modes : au moins une question obligatoire (case à cocher exclue)', () => {
  const questions = buildDefaultQuestionnaire().questions.map((q) => ({ ...q, required: false }));
  assert.ok(codes(valid({ questions })).includes('no_required_question'));
  assert.ok(codes(valid({ questions, required_for_photo: false })).includes('no_required_question'));
  const onlyCheckbox = [{ id: 'c', label: 'Catalogue', type: 'checkbox', required: false }];
  assert.ok(codes(valid({ questions: onlyCheckbox, required_for_photo: false })).includes('no_required_question'));
});

test('les deux modes : aucune case à cocher obligatoire', () => {
  const questions = [
    { id: 'e', label: 'E-mail', type: 'email', required: true },
    { id: 'c', label: 'Je veux le catalogue', type: 'checkbox', required: true },
  ];
  assert.ok(codes(valid({ questions })).includes('required_checkbox'));
  assert.deepEqual(codes(valid({ questions, required_for_photo: false })), ['required_checkbox']);
  const ok = [questions[0], { ...questions[1], required: false }];
  assert.deepEqual(codes(valid({ questions: ok, required_for_photo: false })), []);
});

test('mode obligatoire : mention d’accueil non vide (facultative sinon)', () => {
  assert.ok(codes(valid({ home_notice: '   ' })).includes('home_notice_empty'));
  assert.deepEqual(codes(valid({ home_notice: '', required_for_photo: false })), []);
  assert.ok(codes(valid({ home_notice: 'x'.repeat(121) })).includes('home_notice_length'));
});

test('limites : 8 questions, 12 options, 120 caractères', () => {
  const { questions: maxQ, options: maxO, label: maxL } = QUESTIONNAIRE_LIMITS;
  assert.deepEqual([maxQ, maxO, maxL], [8, 12, 120]);

  const q = (i) => ({ id: `q${i}`, label: `Q${i}`, type: 'email', required: true });
  assert.deepEqual(codes(valid({ questions: Array.from({ length: 8 }, (_, i) => q(i)) })), []);
  assert.ok(codes(valid({ questions: Array.from({ length: 9 }, (_, i) => q(i)) })).includes('too_many_questions'));

  const choice = (options) => [{ id: 's', label: 'Choix', type: 'select', required: true, options }];
  assert.deepEqual(codes(valid({ questions: choice(Array.from({ length: 12 }, (_, i) => `o${i}`)) })), []);
  assert.ok(codes(valid({ questions: choice(Array.from({ length: 13 }, (_, i) => `o${i}`)) })).includes('question_options'));
  assert.ok(codes(valid({ questions: choice(['seule']) })).includes('question_options'));
  assert.ok(codes(valid({ questions: choice(['a', 'b'.repeat(121)]) })).includes('question_options'));

  assert.deepEqual(codes(valid({ questions: [{ ...q(1), label: 'x'.repeat(120) }] })), []);
  assert.ok(codes(valid({ questions: [{ ...q(1), label: 'x'.repeat(121) }] })).includes('question_label'));
  assert.ok(codes(valid({ questions: [{ ...q(1), label: '' }] })).includes('question_label'));
  assert.ok(codes(valid({ questions: [] })).includes('no_questions'));
  assert.ok(codes(valid({ questions: [{ ...q(1), type: 'date' }] })).includes('question_type'));
});
