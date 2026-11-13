# Installer la borne photobooth (PolaKiosk)

La borne de Polabooth est une application Windows, PolaKiosk. Elle prend les photos, applique le
design de l'événement, imprime et envoie les photos au SaaS. Elle ne fonctionne qu'avec un SaaS
installé : faites d'abord [installation-instance.md](installation-instance.md).

Ce guide explique le matériel à prévoir, comment construire l'installeur à votre nom et comment
mettre une borne en service.

---

## 1. Matériel

| Élément | Conseillé | Remarques |
|---|---|---|
| PC | Windows 10 ou 11 (64 bits), 8 Go de RAM, SSD | Mini-PC ou portable. Un seul compte Windows, avec ouverture de session automatique (la borne démarre à la connexion de l'utilisateur). |
| Écran | Écran tactile | L'interface est faite pour le tactile (gros boutons, clavier à l'écran). Testée sur un 12 pouces. |
| Appareil photo | Canon compatible EDSDK, en USB (testé : EOS R100) | Sans Canon, la borne prend la première webcam. Il faut le kit EDSDK de Canon (voir 3.2). |
| Imprimante | Imprimante photo avec pilote Windows (testé : DNP DS620, RX1-HS) | Formats 10×15 et bandes 5×15. Tout pilote Windows fonctionne. |
| Réseau | Wi-Fi, Ethernet ou clé 4G | Pas obligatoire pendant l'événement : les photos partent dès le retour du réseau. Il faut du réseau pour associer la borne et charger un événement (ou un fichier `.pola`, voir 6). |

L'appareil photo doit être réglé en mode photo (pas vidéo), sans mise en veille automatique, et
alimenté sur secteur si possible (adaptateur secteur Canon) : une batterie vide arrête la borne.

---

## 2. Ce qu'il faut pour construire l'installeur

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

Canon ne permet pas de redistribuer ce kit : chacun doit le demander.

1. Créez un compte sur le Canon Developer Programme (recherchez « Canon EDSDK developer » ; la
   demande se fait depuis le site Canon de votre région).
2. Demandez l'accès au **EDSDK** pour Windows. La validation par Canon prend quelques jours.
3. Dans l'archive, prenez les fichiers 64 bits `EDSDK.dll` et `EdsImage.dll`
   (les versions 32 bits ne fonctionnent pas).
4. Copiez-les dans `kiosk\PolaKiosk\EDSDK\native\`.

Git ignore ce dossier : les DLL ne partent jamais dans le dépôt. Elles sont intégrées à
l'installeur si elles sont présentes.

Sans ces DLL, la borne fonctionne avec une webcam (1920×1080 si la webcam le permet). Utile pour
tester, moins bon pour un vrai événement.

---

## 4. Construire l'installeur

Depuis `kiosk\` :

```powershell
dotnet publish PolaKiosk\PolaKiosk.csproj -c Release -r win-x64 --self-contained true
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\PolaKiosk.iss
```

Résultat : `installer\Output\setup-polakiosk.exe` (environ 100 Mo, .NET inclus : rien à installer
sur la borne).

Le numéro de version est celui de `PolaKiosk\PolaKiosk.csproj` (`<Version>`). Changez-le avant
chaque nouvelle version : la borne compare les numéros pour ses mises à jour.

Tests (facultatif) : `dotnet test PolaKiosk.slnx`.

---

## 5. Mettre une borne en service

### 5.1 Installer

1. Copiez `setup-polakiosk.exe` sur le PC de la borne (clé USB, ou téléchargement).
2. Lancez-le. Aucun droit administrateur n'est demandé : l'application s'installe pour
   l'utilisateur Windows en cours et démarre avec sa session.
3. Branchez l'appareil photo (allumé) et l'imprimante avant de lancer la borne.

### 5.2 Premier démarrage

1. **Adresse de votre SaaS** (si `appsettings.Instance.json` n'en donne pas) : tapez
   `photobooth.mon-entreprise.fr`. La borne lit `kiosk-config.json` puis redémarre.
2. **Association** : la borne affiche un code et un QR code. Scannez-le avec un téléphone (ou ouvrez
   `https://<votre SaaS>/associer` et tapez le code), connectez-vous au SaaS, nommez la borne,
   validez. La borne est liée à votre compte ; elle apparaît dans « Parc kiosk ».
3. **Code PIN** de l'écran d'administration de la borne : dans le SaaS, « Parc kiosk », carte de la borne, choisissez
   un PIN (4 à 8 chiffres) pour cette borne puis « Envoyer à la borne ». Sans PIN, l'administration
   de la borne reste fermée.
4. **Code événement** : tapez le code d'accès d'un événement de votre compte (affiché sur sa fiche
   dans le SaaS). Il faut un design approuvé pour l'événement. Vous pouvez aussi envoyer
   l'événement à la borne depuis le SaaS.

### 5.3 Réglages de la borne (écran d'administration)

Ouvrez-le avec le cadenas de l'écran d'accueil, puis le PIN.

- **Imprimante** : choisissez l'imprimante dans la liste (ou l'imprimante par défaut de Windows).
- **Caméra** : « Détection automatique » (Canon, sinon webcam) ou une source précise ; « Tester la caméra » montre l'image et la définition.
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

Contenu du fichier et règles de lecture : [format-pola.md](format-pola.md).

---

## 7. Mettre à jour les bornes

1. Construisez la nouvelle version (étape 4, avec un numéro plus grand).
2. Dans le SaaS, « Parc kiosk » > « Versions kiosk » : indiquez le numéro, envoyez
   `setup-polakiosk.exe`, ajoutez des notes. L'installeur part dans votre stockage S3 (le bucket
   des photos, dossier `releases/`), pas dans Supabase.
3. Sur la carte de chaque borne : choisissez la version puis « Mettre à jour ».

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
| La borne prend la webcam au lieu du Canon | DLL EDSDK absentes de l'installeur (3.2), ou caméra forcée sur webcam dans l'administration. |
| Administration fermée | Définissez et envoyez le PIN depuis le SaaS (5.2, point 3). La borne doit avoir du réseau pour le recevoir. |
| Rien ne s'imprime | Imprimante choisie dans l'administration ? Papier et ruban chargés ? Testez une impression depuis Windows. |
| Photos absentes de la galerie en ligne | La borne était hors ligne : elles partent au retour du réseau. Le nombre d'envois en attente s'affiche sur la carte de la borne dans le SaaS. |

Journaux de la borne : `%LocalAppData%\PolaKiosk\` (`fatal.log`, `watchdog.log`, `update.log`).
Les erreurs sont aussi envoyées au SaaS (journaux de la borne).

Pour quitter l'application sur la borne : écran d'administration (le mode kiosk bloque le clavier
tant qu'il est actif). Pour la désinstaller : Paramètres Windows > Applications > PolaKiosk.
