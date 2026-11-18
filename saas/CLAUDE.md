# CLAUDE.md — SaaS Polabooth

## Contexte

Application web du loueur de photobooth : création des événements, éditeur de designs (le client
crée son tirage en ligne, l'admin le valide), galerie photo des invités, réglages et suivi des
bornes. Elle partage son backend Supabase avec la borne Windows (`kiosk/`, voir `kiosk/CLAUDE.md`).

Installation d'une instance : `docs/installation-instance.md`.

---

## Stack technique

| Couche | Technologie |
|---|---|
| Framework | React 19 + Vite 8 |
| Routage | React Router 7 |
| Styles | Tailwind CSS 3 |
| Canvas | Fabric.js 5 |
| Backend | Supabase (Auth, Postgres, Storage) |
| Fonctions serveur | Supabase Edge Functions (TypeScript, Deno) |
| Emails | Brevo (API) ou tout serveur SMTP |
| IA (facultatif) | clés de l'instance : Replicate (images), Anthropic (assistant) |
| Stockage des médias | Cloudflare R2 ou tout fournisseur compatible S3 (URL présignées, `_shared/storage.ts`) |

---

## Structure des dossiers

```
src/
├── App.jsx              # Routage (public, client, admin)
├── main.jsx
├── lib/
│   ├── supabase.js      # point d'entrée de l'API : ré-exporte lib/api/*
│   └── api/             # client Supabase (client.js) + fonctions d'API, un fichier par domaine
│                        # (+ modules purs testés : photoZones, polaBundle, kiosk*…)
├── features/            # fonctionnalités activables : catalog.js, featureGate.js, modules.js
├── modules/             # emplacement des modules privés éventuels ; ici le registre index.js est vide
├── hooks/               # useFeatures…
├── components/          # Editor.jsx (canvas Fabric.js, découpé dans editor/), Toolbar, PropertiesPanel, panneaux admin…
├── pages/               # Landing, EditorPage, PhotoGallery, Slideshow, EventReport, AdminPair…
│   └── admin/           # AdminEvents, AdminEventDetail, AdminTemplates, AdminLicenses, AdminSettings…
├── utils/               # formats.js, export.js (PNG haute définition), textEffects.js, media.js
├── data/                # stickers intégrés
└── templates/           # modèle vierge par défaut

supabase/
├── functions/           # Edge Functions (Deno), une par dossier
│   └── _shared/         # code partagé (cors, auth, email, stockage, fonctionnalités…)
├── migrations/          # migrations SQL Postgres
├── tests/               # scripts SQL de vérification (transaction annulée)
└── features.json        # manifeste : fonctions, tables et crons de chaque fonctionnalité

scripts/                 # install-instance, check-open-build, kiosk-config…
```

---

## Routage

```
/                          → Landing (public)
/e/:code                   → EditorPage (client, accès par code)
/photos/:code              → PhotoGallery (galerie des invités)
/rapport/:token            → EventReport (bilan public, noindex)
/associer?code=…           → AdminPair (association d'une borne, connexion obligatoire)

/admin/login               → AdminLogin (?next= : retour après connexion ; ?oubli=1 : mot de passe oublié)
/admin/nouveau-mot-de-passe → AdminResetPassword (lien de l'email de réinitialisation)
/admin/*                   → RequireAuth (session Supabase obligatoire)
  /admin                         → /admin/aujourdhui
  /admin/aujourdhui              tableau de bord « Aujourd'hui »
  /admin/events[/new|/:id]       événements (?vue=calendrier ; fiche à onglets ?tab=)
  /admin/bornes                  parc de bornes, matériel, écrans, alertes (?tab=)
  /admin/ecrans-borne/:kind      composition d'un écran de la borne
  /admin/reglages                réglages, fonctionnalités activables, clés des services (#section)
  /admin/templates[/new|/:id/edit] modèles
  /admin/decorations, /admin/fonts
```

`redirectTo` de la réinitialisation du mot de passe = `VITE_APP_URL` + `/admin/nouveau-mot-de-passe` :
cette adresse doit figurer dans les Redirect URLs de Supabase Auth. Règles du mot de passe dans
`src/lib/passwordRules.js` (testé).

Les modules privés éventuels ajoutent leurs routes par `moduleRoutes(place)` ; sans module, elles
n'existent pas.

---

## Modèle de données

### Table `events`
```
id                uuid PK
name              text (NOT NULL, '' tant que le client n'a pas choisi)
client_name, client_email  text
start_date, end_date       date
expires_at        timestamptz  ← fin de la galerie en ligne ; fichiers purgés 30 jours après
access_code       text UNIQUE (ex. "TUQNA5")
form_config       jsonb        ← réglages de l'événement, dont form_config.kiosk pour la borne
created_at        timestamptz
```

### `form_config.kiosk`
Réglages de la borne : `home` (fond, accueil personnalisé, formats proposés), `capture`
(compte à rebours…), `rgpd`, `effects`, `result` (boutons de partage, quotas d'impression, retour
automatique), `email`, `questionnaire`. Défauts, fusion, nettoyage et validation dans des modules
purs testés : `src/lib/kioskFormats.js`, `src/lib/kioskQuestionnaire.js`. La borne lit ces champs
(`KioskConfigDto`) : **vérifier l'effet sur la borne avant de changer un champ.** Plus de thème de
couleurs : les couleurs de la borne sont fixes.

### Table `templates`
```
id, name, format ('portrait' | 'landscape' | 'stripV' | 'stripH'),
canvas_json (fabric.canvas.toJSON()), is_active, thumbnail, created_at
```

### Table `client_designs`
```
id, event_id → events, kind ('print' | 'home'), slot (1 à 4), label, canvas_json, format,
status ('draft' | 'submitted' | 'approved' | 'rejected'), feedback, png_url, created_at
```
UNIQUE (event_id, kind, slot) : `print` = cadre (modèle photo, jusqu'à 4 par événement, numérotés par
`slot`, nommés par `label`, 24 caractères), `home` = écran d'accueil de la borne (1920×1080, un seul,
`slot = 1`). Toute lecture ou écriture par événement filtre `kind` (upsert avec
`onConflict: 'event_id,kind,slot'`) ; `design_versions.kind` et `slot` suivent la même règle. Seul le modèle photo pilote
`events.status`. Aucun droit pour `anon`. La borne lit le design approuvé par la RPC `kiosk_get_approved_design`.

### Autres tables
- `organizations` : comptes ; `features`, `service_settings`, contact, `logo_url`, `kiosk_limit`
- `photos` : galerie (`media_type`, `captured_at`, `storage_path`, `thumbnail_url`)
- `decorations`, `custom_fonts`, `design_versions`
- `event_form_responses`, `global_form_config` : formulaire avant édition
- `kiosk_licenses`, `kiosk_license_machines`, `kiosk_pairings`, `kiosk_releases`, `kiosk_logs`, `print_logs`
- `kiosk_guest_responses`, `kiosk_photo_consents` : questionnaire et consentements de la borne
- `event_activity` (compteurs sans donnée personnelle), `event_reports` (bilans figés)
- `app_admins` : administrateurs de l'application (`is_app_admin()`), ajoutés à la main en SQL

### Fonctionnalités activables
- `organizations.features` (jsonb, `{ "<id>": true|false }`) : clé absente = valeur par défaut du
  catalogue ; le socle (`core`, `templates`) est toujours actif ; une fonctionnalité dont une
  dépendance est inactive est inactive.
- Catalogue front `src/features/catalog.js` et serveur `supabase/functions/_shared/features.ts` :
  **ils se modifient ensemble** (test de parité dans `src/features/catalog.test.js`).
- Front : `useFeatures()` → `{ features, isEnabled(id), isAvailable(id), loading, error, save(next) }` ;
  menu déclaré dans `NAV_FEATURES` (`featureGate.js`) ; routes `RequireFeature` ; écran Réglages >
  Fonctionnalités (`AdminFeatures.jsx`).
- Serveur : `requireFeature(db, orgId, id)`, `requireInstanceFeature` ou `cronFeatureGate`
  (`_shared/feature-guard.ts`) → 404 `{ error: 'fonctionnalite_desactivee' }` (200 `skipped` pour un
  cron). Côté SQL : `org_feature_enabled` → errcode `PT404` ; `public_features_by_code(code)` pour les
  pages publiques. Pages publiques : « Cette page n'est pas disponible. » sur 404 / `PT404`.
- **Manifeste `supabase/features.json`** : toute nouvelle fonction, table ou cron y est déclaré
  (vérifié par `_shared/features-manifest.test.ts`).
- Modules privés : `src/modules/<id>/` et `supabase/functions/_shared/modules/<id>/`. Le code ouvert
  n'y accède que par `src/features/modules.js` (`moduleRoutes`, `<ModuleSlot>`, `moduleHook`) et ne
  les importe jamais (ESLint, `_shared/open-core-modules.test.ts`). Seules exceptions : les registres de
  catalogues `src/modules/catalog.js` et `_shared/private-modules.ts` (données pures qu'un module ajoute aux
  catalogues ouverts : libellé de sa fonctionnalité, clés de service, test de clé, impact de ses crons ; listes
  vides dans ce dépôt).
- Version ouverte : `VITE_PRIVATE_MODULES=none npm run build` (les registres deviennent `[]`), puis
  `npm run check:open-build` vérifie `dist/`.

### Marque de l'instance
Aucune marque dans le code ouvert (`src/features/openCoreBrand.test.js`, `check:open-build`).
- Front : `src/lib/instanceBrand.js` (`BRAND`, `resolveBrand`, valeurs neutres « Photobooth ») lit
  `src/modules/brand.js` (nul dans ce dépôt). Seul fichier autorisé à l'importer. Logo :
  `components/BrandLogo.jsx` (sinon le nom en texte). Manifeste PWA généré depuis
  `src/manifest.template.json`.
- Emails : `_shared/email-layout.ts` ne porte que des marqueurs, remplis par `_shared/email-brand.ts`
  (identité de l'organisation). Expéditeur : `FROM_NAME` / `FROM_EMAIL` (obligatoire). Liens :
  `_shared/app-url.ts` (`APP_URL` / `PUBLIC_APP_URL`, jamais d'adresse en dur).
- Borne : `appsettings.Instance.json` et `installer/instance.iss` (voir `kiosk/CLAUDE.md`).

### Clés des services
Une clé par instance. Catalogue front `src/features/serviceKeys.js`, serveur `_shared/service-keys.ts`
(plus les clés déclarées par les catalogues des modules), liste blanche SQL `service_key_allowed` : ajouter une clé = les trois (test `serviceKeys.test.js`).
- Valeurs dans Vault sous `service_key:<NAME>` ; table `service_keys` (nom, 4 derniers caractères,
  date). RPC `set_service_key`, `delete_service_key`, `list_service_keys` réservées à
  `is_app_admin()` ; aucune RPC ne renvoie une valeur au navigateur.
- Serveur : `getSecret(db, NAME)` (`_shared/secrets.ts` : Vault, sinon variable d'environnement) ;
  dans les fonctions, `serviceSecret(NAME)` (`_shared/service-secrets.ts`). Ne pas lire une clé de
  service avec `Deno.env`.
- `test-service-key` : appel en lecture seule chez le fournisseur, jamais la clé dans la réponse.
- Écran Réglages > Clés (`AdminKeys.jsx`).

---

## Formats canvas

Définis dans `src/utils/formats.js`. Toujours utiliser ces constantes.

| Format | Canvas (px) | Export (px) | Tirage | Zones photo |
|---|---|---|---|---|
| `portrait`  | 400×600 | 2400×3600 | 10×15 cm | 1 |
| `landscape` | 600×400 | 3600×2400 | 15×10 cm | 1 |
| `stripV`    | 200×600 | 1200×3600 | 5×15 cm  | 3 verticales |
| `stripH`    | 600×200 | 3600×1200 | 15×5 cm  | 3 horizontales |

- Échelle : 4 px/mm sur le canvas, export ×6.
- Les zones photo sont en pixels canvas dans `canvas_json`, marquées `isPhotoZone: true`, parfois
  dans un groupe : toujours passer par `src/lib/photoZones.js` (`findPhotoZones`, `photoZoneRect`,
  `withoutPhotoZones`), jamais un simple filtre au premier niveau. La borne suit la même géométrie.

---

## `src/lib/supabase.js` et `src/lib/api/`

**Toute interaction avec Supabase passe par `lib/api/`** (ou par le `api.js` d'un module privé).
Ne jamais appeler `supabase` dans un composant : créer une fonction dans le fichier du domaine
(`designs.js`, `photos.js`, `kiosks.js`…) et l'importer depuis `lib/supabase`, qui ré-exporte tout
`lib/api/` (un nom exporté y est donc unique).

- Appeler une edge function : `callFunction` de `lib/api/functions.js` (logique pure et testée dans
  `lib/functionCall.js`), jamais un `fetch` aux en-têtes recopiés. `admin: true` ajoute le jeton de
  la session (sans session : « Session expirée — reconnectez-vous », rien n'est envoyé) ; l'erreur
  porte le message du serveur, sinon le `fallback` de l'appel. `requestFunction` rend `{ res, data }`
  sans lever, `fetchFunction` la réponse brute (fichier). L'organisation du propriétaire connecté se
  lit par `ownOrganization(columns)` de `lib/api/session.js`.

- Les templates, décorations et polices ont un cache en mémoire : appeler
  `invalidateTemplatesCache()` après toute modification de modèle.
- `canvas_json` peut être très gros : jamais de `select('*')` sur `templates` dans une liste.
  `fetchDbTemplatesMeta()` pour les listes, `fetchDbTemplateById(id)` pour l'édition.
- `kiosk_licenses` : jamais de `select('*')`, toujours `LICENSE_COLUMNS` (`secret` et
  `admin_pin_hash` ne sont lisibles par personne côté SaaS).

---

## Conventions de code

- Composants fonctionnels avec hooks ; `useState` / `useEffect` ; pas de Redux ni de contexte global.
- Imports : React, bibliothèques, `lib` locale, `utils`, composants. Fichiers de composants en PascalCase.
- Logique métier dans des modules purs de `src/lib/` testés avec `node --test`.
- Chargement : états `loading` / `error` ; handlers async avec `saving`, `try / catch / finally`.
  Message de succès effacé après 2 s, d'erreur après 3 s.
- Icônes en SVG dans le JSX (`w-4 h-4`, `w-5 h-5`, `w-6 h-6`).
- Commentaires seulement quand le « pourquoi » n'est pas évident.

---

## Variables d'environnement (front)

```bash
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_APP_URL=https://photobooth.example.com   # SANS slash final
VITE_EMAIL_PROVIDER=smtp                      # facultatif, absent = Brevo
```

- `VITE_APP_URL` n'a pas de slash final : `import.meta.env.VITE_APP_URL.replace(/\/$/, '')`.
- `kiosk-config.json` (lu par la borne à `https://<SaaS>/kiosk-config.json`) n'est pas versionné :
  le plugin `kioskConfig` de `vite.config.js` le produit à la racine de `dist/` (logique testée dans
  `scripts/kiosk-config.mjs`). Variables `KIOSK_SUPABASE_URL` (défaut `VITE_SUPABASE_URL`) et
  `KIOSK_SUPABASE_ANON_KEY` : clé anon au **format JWT** `eyJ…` (la passerelle des fonctions refuse
  `sb_publishable_…`). Sans clé JWT, pas de fichier et un avertissement dans la sortie du build.
- En SMTP, le suivi des emails affiche « Suivi indisponible avec SMTP ».

---

## Flux client (EditorPage)

```
/e/:code → code validé, événement lu
  → nom vide ? état 'collect_name'
  → form_config.enabled ? état 'form' (ClientForm)
  → plusieurs formats ? état 'format'
  → état 'ready' : Editor (Fabric.js), enregistrement automatique
  → le client soumet → PNG haute définition → l'admin approuve ou refuse
```

---

## Edge Functions

Une fonction par dossier, `supabase/functions/<nom>/index.ts` :
```typescript
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  // ... logique
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
```

Les fonctions figent `_shared/` au déploiement : un changement dans `_shared/` oblige à redéployer
toutes les fonctions qui l'importent.

**Briques partagées** : `_shared/event-by-code.ts` (événement lu par son code d'accès, fonctions du
client et des invités), `_shared/cors.ts` (`corsResponse`, `jsonResponse` sans CORS pour les tâches
planifiées), `_shared/auth.ts` (`adminClient`, `userClient`, `sessionUser`), `requireOrgAccess` de
`_shared/admin-guard.ts` (droits sur un événement ou un design). Réponses au client : messages
génériques, détails dans les journaux. Limites anti-abus : sans `RATE_LIMIT_SALT`, les fonctions
publiques répondent 503 ; en-têtes IP de confiance : `clientIp` de `_shared/rate-limit.ts`.
Inscriptions publiques fermées : les comptes se créent par invitation.

**Emails** : `_shared/email.ts` envoie par Brevo ou par SMTP (`_shared/smtp.ts`). Choix
(`_shared/email-provider.ts`) : `EMAIL_PROVIDER` = `brevo` | `smtp` ; absent = Brevo, sauf sans clé
Brevo avec `SMTP_HOST` défini. Secrets SMTP : `SMTP_HOST`, `SMTP_PORT` (465 par défaut, TLS direct ;
Supabase bloque les ports 25 et 587), `SMTP_USER`, `SMTP_PASSWORD`. En SMTP, aucun suivi d'ouverture
(`email-sync` répond `skipped`).

**Email de la borne** : construit par `_shared/kiosk-email.ts` (textes, variables, couleur et logo de
l'événement, `_shared/event-branding.ts`), partagé par `send-kiosk-photo` et `kiosk-email-preview`
(aperçu et email de test à l'adresse de l'admin connecté). Brevo ou SMTP : aucune clé Brevo exigée.

**Garde-fou en dev ou en test** (`_shared/email-guard.ts`, jamais en production) :
`EMAIL_SUBJECT_PREFIX`, `EMAIL_ALLOWLIST`, `EMAIL_REDIRECT_TO`.

**Stockage des médias** : toutes les fonctions passent par `_shared/storage.ts` (`storageClient()`) ;
partie pure testée dans `_shared/storage-config.ts`. Aucune fonction ne lit `R2_*` ni ne crée de
client S3 elle-même (test de garde).
- `STORAGE_ENDPOINT` absent : Cloudflare R2 (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PHOTOS_BUCKET_NAME`, `R2_PUBLIC_URL`, `R2_PHOTOS_PUBLIC_URL`).
- `STORAGE_ENDPOINT` défini : S3 générique (`STORAGE_REGION`, `STORAGE_ACCESS_KEY_ID`,
  `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_FORCE_PATH_STYLE`, `STORAGE_BUCKET`, `STORAGE_PHOTOS_BUCKET`,
  `STORAGE_PUBLIC_URL`, `STORAGE_PHOTOS_PUBLIC_URL`). Exemples par fournisseur :
  `docs/installation-instance.md`.
- Sommes de contrôle en `WHEN_REQUIRED` (sinon les URL présignées cassent chez plusieurs fournisseurs).
- CORS du bucket obligatoire (origine = URL du SaaS, `PUT` et `GET`). Objets lisibles publiquement
  par l'URL publique. Les designs restent dans le bucket Supabase Storage `designs`.

**Expiration des fichiers en ligne** : `media-expiry` (cron quotidien) envoie un rappel au client
7 jours avant `events.expires_at`, puis supprime photos et fichiers 30 jours après. Logique pure
testée dans `media-expiry/logic.ts`.

**Crons** : appelés par pg_cron avec le JWT `service_role` gardé dans Vault (`project_url`,
`service_role_key`) ; `check-cron-alerts` surveille leurs échecs.

---

## Commandes de développement

```bash
npm run dev                # serveur local (port 5173)
npm run lint               # ESLint
npm test                   # tests node --test (front, fonctions, scripts)
npm run build              # build
VITE_PRIVATE_MODULES=none npm run build && npm run check:open-build   # version ouverte, comme la CI
npm run check:functions    # contrôle des fonctions
```

Node 24 recommandé (les tests lisent le TypeScript directement).

### Installation d'une instance

`npm run install-instance [-- --dry-run | --local | --skip-build | --new-admin-password | --config <fichier> | --workdir <dossier>]`
installe le SaaS sur un projet Supabase vide. Guide : `docs/installation-instance.md`.
- Configuration : `instance.env` (gitignoré, modèle commenté `instance.env.example`). Toute nouvelle
  variable : modèle + `validateInstanceEnv` + tests + guide.
- `scripts/install-instance.mjs` (étapes) et `scripts/install-instance-lib.mjs` (pur, testé).
- Étapes : prérequis → migrations → clés → secrets des fonctions → Vault → déploiement des
  fonctions ouvertes (`supabase/features.json`) → compte admin + organisation + `app_admins` →
  `.env.production` → build ouvert dans `dist/` (avec `kiosk-config.json`).
- Relançable : chaque étape vérifie l'état avant d'écrire. Jamais de commande distante sans
  `--remote=<ref>`.

---

## Connexion avec la borne (PolaKiosk)

La borne utilise la clé `anon` et des RPC `SECURITY DEFINER` qui vérifient sa licence
(`p_machine_id` + `p_secret`). Elle n'a aucun droit direct sur les tables (journaux : RPC
`kiosk_record_logs`). Les RPC de la borne refusent un secret vide ou faux.

### Association et comptes
- Une borne appartient à un compte (`kiosk_licenses.org_id`). Elle s'associe par un code de
  6 caractères (alphabet `23456789ABCDEFGHJKMNPQRSTVWXYZ`, affiché `XXX-XXX`, valable 10 min) que
  l'admin valide sur `/associer`. Le secret est remis **une seule fois** à la borne ; le SaaS ne le
  voit jamais.
- `organizations.kiosk_limit` (NULL = sans limite), modifiable par le super-admin seulement.
- Une borne retirée (`retired_at`) est refusée partout. « Remplacer le PC » réassocie la même borne.
- Logique pure testée : `src/lib/kioskPairing.js`.

### RPC et fonctions utilisées par la borne

| Appel | Rôle |
|---|---|
| `kiosk_pairing_start`, `kiosk_pairing_poll` | association (côté borne) |
| `kiosk_pairing_lookup`, `kiosk_pairing_approve` | association (côté admin, `authenticated`) |
| `kiosk_check_license`, `kiosk_heartbeat` | licence ; état (version, imprimante, appareil photo, envois en attente) toutes les 2 min |
| `kiosk_get_event(p_code, p_machine_id, p_secret)` | `{id, org_id, name, access_code, start_date, end_date, form_config: {kiosk}}`, événements du compte de la borne seulement |
| `kiosk_get_approved_design(p_machine_id, p_secret, p_event_id)` | `{id, format, canvas_json, final_png_url, home_design, label, frames}` (cadre approuvé au plus petit `slot`) ou `null` ; `frames` = les autres cadres approuvés triés par `slot` si `frame_choice.enabled` vaut `true`, sinon `null` ; `home_design` = `{id, final_png_url}` de l'écran d'accueil approuvé si `home.personalized` et `home.client_design` valent `true`, sinon `null` |
| `get_org_contact_by_event(p_event_id)` | société, téléphone, email, `logo_url` |
| `get-kiosk-upload-url` (fonction) | URL PUT présignée vers le stockage (5 min, type et taille signés) |
| `kiosk_record_photo` | ligne `photos` (idempotente sur `storage_path`) |
| `kiosk_record_print` | ligne `print_logs` (idempotente sur l'id) |
| `kiosk_record_guest_response` | réponse au questionnaire (idempotente) |
| `kiosk_record_photo_consent` | preuve de consentement photo (idempotente) |
| `kiosk_get_admin_pin` | hash du PIN admin de la borne |
| `kiosk_get_update_request`, `kiosk_report_update_failure` | mises à jour demandées par le SaaS |
| `kiosk_get_event_request`, `kiosk_ack_event_request` | événement envoyé depuis le SaaS |
| `send-kiosk-photo` (fonction) | envoi de la photo par email |

Codes d'erreur communs : `42501` = licence refusée ; `P0001` = identification (la borne réessaie) ;
`22023` = données refusées définitivement (la borne arrête de renvoyer).

### Photos de la borne
- Chemin : `photos/{slug-événement}-{8 car. de l'id}/{sessionId}/{fichier}`. Un renvoi de la même
  séance reçoit le même chemin : ni fichier ni ligne en double.
- `photo_url` = URL publique qui se termine par le chemin. `media_type` : `photo`, `gif`,
  `boomerang`, `video` (animation = `.mp4` + affiche `poster.jpg` du même dossier).
- `captured_at` = début de la séance (horloge de la borne), gardé seulement dans une plage plausible.

### Questionnaire et consentements
- `kiosk_guest_responses` : lecture et suppression par le propriétaire de l'organisation, aucune
  écriture directe. Suppression 30 jours après la fin de l'événement
  (`guest_responses_purge_at`, cron SQL). Export CSV / xlsx dans la fiche événement
  (`src/lib/guestResponsesExport.js`) ; seules les réponses avec `marketing_consent = true` vont
  dans l'export « contacts ».
- `kiosk_photo_consents` : aucune donnée personnelle, lecture par les administrateurs de
  l'application seulement, supprimés avec les photos (`expires_at` + 30 jours).

### Sécurité des bornes
- PIN admin propre à chaque borne (4 à 8 chiffres), défini dans la page des bornes. La fonction
  `kiosk-admin-pin` ne stocke que le hash PBKDF2-SHA256 `pbkdf2$210000$sel_b64$hash_b64`. Vecteur de
  test commun avec la borne.
- Publication d'une version de la borne : SHA-256 de l'installeur calculé dans le navigateur, stocké
  dans `kiosk_releases.sha256` ; fichier envoyé dans le bucket des photos par
  `get-release-upload-url` (réservé à `is_app_admin()`). La borne refuse un installeur différent.

### Mises à jour et envoi d'événement
- Une borne ne se met à jour **que si le SaaS le demande** (`kiosk_request_update`, bouton
  « Mettre à jour »). Après un échec, elle ne réessaie pas sans nouvelle demande.
- L'admin peut envoyer un événement sur une borne (`kiosk_request_event`,
  `kiosk_cancel_event_request`) : un seul envoi par borne, chargé sans code sur place. Logique pure
  testée : `src/lib/kioskEventPush.js`, `src/lib/kioskUpdate.js`.

### Logo et écran de saisie du code
- `organizations.logo_url` : fichier dans le bucket public `kiosk-backgrounds`, sous
  `org/{org_id}/logo.png` (ou `.jpg`), URL avec `?v=<horodatage>` (la borne le garde en cache par URL).
  PNG ou JPG, 2 Mo au plus (`src/lib/orgLogo.js`).
- Fond de l'écran de saisie du code : `kiosk-backgrounds/default/setup_config.json`
  (`src/lib/kioskSetupScreen.js`).

### Fichier `.pola`
Construit par `buildPolaBundle` (`src/lib/polaBundle.js`, pur et testé), appelé par `exportPolaFile`.
Sans design approuvé (ou sans PNG), l'export est refusé (`PolaExportError`). L'écran d'accueil du
client (`home_design` + `assets.home_design`) n'est écrit que s'il est validé et que
`home.personalized` et `home.client_design` valent `true` (`polaHomeDesign`). Format complet :
`docs/format-pola.md`.

### Écran d'accueil créé par le client (admin)
Interrupteur « Le client crée son écran d'accueil (1920×1080) » dans l'onglet Accueil de la fiche
événement (`form_config.kiosk.home.client_design`, booléen strict, faux par défaut). Bloc « Écran
d'accueil du client » : statut, aperçu 16:9 avec le cadre 16:10 en pointillés, Valider / Refuser
(motif obligatoire). Un écran validé est en lecture seule pour le client : « Rouvrir pour correction »
le refuse avec un motif. `review-design` accepte `kind = 'home'` sans toucher `events.status`
(règles : `review-design/logic.ts`, emails : `review-design/home-emails.ts`, journal
`home_design_approved` / `home_design_rejected`). Listes des designs à valider : `src/lib/clientDesigns.js`.

---

## Points d'attention

- Jamais de secret côté navigateur : seulement la clé `anon`. La clé `service_role` ne sert qu'aux
  fonctions serveur et aux crons.
- Les opérations admin utilisent le jeton de session Supabase.
- Une fonction appelée par un administrateur sous son JWT ne doit pas basculer en `service_role`
  quand la RPC s'appuie sur `auth.uid()`.
- Toute migration est vérifiée pour son effet sur la borne (`kiosk/CLAUDE.md`).
- Toute nouvelle variable, tout nouveau secret ou service met à jour `docs/installation*.md`.
