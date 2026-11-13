# CLAUDE.md — Polabooth

Consignes pour les assistants de code (et les humains) qui travaillent sur ce dépôt.

## Vue d'ensemble

Polabooth est une suite logicielle pour les loueurs de photobooth. Le dépôt contient deux
applications :

| App | Dossier | Stack |
|---|---|---|
| SaaS (éditeur de designs, administration, galerie) | `saas/` | React + Vite + Tailwind + Fabric.js + Supabase |
| Borne Windows (PolaKiosk) | `kiosk/` | WPF + .NET 10 + C# + EDSDK Canon + SQLite |

Chaque application a son propre `CLAUDE.md` détaillé. **Le lire avant de toucher à son code.**

Guides d'installation : `docs/installation.md` (vue d'ensemble, coûts), `docs/installation-instance.md`
(SaaS : Supabase, stockage S3 ou R2, emails, hébergement), `docs/installation-borne.md` (matériel,
kit Canon, installeur, mise en service). Format des fichiers hors ligne : `docs/format-pola.md`.

---

## Backend partagé : Supabase

Les deux applications lisent et écrivent dans la **même instance Supabase**.

- `organizations` : comptes (une entreprise de location), avec `features` (fonctionnalités activées)
- `events` : événements, avec `form_config` JSONB (réglages du SaaS et réglages de la borne sous `kiosk`)
- `templates` : modèles, avec `canvas_json` (objets Fabric.js, dont les zones photo)
- `client_designs` : designs soumis par les clients ; la borne utilise le design **approuvé**
- `photos` : photos de la galerie (envoyées par la borne, les invités ou l'admin)
- `kiosk_licenses` : bornes associées à un compte (licence, PIN, mises à jour, état)
- `kiosk_guest_responses` : réponses au questionnaire de la borne (écrites par la borne via RPC,
  lues et exportées par le SaaS, supprimées 30 jours après l'événement)
- `kiosk_photo_consents` : preuves de consentement photo données sur la borne
- `print_logs`, `kiosk_logs` : impressions et journaux des bornes

La borne n'utilise que la clé `anon` et passe par des RPC qui vérifient sa licence (identifiant de
machine + secret reçu à l'association). Elle n'a aucun accès direct aux tables, journaux compris
(RPC `kiosk_record_logs`).

**Règle critique :** toute modification du schéma (table, colonne, fonction SQL) passe par une
nouvelle migration dans `saas/supabase/migrations/` (nom horodaté, unique) et doit être vérifiée
pour son effet sur **les deux** applications.

---

## Flux de données SaaS → borne

```
Admin (SaaS)
  └─ crée l'événement, valide le design du client, règle la borne (form_config.kiosk)
        │
        ▼
  Supabase
        │
        ▼
  PolaKiosk (Windows)
  └─ s'associe au compte (code affiché sur la borne, validé dans le SaaS)
  └─ charge l'événement (code d'accès, envoi depuis le SaaS, ou fichier .pola hors ligne)
  └─ télécharge le design approuvé (canvas_json + PNG troué)
  └─ prend les photos (Canon via EDSDK, ou webcam)
  └─ assemble le montage (zones photo du canvas_json)
  └─ imprime, partage par QR code et email
  └─ envoie les photos : URL présignée (get-kiosk-upload-url) vers le stockage S3 / R2,
     puis ligne photos (RPC kiosk_record_photo)
```

### Conversion des zones photo

Les zones photo du `canvas_json` sont en pixels du canvas du SaaS :

| Format | Canvas (px) | Tirage |
|---|---|---|
| portrait | 400 × 600 | 10 × 15 cm |
| landscape | 600 × 400 | 15 × 10 cm |
| stripV | 200 × 600 | 5 × 15 cm |
| stripH | 600 × 200 | 15 × 5 cm |

La borne convertit vers la définition d'impression (300 dpi) : `scale = printWidthPx / canvasWidthPx`.
Une zone est un objet marqué `isPhotoZone: true`, y compris dans un groupe. La même géométrie est
codée des deux côtés (`saas/src/lib/photoZones.js`, `CompositeService.ParsePhotoZones`) et testée
avec les mêmes cas.

---

## Format `.pola` (mode hors ligne)

Fichier exporté depuis la fiche de l'événement dans le SaaS (« Télécharger .pola »), importé sur la
borne sans réseau. Version 2 : JSON compressé en GZip qui contient ce que la synchro en ligne
récupère, et rien de plus (`event` avec `form_config.kiosk` seul, `design` approuvé, `assets` en
base64, `contact`). Sans design approuvé, l'export est bloqué.

Constructeur pur et testé : `saas/src/lib/polaBundle.js` ; lecture côté borne : `PolaBundle.Parse`.
Description complète et règles de lecture : `docs/format-pola.md`. Tout changement du format se
fait des deux côtés en même temps, avec un nouveau numéro de version.

---

## Guides d'installation

**Toute modification qui change l'installation** (nouvelle variable, nouveau secret, nouveau
service, nouveau bucket, nouveau réglage Supabase, nouveau prérequis de la borne) met à jour
`docs/installation*.md` dans le même commit.

---

## Règles transversales

- Ne jamais committer `saas/.env*`, `saas/instance.env` ni `kiosk/PolaKiosk/appsettings.local.json`
  (secrets).
- Ne jamais mettre la clé `service_role` de Supabase côté client (navigateur ou borne).
- Les DLL du kit Canon EDSDK (`kiosk/PolaKiosk/EDSDK/native/`) ne sont pas dans le dépôt : chaque
  utilisateur les obtient auprès de Canon. Ne jamais les committer.
- Interfaces, messages affichés, documentation et commentaires : en **français**.
- Noms dans le code (variables, fonctions, classes, fichiers) : en **anglais**.
- Ajouter ou mettre à jour les tests de ce qui change. La CI lance les tests du SaaS (avec la
  construction de la version ouverte) et de la borne.
