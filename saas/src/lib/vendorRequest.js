// Demande à l'éditeur du logiciel (spec connecteurs-facturation §6) : un lien mailto préparé, envoyé
// depuis la messagerie de la personne. Rien n'est stocké ni envoyé par le SaaS.

// Même adresse dans toutes les instances : les demandes de tous les loueurs arrivent à l'éditeur.
// Seul fichier exporté autorisé à la contenir (open-core/export.json › forbidden.exceptions.allow).
export const VENDOR_EMAIL = 'hello@jeremypoulain.fr';

export const TOOL_MAX_LENGTH = 80;
export const MESSAGE_MAX_LENGTH = 2000;
export const MAILTO_MAX_LENGTH = 1800;

const ELLIPSIS = '…';

/** `connector` ou `module:<id>` → { kind, id? } ; tout le reste est lu comme `connector`. */
export function parseTopic(topic) {
  const m = /^module:(.+)$/.exec(String(topic ?? '').trim());
  return m ? { kind: 'module', id: m[1].trim() } : { kind: 'connector' };
}

export function topicLabel(topic) {
  const t = parseTopic(topic);
  return t.kind === 'module' ? `module ${t.id}` : 'connecteur de facturation';
}

/** Champs nettoyés et erreurs par champ (`errors` vide = demande valide). */
export function validateVendorRequest({ tool, message } = {}) {
  const cleanTool = String(tool ?? '').trim();
  const cleanMessage = String(message ?? '').trim();
  const errors = {};
  if (!cleanTool) errors.tool = 'Indiquez l\'outil voulu.';
  else if (cleanTool.length > TOOL_MAX_LENGTH) errors.tool = `${TOOL_MAX_LENGTH} caractères au plus.`;
  if (cleanMessage.length > MESSAGE_MAX_LENGTH) errors.message = `${MESSAGE_MAX_LENGTH} caractères au plus.`;
  return { tool: cleanTool, message: cleanMessage, errors, valid: Object.keys(errors).length === 0 };
}

function bodyLines({ tool, message, topic, origin, version }) {
  return [
    `Outil demandé : ${tool}`,
    `Sujet : ${topicLabel(topic)}`,
    `Message : ${message}`,
    `Instance : ${origin || 'inconnue'}`,
    `Version : ${version || 'inconnue'}`,
  ].join('\r\n');
}

function assemble(subject, body) {
  return `mailto:${VENDOR_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/**
 * Lien mailto de la demande (§6.4). Le message est tronqué (« … ») pour que le lien encodé reste sous
 * MAILTO_MAX_LENGTH caractères ; l'outil, limité à 80 caractères, tient toujours.
 */
export function buildVendorMailto({ tool, message, topic = 'connector', origin = '', version = '' }) {
  const cleanTool = String(tool ?? '').trim();
  const cleanMessage = String(message ?? '').trim().replace(/\r?\n/g, '\r\n');
  const subject = `Polabooth : demande de connecteur ${cleanTool}`;
  const parts = { tool: cleanTool, topic, origin, version };
  if (!cleanMessage) return assemble(subject, bodyLines({ ...parts, message: '(aucun)' }));

  const full = assemble(subject, bodyLines({ ...parts, message: cleanMessage }));
  if (full.length <= MAILTO_MAX_LENGTH) return full;

  const base = assemble(subject, bodyLines({ ...parts, message: '' })).length;
  let room = MAILTO_MAX_LENGTH - base - encodeURIComponent(ELLIPSIS).length;
  let kept = '';
  for (const char of Array.from(cleanMessage)) {
    const cost = encodeURIComponent(char).length;
    if (cost > room) break;
    kept += char;
    room -= cost;
  }
  return assemble(subject, bodyLines({ ...parts, message: `${kept.trimEnd()}${ELLIPSIS}` }));
}
