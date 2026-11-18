# Installer votre propre SaaS photobooth

> Guide pas à pas, avec formulaire de configuration : ouvrez [guide-installation.html](guide-installation.html) par un double-clic.

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
| Git | Récupérer le code | https://git-scm.com |
| Un stockage compatible S3 | Photos des bornes | Cloudflare R2, Scaleway, OVHcloud, Backblaze B2, MinIO… |
| Une messagerie SMTP sur le port 465 | Emails aux clients | Votre hébergeur email (IONOS, OVH, Gmail…) |
| Un hébergement de site statique | Mettre le site en ligne | Netlify, Cloudflare Pages, Vercel, ou votre serveur |
| Un nom de domaine | Adresse du SaaS, ex. `photobooth.mon-entreprise.fr` | Votre registraire |

Pas besoin de serveur à vous : Supabase fait office de serveur (base, comptes, fonctions, tâches
planifiées) et le site est un dossier de fichiers statiques. Coûts et choix des offres : voir
[installation.md](installation.md).

La borne (PC Windows) s'installe ensuite : [installation-borne.md](installation-borne.md).

Vérifiez la version dans un terminal :

```bash
node --version       # v20 ou plus
```

Rien d'autre à installer : le script télécharge lui-même l'outil en ligne de commande de Supabase
(la « CLI ») la première fois, avec `npx`, fourni avec Node.js.

> **Port 465 obligatoire.** Supabase bloque les ports 25 et 587. Demandez à votre hébergeur email
> les réglages « SMTP SSL/TLS, port 465 ».

---

## 2. Préparer Supabase

1. Créez un **nouveau projet vide** (région Europe conseillée). Notez le **mot de passe de la base** :
   le script en a besoin.
2. Notez l'**identifiant du projet** : les 20 lettres de l'adresse `https://<identifiant>.supabase.co`
   (Project Settings > General > Project ID).
3. Créez un **jeton d'accès** sur https://supabase.com/dashboard/account/tokens
   (« Generate new token », nom libre, ex. `installation`). Copiez-le tout de suite : il commence par
   `sbp_` et n'est affiché qu'une fois. Il ouvre tout votre compte Supabase : ne le partagez pas.

C'est tout. Avec ce jeton, le script règle lui-même le projet :

- l'adresse du site et les adresses de retour autorisées (lien « Mot de passe oublié ? » compris) ;
- l'envoi des emails des comptes par votre messagerie (SMTP de `instance.env`). Sans cela, Supabase
  n'enverrait l'invitation qu'aux membres de votre équipe Supabase, et quelques emails par heure ;
- 8 caractères minimum pour les mots de passe ;
- les **inscriptions fermées** : personne ne peut se créer un compte depuis le site. Les comptes se
  créent par invitation (le script crée ainsi l'administrateur) ;
- les emails des comptes en français : invitation, mot de passe oublié, code de confirmation. Un
  email que vous avez déjà modifié dans Supabase est gardé tel quel ;
- les **anciennes clés API** (`eyJ…`), dont la borne et les tâches planifiées ont besoin.

Si Supabase refuse un jour d'activer les anciennes clés par le script, le message vous le dira.
Activez-les alors à la main : Project Settings > API Keys > onglet « Legacy API Keys » >
« Enable legacy API keys », puis relancez le script.

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

Le script d'installation vérifie ces réglages avant de rien modifier (étape « Vérifications », section 5) :
il envoie un petit fichier de test, le relit par l'adresse publique, puis le supprime. Il vérifie aussi le
CORS. S'il manque, le script pose lui-même cette règle, en gardant les règles déjà présentes. Si la clé n'en
a pas le droit, il affiche la règle à coller et l'endroit où la coller. Avec Cloudflare R2, une clé
« Object Read & Write » n'a pas ce droit : collez la règle à la main (étape 4 du pas à pas ci-dessous).

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
le projet Supabase (identifiant, mot de passe de la base, jeton `SUPABASE_ACCESS_TOKEN`), l'adresse du
SaaS, votre entreprise, l'email de l'administrateur, le SMTP et le stockage.

Valeur avec un espace, un `#` ou un `$` : entourez-la de guillemets simples
(`SMTP_PASSWORD='mon#mot$de passe'`). Avec une apostrophe : guillemets doubles
(`COMPANY_NAME="L'Atelier Photo"`).

> `instance.env` contient vos mots de passe. Ne l'envoyez à personne. Git l'ignore déjà.

---

## 5. Lancer le script

Toujours depuis le dossier `saas/` :

```bash
npm run install-instance -- --dry-run       # simulation : vérifie la configuration, la messagerie, le stockage et le jeton, ne modifie rien
npm run install-instance                    # installation
```

Le script affiche chaque étape (« Étape 3/13 : … ») :

1. vérifie Node.js et télécharge la CLI Supabase la première fois (une minute environ) ;
2. lit et vérifie `instance.env` (chaque erreur est expliquée) ;
3. vérifie la messagerie et le stockage, avant de rien modifier (détails ci-dessous) ;
4. vérifie le jeton, puis règle les comptes de Supabase : adresse du site, envoi des emails par votre
   SMTP, mots de passe de 8 caractères, inscriptions fermées, emails en français (voir étape 2) ;
5. lie le dossier à votre projet et crée la base (`supabase db push`). Sur un projet tout neuf, il
   attend d'abord que le service Storage de Supabase soit prêt (de quelques minutes à un quart
   d'heure après la création du projet) ;
6. active les anciennes clés si besoin et récupère les clés du projet ;
7. pose les secrets des fonctions (adresse du SaaS, SMTP, stockage, `RATE_LIMIT_SALT`) et ceux des
   tâches planifiées. `RATE_LIMIT_SALT` (sel des limites anti-abus des pages publiques) est tiré au
   hasard à la première installation puis gardé : il est **obligatoire**, sans lui les fonctions
   publiques (éditeur du client, galerie, envoi des photos des invités…) répondent 503 ;
8. déploie les fonctions serveur ;
9. retire les tâches planifiées des fonctionnalités non incluses ;
10. crée le compte administrateur, lui envoie une invitation et crée votre organisation ;
11. écrit la configuration du site et de la borne ;
12. construit le site dans `saas/dist/` ;
13. affiche ce qu'il vous reste à faire.

**Vérifications (étape 3).** Les erreurs les plus fréquentes se voient ici, avant toute modification :

- **messagerie** : le script se connecte à votre serveur SMTP (port 465, SSL/TLS), s'identifie, puis
  envoie un email de test à `ADMIN_EMAIL`, depuis `FROM_EMAIL` (sujet « Polabooth : votre messagerie
  fonctionne »). Regardez aussi dans les indésirables ;
- **stockage**, pour chaque bucket (`STORAGE_BUCKET`, et `STORAGE_PHOTOS_BUCKET` s'il est rempli) : envoi
  d'un fichier de test dans le dossier `polabooth-verification/`, lecture de ce fichier par l'adresse
  publique, vérification du CORS, puis suppression du fichier ;
- **CORS** : s'il manque, le script pose la règle de la section 3. Si la clé n'en a pas le droit, il
  affiche la règle à coller et où la coller.

Chaque point est marqué ✓ (bon), ⚠ (à vérifier, l'installation continue) ou ✗ (bloquant). Un point ✗
arrête le script : identifiants SMTP refusés, email impossible à envoyer, envoi du fichier refusé,
lecture publique impossible, adresse publique en `http://`. Un CORS absent ou un fichier de test non
supprimé donne seulement ⚠. Corrigez, puis relancez : la section 9 donne la solution de chaque message.

La simulation (`--dry-run`) lit les réglages actuels de Supabase et montre ceux qu'elle changerait,
sans le mot de passe SMTP. Elle ne modifie pas votre installation. Elle fait quand même les vérifications :
l'email de test part, et le fichier de test est envoyé puis supprimé. Seule la règle CORS n'est pas posée
(le script dit qu'il la poserait).

À la fin, il affiche le **mot de passe** de l'administrateur. Notez-le : il ne sera plus affiché.

Options utiles :

| Option | Effet |
|---|---|
| `--dry-run` | Simulation : rien n'est modifié (l'email et le fichier de test des vérifications partent quand même) |
| `--config <fichier>` | Utiliser un autre fichier que `instance.env` |
| `--skip-build` | Ne pas reconstruire le site |
| `--skip-email-test` | Vérifier la connexion et les identifiants SMTP sans envoyer l'email de test |
| `--skip-checks` | Sauter les vérifications de la messagerie et du stockage (déconseillé : une erreur ne se verra qu'à l'usage) |
| `--new-admin-password` | Nouveau mot de passe pour l'administrateur (mot de passe perdu, invitation perdue) |
| `--local` | Essai sur une Supabase locale (`npx supabase@3.0.0 start`, Docker nécessaire) : pas de jeton, réglages des comptes lus dans `supabase/config.toml`, clés lues localement, `http://` accepté, secrets et fonctions seulement affichés (pour essayer les fonctions, copiez ces secrets dans `supabase/functions/.env` puis relancez `npx supabase@3.0.0 start`) ; emails dans Mailpit. Ajoutez `--skip-checks` si la messagerie et le stockage de `instance.env` sont fictifs |

Les options se placent après `--` : `npm run install-instance -- --new-admin-password`.

---

## 6. Mettre le site en ligne

Le site est le dossier `saas/dist/`. Hébergez-le à l'adresse de votre SaaS.

Règle indispensable : toute adresse inconnue doit renvoyer `index.html` (le site gère lui-même ses pages).

- **Vercel** (l'offre gratuite « Hobby » est réservée à un usage non commercial : pour une
  entreprise, offre Pro) : `dist/vercel.json` est déjà prêt (renvoi vers `index.html`, en-têtes de sécurité
  adaptés à votre projet et à votre stockage). Depuis `saas/dist/` : `npx vercel --prod`, puis
  ajoutez votre domaine dans le tableau de bord Vercel.
- **Netlify** : `dist/_redirects` est déjà prêt (renvoi vers `index.html`). Glissez le dossier
  `dist` dans Netlify.
- **Cloudflare Pages** : rien à régler, il renvoie déjà vers `index.html`.
- **Votre serveur (Nginx)** : `try_files $uri /index.html;`.

Le fichier `kiosk-config.json` doit être en ligne à `https://<votre SaaS>/kiosk-config.json`. Le script
le crée dans `dist/`, rien à faire de plus.

Vous construisez le site vous-même (par exemple sur Vercel depuis Git) ? Ajoutez la variable
`KIOSK_SUPABASE_ANON_KEY` (clé anon au format `eyJ…`, voir étape 2) aux variables du build. Sinon,
le fichier n'est pas créé et un avertissement s'affiche pendant la construction.

---

## 7. Première connexion

1. Ouvrez l'email d'invitation reçu par l'administrateur et cliquez sur le lien. Il confirme l'adresse.
2. Allez sur `https://<votre SaaS>/admin/login`.
3. Connectez-vous avec l'email de l'administrateur et le mot de passe affiché par le script.
4. Suivez la carte **« Mise en route »** en haut de la page Aujourd'hui. Elle liste ce qu'il reste à
   renseigner et à connecter avant votre première commande, et chaque étape mène au bon écran :
   - votre entreprise (nom, email, téléphone, logo) et l'email de notification ;
   - l'envoi des emails (SMTP réglé par le script, ou une clé Brevo) ;
   - vos fonctionnalités (« Garder ces choix » si celles par défaut vous conviennent) ;
   - les services connectés dont elles ont besoin, un cadre photo, une borne associée (étape 8) et un
     événement d'essai.

   Les étapes se cochent toutes seules d'après vos données. « Configuré » ne veut pas dire
   « fonctionne » : envoyez-vous un email de test depuis Réglages › Services connectés. Vous pouvez
   masquer la carte ; les étapes indispensables restent alors dans « À faire ».

Pas d'email reçu ? Regardez dans les indésirables, corrigez au besoin les réglages SMTP de
`instance.env` et relancez le script : tant que l'invitation n'est pas acceptée, chaque relance la renvoie
(le mot de passe ne change pas). Mot de passe perdu, ou plus d'email du tout : lancez
`npm run install-instance -- --new-admin-password` : l'adresse est confirmée sans email et un nouveau mot
de passe s'affiche.

---

## 8. Associer une borne

1. Construisez l'installeur de la borne à votre nom et installez-le sur le PC :
   [installation-borne.md](installation-borne.md) (matériel, kit Canon, construction, réglages).
2. Au premier démarrage, l'écran « Adresse de votre SaaS » s'affiche. Tapez l'adresse de votre SaaS
   (ex. `photobooth.mon-entreprise.fr`). La borne lit alors `kiosk-config.json`.
3. La borne affiche un code et un QR code.
4. Scannez le QR code (ou ouvrez `https://<votre SaaS>/associer` et tapez le code), connectez-vous,
   donnez un nom à la borne et validez.
5. La borne est associée. Elle apparaît dans la page **Bornes**.

---

## 9. En cas d'échec

Le script s'arrête au premier problème et dit quoi faire. Corrigez, puis **relancez-le** : les étapes
déjà faites ne sont pas refaites.

| Message | Solution |
|---|---|
| `Fichier introuvable : … instance.env` | Copiez `instance.env.example` en `instance.env` (étape 4). |
| `… contient N erreur(s)` | Corrigez chaque ligne citée dans `instance.env`. |
| `SUPABASE_ACCESS_TOKEN est vide` / `invalide` | Créez un jeton (étape 2.3), collez-le en entier dans `instance.env`. |
| `Jeton Supabase refusé` | Jeton faux, expiré ou supprimé : créez-en un nouveau sur https://supabase.com/dashboard/account/tokens, collez-le dans `instance.env`, puis relancez. |
| `Ce jeton n'a pas les droits sur le projet` / `Projet … introuvable avec ce jeton` | Vérifiez `SUPABASE_PROJECT_REF`, et créez le jeton avec le compte Supabase qui possède le projet. |
| `N vérification(s) en échec` | Les lignes marquées ✗ juste au-dessus disent quoi corriger (voir les lignes suivantes). Rien n'a été modifié : corrigez, puis relancez. |
| `Identifiants SMTP refusés` | Vérifiez `SMTP_USER` (souvent l'adresse email complète) et `SMTP_PASSWORD`. Mot de passe avec un espace, un `#` ou un `$` : entourez-le de guillemets simples. |
| `Le serveur exige un mot de passe d'application` | Gmail, Outlook… : créez un « mot de passe d'application » dans votre compte, mettez-le dans `SMTP_PASSWORD`. |
| `Serveur SMTP introuvable` / `Connexion refusée par …` / `Pas de réponse de …` | Vérifiez `SMTP_HOST` et `SMTP_PORT` (465). Pas de réponse : un pare-feu (ou votre box) bloque peut-être ce port. |
| `Certificat du serveur SMTP … refusé` | `SMTP_HOST` doit être le nom exact du serveur, celui donné par votre hébergeur email. |
| `Le serveur … ne répond pas en SSL/TLS` / `ne propose pas de connexion chiffrée` | Utilisez le port SSL/TLS de votre hébergeur : `SMTP_PORT=465`. |
| `Expéditeur refusé : FROM_EMAIL … n'est pas autorisé` / `Email de test refusé` | Mettez dans `FROM_EMAIL` l'adresse du compte SMTP (souvent `SMTP_USER`) ou une adresse que votre hébergeur autorise. |
| `Destinataire refusé : ADMIN_EMAIL` | Vérifiez `ADMIN_EMAIL`. |
| Email de test annoncé envoyé, mais jamais reçu | Regardez dans les indésirables. Le serveur l'a accepté : s'il n'arrive pas, voyez avec votre hébergeur email (adresse d'expédition, SPF/DKIM du domaine). |
| `Stockage … : clé d'accès inconnue` / `clé secrète refusée` | Recopiez en entier `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY`, sans espace. |
| `Stockage … : bucket … introuvable` | Vérifiez `STORAGE_BUCKET` (nom exact) et `STORAGE_ENDPOINT`. |
| `Stockage … : région ou adresse du fournisseur incorrecte` / `injoignable` | Vérifiez `STORAGE_REGION` et `STORAGE_ENDPOINT` (tableau de la section 3). Avec `STORAGE_FORCE_PATH_STYLE=false`, essayez plutôt de laisser la variable vide. |
| `Stockage … : la clé n'a pas le droit d'écrire` | Donnez à la clé les droits de lecture et d'écriture sur le bucket (Cloudflare R2 : « Object Read & Write »). |
| `Lecture publique refusée` / `Fichier de test introuvable par l'adresse publique` / `ne mène pas au bucket` | Rendez la lecture du bucket publique (section 3, point 2 ; R2 : Settings > Public access) et mettez dans `STORAGE_PUBLIC_URL` l'adresse publique de ce bucket (tableau de la section 3). |
| `Adresse publique en http` | Mettez une adresse en `https://` dans `STORAGE_PUBLIC_URL` (et `STORAGE_PHOTOS_PUBLIC_URL`). |
| ⚠ `CORS absent ou incomplet … la clé n'a pas le droit de le poser` | Collez la règle affichée dans les réglages CORS du bucket (Cloudflare R2 : bucket > Settings > CORS Policy ; autres : section 3), puis relancez pour vérifier. |
| ⚠ `CORS posé, mais pas encore pris en compte` / `impossible à vérifier` | Relancez dans quelques minutes : le point doit passer à ✓. Sinon, vérifiez la règle à la main (section 3). |
| ⚠ `fichier de test non supprimé` | Sans conséquence : supprimez à la main le dossier `polabooth-verification/` du bucket. |
| `API de gestion Supabase injoignable` | Vérifiez la connexion Internet, puis relancez. |
| `La CLI Supabase n'a pas pu être lancée par npx` | Vérifiez la connexion Internet (la CLI est téléchargée la première fois), puis relancez. |
| `npx est introuvable` | Installez Node.js (https://nodejs.org, version « LTS ») : `npx` est inclus. |
| `Clés au format JWT introuvables` | Activez les anciennes clés à la main (fin de l'étape 2), puis relancez. |
| `Le service Storage du projet Supabase n'est toujours pas prêt` | Projet créé il y a peu : attendez quelques minutes, puis relancez. Si ça dure, relancez le projet (Project Settings > General > Restart project). |
| `relation "storage.objects" does not exist` pendant `db push` | Même cause (Storage pas encore prêt) : attendez quelques minutes, puis relancez. |
| Échec de `supabase link` ou `db push` (mot de passe) | Vérifiez `SUPABASE_DB_PASSWORD` (Project Settings > Database > Reset database password). |
| `Invitation non envoyée` | Vérifiez le SMTP de `instance.env` (serveur, port 465, identifiant, mot de passe, `FROM_EMAIL` autorisé), puis relancez. Le compte est quand même créé et confirmé : connectez-vous avec le mot de passe affiché. |
| `Une organisation existe déjà … avec un autre propriétaire` | `ADMIN_EMAIL` a changé depuis la première installation. Remettez l'ancien email. |
| `La construction du site a échoué` | `npm ci` dans `saas/`, puis relancez. |
| Pages du client ou galerie : « Service momentanément indisponible » (503) | Secret `RATE_LIMIT_SALT` absent des fonctions (journal de la fonction : `RATE_LIMIT_SALT manquant`). Relancez le script : il le pose. À la main : `npx supabase secrets set RATE_LIMIT_SALT=<64 caractères au hasard>`. |
| Les envois de photos échouent dans le navigateur | CORS du bucket (section 3, point 4) : relancez le script, l'étape « Vérifications » le contrôle. |
| `dist/kiosk-config.json n'a pas été généré` | Clé anon au format JWT absente : activez les anciennes clés (fin de l'étape 2), puis relancez. |
| La borne refuse l'adresse du SaaS | Vérifiez que `https://<votre SaaS>/kiosk-config.json` s'ouvre dans un navigateur. |

---

## 10. Relancer et mettre à jour

Relancer le script est sans risque : il ne crée ni deuxième compte, ni deuxième organisation, ni
doublon. Il ne repose que les secrets modifiés.

Relancez-le après chaque changement de `instance.env` (nouveau mot de passe SMTP, autre stockage…).
Il remet aussi les réglages des comptes de Supabase (étape 2) : modifiez le SMTP dans `instance.env`,
pas dans le tableau de bord de Supabase. Gardez le jeton dans `instance.env` : chaque relance en a besoin.

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
- Avec le module de réservation, la facturation est en **mode manuel** par défaut : aucun outil de
  facturation à brancher, Pennylane est facultatif. Les PDF des devis et des factures déposés sur
  une réservation sont rangés dans le bucket Supabase privé `billing-documents`, créé par les
  migrations (rien à régler, aucun accès public : lecture par lien signé seulement). Une tâche
  planifiée quotidienne (`billing-documents-cleanup`, 03:45 UTC, fonction du même nom) efface les
  PDF d'une réservation supprimée, ou d'un document supprimé, 24 h après. La conservation légale
  des factures reste dans votre outil de facturation.
- Les clés des services facultatifs (agenda Google, images par IA, assistant) se saisissent dans le
  SaaS : Réglages > Services connectés.
- Seul le compte administrateur (créé par le script, étape 10) crée une organisation : un autre
  compte qui se connecte au SaaS n'en obtient pas d'office et ne voit rien.
- Les buckets de Supabase restent publics (les images s'ouvrent par leur adresse), mais leur contenu ne
  se liste pas. Chaque bucket limite la taille et le type des fichiers : `designs` 50 Mo (PNG, JPEG,
  WebP), `template-backgrounds` 20 Mo, `decorations` et `fonts` 10 Mo, `kiosk-backgrounds` 10 Mo. Le
  plan gratuit de Supabase plafonne de toute façon chaque fichier à 50 Mo.
- Les écrans de la borne (Bornes > Écrans) peuvent écrire leurs textes dans une
  police Google : à la publication, la fonction `google-font-file` (déployée par le script, rien à
  régler) télécharge le fichier sur Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`) et
  le range dans le bucket `kiosk-backgrounds` avec les images. La borne ne contacte jamais Google.
- Les images ajoutées aux modèles (photos importées, décorations, images détourées) sont rangées
  dès leur ajout dans le bucket `designs` par la fonction `upload-design-image` (déployée par le
  script avec la création des designs, rien à régler) : `{événement}/images/` pour un client,
  `templates/images/` pour la bibliothèque de modèles. Les modèles n'enregistrent que l'adresse
  des images. Les modèles créés avant cette version gardent leurs images intégrées : le script
  `node scripts/convert-design-images.mjs` (dans `saas/`, essai à blanc par défaut, `--apply`
  pour écrire) les range dans le stockage. Les aperçus des modèles de la bibliothèque vont dans
  `templates/previews/` ; ceux enregistrés avant cette version se rangent avec
  `node scripts/convert-template-previews.mjs` (même principe).
- Une tâche planifiée quotidienne (`design-images-cleanup`, 03:30 UTC, fonction du même nom
  déployée par le script, rien à régler) supprime de ces dossiers `images/` et `previews/` les
  images qui ne servent plus : plus de 7 jours dans le stockage et citées dans aucun design, aucune
  version de l'historique, aucun modèle ni écran de la borne. En cas d'erreur, elle ne supprime
  rien et l'alerte des tâches planifiées vous prévient.
- Modèles Brevo (facultatifs : email d'accès réglé dans l'organisation, relance de la création du
  cadre) : paramètres disponibles `CLIENT_NAME`, `EVENT_NAME`, `ACCESS_CODE`, `EDITOR_URL`, plus
  `EXPIRES_DATE` (accès) ou `DAYS_LEFT` (relance), et `TRACKING_URL` : le lien « Suivre ma
  réservation » quand l'événement vient d'une demande de réservation en ligne, vide sinon (toujours
  vide sans la réservation en ligne). Pour l'afficher seulement s'il existe :
  `{% if params.TRACKING_URL %}<p>Où en est votre réservation ? <a href="{{ params.TRACKING_URL }}">Suivre ma réservation</a></p>{% endif %}`.
  En SMTP, ou sans modèle, les emails de l'app ajoutent cette ligne d'eux-mêmes.
- Inscriptions fermées : un compte ne se crée que par invitation (script, ou Authentication > Users >
  « Invite user » dans Supabase). Ne rouvrez pas les inscriptions (Authentication > Sign In / Providers >
  « Allow new users to sign up ») : n'importe qui pourrait se créer un compte.
- Limites anti-abus et adresse IP des visiteurs : les fonctions publiques lisent l'IP dans
  `cf-connecting-ip`, puis `x-real-ip`, puis le dernier élément de `X-Forwarded-For`. Sur Supabase
  hébergé (`supabase.co`), Cloudflare et la passerelle de Supabase posent ces en-têtes : rien à faire.
  Supabase auto-hébergé derrière votre propre reverse proxy (nginx, Caddy, Kong…) : le proxy doit
  supprimer `cf-connecting-ip` reçu du visiteur et écraser `x-real-ip` avec la vraie adresse (nginx :
  `proxy_set_header CF-Connecting-IP "";` et `proxy_set_header X-Real-IP $remote_addr;`). Sinon un
  visiteur peut changer d'adresse à chaque requête et contourner les limites.
- La clé `service_role` de Supabase ne sert qu'au script. Elle n'est écrite dans aucun fichier du site.
- `instance.env` et `.env.production` restent sur votre ordinateur. Git les ignore.
