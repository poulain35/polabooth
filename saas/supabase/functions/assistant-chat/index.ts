/**
 * POST /functions/v1/assistant-chat
 *
 * Assistant de dépannage « livre fermé » pour les clients en location.
 * Répond UNIQUEMENT à partir de la base de cas (table support_articles).
 * Jamais de connaissance générale / internet : si le problème n'est couvert par
 * aucun cas, l'assistant invite à contacter le loueur (appel si bloquant, SMS sinon).
 *
 * Endpoint public (la page d'aide l'est) — protégé par l'anon key Supabase.
 *
 * Body:    { messages: [{ role: 'user'|'assistant', content: string }], code?: string }
 * Réponse: { reply: string, escalate: { needed: boolean, urgency: 'blocking'|'normal'|'none' } }
 */

import { handleCors, corsResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/auth.ts';
import { GLOBAL_KEY, LIMITS, publicGuard } from '../_shared/public-rate-limit.ts';
import { instanceOrg, requireInstanceFeature } from '../_shared/feature-guard.ts';
import { getOrgIdentity } from '../_shared/org-identity.ts';
import { serviceSecret } from '../_shared/service-secrets.ts';
import { getServiceSetting } from '../_shared/secrets.ts';

// Modèle par défaut ; Paramètres > Clés (service_settings.assistant_model) ou le secret ASSISTANT_MODEL le remplacent.
const DEFAULT_MODEL = 'claude-opus-4-8';

const MAX_MESSAGES = 24;       // borne anti-abus sur la longueur de conversation
const MAX_CHARS_PER_MSG = 4000; // borne anti-abus sur la taille d'un message

interface Article {
  category: string;
  title: string;
  keywords: string[] | null;
  solution: string;
  severity: string; // 'blocking' | 'annoying' | 'minor'
}

function buildKnowledgeBase(articles: Article[]): string {
  if (articles.length === 0) return '(Aucun cas dans la base pour le moment.)';
  return articles
    .map((a, i) => {
      const kw = a.keywords?.length ? `\nMots-clés : ${a.keywords.join(', ')}` : '';
      return `### Cas ${i + 1} — ${a.title}
Catégorie : ${a.category}
Gravité : ${a.severity}${kw}
Solution :
${a.solution}`;
    })
    .join('\n\n');
}

// Nom du loueur : identité de l'entreprise de l'instance (Paramètres → Entreprise, lot L7).
const instructions = (company: string) => `Tu es l'assistant de dépannage de « ${company} », loueur de photobooths.
Tu aides un client qui rencontre un problème pendant sa location (mariage, anniversaire, soirée d'entreprise), en autonomie totale, sans technicien sur place. Il peut être stressé : sois chaleureux, rassurant, et guide pas à pas.

RÈGLES ABSOLUES :
1. Tu réponds EXCLUSIVEMENT à partir de la BASE DE CAS fournie ci-dessous. Tu n'utilises JAMAIS de connaissances générales, ni internet, ni de suppositions sur du matériel.
2. Si le problème du client ne correspond à aucun cas de la base, tu NE TENTES PAS de deviner une solution. Tu réponds gentiment que tu n'as pas la solution et qu'il faut contacter le loueur (${company}), puis tu mets escalate.needed = true.
3. Quand un cas correspond, donne la solution étape par étape, en reformulant clairement. Demande confirmation à chaque étape si la manip est délicate.
4. Reste strictement dans le sujet du dépannage photobooth. Pour toute autre demande, escalade vers le loueur.
5. Réponds toujours en français, ton concret et bienveillant. Pas de jargon technique inutile.

DÉCISION D'ESCALADE (escalate) :
- escalate.needed = true UNIQUEMENT si tu ne peux pas résoudre depuis la base, OU si le client indique avoir déjà tout essayé sans succès.
- escalate.urgency = "blocking" si le booth est inutilisable en plein événement (l'appel direct est justifié).
- escalate.urgency = "normal" si le problème est gênant mais non bloquant (un SMS suffit).
- escalate.urgency = "none" si tu as fourni une solution et qu'aucun contact n'est nécessaire.
- Si escalate.needed = false, urgency doit être "none".

Tu réponds au format JSON imposé : { reply, escalate }. Le champ reply contient ton message au client (texte simple, sauts de ligne autorisés).`;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    escalate: {
      type: 'object',
      properties: {
        needed: { type: 'boolean' },
        urgency: { type: 'string', enum: ['blocking', 'normal', 'none'] },
      },
      required: ['needed', 'urgency'],
      additionalProperties: false,
    },
  },
  required: ['reply', 'escalate'],
  additionalProperties: false,
};

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return corsResponse(405, { error: 'Method not allowed' });
  // Paramètres > Clés, sinon secrets ANTHROPIC_API_KEY / ASSISTANT_MODEL (lot L6b).
  const anthropicKey = await serviceSecret('ANTHROPIC_API_KEY');
  if (!anthropicKey) {
    return corsResponse(500, { error: 'Clé API Claude manquante : à saisir dans Paramètres > Clés' });
  }

  // ── Params ──────────────────────────────────────────────────────────────────
  let body: { messages?: unknown };
  try { body = await req.json(); } catch { return corsResponse(400, { error: 'Body JSON invalide' }); }

  const raw = Array.isArray(body.messages) ? body.messages : [];
  const messages = raw
    .filter((m): m is { role: string; content: string } =>
      !!m && typeof m === 'object'
      && (m as { role?: unknown }).role !== undefined
      && typeof (m as { content?: unknown }).content === 'string')
    .slice(-MAX_MESSAGES)
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content.slice(0, MAX_CHARS_PER_MSG),
    }));

  // La conversation doit commencer par un message utilisateur.
  while (messages.length > 0 && messages[0].role !== 'user') messages.shift();
  if (messages.length === 0) return corsResponse(400, { error: 'Aucun message client' });

  // ── Limitation de débit (appel payant) ──────────────────────────────────────
  const db = adminClient();
  const guard = publicGuard('assistant-chat', req, db, Deno.env.get('RATE_LIMIT_SALT'));
  const limited = await guard.check([
    [LIMITS.assistantIp, guard.ip],
    [LIMITS.assistantIpDay, guard.ip],
    [LIMITS.assistantGlobalDay, GLOBAL_KEY],
  ]);
  if (limited) return limited;
  // Base d'aide commune à l'instance : pas d'événement ni d'org dans la requête.
  const disabled = await requireInstanceFeature(db, 'assistant');
  if (disabled) return disabled;

  // ── Base de connaissances (cas publiés) ───────────────────────────────────────
  const { data: articles, error: dbErr } = await db
    .from('support_articles')
    .select('category, title, keywords, solution, severity')
    .eq('is_published', true)
    .order('sort_order', { ascending: true });

  if (dbErr) return corsResponse(500, { error: 'Lecture de la base de cas échouée' });

  const knowledgeBase = buildKnowledgeBase((articles ?? []) as Article[]);
  const org = await instanceOrg(db).catch(() => null);
  const company = (await getOrgIdentity(db, org?.id)).companyName || 'votre loueur';

  // ── Appel Anthropic (closed-book + sortie structurée + cache du KB) ────────────
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: (await getServiceSetting(db, null, 'assistant_model', 'ASSISTANT_MODEL')) ?? DEFAULT_MODEL,
        max_tokens: 1024,
        // Pas de "thinking" : réponses rapides, le format structuré garde la sortie propre.
        thinking: { type: 'disabled' },
        system: [
          { type: 'text', text: instructions(company) },
          {
            type: 'text',
            text: `BASE DE CAS (seule source autorisée) :\n\n${knowledgeBase}`,
            // Cache du bloc stable instructions + base de cas (prefix match).
            cache_control: { type: 'ephemeral' },
          },
        ],
        output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
        messages,
      }),
    });

    if (!res.ok) {
      const errTxt = await res.text();
      console.error('Anthropic error:', res.status, errTxt);
      return corsResponse(502, { error: 'Le service IA est momentanément indisponible' });
    }

    const data = await res.json();
    const textBlock = (data.content ?? []).find((b: { type: string }) => b.type === 'text');
    if (!textBlock?.text) return corsResponse(502, { error: 'Réponse IA vide' });

    // La sortie structurée garantit du JSON ; on reste tolérant par sécurité
    // (extraction d'un éventuel objet, sinon repli prudent vers une escalade).
    let parsed: { reply?: string; escalate?: { needed?: boolean; urgency?: string } } | null = null;
    try { parsed = JSON.parse(textBlock.text); }
    catch {
      const m = textBlock.text.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch { /* ignore */ } }
    }

    if (parsed && typeof parsed.reply === 'string') {
      return corsResponse(200, {
        reply: parsed.reply,
        escalate: {
          needed: !!parsed.escalate?.needed,
          urgency: parsed.escalate?.urgency ?? 'none',
        },
      });
    }

    // Repli : on n'a pas pu structurer → on invite à contacter le loueur.
    return corsResponse(200, {
      reply: "Je n'ai pas réussi à traiter votre demande. Vous pouvez contacter directement le loueur ci-dessous.",
      escalate: { needed: true, urgency: 'normal' },
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur interne';
    console.error('assistant-chat:', msg);
    return corsResponse(500, { error: 'Erreur interne' });
  }
});
