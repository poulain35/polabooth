// LAB-217 : la borne enregistre les consentements photo dans event_form_responses
// (answers.type = 'rgpd_consent'), à côté des vraies réponses du client. Les questions du
// client ont des id en `q_…` : la clé `type` ne vient que de la borne.
export const KIOSK_CONSENT_TYPE = 'rgpd_consent';

// Filtre PostgREST (`.or(...)`) : sans `is.null`, `neq` exclurait aussi les vraies réponses,
// qui n'ont pas de clé `type`. Recopié dans supabase/functions/get-event/index.ts.
export const NOT_KIOSK_CONSENT_FILTER = `answers->>type.is.null,answers->>type.neq.${KIOSK_CONSENT_TYPE}`;

export function isKioskConsentRow(row) {
  return row?.answers?.type === KIOSK_CONSENT_TYPE;
}

export function withoutKioskConsents(rows) {
  return (rows ?? []).filter((r) => !isKioskConsentRow(r));
}

/** Une seule réponse client par événement : la plus récente. */
export function latestResponsePerEvent(rows) {
  const sorted = withoutKioskConsents(rows).sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at));
  const seen = new Set();
  const out = [];
  for (const r of sorted) {
    if (seen.has(r.event_id)) continue;
    seen.add(r.event_id);
    out.push(r);
  }
  return out;
}

// ── Envoi du formulaire client (RPC submit_form_response, LAB-277) ───────────────────────────

export const FORM_RATE_LIMITED_MESSAGE = 'Trop d\'envois, réessayez dans quelques minutes.';
export const FORM_UNKNOWN_EVENT_MESSAGE = 'Cet événement est introuvable ou n\'est plus actif. Vérifiez le lien reçu.';
export const FORM_DISABLED_MESSAGE = 'Le formulaire n\'est plus ouvert pour cet événement.';
export const FORM_INVALID_MESSAGE = 'Vos réponses sont trop longues. Raccourcissez-les puis réessayez.';
export const FORM_GENERIC_MESSAGE = 'L\'envoi a échoué. Réessayez dans un instant.';

/** Refus de la limite d'envois (PT429, indice trop_de_requetes ou statut HTTP 429). */
export function isFormRateLimited(error) {
  return !!error && (error.code === 'PT429' || error.hint === 'trop_de_requetes' || error.status === 429);
}

/** Message affiché au client pour une erreur de submit_form_response. */
export function formSubmitErrorMessage(error) {
  if (isFormRateLimited(error)) return FORM_RATE_LIMITED_MESSAGE;
  const message = String(error?.message ?? '');
  if (error?.code === 'PT404' || /fonctionnalite_desactivee|formulaire_desactive/.test(message)) return FORM_DISABLED_MESSAGE;
  if (error?.code === '22023') return FORM_INVALID_MESSAGE;
  return FORM_GENERIC_MESSAGE;
}
