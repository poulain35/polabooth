// Limitation de débit des edge functions publiques hors réservation (LAB-111).
// Réutilise `booking_rate_limits` et RATE_LIMIT_SALT (rate-limit.ts). Buckets préfixés `pub:`,
// purgés à 48 h par le cron `purge-booking-rate-limits` (qui ne filtre pas sur le préfixe) :
// aucune fenêtre ci-dessous ne dépasse 48 h.
//
// Sans RATE_LIMIT_SALT (secret obligatoire, généré par le script d'installation) : FAIL-CLOSED,
// `check` répond 503 avec un message générique et l'incident part en console.error (LAB-392 ;
// avant, la limitation était coupée sans bruit). Sans IP client ou si la table ne répond pas :
// FAIL-OPEN, la requête est servie normalement et l'incident part en console.error.
// IP du client : voir clientIp (rate-limit.ts), en-têtes pris en compte et confiance à leur accorder.
// Sans import Deno/esm.sh : testable sous `node --test` (public-rate-limit.test.ts).

import { corsHeaders } from './cors.ts';
import { clientIp, hashKey, ipHeaderNames, peekRateLimit, recordHit } from './rate-limit.ts';

export interface Rule {
  /** Identifiant du compteur (préfixe de bucket), unique par fonction sauf compteur partagé voulu. */
  bucket: string;
  limit: number;
  windowSeconds: number;
}

const MIN = 60;
const HOUR = 3600;
const DAY = 86400;

/**
 * Seuils. Contexte d'usage réel : 100+ invités derrière le même Wi-Fi / NAT 4G, le client qui
 * édite son design, le kiosk qui envoie toute la soirée depuis une seule IP.
 */
export const LIMITS = {
  // Partagé par toutes les fonctions à code d'accès. Seuls les codes INCONNUS comptent ; les invités
  // arrivent par QR/lien (code valide). 50/15 min/IP ⇒ < 5 000 essais/jour face à 32^6 ≈ 10^9 codes.
  codeFailures: { bucket: 'code-fail:ip', limit: 50, windowSeconds: 15 * MIN },

  // 1 appel par ouverture de l'éditeur ou de l'accueil : 300/10 min couvre 100 appareils sur un NAT.
  getEventIp: { bucket: 'get-event:ip', limit: 300, windowSeconds: 10 * MIN },

  // Debounce 1,5 s + détection de changement ⇒ ≤ 40 envois/min en édition continue : 60/min par code.
  autosaveCode: { bucket: 'autosave:code', limit: 60, windowSeconds: MIN },
  // Plusieurs éditeurs derrière une même IP (couple sur deux appareils, agence) : 200/min.
  autosaveIp: { bucket: 'autosave:ip', limit: 200, windowSeconds: MIN },

  // Historique des versions (LAB-115) : 1 liste à l'ouverture du panneau, 1 lecture par restauration,
  // 1 enregistrement par sauvegarde manuelle. Bien au-dessus d'un usage humain, borne le remplissage.
  designVersionsCode: { bucket: 'design-versions:code', limit: 60, windowSeconds: 10 * MIN },
  designVersionsIp: { bucket: 'design-versions:ip', limit: 200, windowSeconds: 10 * MIN },

  // Appelé une fois, à la première ouverture de l'éditeur.
  setEventNameIp: { bucket: 'set-event-name:ip', limit: 30, windowSeconds: 10 * MIN },

  // Chaque soumission = upload PNG + email admin + webhook ; un client soumet une à quelques fois.
  submitDesignCode: { bucket: 'submit-design:code', limit: 20, windowSeconds: HOUR },
  submitDesignIp: { bucket: 'submit-design:ip', limit: 60, windowSeconds: HOUR },

  // Payant (Replicate). Un client détoure quelques photos ; l'admin (JWT) n'est soumis qu'à l'IP.
  removeBgIp: { bucket: 'remove-bg:ip', limit: 120, windowSeconds: HOUR },
  removeBgCode: { bucket: 'remove-bg:code', limit: 40, windowSeconds: HOUR },
  removeBgCodeDay: { bucket: 'remove-bg:code-day', limit: 150, windowSeconds: DAY },

  // Images des modèles rangées dans le stockage (LAB-348) : une par image restée dans le modèle
  // (photo importée, décoration, détourage, teinte), envoi groupé après 1,5 s d'inactivité. Un client
  // qui compose activement en ajoute quelques dizaines par séance ; l'admin (JWT) n'est soumis qu'à l'IP.
  designImageCode: { bucket: 'design-image:code', limit: 120, windowSeconds: 10 * MIN },
  designImageCodeDay: { bucket: 'design-image:code-day', limit: 600, windowSeconds: DAY },
  designImageIp: { bucket: 'design-image:ip', limit: 300, windowSeconds: 10 * MIN },

  // 2 URL par photo invité (pleine + miniature). 300 photos/min ≈ 600 Mo/min (~80 Mbit/s soutenus),
  // au-delà du débit d'une salle de réception : jamais atteint en usage réel, même à 150 invités.
  guestUploadCode: { bucket: 'guest-upload:code', limit: 600, windowSeconds: MIN },
  guestUploadIp: { bucket: 'guest-upload:ip', limit: 600, windowSeconds: MIN },
  // 1 enregistrement par photo invité : même plafond de 300 photos/min.
  guestRecordCode: { bucket: 'guest-record:code', limit: 300, windowSeconds: MIN },
  guestRecordIp: { bucket: 'guest-record:ip', limit: 300, windowSeconds: MIN },

  // Galeries : rechargées après chaque lot d'upload ; 150 invités qui scannent le QR en même temps.
  getPhotosIp: { bucket: 'get-photos:ip', limit: 300, windowSeconds: MIN },
  getAudioTracksIp: { bucket: 'get-audio-tracks:ip', limit: 300, windowSeconds: MIN },

  // Kiosk (une IP pour toute la soirée) : une séance prend ≥ 30 s ⇒ ≤ 20 emails/10 min par borne ;
  // 120/10 min laisse de la marge pour 6 bornes derrière le même routeur 4G.
  kioskEmailIp: { bucket: 'kiosk-email:ip', limit: 120, windowSeconds: 10 * MIN },
  // Un invité s'envoie quelques séances ; bloque le bombardement d'une adresse tierce.
  kioskEmailTo: { bucket: 'kiosk-email:to', limit: 10, windowSeconds: HOUR },
  // ≤ 240 emails/h par borne au rythme maximal : 600/h par événement couvre 2 bornes avec marge.
  kioskEmailEvent: { bucket: 'kiosk-email:event', limit: 600, windowSeconds: HOUR },

  // Email au loueur à chaque message : un client en difficulté en envoie un ou deux.
  supportIp: { bucket: 'support:ip', limit: 10, windowSeconds: HOUR },
  supportIpDay: { bucket: 'support:ip-day', limit: 30, windowSeconds: DAY },

  // Payant (Anthropic). Conversation bornée à 24 messages : 30 messages/10 min, 150/jour par IP.
  assistantIp: { bucket: 'assistant:ip', limit: 30, windowSeconds: 10 * MIN },
  assistantIpDay: { bucket: 'assistant:ip-day', limit: 150, windowSeconds: DAY },
  // Plafond de coût toutes IP confondues (clé fixe GLOBAL_KEY) : une rotation d'IP ne le contourne pas.
  assistantGlobalDay: { bucket: 'assistant:global-day', limit: 500, windowSeconds: DAY },

  // Payant (Replicate), admin authentifié, compté par utilisateur. Le mode « 4 formats » du
  // panneau de fond généré (module IA visuelle) fait 4 appels par clic : 40/h = 10 essais multi-formats par heure.
  generateBgUser: { bucket: 'generate-bg:user', limit: 40, windowSeconds: HOUR },
  generateBgUserDay: { bucket: 'generate-bg:user-day', limit: 150, windowSeconds: DAY },

  // Resynchro du suivi d'un email (email-sync, LAB-123) : un clic par email, appel à l'API Brevo
  // (quota partagé avec les envois). 20/10 min par admin suffit pour une page de lead ou d'événement.
  emailSyncUser: { bucket: 'email-sync:user', limit: 20, windowSeconds: 10 * MIN },

  // Email de test de l'email de la borne (kiosk-email-preview, LAB-300) : envoyé à l'admin lui-même.
  kioskEmailTestUser: { bucket: 'kiosk-email-test:user', limit: 10, windowSeconds: HOUR },

  // Email de test des réglages d'envoi (send-test-email, LAB-345) : envoyé à l'administrateur lui-même.
  testEmailUser: { bucket: 'test-email:user', limit: 10, windowSeconds: HOUR },
} as const;

/** Clé des compteurs globaux (une seule entrée de bucket pour toute la fonction). */
export const GLOBAL_KEY = 'global';

/** « Réessayez dans … » lisible (secondes, minutes ou heures arrondies au supérieur). */
export function retryHint(seconds: number): string {
  const s = Math.max(1, Math.ceil(seconds));
  if (s < 60) return `Réessayez dans ${s} seconde${s > 1 ? 's' : ''}.`;
  if (s < HOUR) {
    const m = Math.ceil(s / 60);
    return `Réessayez dans ${m} minute${m > 1 ? 's' : ''}.`;
  }
  const h = Math.ceil(s / HOUR);
  return `Réessayez dans ${h} heure${h > 1 ? 's' : ''}.`;
}

/**
 * 429 + Retry-After. `error` porte le message en français : les appelants existants (front, kiosk)
 * affichent déjà `data.error`.
 */
export function tooManyRequests(retryAfterSeconds: number): Response {
  const retry = Math.max(1, Math.ceil(retryAfterSeconds));
  return new Response(
    JSON.stringify({ error: `Trop de requêtes. ${retryHint(retry)}`, code: 'trop_de_requetes', retry_after: retry }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Retry-After': String(retry),
        'Access-Control-Expose-Headers': 'Retry-After',
      },
    },
  );
}

/** Corps du refus quand la limitation de débit n'est pas configurée : aucun détail technique. */
export const SERVICE_UNAVAILABLE_BODY = {
  error: 'Service momentanément indisponible. Réessayez plus tard.',
  code: 'service_indisponible',
} as const;

function serviceUnavailable(): Response {
  return new Response(JSON.stringify(SERVICE_UNAVAILABLE_BODY), {
    status: 503,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Sous-ensemble du client supabase-js (cf. rate-limit.ts).
// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any };

/** Paire (règle, clé en clair). Clé vide ou nulle ⇒ règle ignorée. */
export type Check = readonly [Rule, string | null | undefined];

export interface GuardOptions {
  db: Db;
  salt: string | undefined;
  headers: Headers;
  now?: () => number;
}

const warned = new Set<string>();
function warnOnce(key: string, message: string) {
  if (warned.has(key)) return;
  warned.add(key);
  console.error(message);
}

export class PublicGuard {
  /** IP du client, ou null si aucun en-tête IP (les règles par IP sont alors ignorées). */
  readonly ip: string | null;
  private readonly fn: string;
  private readonly opts: GuardOptions;

  constructor(fn: string, opts: GuardOptions) {
    this.fn = fn;
    this.opts = opts;
    const ip = clientIp(opts.headers);
    this.ip = ip === 'unknown' ? null : ip;
    if (!this.ip) {
      warnOnce(`ip:${fn}`, `${fn} : IP client introuvable (en-têtes : ${ipHeaderNames(opts.headers).join(', ') || 'aucun'}), limites par IP ignorées`);
    }
  }

  /**
   * Contrôle groupé : si une règle est dépassée, 429 et rien n'est compté ; sinon la requête est
   * comptée sur chaque règle. `codeFailures` : refuse aussi si l'IP cumule trop de codes inconnus
   * (sans compter cette requête comme un échec). Renvoie null quand la requête peut être servie.
   * Sans RATE_LIMIT_SALT : 503 générique (fail-closed), aucun accès base, incident en console.error.
   */
  async check(checks: readonly Check[], opts: { codeFailures?: boolean } = {}): Promise<Response | null> {
    if (!this.opts.salt) {
      console.error(`${this.fn} : RATE_LIMIT_SALT manquant, requête refusée (503, fail-closed). Secret à définir, voir docs/installation-instance.md.`);
      return serviceUnavailable();
    }
    return await this.failOpen(null, async (salt) => {
      const now = this.opts.now?.() ?? Date.now();
      const all: Check[] = checks.filter(([, key]) => !!key);
      if (opts.codeFailures && this.ip) all.push([LIMITS.codeFailures, this.ip]);

      const buckets = await Promise.all(all.map(async ([rule, key]) => ({ rule, bucket: await bucketOf(rule, key!, salt) })));
      const decisions = await Promise.all(
        buckets.map(({ rule, bucket }) => peekRateLimit(this.opts.db, bucket, rule.limit, rule.windowSeconds, now)),
      );

      const blocked = decisions.map((d, i) => ({ d, rule: buckets[i].rule })).filter(({ d }) => !d.allowed);
      if (blocked.length) {
        console.warn(`${this.fn} : 429 (${blocked.map(({ rule }) => rule.bucket).join(', ')})`);
        return tooManyRequests(Math.max(...blocked.map(({ d }) => d.retryAfterSeconds)));
      }

      const counted = buckets.filter(({ rule }) => rule !== LIMITS.codeFailures);
      await Promise.all(counted.map(({ bucket }) => recordHit(this.opts.db, bucket)));
      return null;
    });
  }

  /** Enregistre un code d'accès inconnu pour l'IP (à appeler sur le 404 « code invalide »). */
  async codeFailed(): Promise<void> {
    if (!this.ip) return;
    const ip = this.ip;
    await this.failOpen(undefined, async (salt) => {
      await recordHit(this.opts.db, await bucketOf(LIMITS.codeFailures, ip, salt));
    });
  }

  /** Table en panne : requête servie. Sans sel, rien n'est compté (`check` a déjà refusé). */
  private async failOpen<T>(fallback: T, run: (salt: string) => Promise<T>): Promise<T> {
    const salt = this.opts.salt ?? '';
    if (!salt) return fallback;
    try {
      return await run(salt);
    } catch (e) {
      console.error(`${this.fn} : limitation de débit indisponible, requête servie (fail-open) :`, e instanceof Error ? e.message : e);
      return fallback;
    }
  }
}

async function bucketOf(rule: Rule, key: string, salt: string): Promise<string> {
  return `pub:${rule.bucket}:${await hashKey(key, salt)}`;
}

/** Garde de la fonction `fn` pour la requête `req`. */
export function publicGuard(fn: string, req: Request, db: Db, salt: string | undefined): PublicGuard {
  return new PublicGuard(fn, { db, salt, headers: req.headers });
}
