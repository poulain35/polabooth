/**
 * POST /functions/v1/remove-background
 *
 * Supprime l'arrière-plan d'une image via Replicate.
 * Auth : code d'accès événement (client) OU JWT admin.
 *
 * Body: { image, code? }  — image = URL https ou data URI (data:image/...;base64,...)
 *
 * Réponse: { url: "data:image/png;base64,..." }  — PNG transparent embarqué
 * (data URI pour persister dans canvas_json + rester compatible export .pola)
 */

import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts';
import { handleCors, corsResponse } from '../_shared/cors.ts';
import { adminClient, sessionUser } from '../_shared/auth.ts';
import { authenticate, requireAnyOrgOwner } from '../_shared/admin-guard.ts';
import { requireFeature } from '../_shared/features.ts';
import { requireInstanceFeature } from '../_shared/feature-guard.ts';
import { serviceSecret } from '../_shared/service-secrets.ts';
import { templateLinkExpired } from '../_shared/expiry.ts';
import { LIMITS, publicGuard } from '../_shared/public-rate-limit.ts';


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
  const accessCode = code && typeof code === 'string' ? code.toUpperCase().trim() : null;
  const guard = publicGuard('remove-background', req, db, Deno.env.get('RATE_LIMIT_SALT'));
  const limited = await guard.check(
    [[LIMITS.removeBgIp, guard.ip], [LIMITS.removeBgCode, accessCode], [LIMITS.removeBgCodeDay, accessCode]],
    { codeFailures: !!accessCode },
  );
  if (limited) return limited;

  // ── Auth : code d'accès (client) OU JWT admin ─────────────────────────────────
  let authorized = false;
  if (accessCode) {
    const { data: event } = await db
      .from('events')
      .select('org_id, status, end_date')
      .eq('access_code', accessCode)
      .single();
    if (!event) await guard.codeFailed();
    if (event && event.status !== 'archived'
      && !templateLinkExpired(event.end_date)) {
      const disabled = await requireFeature(db, event.org_id, 'ai_visuals');
      if (disabled) return disabled;
      authorized = true;
    }
  } else {
    const auth = await authenticate(req.headers.get('Authorization'), sessionUser);
    if (auth.response) return auth.response;
    const notOwner = await requireAnyOrgOwner(db, auth.user.id);
    if (notOwner) return notOwner;
    const disabled = await requireInstanceFeature(db, 'ai_visuals');
    if (disabled) return disabled;
    authorized = true;
  }
  if (!authorized) return corsResponse(401, { error: 'Non autorisé' });

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

    // Embarquer le résultat en data URI — persistant dans canvas_json + offline .pola
    const imgRes = await fetch(outputUrl);
    if (!imgRes.ok) throw new Error('Téléchargement du résultat échoué');
    const dataUri = `data:image/png;base64,${encodeBase64(await imgRes.arrayBuffer())}`;

    return corsResponse(200, { url: dataUri });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur interne';
    return corsResponse(500, { error: msg });
  }
});
