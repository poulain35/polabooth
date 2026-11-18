/**
 * POST /functions/v1/google-font-file — fichier TTF d'une police Google (LAB-331).
 *
 * Headers : Authorization: Bearer {admin_jwt} (verify_jwt = true)
 * Body    : { "family": "Great Vibes", "weight": 400 }
 * Accès   : propriétaire d'une organisation (403 sinon).
 * Réponse : les octets du fichier (Content-Type font/ttf ou font/otf), avec CORS ; 404 si Google ne
 *           connaît pas la famille.
 *
 * Sert à la publication des écrans de la borne : un texte vivant écrit dans une police Google part
 * avec son fichier, que la borne (WPF) charge depuis son cache. Le navigateur ne peut pas obtenir
 * de TTF lui-même (Google lui renvoie du WOFF2 selon son User-Agent, qu'il ne peut pas changer) :
 * la fonction interroge fonts.googleapis.com avec un User-Agent ancien, récupère le fichier sur
 * fonts.gstatic.com et le renvoie tel quel. Le navigateur l'envoie ensuite lui-même dans
 * kiosk-backgrounds/org/{org_id}/. Graisse absente de la famille : la graisse par défaut.
 */

import { corsHeaders, corsResponse, handleCors } from '../_shared/cors.ts';
import { adminClient, sessionUser } from '../_shared/auth.ts';
import { authenticate, requireAnyOrgOwner } from '../_shared/admin-guard.ts';
import { fontCssUrls, fontFileUrl, isFontFile, LEGACY_USER_AGENT, MAX_FONT_BYTES, parseFontRequest } from './logic.ts';

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return corsResponse(405, { error: 'Method not allowed' });

  const auth = await authenticate(req.headers.get('Authorization'), sessionUser);
  if (auth.response) return auth.response;
  const denied = await requireAnyOrgOwner(adminClient(), auth.user.id);
  if (denied) return denied;

  let body: unknown;
  try { body = await req.json(); } catch { return corsResponse(400, { error: 'Body JSON invalide' }); }
  const request = parseFontRequest(body);
  if ('error' in request) return corsResponse(400, { error: request.error });

  let fileUrl: string | null = null;
  try {
    for (const cssUrl of fontCssUrls(request)) {
      const res = await fetch(cssUrl, { headers: { 'User-Agent': LEGACY_USER_AGENT } });
      if (!res.ok) { await res.body?.cancel(); continue; }
      fileUrl = fontFileUrl(await res.text());
      if (fileUrl) break;
    }
  } catch {
    return corsResponse(502, { error: 'Google Fonts injoignable' });
  }
  if (!fileUrl) return corsResponse(404, { error: `Police Google introuvable : ${request.family}` });

  let bytes: Uint8Array<ArrayBuffer>;
  try {
    const res = await fetch(fileUrl);
    if (!res.ok) return corsResponse(502, { error: 'Fichier de police introuvable chez Google' });
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch {
    return corsResponse(502, { error: 'Google Fonts injoignable' });
  }
  if (bytes.length > MAX_FONT_BYTES || !isFontFile(bytes)) {
    return corsResponse(502, { error: 'Fichier de police inutilisable' });
  }

  return new Response(bytes, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': /\.otf$/i.test(fileUrl) ? 'font/otf' : 'font/ttf',
      'Cache-Control': 'private, max-age=3600',
    },
  });
});
