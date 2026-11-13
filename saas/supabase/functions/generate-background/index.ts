/**
 * POST /functions/v1/generate-background
 *
 * Génère un fond via Replicate (Flux). Réservé aux propriétaires d'une organisation, limité par utilisateur.
 *
 * Body: { prompt, model, formatId }
 * model: "flux-1.1-pro" | "flux-1.1-pro-ultra" | "flux-2-pro"
 * formatId: "portrait" | "landscape" | "stripV" | "stripH"
 *
 * Réponse: { url: "https://..." }
 */

import { handleCors, corsResponse } from '../_shared/cors.ts';
import { adminClient, sessionUser } from '../_shared/auth.ts';
import { authenticate, requireAnyOrgOwner } from '../_shared/admin-guard.ts';
import { requireInstanceFeature } from '../_shared/feature-guard.ts';
import { serviceSecret } from '../_shared/service-secrets.ts';
import { LIMITS, publicGuard } from '../_shared/public-rate-limit.ts';


const MODEL_IDS: Record<string, string> = {
  'flux-1.1-pro':       'black-forest-labs/flux-1.1-pro',
  'flux-1.1-pro-ultra': 'black-forest-labs/flux-1.1-pro-ultra',
  'flux-2-pro':         'black-forest-labs/flux-2-pro',
};

// Dimensions de génération alignées sur le ratio exact de chaque format.
// Fabric.js upscale l'image pour couvrir le canvas — inutile de générer en haute résolution.
const FORMAT_DIMS: Record<string, { width: number; height: number }> = {
  portrait:  { width: 832,  height: 1248 }, // ratio 2:3
  landscape: { width: 1248, height: 832  }, // ratio 3:2
  stripV:    { width: 512,  height: 1536 }, // ratio 1:3
  stripH:    { width: 1536, height: 512  }, // ratio 3:1
};

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
      throw new Error(data.error ?? 'Génération échouée sur Replicate');
    }
  }
  throw new Error('Timeout: la génération a pris trop de temps');
}

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return corsResponse(405, { error: 'Method not allowed' });

  // ── Auth admin : JWT valide + propriétaire d'au moins une organisation ───────
  // verify_jwt = false (config.toml) : getUser() valide le JWT côté Auth (ES256 et HS256).
  const auth = await authenticate(req.headers.get('Authorization'), sessionUser);
  if (auth.response) return auth.response;
  const db = adminClient();
  const notOwner = await requireAnyOrgOwner(db, auth.user.id);
  if (notOwner) return notOwner;
  const disabled = await requireInstanceFeature(db, 'ai_visuals');
  if (disabled) return disabled;

  // ── Limitation de débit (appel payant) ──────────────────────────────────────
  const guard = publicGuard('generate-background', req, db, Deno.env.get('RATE_LIMIT_SALT'));
  const limited = await guard.check([[LIMITS.generateBgUser, auth.user.id], [LIMITS.generateBgUserDay, auth.user.id]]);
  if (limited) return limited;

  // Paramètres > Clés, sinon secret REPLICATE_API_TOKEN (lot L6b).
  const token = await serviceSecret('REPLICATE_API_TOKEN');
  if (!token) return corsResponse(500, { error: 'Jeton Replicate manquant : à saisir dans Paramètres > Clés' });

  // ── Params ──────────────────────────────────────────────────────────────────
  const { prompt, model, formatId } = await req.json();
  if (!prompt?.trim()) return corsResponse(400, { error: 'Prompt manquant' });
  if (!model)          return corsResponse(400, { error: 'Modèle manquant' });
  if (!formatId)       return corsResponse(400, { error: 'Format manquant' });

  const modelPath = MODEL_IDS[model];
  if (!modelPath) return corsResponse(400, { error: `Modèle inconnu : ${model}` });

  const dims = FORMAT_DIMS[formatId] ?? FORMAT_DIMS.portrait;

  // ── Appel Replicate ─────────────────────────────────────────────────────────
  try {
    const startRes = await fetch(
      `https://api.replicate.com/v1/models/${modelPath}/predictions`,
      {
        method: 'POST',
        headers: {
          Authorization:  `Token ${token}`,
          'Content-Type': 'application/json',
          Prefer:         'wait=55', // attendre jusqu'à 55s avant de basculer en polling
        },
        body: JSON.stringify({
          input: {
            prompt:         prompt.trim(),
            width:          dims.width,
            height:         dims.height,
            output_format:  'jpg',
            output_quality: 90,
          },
        }),
      }
    );

    const prediction = await startRes.json();
    if (!startRes.ok) throw new Error(prediction.detail ?? `Replicate error ${startRes.status}`);

    // Si Prefer:wait a fonctionné → déjà terminé
    if (prediction.status === 'succeeded') {
      const url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
      return corsResponse(200, { url });
    }

    // Sinon polling
    const url = await pollPrediction(prediction.id, token);
    return corsResponse(200, { url });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur interne';
    return corsResponse(500, { error: msg });
  }
});
