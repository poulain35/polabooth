# Installer Polabooth : vue d'ensemble

> Guide pas à pas, avec formulaire de configuration : ouvrez [guide-installation.html](guide-installation.html) par un double-clic.

Polabooth est une suite logicielle pour les loueurs de photobooth. Elle a deux parties :

- **le SaaS** : site web où vous gérez vos événements, vos clients, les designs et le parc de bornes,
  et où les invités retrouvent leurs photos ;
- **la borne** (PolaKiosk) : application Windows installée sur le PC de chaque photobooth.

La borne ne fonctionne qu'avec un SaaS : installez le SaaS d'abord. À la première connexion, la carte
« Mise en route » de la page Aujourd'hui liste ce qu'il reste à renseigner et à connecter.

| Étape | Guide | Durée |
|---|---|---|
| 1. Le SaaS | [installation-instance.md](installation-instance.md) | environ 1 h |
| 2. La borne | [installation-borne.md](installation-borne.md) | 1 h avec l'installeur prêt à l'emploi (kit Canon inclus) |

---

## Comment les morceaux s'assemblent

```
                 ┌──────────────────────────────┐
  Vous (admin) ─▶│  Site du SaaS (fichiers)     │  hébergement statique : Netlify, Cloudflare
  Invités     ─▶ │  photobooth.mon-entreprise.fr│  Pages, Vercel ou votre serveur
                 └──────────────┬───────────────┘
                                │
                 ┌──────────────▼───────────────┐
                 │  Supabase                    │  base de données, comptes, fonctions
                 │  (le « serveur »)            │  serveur, tâches planifiées, petits fichiers
                 └───────┬──────────────┬───────┘
                         │              │
           ┌─────────────▼───┐    ┌─────▼──────────────┐
           │ Stockage S3     │    │ Messagerie SMTP    │
           │ (R2, Scaleway…) │    │ (port 465)         │
           │ photos          │    │ emails aux clients │
           └─────────────▲───┘    └────────────────────┘
                         │
                 ┌───────┴──────────────────────┐
                 │  Borne : PC Windows          │  Canon (ou webcam), imprimante photo,
                 │  PolaKiosk                   │  écran tactile, réseau (Wi-Fi, 4G)
                 └──────────────────────────────┘
```

- **Supabase** remplace le serveur : vous n'avez aucune machine à administrer. Le script
  d'installation y crée la base, déploie les fonctions et règle les tâches planifiées.
- **Le stockage S3** garde les photos des bornes. Les invités les ouvrent
  directement depuis ce stockage.
- **Le SMTP** envoie les emails (photos aux invités, échanges avec vos clients, alertes des
  bornes) depuis votre adresse.
- **La borne** parle à Supabase avec une clé publique, lue sur le site du SaaS
  (`/kiosk-config.json`). Elle envoie ses photos dans le stockage. Elle continue de fonctionner
  sans réseau et envoie tout au retour de la connexion.

---

## Ce que ça coûte

Prix indicatifs relevés en novembre 2026, à vérifier chez chaque fournisseur.

| Service | Pour démarrer | En activité | Remarques |
|---|---|---|---|
| Supabase | Gratuit | Pro : 25 $/mois | L'offre gratuite met le projet en pause après une semaine sans activité (bornes et galeries hors service). Pour une activité réelle, prenez Pro. |
| Hébergement du site | Gratuit (Netlify, Cloudflare Pages) | Gratuit, ou Vercel Pro 20 $/mois | Vercel gratuit (« Hobby ») est réservé à un usage non commercial. Un serveur existant convient aussi (Nginx). |
| Stockage Cloudflare R2 | Gratuit jusqu'à 10 Go | environ 0,015 $ par Go et par mois au-delà | Pas de frais de sortie. Un événement de 400 photos pèse environ 200 Mo. Scaleway, OVHcloud et Backblaze sont du même ordre, avec des frais de sortie variables. |
| SMTP | Inclus avec votre messagerie | Inclus | Port 465 obligatoire. Gmail limite le nombre d'envois par jour. |
| Nom de domaine | environ 10 à 15 € par an | | Vous en avez sans doute déjà un : un sous-domaine suffit (`photobooth.…`). |
| Kit Canon EDSDK | Gratuit | | Inclus dans l'installeur prêt à l'emploi. Pour construire le vôtre : sur demande auprès de Canon. |
| Inno Setup, .NET | Gratuits | | Pour construire l'installeur de la borne. |

Les services facultatifs (images par IA, assistant, agenda Google) se paient chez leur fournisseur
avec vos propres clés, saisies dans le SaaS (Réglages > Services connectés). Sans clé, ces fonctions sont
simplement absentes.

---

## Ce qui n'est pas inclus

- Quelques fonctionnalités ne font pas partie de Polabooth : réservation en ligne, facturation,
  prospects, livre d'or audio.
- Pas de site vitrine : Polabooth contient le SaaS et la borne. Votre site commercial reste à part.

---

## Pour aller plus loin

- Détails techniques du SaaS : `saas/CLAUDE.md`.
- Détails techniques de la borne : `kiosk/CLAUDE.md` et `kiosk/installer/README.md`.
- Format du fichier `.pola` (événement emporté sur la borne sans réseau) :
  [format-pola.md](format-pola.md).
