// Carte « Emails automatiques au client » des réglages admin (LAB-262) : lien de l'éditeur avant
// l'événement, relances tant que le template n'est pas soumis, lien des photos après.
// Trois emplacements en base : business_profile (access_email_auto, delivery_auto),
// organizations.brevo_access_template_id et organizations.design_reminders.
import { businessProfilePatch, CLIENT_EMAIL_KEYS } from './businessProfile.js';

export const DESIGN_REMINDERS_DEFAULT = { enabled: false, milestones: [20, 10], brevo_template_id: null };

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Numéro de modèle Brevo : entier positif, sinon null (vide = email intégré à l'app). */
export function brevoTemplateId(raw) {
  const n = Number(String(raw ?? '').trim());
  return String(raw ?? '').trim() !== '' && Number.isInteger(n) && n > 0 ? n : null;
}

/** Jalons de relance : entiers > 0, sans doublon, du plus lointain au plus proche ; vide = défaut. */
export function cleanMilestones(list) {
  const cleaned = [...new Set(
    (Array.isArray(list) ? list : []).map((m) => Math.round(Number(m))).filter((m) => Number.isFinite(m) && m > 0),
  )].sort((a, b) => b - a);
  return cleaned.length ? cleaned : [...DESIGN_REMINDERS_DEFAULT.milestones];
}

/** État initial des relances : défauts puis valeur en base (sous-clés inconnues gardées). */
export function designRemindersForm(stored) {
  const dr = isObject(stored) ? stored : {};
  return {
    ...DESIGN_REMINDERS_DEFAULT,
    ...dr,
    enabled: !!dr.enabled,
    milestones: Array.isArray(dr.milestones) && dr.milestones.length ? dr.milestones : [...DESIGN_REMINDERS_DEFAULT.milestones],
    brevo_template_id: dr.brevo_template_id ?? '',
  };
}

/** Valeur de design_reminders à écrire. */
export function designRemindersPatch(form) {
  const { enabled, milestones, brevo_template_id: tpl, ...rest } = form;
  return { ...rest, enabled: !!enabled, milestones: cleanMilestones(milestones), brevo_template_id: brevoTemplateId(tpl) };
}

export function clientEmailsBusinessPatch(cfg) {
  const full = businessProfilePatch(cfg);
  return Object.fromEntries(CLIENT_EMAIL_KEYS.map((k) => [k, full[k]]));
}

/** Tout ce que la carte enregistre : patch de business_profile + colonnes d'organizations. */
export function clientEmailsSave({ profile, accessTemplateId, reminders }) {
  return {
    businessPatch: clientEmailsBusinessPatch(profile),
    columns: {
      brevo_access_template_id: brevoTemplateId(accessTemplateId),
      design_reminders: designRemindersPatch(reminders),
    },
  };
}

/** Résumé « ce qui part et quand », dans l'ordre du parcours du client. */
export function clientEmailsSummary({ profile, reminders }) {
  const out = [];
  const patch = clientEmailsBusinessPatch(profile);
  if (patch.access_email_auto.enabled) out.push(`J-${patch.access_email_auto.days_before} : lien de l'éditeur`);
  if (reminders?.enabled) {
    const ms = cleanMilestones(reminders.milestones);
    out.push(`${ms.map((m) => `J-${m}`).join(', ')} : ${ms.length > 1 ? 'relances' : 'relance'} si le template n'est pas soumis`);
  }
  if (patch.delivery_auto.enabled) out.push(`J+${patch.delivery_auto.days_after} : lien des photos`);
  return out;
}
