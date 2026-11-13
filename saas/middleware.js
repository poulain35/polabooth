// Edge Middleware Vercel — injecte les balises Open Graph dans /photos/:code
// pour que les liens partagés (WhatsApp, Facebook, iMessage…) affichent un aperçu.
// Uniquement pour les robots crawlers : les vrais visiteurs reçoivent la SPA normale.

/* global process */
export const config = { matcher: '/photos/:path*' };

const SUPABASE_URL  = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = process.env.VITE_SUPABASE_ANON_KEY;

const BOT_RE = /facebookexternalhit|Facebot|Twitterbot|WhatsApp|Slackbot|TelegramBot|LinkedInBot|Discordbot|Pinterest|Googlebot|bingbot|redditbot|Embedly|vkShare|Applebot|SkypeUriPreview/i;

function esc(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default async function middleware(request) {
  // Visiteurs réels → SPA normale (aucune latence ajoutée)
  if (!BOT_RE.test(request.headers.get('user-agent') || '')) return;

  const url  = new URL(request.url);
  const code = url.pathname.split('/')[2]?.toUpperCase();

  const shell = await fetch(new URL('/index.html', url.origin)).then((r) => r.text()).catch(() => null);
  if (!shell) return; // en cas de souci, laisser Vercel servir normalement

  let title       = 'Galerie photo';
  let description = 'Retrouvez et téléchargez vos photos.';
  let image       = `${url.origin}/logo-square.png`;

  try {
    if (code && SUPABASE_URL && SUPABASE_ANON) {
      const headers = { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` };
      // RPC SECURITY DEFINER (LAB-112) : anon n'a plus de SELECT direct sur `events`.
      const event = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_public_event`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_code: code }),
      }).then((r) => (r.ok ? r.json() : null));
      if (event?.id) {
        title = [event.name, event.company].filter(Boolean).join(' — ') || title;
        // RPC SECURITY DEFINER (LAB-114) : anon n'a plus de SELECT direct sur `photos`.
        const photos = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_public_photos`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_code: code, p_limit: 1 }),
        }).then((r) => (r.ok ? r.json() : []));
        const photo = Array.isArray(photos) ? photos[0] : null;
        if (photo) image = photo.thumbnail_url || photo.photo_url || image;
      }
    }
  } catch { /* on garde les valeurs par défaut */ }

  const tags = `
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:image" content="${esc(image)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${esc(url.href)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(title)}" />
    <meta name="twitter:image" content="${esc(image)}" />`;

  return new Response(shell.replace('</head>', `${tags}\n</head>`), {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
