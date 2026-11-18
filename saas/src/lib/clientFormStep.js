import { hasAnswer } from '../utils/formQuestions.js';

/**
 * Formulaire avant l'éditeur du client (LAB-354) : demandé tant que le client n'a jamais répondu,
 * ou s'il manque la réponse à une question obligatoire (ajoutée après coup par l'admin).
 * Une fois rempli, il ne revient plus à chaque visite.
 */
export function clientFormNeeded({ enabled, questions, answers }) {
  if (!enabled || !Array.isArray(questions) || questions.length === 0) return false;
  if (!answers || typeof answers !== 'object') return true;
  return questions.some((q) => q?.required && !hasAnswer(answers[q.id]));
}
