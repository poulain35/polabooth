# Installer votre propre SaaS photobooth

Ce guide installe le SaaS de Polabooth sur **votre** projet Supabase, avec **votre** stockage et **votre** messagerie.
Un script fait l'essentiel. Comptez une heure la première fois.

Vous n'avez pas besoin d'être développeur. Il faut savoir ouvrir un terminal, copier une commande et
modifier un fichier texte.

---

## 1. Ce qu'il vous faut

| Quoi | Pourquoi | Où |
|---|---|---|
| Un compte Supabase | Base de données, comptes, fonctions serveur | https://supabase.com (offre gratuite possible pour démarrer) |
| Node.js 20 ou plus récent | Lancer le script et construire le site | https://nodejs.org (version « LTS ») |
| La CLI Supabase 3.x | Le script s'en sert pour parler à Supabase | `npm install -g supabase@3` |
| Git | Récupérer le code | https://git-scm.com |
| Un stockage compatible S3 | Photos des bornes | Cloudflare R2, Scaleway, OVHcloud, Backblaze B2, MinIO… |
| Une messagerie SMTP sur le port 465 | Emails aux clients | Votre hébergeur email (IONOS, OVH, Gmail…) |
| Un hébergement de site statique | Mettre le site en ligne | Netlify, Cloudflare Pages, Vercel, ou votre serveur |
| Un nom de domaine | Adresse du SaaS, ex. `photobooth.mon-entreprise.fr` | Votre registraire |

Pas besoin de serveur à vous : Supabase fait office de serveur (base, comptes, fonctions, tâches
planifiées) et le site est un dossier de fichiers statiques. Coûts et choix des offres : voir
[installation.md](installation.md).

La borne (PC Windows) s'installe ensuite : [installation-borne.md](installation-borne.md).

Vérifiez les versions dans un terminal :

```bash
node --version       # v20 ou plus
supabase --version   # 3.x
```

> **Port 465 obligatoire.** Supabase bloque les ports 25 et 587. Demandez à votre hébergeur email
> les réglages « SMTP SSL/TLS, port 465 ».

---

## 2. Préparer Supabase

1. Créez un **nouveau projet vide** (région Europe conseillée). Notez le **mot de passe de la base** :
   le script en a besoin.
2. Notez l'**identifiant du projet** : les 20 lettres de l'adresse `https://<identifiant>.supabase.co`
   (Project Settings > General > Project ID).
3. Activez les **anciennes clés** : Project Settings > API Keys > onglet « Legacy API Keys » >
   « Enable legacy API keys ». La borne et les tâches planifiées en ont besoin (clés `eyJ…`).
4. Authentication > URL Configuration :
   - Site URL : l'adresse de votre SaaS, ex. `https://photobooth.mon-entreprise.fr` ;
   - Redirect URLs : ajoutez `https://photobooth.mon-entreprise.fr/**`. Elle couvre la page de
     choix d'un nouveau mot de passe (`/admin/nouveau-mot-de-passe`), où mène le lien
     « Mot de passe oublié ? ».
5. Authentication > Emails > SMTP Settings : activez « Custom SMTP » avec les mêmes réglages que
   votre messagerie (port 465). Sans cela, Supabase n'envoie l'invitation et les emails de mot de
   passe oublié qu'aux membres de votre équipe Supabase, et seulement quelques emails par heure.
6. Facultatif : Authentication > Providers > Email, longueur minimale du mot de passe à 8 (le SaaS
   en demande 8). Authentication > Emails > Templates : traduisez l'email « Reset Password » si
   vous le souhaitez (il est en anglais par défaut).

Faites les étapes 4 et 5 **avant** le script : il envoie l'invitation du compte administrateur.

---

## 3. Préparer le stockage

Chez votre fournisseur S3 :

1. Créez un bucket, par exemple `medias`.
2. Rendez sa lecture **publique** (les photos s'affichent par leur adresse). Cette adresse publique
   doit être en `https://` : la borne n'enregistre pas une photo dont l'adresse est en `http://`.
3. Créez une clé d'accès (Access Key ID + Secret Access Key) avec droits de lecture et d'écriture.
4. Réglez le **CORS** du bucket, sinon les envois depuis le navigateur échouent :
   - origine : l'adresse de votre SaaS (`https://photobooth.mon-entreprise.fr`) ;
   - méthodes : `GET` et `PUT` ;
   - en-têtes autorisés : `*` ;
   - en-tête exposé : `ETag`.

Exemple de règle CORS au format S3 (JSON) :

```json
[
  {
    "AllowedOrigins": ["https://photobooth.mon-entreprise.fr"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Adresses usuelles (à vérifier chez le fournisseur, bucket `medias`) :

| Fournisseur | STORAGE_ENDPOINT | STORAGE_REGION | STORAGE_PUBLIC_URL |
|---|---|---|---|
| Cloudflare R2 | `https://<account_id>.r2.cloudflarestorage.com` | `auto` | `https://medias.mon-entreprise.fr` (domaine relié au bucket) ou `https://pub-<id>.r2.dev` |
| Scaleway | `https://s3.fr-par.scw.cloud` | `fr-par` | `https://medias.s3.fr-par.scw.cloud` |
| OVHcloud | `https://s3.gra.io.cloud.ovh.net` | `gra` | `https://medias.s3.gra.io.cloud.ovh.net` |
| Backblaze B2 | `https://s3.eu-central-003.backblazeb2.com` | `eu-central-003` | `https://f003.backblazeb2.com/file/medias` |
| MinIO | `https://minio.mon-entreprise.fr` | (vide) | `https://minio.mon-entreprise.fr/medias` |

### Cloudflare R2, pas à pas

R2 n'a pas de frais de sortie (les invités qui regardent les photos ne coûtent rien) et offre
10 Go gratuits. C'est le choix conseillé.

1. Tableau de bord Cloudflare > R2 Object Storage : activez R2 (une carte bancaire est demandée,
   rien n'est prélevé sous les quotas gratuits).
2. Create bucket : nom `medias`, emplacement « Automatic » ou « European Union ».
3. Lecture publique, dans le bucket > Settings > Public access :
   - **domaine personnalisé** (conseillé) : « Connect Domain », ex. `medias.mon-entreprise.fr`.
     Le domaine doit être géré par Cloudflare (DNS) ;
   - ou **adresse r2.dev** : « Allow Access ». Adresse `https://pub-<id>.r2.dev`, limitée en débit
     par Cloudflare : à réserver aux essais.
4. Settings > CORS Policy : collez la règle JSON ci-dessus.
5. R2 > Manage R2 API Tokens > Create API token : permission « Object Read & Write », limitée au
   bucket `medias`. Notez l'Access Key ID et la Secret Access Key (affichée une seule fois).
6. L'**Account ID** (pour `STORAGE_ENDPOINT`) est affiché sur la page d'accueil de R2.

Dans `instance.env` :

```bash
STORAGE_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
STORAGE_REGION=auto
STORAGE_ACCESS_KEY_ID=<Access Key ID>
STORAGE_SECRET_ACCESS_KEY=<Secret Access Key>
STORAGE_BUCKET=medias
STORAGE_PUBLIC_URL=https://medias.mon-entreprise.fr
```

---

## 4. Récupérer le code et remplir la configuration

```bash
git clone https://github.com/<compte>/polabooth
cd polabooth/saas
npm ci
```

Copiez le modèle de configuration :

```bash
cp instance.env.example instance.env       # Windows (PowerShell) : copy instance.env.example instance.env
```

Ouvrez `instance.env` dans un éditeur de texte. Chaque ligne est expliquée. Remplissez :
le projet Supabase, l'adresse du SaaS, votre entreprise, l'email de l'administrateur, le SMTP et le
stockage.

Valeur avec un espace, un `#` ou un `$` : entourez-la de guillemets simples
(`SMTP_PASSWORD='mon#mot$de passe'`). Avec une apostrophe : guillemets doubles
(`COMPANY_NAME="L'Atelier Photo"`).

> `instance.env` contient vos mots de passe. Ne l'envoyez à personne. Git l'ignore déjà.

---

## 5. Lancer le script

Toujours depuis le dossier `saas/` :

```bash
supabase login                              # une seule fois, ouvre le navigateur
npm run install-instance -- --dry-run       # simulation : vérifie la configuration, ne modifie rien
npm run install-instance                    # installation
```

Le script :

1. vérifie Node.js, la CLI Supabase et votre connexion ;
2. lit et vérifie `instance.env` (chaque erreur est expliquée) ;
3. lie le dossier à votre projet et crée la base (`supabase db push`). Sur un projet tout neuf, il
   attend d'abord que le service Storage de Supabase soit prêt (de quelques minutes à un quart
   d'heure après la création du projet) ;
4. récupère les clés du projet ;
5. pose les secrets des fonctions (adresse du SaaS, SMTP, stockage) et ceux des tâches planifiées ;
6. déploie les fonctions serveur ;
7. retire les tâches planifiées des fonctionnalités non incluses ;
8. crée le compte administrateur, lui envoie une invitation et crée votre organisation ;
9. écrit la configuration du site et de la borne ;
10. construit le site dans `saas/dist/` ;
11. affiche ce qu'il vous reste à faire.

À la fin, il affiche le **mot de passe** de l'administrateur. Notez-le : il ne sera plus affiché.

Options utiles :

| Option | Effet |
|---|---|
| `--dry-run` | Simulation, rien n'est modifié |
| `--config <fichier>` | Utiliser un autre fichier que `instance.env` |
| `--skip-build` | Ne pas reconstruire le site |
| `--new-admin-password` | Nouveau mot de passe pour l'administrateur (mot de passe perdu, invitation perdue) |
| `--local` | Essai sur une Supabase locale (`supabase start`) : clés lues localement, `http://` accepté, secrets et fonctions seulement affichés (pour essayer les fonctions, copiez ces secrets dans `supabase/functions/.env` puis relancez `supabase start`) ; emails dans Mailpit |

Les options se placent après `--` : `npm run install-instance -- --new-admin-password`.

---

## 6. Mettre le site en ligne

Le site est le dossier `saas/dist/`. Hébergez-le à l'adresse de votre SaaS.

Règle indispensable : toute adresse inconnue doit renvoyer `index.html` (le site gère lui-même ses pages).

- **Vercel** (l'offre gratuite « Hobby » est réservée à un usage non commercial : pour une
  entreprise, offre Pro) : `dist/vercel.json` est déjà prêt (renvoi vers `index.html`, en-têtes de sécurité
  adaptés à votre projet et à votre stockage). Depuis `saas/dist/` : `npx vercel --prod`, puis
  ajoutez votre domaine dans le tableau de bord Vercel.
- **Netlify** : créez `dist/_redirects` contenant `/* /index.html 200`, puis glissez le dossier
  `dist` dans Netlify.
- **Votre serveur (Nginx)** : `try_files $uri /index.html;`.

Le fichier `kiosk-config.json` doit être en ligne à `https://<votre SaaS>/kiosk-config.json`. Le script
le crée dans `dist/`, rien à faire de plus.

Vous construisez le site vous-même (par exemple sur Vercel depuis Git) ? Ajoutez la variable
`KIOSK_SUPABASE_ANON_KEY` (clé anon au format `eyJ…`, voir étape 2.3) aux variables du build. Sinon,
le fichier n'est pas créé et un avertissement s'affiche pendant la construction.

---

## 7. Première connexion

1. Ouvrez l'email d'invitation reçu par l'administrateur et cliquez sur le lien. Il confirme l'adresse.
2. Allez sur `https://<votre SaaS>/admin/login`.
3. Connectez-vous avec l'email de l'administrateur et le mot de passe affiché par le script.
4. Complétez Paramètres (fiche contact, logo, expéditeur des emails).

Pas d'email reçu ? Vérifiez les réglages SMTP de Supabase (étape 2.5), puis lancez
`npm run install-instance -- --new-admin-password` : l'adresse est confirmée et un nouveau mot de passe
s'affiche.

---

## 8. Associer une borne

1. Construisez l'installeur de la borne à votre nom et installez-le sur le PC :
   [installation-borne.md](installation-borne.md) (matériel, kit Canon, construction, réglages).
2. Au premier démarrage, l'écran « Adresse de votre SaaS » s'affiche. Tapez l'adresse de votre SaaS
   (ex. `photobooth.mon-entreprise.fr`). La borne lit alors `kiosk-config.json`.
3. La borne affiche un code et un QR code.
4. Scannez le QR code (ou ouvrez `https://<votre SaaS>/associer` et tapez le code), connectez-vous,
   donnez un nom à la borne et validez.
5. La borne est associée. Elle apparaît dans « Parc kiosk ».

---

## 9. En cas d'échec

Le script s'arrête au premier problème et dit quoi faire. Corrigez, puis **relancez-le** : les étapes
déjà faites ne sont pas refaites.

| Message | Solution |
|---|---|
| `Fichier introuvable : … instance.env` | Copiez `instance.env.example` en `instance.env` (étape 4). |
| `… contient N erreur(s)` | Corrigez chaque ligne citée dans `instance.env`. |
| `Vous n'êtes pas connecté à Supabase` | `supabase login`, puis relancez. |
| `La CLI supabase est introuvable` / `3.x est nécessaire` | `npm install -g supabase@3`. |
| `Clés au format JWT introuvables` | Activez les anciennes clés (étape 2.3), puis relancez. |
| `Le service Storage du projet Supabase n'est toujours pas prêt` | Projet créé il y a peu : attendez quelques minutes, puis relancez. Si ça dure, relancez le projet (Project Settings > General > Restart project). |
| `relation "storage.objects" does not exist` pendant `db push` | Même cause (Storage pas encore prêt) : attendez quelques minutes, puis relancez. |
| Échec de `supabase link` ou `db push` (mot de passe) | Vérifiez `SUPABASE_DB_PASSWORD` (Project Settings > Database > Reset database password). |
| `Invitation non envoyée` | Réglez le SMTP de Supabase (étape 2.5). Le compte est quand même créé et confirmé : connectez-vous avec le mot de passe affiché. |
| `Une organisation existe déjà … avec un autre propriétaire` | `ADMIN_EMAIL` a changé depuis la première installation. Remettez l'ancien email. |
| `La construction du site a échoué` | `npm ci` dans `saas/`, puis relancez. |
| Les envois de photos échouent dans le navigateur | CORS du bucket (étape 3.4). |
| `dist/kiosk-config.json n'a pas été généré` | Clé anon au format JWT absente : activez les anciennes clés (étape 2.3), puis relancez. |
| La borne refuse l'adresse du SaaS | Vérifiez que `https://<votre SaaS>/kiosk-config.json` s'ouvre dans un navigateur. |

---

## 10. Relancer et mettre à jour

Relancer le script est sans risque : il ne crée ni deuxième compte, ni deuxième organisation, ni
doublon. Il ne repose que les secrets modifiés.

Relancez-le après chaque changement de `instance.env` (nouveau mot de passe SMTP, autre stockage…).

Pour installer une nouvelle version :

```bash
cd polabooth/saas
git pull
npm ci
npm run install-instance
```

Le script applique les nouvelles migrations, redéploie les fonctions et reconstruit `dist/`.
Remettez ensuite `dist/` en ligne (étape 6).

---

## 11. Bon à savoir

- Quelques fonctionnalités (réservation en ligne, facturation, prospects, livre d'or audio) ne
  font pas partie de Polabooth. Leurs fonctions et tâches planifiées ne sont pas installées.
- Les clés des services facultatifs (images par IA, assistant, agenda Google) se saisissent dans le
  SaaS : Paramètres > Clés.
- La clé `service_role` de Supabase ne sert qu'au script. Elle n'est écrite dans aucun fichier du site.
- `instance.env` et `.env.production` restent sur votre ordinateur. Git les ignore.
