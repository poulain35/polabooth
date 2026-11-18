// Webhook des alertes de la borne (organizations.webhook_url), partagé par les deux réconciliations.

/** POST best-effort vers le webhook de l'org (organizations.webhook_url). Ne lève jamais. */
export async function postWebhook(url: string | null | undefined, payload: Record<string, unknown>) {
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error('Échec webhook alerte', e);
  }
}
