/**
 * POST /functions/v1/remove-background
 *
 * Supprime l'arrière-plan d'une image via Replicate.
 * Auth : code d'accès événement (client) OU JWT admin.
 *
 * Body: { image, code? }  — image = URL https ou data URI (data:image/...;base64,...)
 *
 * Réponse: { url }  — PNG transparent rangé dans le bucket `designs` (LAB-348), au même endroit
 * que les images envoyées par upload-design-image : `{event_id}/images/{sha256}.png` (client) ou
 * `templates/images/{sha256}.png` (admin). Si le stockage échoue, data URI en repli
 * (`data:image/png;base64,...`) : l'éditeur range l'image lui-même plus tard.
 */

import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts';
import { handleCors, corsResponse } from '../_shared/cors.ts';
import { adminClient, sessionUser } from '../_shared/auth.ts';
import { authenticate, requireAnyOrgOwner } from '../_shared/admin-guard.ts';
import { requireInstanceFeature } from '../_shared/feature-guard.ts';
import { serviceSecret } from '../_shared/service-secrets.ts';
import { eventByCode, normalizeAccessCode } from '../_shared/event-by-code.ts';
import { LIMITS, publicGuard } from '../_shared/public-rate-limit.ts';
import { storeDesignImage, type ImageScope } from '../_shared/design-images.ts';


// BiRefNet — conserve la résolution d'entrée et renvoie un PNG avec alpha.
const MODEL_PATH = '851-labs/background-remover';

async function pollPrediction(id: string, token: string): Promise<string> {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const res  = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
      headers: { Authorization: `Token ${token}` },
    });
    const data = await res.json();
    if (data.status === 'succeeded') {
      return Array.isArray(data.output) ? data.output[0] : data.output;
    }
    if (data.status === 'failed' || data.status === 'canceled') {
      throw new Error(data.error ?? 'Suppression du fond échouée sur Replicate');
    }
  }
  throw new Error('Timeout: la suppression du fond a pris trop de temps');
}

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return corsResponse(405, { error: 'Method not allowed' });

  // ── Params ──────────────────────────────────────────────────────────────────
  let body: { image?: unknown; code?: unknown };
  try { body = await req.json(); } catch { return corsResponse(400, { error: 'Body JSON invalide' }); }

  const image = body.image;
  const code  = body.code;
  if (!image || typeof image !== 'string') return corsResponse(400, { error: 'Image manquante' });

  // ── Limitation de débit (appel payant) ──────────────────────────────────────
  const db = adminClient();
  const accessCode = normalizeAccessCode(code);
  const guard = publicGuard('remove-background', req, db, Deno.env.get('RATE_LIMIT_SALT'));
  const limited = await guard.check(
    [[LIMITS.removeBgIp, guard.ip], [LIMITS.removeBgCode, accessCode], [LIMITS.removeBgCodeDay, accessCode]],
    { codeFailures: !!accessCode },
  );
  if (limited) return limited;

  // ── Auth : code d'accès (client) OU JWT admin ─────────────────────────────────
  let scope: ImageScope = { kind: 'templates' };
  if (accessCode) {
    // Code inconnu, archivé ou lien expiré : même 401, sans dire lequel.
    const unauthorized = { status: 401, error: 'Non autorisé' };
    const found = await eventByCode(db, accessCode, {
      fn: 'remove-background',
      columns: [],
      guard,
      notFound: unauthorized,
      archived: unauthorized,
      expiry: { rule: 'template', refusal: unauthorized },
      feature: 'ai_visuals',
    });
    if (found.response) return found.response;
    scope = { kind: 'event', eventId: found.event.id };
  } else {
    const auth = await authenticate(req.headers.get('Authorization'), sessionUser);
    if (auth.response) return auth.response;
    const notOwner = await requireAnyOrgOwner(db, auth.user.id);
    if (notOwner) return notOwner;
    const disabled = await requireInstanceFeature(db, 'ai_visuals');
    if (disabled) return disabled;
  }

  // Paramètres > Clés, sinon secret REPLICATE_API_TOKEN (lot L6b).
  const token = await serviceSecret('REPLICATE_API_TOKEN');
  if (!token) return corsResponse(500, { error: 'Jeton Replicate manquant : à saisir dans Paramètres > Clés' });

  // ── Appel Replicate ─────────────────────────────────────────────────────────
  try {
    // Modèle communautaire → l'endpoint /models/.../predictions est réservé aux
    // modèles officiels. On récupère la dernière version puis on cible /predictions.
    const modelRes = await fetch(`https://api.replicate.com/v1/models/${MODEL_PATH}`, {
      headers: { Authorization: `Token ${token}` },
    });
    const model = await modelRes.json();
    if (!modelRes.ok || !model.latest_version?.id) {
      throw new Error(model.detail ?? `Modèle introuvable : ${MODEL_PATH}`);
    }

    const startRes = await fetch(
      'https://api.replicate.com/v1/predictions',
      {
        method: 'POST',
        headers: {
          Authorization:  `Token ${token}`,
          'Content-Type': 'application/json',
          Prefer:         'wait=55',
        },
        body: JSON.stringify({
          version: model.latest_version.id,
          input:   { image, format: 'png' },
        }),
      }
    );

    const prediction = await startRes.json();
    if (!startRes.ok) throw new Error(prediction.detail ?? `Replicate error ${startRes.status}`);

    let outputUrl: string;
    if (prediction.status === 'succeeded') {
      outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    } else {
      outputUrl = await pollPrediction(prediction.id, token);
    }

    // L'adresse Replicate expire : le résultat est rangé dans le stockage (adresse durable).
    const imgRes = await fetch(outputUrl);
    if (!imgRes.ok) throw new Error('Téléchargement du résultat échoué');
    const bytes = new Uint8Array(await imgRes.arrayBuffer());
    try {
      const stored = await storeDesignImage(db, scope, bytes);
      return corsResponse(200, { url: stored.url });
    } catch (storeErr) {
      console.error('remove-background : stockage du résultat impossible, data URI en repli', storeErr);
      return corsResponse(200, { url: `data:image/png;base64,${encodeBase64(bytes)}` });
    }

  } catch (err: unknown) {
    // Détail (réponse Replicate, délai…) en journal seulement (LAB-392).
    console.error('remove-background : échec de la suppression du fond', err);
    return corsResponse(500, { error: 'La suppression du fond a échoué, réessayez.' });
  }
});
