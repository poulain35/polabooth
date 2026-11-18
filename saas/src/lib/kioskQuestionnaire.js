/**
 * Questionnaire de la borne (form_config.kiosk.questionnaire, LAB-220, spec LAB-208).
 * Module pur : défauts, fusion avec la config enregistrée, nettoyage et validation à la sauvegarde.
 */
import { KIOSK_QUESTION_TYPES, isChoiceType } from '../utils/formQuestions.js';

export const QUESTIONNAIRE_LIMITS = { questions: 8, options: 12, label: 120 };

export const DEFAULT_NOTICE =
  "Vos réponses sont collectées pour {controller_name}. Elles sont conservées 1 mois après l'événement, puis supprimées. Pour les consulter ou les supprimer : {controller_contact}.";

export const CONTROLLER_NAME_REQUIRED = 'Indiquez le nom du client responsable des données';

export function buildDefaultQuestionnaire() {
  return {
    enabled: false,
    required_for_photo: true,
    title: 'Restons en contact',
    intro: 'Quelques questions rapides pendant que votre photo se prépare.',
    cancel_label: 'Annuler',
    skip_label: 'Passer',
    // Une seule question de départ, obligatoire : l'admin compose le reste événement par événement.
    questions: [
      { id: 'q_email', label: 'Votre e-mail', type: 'email', required: true },
    ],
    controller: { name: '', contact_email: '' },
    notice: DEFAULT_NOTICE,
    marketing_consent: {
      enabled: true,
      label: "J'accepte d'être recontacté(e) par {controller_name}.",
    },
    prefill_share_email: true,
  };
}

// Config enregistrée + défauts. Les clés abandonnées (allow_skip, retention_days, home_notice :
// mention d'accueil retirée le 2026-11-15) et tout réglage « obligatoire » / « coché » de la case
// de prospection sont retirés.
export function withQuestionnaireDefaults(raw) {
  const def = buildDefaultQuestionnaire();
  const src = raw && typeof raw === 'object' ? raw : {};
  const rest = { ...src };
  delete rest.allow_skip;
  delete rest.retention_days;
  delete rest.home_notice;
  return {
    ...def,
    ...rest,
    questions: Array.isArray(src.questions) ? src.questions : def.questions,
    controller: { ...def.controller, ...(src.controller ?? {}) },
    marketing_consent: {
      enabled: src.marketing_consent?.enabled ?? def.marketing_consent.enabled,
      label:   src.marketing_consent?.label   ?? def.marketing_consent.label,
    },
  };
}

// Forme écrite dans form_config : libellés et options rognés, options vides retirées.
export function cleanQuestionnaire(q) {
  const base = withQuestionnaireDefaults(q);
  return {
    ...base,
    controller: {
      name: String(base.controller.name ?? '').trim(),
      contact_email: String(base.controller.contact_email ?? '').trim(),
    },
    questions: base.questions.map((question) => {
      const next = { ...question, label: String(question.label ?? '').trim(), required: !!question.required };
      if (isChoiceType(next.type)) {
        next.options = (question.options ?? []).map((o) => String(o ?? '').trim()).filter(Boolean);
      } else {
        delete next.options;
      }
      return next;
    }),
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Renvoie la liste des erreurs bloquantes ({ code, message }), vide si la config est valide.
 * Un questionnaire désactivé n'est pas contrôlé : il n'est pas affiché par la borne.
 */
export function validateKioskQuestionnaire(raw) {
  const q = cleanQuestionnaire(raw);
  if (!q.enabled) return [];

  const { questions: maxQuestions, options: maxOptions, label: maxLen } = QUESTIONNAIRE_LIMITS;
  const errors = [];
  const add = (code, message) => errors.push({ code, message });
  const typeValues = KIOSK_QUESTION_TYPES.map((t) => t.value);

  if (!q.controller.name) add('controller_name', CONTROLLER_NAME_REQUIRED);
  if (q.controller.contact_email && !EMAIL_RE.test(q.controller.contact_email)) {
    add('controller_email', "L'e-mail de contact du client n'est pas valide");
  }

  if (q.questions.length === 0) add('no_questions', 'Ajoutez au moins une question');
  if (q.questions.length > maxQuestions) add('too_many_questions', `${maxQuestions} questions maximum`);

  q.questions.forEach((question, i) => {
    const n = i + 1;
    if (!typeValues.includes(question.type)) add('question_type', `Question ${n} : type inconnu`);
    if (!question.label) add('question_label', `Question ${n} : indiquez un libellé`);
    else if (question.label.length > maxLen) add('question_label', `Question ${n} : libellé de ${maxLen} caractères maximum`);
    if (isChoiceType(question.type)) {
      if (question.options.length < 2) add('question_options', `Question ${n} : au moins deux options`);
      if (question.options.length > maxOptions) add('question_options', `Question ${n} : ${maxOptions} options maximum`);
      if (question.options.some((o) => o.length > maxLen)) {
        add('question_options', `Question ${n} : options de ${maxLen} caractères maximum`);
      }
    }
  });

  for (const [key, name] of [['title', 'Le titre'], ['intro', "Le texte d'introduction"], ['cancel_label', 'Le bouton « Annuler »'], ['skip_label', 'Le bouton « Passer »']]) {
    if (String(q[key] ?? '').length > maxLen) add(key, `${name} : ${maxLen} caractères maximum`);
  }
  if (String(q.marketing_consent.label ?? '').length > maxLen) {
    add('marketing_label', `La case de prospection : ${maxLen} caractères maximum`);
  }

  // Dans les deux modes : au moins une vraie question obligatoire (une case à cocher ne compte pas,
  // et ne peut jamais être obligatoire : ce serait un accord forcé).
  if (q.questions.some((question) => question.type === 'checkbox' && question.required)) {
    add('required_checkbox', 'Une case à cocher ne peut pas être obligatoire');
  }
  if (q.questions.length > 0 && !q.questions.some((question) => question.required && question.type !== 'checkbox')) {
    add('no_required_question', 'Rendez au moins une question obligatoire');
  }

  return errors;
}
