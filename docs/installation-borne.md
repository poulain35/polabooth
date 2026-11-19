# Installer la borne photobooth (PolaKiosk)

La borne de Polabooth est une application Windows, PolaKiosk. Elle prend les photos, applique le
design de l'événement, imprime et envoie les photos au SaaS. Elle ne fonctionne qu'avec un SaaS
installé : faites d'abord [installation-instance.md](installation-instance.md).

Ce guide explique le matériel à prévoir, comment obtenir l'installeur et comment mettre une borne
en service.

> **Le plus simple : l'installeur prêt à l'emploi.** L'onglet **Releases** du dépôt Polabooth sur
> GitHub propose `setup-polakiosk-<version>.exe`. Il contient le kit Canon EDSDK : la borne
> fonctionne directement avec un appareil Canon, sans compte développeur Canon. Il ne porte le nom
> d'aucune entreprise : la borne demande l'adresse de votre SaaS au premier démarrage. Téléchargez-le
> et passez directement à l'étape 5. Les sections 2 à 4 servent à construire votre propre
> installeur (à votre nom, ou avec du code modifié).
>
> Les fichiers Canon de l'installeur appartiennent à Canon et ne servent qu'avec PolaKiosk : voir
> `THIRD-PARTY-NOTICES.txt`, installé avec l'application.

---

## 1. Matériel

| Élément | Conseillé | Remarques |
|---|---|---|
| PC | Windows 10 ou 11 (64 bits), 8 Go de RAM, SSD | Mini-PC ou portable. Un seul compte Windows, avec ouverture de session automatique si la borne doit démarrer toute seule (case de l'Admin, voir 5.1). |
| Écran | Écran tactile | L'interface est faite pour le tactile (gros boutons, clavier à l'écran). Testée sur un 12 pouces. |
| Appareil photo | Canon compatible EDSDK, en USB (testé : EOS R100) | Sans Canon, la borne prend la première webcam. Le kit EDSDK de Canon est inclus dans l'installeur prêt à l'emploi ; pour construire le vôtre, voir 3.2. |
| Imprimante | Imprimante photo avec pilote Windows (testé : DNP DS620, RX1-HS) | Formats 10×15 et bandes 5×15. Tout pilote Windows fonctionne s'il propose ces formats (nom « 4x6 », « 10x15 », « 2x6 »… ou taille exacte). Pour imprimer deux bandes par feuille 10×15, le pilote doit savoir couper la feuille en deux (DNP : coupe 2 pouces, voir 5.3). |
| Réseau | Wi-Fi, Ethernet ou clé 4G | Pas obligatoire pendant l'événement : les photos partent dès le retour du réseau. Il faut du réseau pour associer la borne et charger un événement (ou un fichier `.pola`, voir 6). |

L'appareil photo doit être réglé en mode photo (pas vidéo), sans mise en veille automatique, et
alimenté sur secteur si possible (adaptateur secteur Canon) : une batterie vide arrête la borne.

Mettez la molette de l'appareil sur **M** (manuel) : la borne ne règle la vitesse, l'ouverture, les
ISO et la balance des blancs qu'en mode M (administration › Caméra › « Appareil photo », voir 5.3).
Les réglages choisis sont gardés sur la borne et remis chaque fois qu'elle ouvre l'appareil.

Réglez l'exposition du Canon pour le flash, comme pour une photo normale. Sur les Canon EOS R, la
borne désactive d'elle-même la « simulation d'exposition » : l'aperçu à l'écran reste clair même si
les réglages sont faits pour le flash, et la photo garde l'exposition que vous avez choisie.

### Matériel testé

Seul ce matériel a été essayé sur une vraie borne. Un autre matériel peut fonctionner : s'il marche
chez vous, dites-le dans l'onglet **Discussions** du dépôt Polabooth pour compléter la liste.

| Matériel | Modèle | Ce qui a été vérifié |
|---|---|---|
| PC | Mini-PC sous Windows | Toute la borne (borne 1.0.18, novembre 2026) |
| Appareil photo | Canon EOS R100, en USB | Aperçu en direct clair, prise de vue au flash (borne 1.0.18) |
| Webcam | Webcam d'un PC de test | Aperçu et prise de vue, sans Canon branché |
| Imprimante | DNP DS620 | Impression 10×15, et deux bandes 5×15 coupées sur une feuille 10×15 avec le réglage « bandes coupées » (voir 5.3) ; les deux formats sur le même événement, avec le choix du cadre (borne 1.0.18) |
| Imprimante | DNP RX1-HS | Impression |
| Écran | Écran tactile 12 pouces | Toute la borne au doigt |

---

## 2. Ce qu'il faut pour construire l'installeur

Inutile avec l'installeur prêt à l'emploi (voir le début du guide).

Sur un PC Windows de développement (pas forcément la borne) :

- [SDK .NET 10](https://dotnet.microsoft.com/download) ;
- [Inno Setup 6.1 ou plus récent](https://jrsoftware.org/isdl.php) ;
- Git ;
- facultatif : le kit **Canon EDSDK** (voir 3.2).

Vérifiez dans un terminal PowerShell :

```powershell
dotnet --version     # 10.x
```

---

## 3. Préparer le code à votre nom

```powershell
git clone https://github.com/<compte>/polabooth
cd polabooth\kiosk
```

### 3.1 Les réglages de votre instance

Deux fichiers facultatifs portent le nom et les adresses de l'entreprise qui construit
l'installeur. Si le dépôt contient ces fichiers, remplacez leur contenu par le vôtre : sinon vos
bornes afficheraient les adresses d'une autre entreprise dans les QR codes et l'écran
d'association. S'ils n'existent pas, créez-les, ou passez-vous-en (voir plus bas).

**`PolaKiosk\appsettings.Instance.json`** :

```json
{
  "Kiosk": {
    "SaasUrl": "https://photobooth.mon-entreprise.fr",
    "PairingUrl": "https://photobooth.mon-entreprise.fr/associer"
  },
  "Contact": {
    "CompanyName": "Mon Entreprise",
    "Email": "contact@mon-entreprise.fr"
  }
}
```

- `SaasUrl` : l'adresse de votre SaaS (`APP_URL` dans `instance.env`). Elle sert aux QR codes de
  partage des photos.
- `PairingUrl` : facultatif. Vide, la borne prend `<SaasUrl>/associer`.
- `Contact` : affiché sur la borne tant qu'aucun événement n'a fourni le contact de votre compte.

Sans ce fichier, la borne demande l'adresse du SaaS au premier démarrage (voir 5) et utilise
celle qui est tapée.

**`installer\instance.iss`** : le nom de l'éditeur affiché par Windows (Paramètres > Applications).
Son contenu :

```
#define AppPublisher "Mon Entreprise"
```

Sans ce fichier, l'éditeur affiché est « PolaKiosk ».

Ne créez **pas** de `appsettings.Production.json` : il sert à fixer l'adresse Supabase dans
l'installeur. Sans lui, la borne lit l'adresse et la clé publique dans
`https://<votre SaaS>/kiosk-config.json`, que le script d'installation du SaaS a créé.

### 3.2 Le kit Canon EDSDK (pour un appareil Canon)

L'installeur prêt à l'emploi contient déjà ce kit. Le code source, lui, ne le contient pas :
Canon permet de distribuer ses fichiers seulement dans un logiciel, pas seuls. Pour construire
votre propre installeur avec Canon, demandez votre accès :

1. Créez un compte sur le Canon Developer Programme (recherchez « Canon EDSDK developer » ; la
   demande se fait depuis le site Canon de votre région).
2. Demandez l'accès au **EDSDK** pour Windows. La validation par Canon prend quelques jours.
3. Dans l'archive, prenez les fichiers 64 bits `EDSDK.dll` et `EdsImage.dll`
   (les versions 32 bits ne fonctionnent pas).
4. Copiez-les dans `kiosk\PolaKiosk\EDSDK\native\`.

Git ignore ce dossier : les DLL ne partent jamais dans le dépôt. Elles sont intégrées à
l'installeur si elles sont présentes, avec `THIRD-PARTY-NOTICES.txt` (mentions demandées par Canon).

Sans ces DLL, la borne fonctionne avec une webcam (1920×1080 si la webcam le permet). Utile pour
tester, moins bon pour un vrai événement.

---

## 4. Construire l'installeur

Depuis `kiosk\` :

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File installer\build.ps1
```

Le script publie l'application puis compile l'installeur avec Inno Setup. Résultat :
`installer\Output\setup-polakiosk.exe` (environ 100 Mo, .NET inclus : rien à installer sur la borne).

**Signature (facultative).** Sans signature, Windows affiche « Windows a protégé votre ordinateur »
(éditeur inconnu) au premier lancement de l'installeur téléchargé : cliquez « Informations
complémentaires » puis « Exécuter quand même ». Pour éviter cet avertissement chez vos clients ou
sur vos bornes, achetez un certificat de signature de code (Authenticode) au nom de votre société
auprès d'une autorité de certification, puis définissez avant le script `KIOSK_SIGN_CERT_THUMBPRINT`
(certificat du magasin Windows ou jeton USB), ou `KIOSK_SIGN_CERT_FILE` et
`KIOSK_SIGN_CERT_PASSWORD` (fichier `.pfx`), ou `KIOSK_SIGN_COMMAND` (service de signature dans le
cloud). Détails : `kiosk/installer/README.md`, « Signer ». Les mises à jour lancées depuis le SaaS
ne déclenchent pas cet avertissement.

Le numéro de version est celui de `PolaKiosk\PolaKiosk.csproj` (`<Version>`). Changez-le avant
chaque nouvelle version : la borne compare les numéros pour ses mises à jour.

Tests (facultatif) : `dotnet test PolaKiosk.slnx`.

---

## 5. Mettre une borne en service

### 5.1 Installer

1. Copiez `setup-polakiosk.exe` sur le PC de la borne (clé USB, ou téléchargement). Le plus simple :
   sur le PC de la borne, ouvrez le navigateur à l'adresse `https://<votre-saas>/installer-borne`.
   Elle télécharge toujours la dernière version publiée dans Bornes › Versions, sans connexion
   (adresse publique, affichée avec un bouton « Copier » dans cet onglet ; RPC
   `get_latest_kiosk_installer`, migration `20270115000000`). Aucune version publiée : la page le dit.
2. Lancez-le. Aucun droit administrateur n'est demandé : l'application s'installe pour
   l'utilisateur Windows en cours. Elle ne démarre pas avec Windows : pour qu'elle s'ouvre
   toute seule à chaque démarrage du PC, cochez « Lancer la borne au démarrage de Windows » dans
   l'Admin de la borne (carte « Démarrage de Windows »). Sinon, ouvrez-la avec l'icône PolaKiosk du
   Bureau.
3. Branchez l'appareil photo (allumé) et l'imprimante avant de lancer la borne.

### 5.2 Premier démarrage

1. **Adresse de votre SaaS** (si `appsettings.Instance.json` n'en donne pas) : tapez
   `photobooth.mon-entreprise.fr`. La borne lit `kiosk-config.json` puis redémarre.
2. **Association** : la borne affiche un code et un QR code. Scannez-le avec un téléphone (ou ouvrez
   `https://<votre SaaS>/associer` et tapez le code), connectez-vous au SaaS, nommez la borne,
   validez. La borne est liée à votre compte ; elle apparaît dans la page **Bornes**.
3. **Code PIN** de l'écran d'administration de la borne : dans le SaaS, page **Bornes** (onglet État), carte de la borne, choisissez
   un PIN (4 à 8 chiffres) pour cette borne puis « Envoyer à la borne ». Sans PIN, l'administration
   de la borne reste fermée.
4. **Imprimante et bandes coupées** (obligatoire, une seule fois) : ouvrez l'écran
   d'administration de la borne, choisissez l'imprimante, « Enregistrer », puis « Enregistrer le
   réglage bandes coupées » (détail en 5.3). **Sans ce réglage, les bandes 5×15 ne s'impriment pas
   correctement.** Faites-le dès l'installation, avant le premier événement.
5. **Code événement** : tapez le code d'accès d'un événement de votre compte (affiché sur sa fiche
   dans le SaaS). Il faut un design approuvé pour l'événement. Vous pouvez aussi envoyer
   l'événement à la borne depuis le SaaS.

### 5.3 Réglages de la borne (écran d'administration)

Ouvrez-le avec le cadenas de l'écran d'accueil, puis le PIN.

- **Imprimante** : choisissez l'imprimante dans la liste (ou l'imprimante par défaut de Windows),
  puis « Enregistrer ».
- **Bandes 5×15** (même carte) : une bande s'imprime deux fois sur une feuille 10×15 que
  l'imprimante coupe en deux. **Obligatoire dès l'installation de la borne**, sinon les bandes ne
  s'impriment pas correctement. À faire une fois par imprimante, après l'avoir enregistrée, et à
  refaire après un changement d'imprimante ou une mise à jour du pilote (la carte l'indique) :
  1. « Enregistrer le réglage bandes coupées » : la fenêtre des préférences du pilote s'ouvre.
     Cochez la coupe 2 pouces (« 2inch cut ») puis validez (OK).
  2. « Enregistrer le réglage normal » (facultatif) : dans la même fenêtre, vérifiez que la coupe
     2 pouces est décochée puis validez. Sans ce réglage, les 10×15 partent avec le réglage par
     défaut du pilote.
  3. Faites un essai avec un cadre en bande (deux bandes coupées au milieu), puis un 10×15 (feuille
     entière, non coupée).

  Emplacement de l'option dans les pilotes DNP (DS620, RX1-HS) : **à vérifier**. Elle se trouve
  dans les préférences d'impression du pilote, probablement dans un onglet d'options ou
  « Avancé » ; son nom exact (« 2inch cut » ou proche) reste à relever. Le format de papier choisi
  dans cette fenêtre n'a pas d'importance : la borne impose le 10×15 (4x6) ensuite.
  Sans réglage « bandes coupées », la borne envoie la bande seule au format 2x6. Si le pilote n'a
  pas ce papier (cas de la DS620), elle demande une taille personnalisée que le pilote imprime mal,
  et un avertissement est écrit dans les journaux (catégorie `print`, « Papier 2x6 introuvable »).
- **Décalage de l'impression** (même carte, facultatif, 1.0.23) : si la marge n'est pas la même des
  deux côtés (elle peut changer d'un rouleau de papier à l'autre), « Imprimer une feuille de test » :
  un trait tous les millimètres depuis chaque bord. Comptez les traits de chaque côté, puis décalez
  par pas de 0,5 mm (gauche / droite, haut / bas, 5 mm au plus) ; un léger agrandissement (5 % au
  plus) cache un bord blanc. Un seul réglage pour tous les formats, gardé par borne.
- **Caméra** : « Détection automatique » (Canon, sinon webcam) ou une source précise ; « Tester la caméra » montre l'image et la définition.
- **Appareil photo** (bouton de la carte Caméra, Canon seulement) : vitesse, ouverture, ISO et
  balance des blancs, avec l'aperçu et une photo de test au flash (ni gardée ni envoyée). Molette de
  l'appareil sur M obligatoire ; au-delà de 1/200, le flash risque de ne couvrir qu'une partie de la photo.
  Les mêmes réglages se font à distance dans le SaaS, page **Bornes** (onglet État), section
  « Appareil photo » de la carte de la borne : la borne les applique dès qu'aucune séance n'est en
  cours (borne en ligne, version postérieure à 1.0.19). Le dernier réglage fait, sur la borne ou dans le SaaS, gagne.
- **Photos du Canon** : petite, moyenne (conseillé) ou grande taille.
- **Nettoyage du PC** : nombre de jours avant d'effacer les photos d'un événement terminé (30 par
  défaut). Une photo pas encore envoyée n'est jamais effacée.
- **Changer de SaaS** (carte « Adresse du SaaS ») : efface l'adresse, l'association, le PIN et l'événement chargé (pour rattacher la borne à une autre
  instance).

Ces réglages restent après les mises à jour.

---

## 6. Sans réseau : le fichier `.pola`

Sur la fiche d'un événement dans le SaaS, « Télécharger .pola » produit un fichier qui contient
l'événement, son design et le logo. Copiez-le sur une clé USB, puis importez-le depuis l'écran
d'administration de la borne. La borne garde les photos et les envoie au retour du réseau.

La borne doit quand même avoir été associée une fois, avec du réseau.

La borne garde une copie des 20 derniers fichiers importés : dans l'écran d'administration,
« .pola déjà importés » → « Recharger » remet un événement en place sans clé USB. Ces copies sont
dans `%AppData%\PolaKiosk\pola-history\` (avec `history.json`, qui les décrit). Vous pouvez supprimer
ce dossier : la liste repart vide, rien d'autre ne change.

Contenu du fichier et règles de lecture : [format-pola.md](format-pola.md).

---

## 7. Mettre à jour les bornes

1. Téléchargez la nouvelle version prête à l'emploi (onglet Releases), ou construisez la vôtre
   (étape 4, avec un numéro plus grand).
2. Dans le SaaS, page **Bornes**, onglet **Versions** : indiquez le numéro, envoyez
   `setup-polakiosk.exe`, ajoutez des notes. L'installeur part dans votre stockage S3 (le bucket
   des photos, dossier `releases/`), pas dans Supabase.
3. Pour chaque borne : choisissez la version puis « Mettre à jour ».

La borne s'installe seule à sa prochaine connexion, jamais pendant une séance photo. En cas
d'échec, la carte affiche le message et l'ancienne version continue de tourner. Pour revenir en
arrière, demandez une version plus ancienne.

Détails techniques (watchdog, journaux, rollback) : `kiosk/installer/README.md`.

---

## 8. En cas de problème

| Symptôme | Que faire |
|---|---|
| « Adresse de votre SaaS » refusée | Ouvrez `https://<votre SaaS>/kiosk-config.json` dans un navigateur : il doit s'afficher. Sinon, voir l'étape 6 de [installation-instance.md](installation-instance.md). |
| Les QR codes ou l'association mènent au site d'une autre entreprise | `appsettings.Instance.json` contient encore les adresses d'une autre entreprise (3.1). Corrigez-le ou supprimez-le, puis reconstruisez l'installeur. |
| « Problème technique » sur l'accueil | L'appareil photo n'est pas détecté : vérifiez le câble USB, l'alimentation, le mode photo. Le SaaS est prévenu (carte de la borne). |
| La borne prend la webcam au lieu du Canon | Installeur construit sans les DLL EDSDK (3.2 ; l'installeur prêt à l'emploi les contient), ou caméra forcée sur webcam dans l'administration. |
| « Mettez la molette de l'appareil sur M » dans « Appareil photo » | La molette du Canon est sur un autre mode : tournez-la sur M. Les réglages gardés sont remis la prochaine fois que la borne ouvre l'appareil (journaux, catégorie `camera`). |
| Administration fermée | Définissez et envoyez le PIN depuis le SaaS (5.2, point 3). La borne doit avoir du réseau pour le recevoir. |
| Rien ne s'imprime | Imprimante choisie dans l'administration ? Papier et ruban chargés ? Testez une impression depuis Windows. |
| Bandes imprimées une seule fois, ou feuille non coupée | Réglage « bandes coupées » absent ou refusé (autre imprimante, pilote changé) : la carte Imprimante de l'administration l'indique, comme les journaux (catégorie `print`). Enregistrez-le à nouveau (5.3) et vérifiez que la coupe 2 pouces est cochée. |
| Un 10×15 sort coupé en deux | Le réglage « normal » a été enregistré avec la coupe cochée, ou le réglage par défaut du pilote la contient : enregistrez le réglage normal, coupe décochée (5.3). |
| Photo agrandie et rognée, ou imprimée sur un autre format | Le pilote ne propose pas le papier attendu. Dans les journaux de la borne (catégorie `print`), au premier tirage : la liste des formats du pilote, puis le format retenu ou « Papier … introuvable ». Choisissez un pilote qui propose le 10×15 (4x6) et la bande (2x6). |
| Photos absentes de la galerie en ligne | La borne était hors ligne : elles partent au retour du réseau. Le nombre d'envois en attente s'affiche sur la carte de la borne dans le SaaS. |

Journaux de la borne : `%LocalAppData%\PolaKiosk\` (`fatal.log`, `watchdog.log`, `update.log`).
Les erreurs sont aussi envoyées au SaaS (journaux de la borne).

Pour quitter l'application sur la borne : écran d'administration, « Quitter vers Windows » (le mode
kiosk bloque le clavier tant qu'il est actif). La borne ne se relance pas toute seule ; elle repart en
lançant PolaKiosk à la main, ou à la prochaine ouverture de session Windows si la case « Lancer la
borne au démarrage de Windows » est cochée. Fermée autrement (plantage,
fenêtre fermée), elle est relancée par le watchdog en 15 secondes au plus. Pour la désinstaller : Paramètres Windows > Applications > PolaKiosk.
