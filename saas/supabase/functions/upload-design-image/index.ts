/**
 * POST /functions/v1/upload-design-image[?code=XXXXXX | ?kind=preview]
 *
 * Range une image d'un modèle dans le bucket public `designs` (LAB-348) : photo importée,
 * décoration, image détourée ou fond IA. `canvas_json` ne garde ensuite que l'adresse https.
 * `?kind=preview` (LAB-356, administrateur seulement) : aperçu d'un modèle de la bibliothèque
 * (`templates.preview_url`).
 *
 * Auth : code d'accès de l'événement (client, `?code=`) OU JWT d'un administrateur de l'application
 * (bibliothèque de modèles).
 * Corps : les octets de l'image (PNG, JPEG ou WebP, vérifié par les premiers octets), 15 Mo au plus.
 * Chemin : `{event_id}/images/{sha256}.{ext}` (client), `templates/images/{sha256}.{ext}` (admin)
 * ou `templates/previews/{sha256}.{ext}` (aperçu, admin).
 *
 * Réponse : { url, path, sha256, bytes }
 */

import { handleCors, corsResponse } from '../_shared/cors.ts';
import { adminClient, sessionUser } from '../_shared/auth.ts';
import { authenticate, requireAppAdmin } from '../_shared/admin-guard.ts';
import { eventByCode, normalizeAccessCode } from '../_shared/event-by-code.ts';
import { LIMITS, publicGuard } from '../_shared/public-rate-limit.ts';
import { DesignImageError, MAX_IMAGE_BYTES, storeDesignImage, type ImageScope } from '../_shared/design-images.ts';

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return corsResponse(405, { error: 'Method not allowed' });

  const announced = Number(req.headers.get('content-length') ?? 0);
  if (announced > MAX_IMAGE_BYTES) {
    return corsResponse(413, { error: `Image trop lourde (${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} Mo au plus)` });
  }

  const params = new URL(req.url).searchParams;
  const accessCode = normalizeAccessCode(params.get('code'));
  const kind = params.get('kind');
  if (kind !== null && kind !== 'preview') return corsResponse(400, { error: 'Type d’image inconnu' });
  // Les aperçus sont ceux des modèles de la bibliothèque : jamais par code d'événement.
  if (kind === 'preview' && accessCode) return corsResponse(400, { error: 'Aperçu réservé à la bibliothèque de modèles' });

  // ── Limitation de débit ─────────────────────────────────────────────────────
  const db = adminClient();
  const guard = publicGuard('upload-design-image', req, db, Deno.env.get('RATE_LIMIT_SALT'));
  const limited = await guard.check(
    [[LIMITS.designImageIp, guard.ip], [LIMITS.designImageCode, accessCode], [LIMITS.designImageCodeDay, accessCode]],
    { codeFailures: !!accessCode },
  );
  if (limited) return limited;

  // ── Auth : code d'accès (client) OU administrateur de l'application ─────────
  let scope: ImageScope;
  if (accessCode) {
    const closed = { status: 403, error: 'Le lien de cet événement a expiré' };
    const found = await eventByCode(db, accessCode, {
      fn: 'upload-design-image',
      columns: [],
      guard,
      notFound: { status: 401, error: 'Code invalide' },
      archived: closed,
      expiry: { rule: 'template', refusal: closed },
      feature: 'client_design',
    });
    if (found.response) return found.response;
    scope = { kind: 'event', eventId: found.event.id };
  } else {
    const auth = await authenticate(req.headers.get('Authorization'), sessionUser);
    if (auth.response) return auth.response;
    const notAdmin = await requireAppAdmin(db, auth.user.id);
    if (notAdmin) return notAdmin;
    scope = kind === 'preview' ? { kind: 'templatePreviews' } : { kind: 'templates' };
  }

  // ── Vérification et rangement ───────────────────────────────────────────────
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await req.arrayBuffer());
  } catch {
    return corsResponse(400, { error: 'Corps illisible' });
  }
  try {
    const stored = await storeDesignImage(db, scope, bytes);
    return corsResponse(200, { url: stored.url, path: stored.path, sha256: stored.sha256, bytes: stored.bytes });
  } catch (err) {
    if (err instanceof DesignImageError) return corsResponse(err.status, { error: err.message });
    console.error('upload-design-image :', err);
    return corsResponse(500, { error: 'Erreur interne' });
  }
});
