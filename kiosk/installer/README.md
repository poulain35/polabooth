# Installeur & mises à jour PolaKiosk

> Vous installez la borne pour votre propre instance ? Suivez d'abord
> [docs/installation-borne.md](../../docs/installation-borne.md) (matériel, kit Canon, fichiers à
> remplacer). Un installeur prêt à l'emploi, kit Canon inclus, est publié dans l'onglet Releases
> du dépôt. Ce fichier détaille la mécanique de l'installeur et des mises à jour.

`setup-polakiosk.exe` installe l'app **par utilisateur** (`%LocalAppData%\Programs\PolaKiosk`),
sans droits admin. Ça permet aux **mises à jour automatiques de se faire en silence**, sans UAC.
Le watchdog relance l'app si elle plante et après une mise à jour. **Lancement au démarrage de Windows :
désactivé à l'installation**, réglé par la case « Lancer la borne au démarrage de Windows » de l'Admin
de la borne. Cochée, l'app pose le raccourci « PolaKiosk Watchdog » dans le **dossier Démarrage** de
l'utilisateur (l'installeur ne le pose plus depuis la 1.0.22 ; une borne installée avant le garde).
Décochée, on ouvre la borne à la main et c'est l'app qui lance le watchdog.

## Prérequis (poste de build, une fois)

- [Inno Setup 6.1+](https://jrsoftware.org/isdl.php) (lecture de la version dans la DLL publiée)
- SDK .NET 10

## Générer une version

### 1. Mettre à jour le numéro de version (un seul endroit)

- `PolaKiosk\PolaKiosk.csproj` → `<Version>1.1.0</Version>`

> Ce numéro est lu au runtime par le kiosk (heartbeat, comparaison avec la version demandée), et par
> `PolaKiosk.iss` dans la `PolaKiosk.dll` publiée : l'installeur ne peut plus porter une autre version.

### 2. Construire l'installeur

Depuis `kiosk\` :

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File installer\build.ps1
```

Le script publie l'app en self-contained (`dotnet publish … -c Release -r win-x64 --self-contained true`,
sortie `PolaKiosk\bin\Release\net10.0-windows\win-x64\publish\`), la signe si un certificat est
configuré (étape 3), puis compile `installer\PolaKiosk.iss` avec Inno Setup (variable `ISCC` pour
un autre chemin). Résultat : `installer\Output\setup-polakiosk.exe`.

À la main, c'est `dotnet publish` puis `ISCC installer\PolaKiosk.iss` (installeur non signé) ; sans
publication préalable, la compilation s'arrête sur « PolaKiosk.dll introuvable ».

### 3. Signer (facultatif, LAB-424)

Sans signature, Windows SmartScreen affiche « Windows a protégé votre ordinateur » et « éditeur
inconnu » au premier lancement de `setup-polakiosk.exe` téléchargé (il faut cliquer « Informations
complémentaires » puis « Exécuter quand même »). Une mise à jour lancée par la borne n'est pas
concernée : elle n'est pas « téléchargée depuis Internet » au sens de Windows.

Avec un certificat de **signature de code** (Authenticode, OV ou EV, au nom de votre société),
`build.ps1` signe `PolaKiosk.exe`, `PolaKiosk.dll`, l'installeur et son désinstalleur
(`installer\sign.ps1`, SHA-256, horodaté). Il suffit de définir **une** de ces variables avant de
lancer le script :

| Variable | Usage |
|---|---|
| `KIOSK_SIGN_CERT_THUMBPRINT` | Empreinte (SHA-1) du certificat dans le magasin Windows (`CurrentUser\My` ou `LocalMachine\My`) : jeton USB fourni par l'autorité, ou certificat importé |
| `KIOSK_SIGN_CERT_FILE` + `KIOSK_SIGN_CERT_PASSWORD` | Fichier `.pfx` et son mot de passe |
| `KIOSK_SIGN_COMMAND` | Commande complète d'un service de signature dans le cloud (ex. `signtool sign /fd SHA256 /tr … /td SHA256 /dlib … /dmdf … {file}`) ; `{file}` est remplacé par le chemin du fichier |
| `KIOSK_SIGN_TIMESTAMP_URL` | Serveur d'horodatage (par défaut `http://timestamp.digicert.com`) ; inutile avec `KIOSK_SIGN_COMMAND` |

```powershell
$env:KIOSK_SIGN_CERT_THUMBPRINT = "0123…"   # empreinte de votre certificat
powershell -NoProfile -ExecutionPolicy Bypass -File installer\build.ps1
Get-AuthenticodeSignature installer\Output\setup-polakiosk.exe   # Status : Valid
```

Ne mettez jamais le certificat ni son mot de passe dans le dépôt. Une signature ratée arrête la
construction (aucun installeur à moitié signé). Un certificat auto-signé (essai) passe avec un
avertissement, mais Windows ne l'approuve pas : il ne retire pas l'alerte SmartScreen. Même signé,
un tout nouveau certificat OV peut encore déclencher l'alerte le temps que sa réputation se forme ;
un certificat EV la retire d'emblée. Le script de l'installeur public
(`npm run release-polabooth-kiosk`) utilise `build.ps1` et les mêmes variables.

L'installeur contient toujours `THIRD-PARTY-NOTICES.txt` : si les DLL Canon
(`PolaKiosk\EDSDK\native\`) étaient présentes au moment de la publication, elles sont dans
l'installeur, et ce fichier rappelle qu'elles appartiennent à Canon et ne servent qu'avec PolaKiosk.
Ne les mettez jamais dans le dépôt git.

## Première installation sur un PC kiosk

1. Lancer `setup-polakiosk.exe` (aucun droit admin requis).
2. L'app s'installe, le watchdog démarre, l'app se lance. Pour qu'elle démarre avec Windows :
   Admin de la borne → « Démarrage de Windows » → cocher la case.
3. Dans le SaaS → **Kiosks**, le PC apparaît avec sa version installée (ex. `v1.0.0 ✓`).
4. **Imprimante** : ouvrir l'écran admin (PIN) → carte **Imprimante** → choisir l'imprimante
   dans la liste déroulante, ou laisser « Imprimante par défaut du système ». Le choix est
   stocké dans `machine-settings.json` (DataDirectory) et conservé entre les mises à jour.
   Aucun fichier de config à éditer à la main.

> **Backend (dev vs prod)** : un build publié tourne en environnement *Production* et utilise
> donc la config prod (`appsettings.json` + `appsettings.Instance.json` + `appsettings.Production.json`). Les fichiers
> `appsettings.local.json` (overrides développeur) et `appsettings.Development.json` (base de dev, PIN de dev,
> mode kiosk coupé) ne sont **ni publiés ni livrés** : `dotnet publish` ne les copie pas et `PolaKiosk.iss`
> les exclut aussi (LAB-394) — aucun risque de pointer un kiosk sur la base de dev.
>
> **Adresse du SaaS (open core K2)** : sans adresse Supabase dans les appsettings (build d'une autre
> instance, sans `appsettings.Production.json`), la borne affiche au premier démarrage l'écran
> « Adresse de votre SaaS ». L'adresse tapée (ex. `photobooth.mon-entreprise.fr`) sert à lire
> `https://<adresse>/kiosk-config.json` (`supabaseUrl`, `supabaseAnonKey`), puis l'adresse est
> enregistrée dans `machine-settings.json` et la borne redémarre sur l'association. Ni
> `appsettings.Instance.json` ni `instance.iss` ne fixent d'adresse Supabase. Admin → « Changer de
> SaaS » efface l'adresse et l'association.
> `supabaseAnonKey` doit être la clé anon **au format JWT** (`eyJ…`, Supabase → API Keys → Legacy) :
> `get-kiosk-upload-url` et `send-kiosk-photo` sont vérifiées par la passerelle, qui refuse une clé
> `sb_publishable_…` (erreur 401 à l'envoi des photos et des emails).
> Côté SaaS, ce fichier n'est pas versionné : le build le génère depuis `KIOSK_SUPABASE_ANON_KEY`
> (et `KIOSK_SUPABASE_URL`), voir `saas/CLAUDE.md`, « Variables d'environnement ».

> **Nouvelle borne.** Bornes › Versions affiche l'adresse courte `<adresse du SaaS>/installer-borne` (bouton « Copier ») : ouverte dans le navigateur du PC de la borne, elle télécharge la dernière version publiée, sans connexion (page publique, RPC `get_latest_kiosk_installer` ouverte à anon, qui ne renvoie que le numéro et l'adresse de l'installeur). Chaque version a aussi « Télécharger » et « Copier le lien ».

## Déployer une mise à jour (depuis le SaaS)

Une borne ne se met **jamais** à jour d'elle-même : uniquement quand on le demande depuis le SaaS.
Tout se pilote dans **Admin → Kiosks** :

1. **Publier la version** (bloc « Versions kiosk », réservé aux administrateurs de l'application) : renseigner le numéro (ex. `1.1.0`), choisir le `setup-polakiosk.exe`, ajouter des notes. Le navigateur calcule l'empreinte SHA-256, puis envoie l'installeur (500 Mo au maximum, barre de progression) dans le stockage des médias de l'instance (R2 ou S3, clé `releases/setup-polakiosk-<version>.exe`, par une URL présignée de la fonction `get-release-upload-url`), et non dans Supabase Storage, limité à 50 Mo par fichier sur l'offre gratuite. L'adresse publique du fichier devient l'adresse de téléchargement de la version. Pour corriger un installeur, publiez plutôt un nouveau numéro : un CDN peut garder l'ancien fichier en cache.
2. **Mettre à jour une borne** : sur la carte de la machine, bloc « Mise à jour », choisir la version (la dernière publiée par défaut) puis **Mettre à jour**. À refaire pour chaque borne.
3. La borne lit la demande à sa prochaine connexion (démarrage, puis toutes les 2 min) : la carte affiche « reçue le … ». Elle affiche ensuite « Mise à jour en cours… », s'installe en silence et redémarre dans la nouvelle version.
4. La carte affiche « installée » dès que la borne tourne sur la version demandée, et passe de `v1.0.0 → 1.1.0` (orange) à `v1.1.0 ✓` (vert) si c'est la dernière version publiée.

> **Jamais pendant une séance invité.** Une mise à jour ne s'installe que sur l'écran de démarrage,
> de saisie du code ou d'accueil. Demandée pendant une séance (prise de vue, résultat, galerie,
> admin…), elle attend le retour sur l'accueil.
>
> **En cas d'échec** (réseau coupé, téléchargement qui cale plus de 60 s, installeur refusé, installeur
> en erreur…), la borne revient à l'écran précédent (ou l'ancienne version redémarre) et **signale
> l'échec au SaaS** : la carte affiche « échec » avec le message. La borne ne réessaie pas d'elle-même :
> cliquer à nouveau sur **Mettre à jour** pour relancer.

## Revenir en arrière (rollback)

Un gros bug sur la `1.1.0` ? Sur la carte de la borne, choisir une version antérieure
(ex. `1.0.0`) puis **Mettre à jour**. (Gardez donc les anciennes versions publiées
dans la liste : supprimer une version annule les demandes en cours vers elle.)

## Mécanique (pour info)

- **Watchdog** (`scripts\watchdog.ps1`) : lancé au logon par le raccourci du dossier Démarrage si la case de l'Admin est cochée, sinon par l'app à son démarrage quand aucun ne tourne (mutex `Local\PolaKiosk.Watchdog`) ; lance l'app, la relance si elle disparaît. Suspend la relance si `update.lock` est présent, sauf si ce verrou a plus de 10 min (mise à jour interrompue) : il est alors supprimé. Suspend aussi la relance tant que `stop.flag` existe (bouton « Quitter vers Windows » de l'admin de la borne) ; il supprime ce fichier en démarrant, donc la borne repart à l'ouverture de session suivante (case cochée). Un seul watchdog par session.
- **Mise à jour** : l'app télécharge l'installeur en flux dans `%LocalAppData%\PolaKiosk\updates` (fichier `.part` renommé une fois complet, empreinte SHA-256 vérifiée), pose `update.lock`, lance `scripts\apply-update.ps1` puis se ferme. Le script installe en silence (`/VERYSILENT`, 8 min maximum), vérifie le code retour, retire le verrou ; le watchdog relance l'app. En cas d'échec, il écrit `update.failed` (la version ratée) : l'ancienne version redémarre et signale l'échec au SaaS.
- **Une seule instance** : une seconde copie de PolaKiosk lancée en même temps se ferme aussitôt.
- **Journaux** : `%LocalAppData%\PolaKiosk\watchdog.log`, `update.log` et `setup-install.log` (journal détaillé de l'installeur).

## Désinstallation

Paramètres Windows → Applications → PolaKiosk → Désinstaller. Arrête le watchdog et l'app,
retire le raccourci de démarrage s'il existe.
