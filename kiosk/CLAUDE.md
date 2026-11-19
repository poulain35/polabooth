# CLAUDE.md — PolaKiosk (borne Windows de Polabooth)

## Contexte

Application Windows plein écran installée sur le PC de chaque borne. Elle complète le SaaS
(`saas/`, voir `saas/CLAUDE.md`) et utilise le même backend Supabase.

**Ce qu'elle fait :**
- photos avec un appareil Canon en USB (EDSDK), ou une webcam, ou une caméra simulée (mock) ;
- applique le design approuvé dans le SaaS (zones photo + décor PNG) et propose des effets ;
- imprime sur l'imprimante photo Windows, partage par QR code et email ;
- fonctionne hors ligne (SQLite local, envois différés, import de fichiers `.pola`) ;
- administration protégée par un code PIN ;
- mises à jour sur demande depuis le SaaS, relance par un watchdog.

**Ce qu'elle ne fait pas :** créer des modèles, gérer les clients ou la galerie (tout cela se fait
dans le SaaS).

Installation d'une borne : `docs/installation-borne.md`.

---

## Stack

| Couche | Technologie |
|---|---|
| UI | WPF, .NET 10 (`net10.0-windows`), C# |
| Architecture | MVVM (CommunityToolkit.Mvvm) + injection via `Host.CreateDefaultBuilder` |
| Prise de vue | Canon EDSDK (P/Invoke), OpenCvSharp4 (webcam) |
| Base locale | SQLite via EF Core |
| Backend | Supabase, appelé en REST / RPC par `HttpClient` (clé anon) |
| Image | SkiaSharp (montage, effets), QRCoder (QR code) |
| Impression | `System.Drawing.Printing.PrintDocument` ; état via `System.Printing` |
| Installeur | Inno Setup (installation par utilisateur) |

Paquets NuGet : toujours une version exacte dans le `.csproj` (pas de `*`). Tests : xunit v3
(paquet `xunit.v3.mtp-off`, pour garder `dotnet test` classique), FluentAssertions 8, Moq 4.

---

## Arborescence

```
kiosk/
├── PolaKiosk.slnx                 ← solution
├── docs/checklist-tests-terrain.md
├── installer/                     ← PolaKiosk.iss (Inno Setup), instance.iss facultatif (éditeur),
│                                    build.ps1 (construction), sign.ps1 (signature facultative)
├── scripts/                       ← watchdog.ps1, apply-update.ps1, fetch-ffmpeg.ps1 (ffmpeg LGPL vérifié)
├── PolaKiosk/
│   ├── App.xaml(.cs)              ← démarrage, DI, erreurs globales ; App.xaml = couleurs, polices, styles
│   ├── KioskFonts.cs, Assets/Fonts/  ← polices embarquées (Fraunces, DM Sans, licences OFL)
│   ├── MainWindow.xaml(.cs)       ← fenêtre hôte plein écran
│   ├── AppSettings.cs             ← sections Supabase / Kiosk / Camera / Contact + InstanceSettings
│   ├── Views/                     ← SaasAddress, Splash, Update, Pairing, EventSetup, EventLoading,
│   │                                Home, Rgpd, Live, Questionnaire, EffectSelect, Result, Gallery, Admin
│   ├── ViewModels/                ← un ViewModel par vue (sauf Splash et Update) + paramètres de navigation
│   ├── Services/                  ← une interface I* par service injecté (caméra, montage, impression,
│   │                                séances, synchro, licence, association, mises à jour, navigation…)
│   ├── Models/LocalDb/            ← AppDbContext + entités SQLite
│   ├── Models/Supabase/           ← DTO (EventDto, KioskConfigDto, QuestionnaireConfig…)
│   ├── EDSDK/                     ← EDSDK.cs (P/Invoke), EdsdkTypes.cs ; native/ = DLL Canon, NON versionnées
│   ├── Controls/                  ← TouchKeyboard (clavier tactile) + KioskTextBox
│   └── Converters/
└── PolaKiosk.Tests/               ← Services/, Controls/, Fonts/, ViewModels/
```

---

## Architecture MVVM

Pattern : **View → ViewModel → Service → Model**. Vues et ViewModels sont enregistrés en transient ;
les paramètres de navigation arrivent par `IParameterReceiver`.

- Un ViewModel ne référence jamais un élément XAML.
- La navigation passe par `INavigationService` (`NavigateTo<TView>()`, `NavigateTo<TView>(param)`,
  `GoBack()`). Arriver sur Home ou EventSetup vide l'historique (10 écrans au plus sinon) ; chaque
  écran quitté voit son ViewModel libéré par `IReleasable.Release()`. Pas d'`IDisposable` sur les
  ViewModels (le conteneur garderait les transients jusqu'à la fermeture).
- Images affichées : toujours par `ImageLoader` (décodage à la taille de l'écran ou de la vignette,
  `Freeze`, hors du fil d'affichage). Jamais de `BitmapImage` pleine résolution.
- **Pas de `MessageBox`** (bloquant sur une borne) : erreur affichée dans la vue (propriété
  observable effacée après quelques secondes), puis retour à un écran sûr.
- Dépendre des interfaces (`IPrintService`, `ICameraService`…), pas des classes concrètes.

---

## Caméra

### Choix de la source
`CameraDetectionService.SelectBestCamera` : Canon si `EDSDK.dll` est présent à côté de l'exe, sinon
première webcam, sinon mock. L'écran Admin peut forcer la source (`canon` / `webcam` / `mock` + index
de la webcam), gardée dans `machine-settings.json`. Webcam : 1920×1080 demandé, définition relue
après ouverture, avertissement sous 1280×720.

`CameraHealthService` : appareil présent / absent / inconnu, vérifié au démarrage, à chaque
affichage de l'accueil puis toutes les 30 s. Absent → l'accueil affiche « Problème technique »,
séance impossible ; l'état part au heartbeat.

### DLL Canon
`PolaKiosk/EDSDK/native/EDSDK.dll` et `EdsImage.dll`, copiées à la racine de la sortie.
**Jamais dans le dépôt** : ne jamais les committer ni les modifier. L'installeur prêt à l'emploi
(onglet Releases) les contient, avec `installer/THIRD-PARTY-NOTICES.txt` (mentions demandées par
Canon : fichiers de Canon, utilisables seulement avec PolaKiosk). Pour construire un installeur
avec Canon, chacun demande son accès au programme développeur de Canon.

### ffmpeg (animations)
`PolaKiosk/ffmpeg/ffmpeg.exe` (build LGPL de BtbN, version figée), copié à la racine de la sortie.
**Jamais dans le dépôt** (environ 126 Mo) : `scripts/fetch-ffmpeg.ps1` le télécharge, vérifie les
empreintes SHA-256, refuse un build GPL ou nonfree et exige l'encodeur `h264_mf` ou `libopenh264`.
`installer/build.ps1` le lance avant la publication ; l'installeur refuse de se construire sans
ffmpeg et installe ses licences (`installer/licenses/ffmpeg/`) ; `THIRD-PARTY-NOTICES.txt` donne la
version et l'adresse des sources. `AnimationService` crée la vidéo (MP4 H.264, yuv420p,
`+faststart`, dimensions paires) et l'affiche JPEG, avec délai maximal et annulation, sans jamais
lever d'exception (journaux catégorie `animation_encode`). Admin › Borne : « Animations : … ».

### Prise de vue (`EdsdkCameraService`)
Toutes les opérations EDSDK passent par **un thread STA dédié** (file d'attente bloquante).
```
InitializeAsync    → EdsInitializeSDK → liste des appareils → EdsOpenSession
                     → SaveTo = Host + EdsSetCapacity (sinon la photo reste sur la carte)
                     → qualité d'image selon l'Admin (M JPEG fin par défaut)
StartLiveViewAsync → sortie EVF vers le PC → boucle EdsDownloadEvfImage
CaptureAsync       → prise ouverte (CaptureSlot) → TakePicture, repli PressShutterButton
                     → pompe EdsGetEvent jusqu'à l'arrivée de la photo (15 s) → téléchargement
                     → fichier photo_yyyyMMdd_HHmmss_fff_{guid8} (écriture atomique)
ShutdownAsync      → fermeture de session + EdsTerminateSDK (dans OnExit)
```
- Chaque référence EDSDK est libérée, y compris en cas d'erreur.
- Délai dépassé : la prise est close ; une photo qui arrive ensuite est refusée
  (`EdsDownloadCancel`), jamais attribuée à la prise suivante.
- Appareil éteint ou débranché : la prise en cours échoue tout de suite, la session est fermée.
- Taille des photos (`CanonPhotoSize`, réglage Admin) : `small` (S1), `medium` (M, défaut), `full` (L).

### Écran de prise de vue (`LiveViewModel`)
- Compte à rebours `capture.countdown_seconds` (5 par défaut), une capture par zone photo, flash.
- Zones lues par `ICompositeService.GetPhotoZonesAsync` (en cache) ; `CompositeService.ParsePhotoZones`
  est la seule fonction d'analyse.
- Écran quitté pendant la prise ou le montage : ni montage ni navigation (jeton d'annulation).
- En cas d'échec : message 6 s puis retour à l'accueil.

---

## Montage photo + design

Le design approuvé (RPC `kiosk_get_approved_design`) fournit `canvas_json`, `format` et
`final_png_url` (décor PNG transparent aux zones).

### Zones photo
Objets de `canvas_json.objects` marqués **`isPhotoZone: true`**, y compris dans un `group`
(récursivement). La borne reproduit la matrice de Fabric 5.3 : position relative au centre du
groupe, `left`/`top`, `originX`/`originY`, `scaleX`/`scaleY`, `angle`, miroirs. Ordre des zones =
ordre d'empilement. Même géométrie côté SaaS (`saas/src/lib/photoZones.js`) : les tests des deux
côtés partagent les mêmes cas. Le SaaS utilise Fabric 7 mais force les défauts de Fabric 5
(`saas/src/lib/fabric.js` : origine `left`/`top`, types en minuscules) : la borne garde la géométrie
de Fabric 5.3.

### Formats et conversion
| Format | Canvas SaaS (px) | Montage (px) | Impression (mm) | Papier |
|---|---|---|---|---|
| portrait | 400 × 600 | 2400 × 3600 | 100 × 150 | 4x6 |
| landscape | 600 × 400 | 3600 × 2400 | 150 × 100 | 4x6 |
| stripV | 200 × 600 | 1200 × 3600 | 50 × 150 | 2x6 |
| stripH | 600 × 200 | 3600 × 1200 | 150 × 50 | 2x6 |

`scale = printWidthPx / canvasWidthPx`. Le montage est à la taille du PNG exporté par le SaaS
(canvas × 6, `PrintFormats.ExportScale`) : le décor est dessiné tel quel, sans redimensionnement,
et seul le pilote de l'imprimante réduit à sa résolution.

### Assemblage (`CompositeService`, SkiaSharp)
1. Chaque photo est recadrée en « cover » dans sa zone (moins de photos que de zones : la dernière
   est répétée). Modèle sans zone : la photo occupe tout le cadre.
2. Le PNG du design est dessiné par-dessus, à sa taille (photos agrandies en Catmull-Rom).
3. Export JPEG (qualité 92, couleurs en pleine définition 4:4:4, `KioskJpeg`), nom unique `composite_…_{guid8}.jpg`, écriture atomique.
4. Vignette 320 px dans `composites\thumbs\` pour la galerie.

SkiaSharp alloue des ressources natives : toujours `using` / `Dispose()`.

### Écritures de fichiers
`AtomicFile` (fichier temporaire du même dossier, vidé sur disque, puis `File.Move` avec écrasement)
pour `state.json`, `machine-settings.json`, `license.json`, les fichiers DPAPI, les photos et
montages. Jamais `File.OpenWrite` (ne tronque pas l'ancien contenu). Noms uniques :
`UniqueFileName.Create(prefixe, extension)`.

---

## Réglages de l'événement (`form_config.kiosk`, `KioskConfigDto`)

Champs utilisés :
- `home.background_url`, `home.personalized`, `home.display_name`, `home.buttons.*` (formats proposés ;
  photo et GIF gérés, `HomeScreen.SupportedFormats` ; tuile GIF masquée si ffmpeg n'est pas prêt ;
  boomerang pas encore géré)
- `capture.countdown_seconds`
- `capture.gif.shots` (3 à 6, défaut 4) et `capture.gif.interval_ms` (500 à 3000, défaut 1000) :
  photos du GIF et intervalle entre deux (lecture tolérante : hors bornes = défaut)
- `rgpd.enabled`, `rgpd.message`
- `effects.enabled_effects`, `effects.default_effect`, `effects.user_can_choose`
  (none, bw, sepia, vintage, vignette, bright)
- `result.max_prints_per_event`, `result.max_prints_per_photo`, `result.auto_return_seconds`
  (0 = désactivé), `result.show_remaining_prints`, `result.buttons` (retake, print, qr, email, home :
  `enabled` seulement, textes fixes)
- `email.enabled` (envoi par la fonction `send-kiosk-photo`)
- `questionnaire.*` (miroir de `saas/src/lib/kioskQuestionnaire.js`) : lecture tolérante
  (`QuestionnaireConfigConverter`), 8 questions / 12 options / 120 caractères au plus.

Les couleurs de la borne sont fixes : un ancien `theme` est ignoré. `form_config.kiosk` est édité
dans le SaaS : **vérifier l'effet côté SaaS avant de changer un champ.**

---

## Données locales

`%AppData%\PolaKiosk\polakiosk.db` (SQLite, WAL). Créée par `EnsureCreatedAsync` ; les tables
manquantes sont créées complètes, puis `LocalDbSchema.UpgradeAsync` ajoute à une base existante les
colonnes de `LocalDbSchema.AddedColumns` qui lui manquent (sans perte) : **y ajouter toute nouvelle
colonne d'une table existante**, et dans `LocalDbSchemaTests`. `Sessions` porte le type de séance
(`MediaType` : `photo` ou `gif`), le clip et l'affiche d'un GIF, sa durée et sa taille, et
`UploadRejected` (refus définitif du serveur).
Tables : `Events`, `Templates`, `Sessions`, `PrintCounts`, `PrintLogs`, `KioskLogs`, `GuestResponses`,
`PhotoConsents`.

Autres fichiers de `%AppData%\PolaKiosk` : `state.json` (événement actif, compte de la borne),
`license.json` (signé HMAC), `license.key`, `activation.bin` et `admin-pin.bin` (chiffrés DPAPI),
`machine-settings.json`, `templates/` (PNG des designs), `backgrounds/`, `logo/`, `pola/` (copie de
chaque `.pola` importé), `pending/{sessionId}/` (photo en attente du questionnaire obligatoire),
`events/{nom}_{id8}/originals|composites|composites\thumbs|animations\{sessionId}` (GIF : `clip.mp4`
et `poster.jpg`).

`%LocalAppData%\PolaKiosk` : `watchdog.log`, `fatal.log`, `update.log`, `updates/`, `update.lock`,
fichiers d'état des mises à jour.

**Nettoyage du PC** (`EventCleanupService`) : au démarrage puis une fois par jour, le dossier d'un
événement terminé est supprimé après le délai de l'Admin (30 jours par défaut). Jamais l'événement
actif, jamais un événement dont une séance n'est pas envoyée, uniquement un dossier
`{nom}_{id8}` sous `events\` (garde-fou de chemin testé).

---

## Supabase

Tous les appels passent par `HttpClient` avec `apikey` + `Bearer` = clé anon. **Jamais de clé
`service_role`.** Seule exception : le PUT vers le stockage (URL présignée), sans ces en-têtes, en
flux, avec un délai selon la taille du fichier (10 min au moins pour un clip).

| Usage | Appel |
|---|---|
| Événement par code | RPC `kiosk_get_event {p_code, p_machine_id, p_secret}` → `{id, org_id, name, access_code, start_date, end_date, form_config: {kiosk}}` ; `42501` → licence refusée ; `null` → « Ce code ne correspond à aucun événement de votre compte. » |
| Association | RPC `kiosk_pairing_start {p_machine_id, p_machine_name, p_app_version, p_device_key_hash}` puis `kiosk_pairing_poll {p_pairing_id, p_device_key}` (statut ; `approved` porte le secret **une seule fois**) |
| Design approuvé | RPC `kiosk_get_approved_design {p_machine_id, p_secret, p_event_id}` → `{id, format, canvas_json, final_png_url}` ou `null` |
| URL d'envoi | `POST functions/v1/get-kiosk-upload-url` → `presigned_url`, `storage_path`, `public_url`, `content_type` ; GIF : `kind` = `poster` (affiche) puis `media` (clip) |
| Envoi | `PUT {presigned_url}` avec `Content-Type` = `content_type` |
| Enregistrer la photo | RPC `kiosk_record_photo {p_code, p_event_id, p_storage_path, p_photo_url, p_machine_id, p_secret, p_captured_at}` ; GIF : en plus `p_media_type`, `p_thumbnail_path`, `p_duration_ms`, `p_width`, `p_height` ; `22023` = refus définitif |
| Contact du loueur | RPC `get_org_contact_by_event {p_event_id}` → société, téléphone, email, `logo_url` |
| Consentement photo | RPC `kiosk_record_photo_consent` (idempotente ; `22023` = refus définitif) |
| Réponse au questionnaire | RPC `kiosk_record_guest_response` (idempotente ; `22023` = refus définitif) |
| Impression | RPC `kiosk_record_print` (idempotente, renvoie `true` aussi pour un doublon) |
| Email | `functions/v1/send-kiosk-photo` |
| Journaux | RPC `kiosk_record_logs {p_machine_id, p_secret, p_logs}` → nombre de lignes enregistrées (100 lignes par lot, idempotente sur `id` ; `42501` = licence refusée, `PT429` = plus de 600 lignes / 15 min) |
| Licence / état | RPC `kiosk_check_license`, `kiosk_heartbeat` (version, imprimante, envois en attente, appareil photo) |
| PIN admin | RPC `kiosk_get_admin_pin` → `pin_hash`, `pin_set_at` |
| Mise à jour | RPC `kiosk_get_update_request`, `kiosk_report_update_failure` |
| Événement envoyé | RPC `kiosk_get_event_request`, `kiosk_ack_event_request` |
| Écran de saisie du code | `kiosk-backgrounds/default/setup_config.json` (Storage public) |

QR code : `{SaasUrl}/photos/{accessCode}?photo={photoId}&via=qr` (`via=qr` compte les scans).

### Synchronisation (`SyncService`)
- `SyncByCodeAsync(code)` : événement → design approuvé téléchargé → contact. **Sans réseau
  seulement** (pas de réponse HTTP ou délai dépassé), repli sur `DataDirectory\pola\*.pola`
  (recherche par `access_code`). Une erreur 4xx / 5xx de Supabase est remontée telle quelle.
- `ImportPolaFileAsync` : `PolaBundle.Parse` vérifie tout avant d'écrire (ancien format, fichier
  sans design ou illisible → message affichable, rien n'est écrit). Format : `docs/format-pola.md`.
- Toutes les méthodes réseau prennent un `CancellationToken` transmis jusqu'aux appels HTTP.
- `NetworkMonitorService` : contrôle toutes les 15 s et à chaque changement réseau ; un seul
  `NetworkRestored` par retour du réseau.
- Au retour du réseau, `OnlineSyncService` envoie séances, réponses, consentements, impressions et
  journaux, puis resynchronise. Chaque étape est isolée : une erreur n'arrête pas les suivantes.

### Séances photo (`SessionService`)
- Après le montage, la séance est enregistrée (`Uploaded = false`) ; son id est écrit dans
  `{montage}.share.json`. `CapturedAt` = début de la séance (UTC).
- Envoi : URL `get-kiosk-upload-url`, PUT, puis `kiosk_record_photo`. En échec ou hors ligne, la
  séance reste en attente (retour du réseau ou cycle de 2 min).
- Chemin : `photos/{slug-événement}-{8 car. de l'id}/{sessionId}/{fichier}` ; un renvoi reçoit le
  même chemin, donc pas de doublon. Un seul envoi à la fois par séance : un clip lent ne retarde
  pas le QR de l'invité suivant.
- GIF : affiche, puis clip MP4, puis une seule ligne `photos` (`media_type = gif`) ; clip ou affiche
  manquant → le montage part comme une photo. Photos envoyées avant les animations. Refus `22023`
  → séance sortie de la file, fichiers gardés, journalisé.
- Questionnaire obligatoire : poses et montage dans `pending\{sessionId}\`, **aucune séance ni
  envoi avant la validation** ; abandon = dossier supprimé.

Toute modification de schéma : migration dans `saas/supabase/migrations/` et vérification de
l'effet sur le SaaS.

---

## Démarrage (`App.OnStartup`)

1. Gestionnaires d'erreurs globales en tout premier, puis mutex d'instance unique.
2. Hôte, base SQLite, nettoyage des photos en attente, fenêtre sur Splash.
3. Contrôle du réseau (3 s max). En ligne : resynchro bornée, demande de mise à jour (installée
   seulement si le SaaS l'a demandée), événement envoyé depuis le SaaS. Tout échec est journalisé
   et le démarrage continue.
4. Écran (`StartupFlow`) : SaasAddress sans adresse Supabase ; Pairing si la licence n'est pas
   valide ; Home si un événement envoyé vient d'être chargé ou si l'événement actif est en base ;
   sinon EventSetup.
5. Boucle de fond toutes les 2 min : heartbeat, nettoyage, réponses, consentements, licence (un
   refus explicite du serveur renvoie à Pairing ; une coupure réseau n'est jamais un refus),
   impressions, séances, mise à jour. L'événement envoyé a sa propre boucle de 20 s (Home et
   EventSetup, en ligne seulement). Chaque étape est protégée séparément.

Erreurs : `fatal.log` reçoit toutes les erreurs globales. Erreur sur le fil d'affichage → retour à
Home ou EventSetup ; plus de 5 en une minute → arrêt (`Environment.Exit(1)`), le watchdog relance.

---

## Identité visuelle

Couleurs **fixes**, dans `App.xaml` : dans les vues, toujours passer par les clés (`KioskCream`,
`KioskPaper`, `KioskForest`, `KioskSage`, `KioskMint`, `KioskBlush`, `KioskBrown`, `KioskDark`,
`KioskError…`), jamais de couleur en dur (exceptions : blanc pur du flash et du fond des QR codes).

- Polices embarquées (`Assets/Fonts/`, licences OFL) : titres Fraunces, texte DM Sans. WPF ignore
  les axes des polices variables : n'embarquer que des fichiers statiques. Un nom de famille faux
  ne lève aucune erreur (repli sur Segoe UI) : d'où `KioskFontsTests`.
- Styles communs : `KioskPrimaryButton`, `KioskSecondaryButton`, `KioskOutlineButton`,
  `KioskBackButton`, `KioskTile`, `KioskPill`, `KioskTextField`… Cibles tactiles ≥ 44 px.
- Pas d'arrondi « 999 » pour une pastille : WPF dessine une ellipse. Rayon = moitié de la hauteur.
- Dans un `ControlTemplate` des ressources d'une vue, ne pas référencer une ressource d'App de type
  valeur (`CornerRadius`) en `StaticResource` : plantage au rendu.
- L'administration garde un fond sombre.

---

## Écrans

```
SaasAddress (aucune adresse Supabase) : adresse du SaaS tapée → lecture de
  https://<adresse>/kiosk-config.json → enregistrée dans machine-settings.json → redémarrage → Pairing
Splash → (Update si demandée) → Pairing | EventSetup | Home
Pairing : QR code {PairingUrl}?code=XXXXXX + code « XXX-XXX », suivi toutes les 3 s ; validé →
  secret en DPAPI → EventSetup
EventSetup : code d'accès → EventLoading → Home
Home → Rgpd (si activé ; refus = retour, rien d'écrit) → Live
Live → Questionnaire (si actif) → EffectSelect (si l'invité choisit) → Result
Result : imprimer, email, QR code, refaire, terminer ; retour automatique
Home → Gallery → Result (même séance, sans « Refaire »)
Home / EventSetup → pavé PIN → Admin : menu à gauche, quatre sections une à la fois (Événement,
  Imprimante, Caméra, Borne), défilement au doigt ; choix en tuiles enregistrés au toucher (tuile
  choisie au relâcher si le doigt n'a pas glissé) ; événement, imprimante, caméra, taille des photos,
  nettoyage, import .pola, changer de SaaS
```

- **Accueil** (`HomeScreen.ResolveLayout`, testé) : neutre, personnalisé (nom et date), ou choix
  du format. Logo du loueur en cache, sinon le nom de la société, sinon « Photobooth ».
- **Questionnaire** : une question par écran, clavier tactile selon le type ; mode obligatoire
  (sans réponse, la photo n'est ni imprimée ni partagée) ou facultatif (« Passer »). Réponses
  chiffrées DPAPI dans `GuestResponses`, envoyées puis supprimées ; purge locale à 30 jours.
  Journaux : nombres et codes seulement, jamais de réponse ni d'email.
- **Consentement photo** : un refus n'est jamais enregistré ; l'accord est écrit avec chaque
  séance, dans la même transaction. Aucune donnée personnelle. Purge locale à 90 jours.
- **Résultat** : impression avec − / + bornée par les quotas ; email et QR code grisés tant que la
  photo n'est pas en ligne ; case d'accord de l'email toujours décochée à l'ouverture.
- `IdleTimeoutService` n'agit que sur Result, EffectSelect et Gallery ; jamais pendant Live ni
  Questionnaire (qui ont leurs propres minuteries).

### Clavier tactile (`Controls/TouchKeyboard`)
Le clavier de Windows marche mal en mode kiosk : la borne a le sien. Il écrit directement dans le
champ (`KioskTextBox`, que Windows ne prend pas pour un champ d'édition), ses touches ne prennent
jamais le focus. Dispositions : texte (AZERTY), email, email sans Entrée, téléphone. Logique sans
WPF et testée : `TouchKeyboardEditor`, `TouchKeyboardLayouts`, `EmailDomainSuggestions`.

---

## Mode kiosk et PIN

- `MainWindow` : sans bordure, maximisée. `Kiosk.KioskMode = true` **par défaut** ; seul
  `appsettings.Development.json` le passe à `false`. Actif : `Topmost`, hook clavier (Win, Alt+F4,
  Alt+Tab…), fermeture annulée. L'écran Admin le désactive, le retour le réactive.
- PIN admin **propre à chaque borne** (4 à 8 chiffres), défini dans le SaaS. La borne ne reçoit que
  le hash PBKDF2-SHA256 (`pbkdf2$iterations$sel_b64$hash_b64`), le garde chiffré DPAPI et compare en
  temps constant ; 5 essais puis blocage 30 s. **Sans PIN reçu, l'Admin est bloqué.** PIN de dev :
  `Kiosk.DevAdminPin`, lu seulement en Debug **et** en environnement Development.

---

## Licence, mises à jour, watchdog

- **Licence** : `MachineId` = `MachineGuid` de Windows. Secret reçu à l'association, gardé chiffré
  DPAPI dans `activation.bin`. `LicenseService.CheckAsync` → `Valid`, `Refused` ou `Unverified`.
  Cache `license.json` **signé HMAC-SHA256** (clé DPAPI) : cache modifié, d'une autre machine ou daté
  dans le futur → rejeté. Valable hors ligne `Kiosk.LicenseGraceDays` jours (14).
- Un `.pola` dont `event.org_id` n'est pas celui de la borne est refusé (« Ce fichier vient d'un
  autre compte. »).
- **Mises à jour** : uniquement sur demande du SaaS, installées seulement hors séance invité
  (`UpdateCoordinator.CanApplyNow` : Splash, EventSetup ou Home). Téléchargement vers `.part`, puis
  **contrôle SHA-256** contre l'empreinte de la demande ; différent → supprimé, échec signalé.
  Identique → `apply-update.ps1` (installeur silencieux, code retour vérifié). Aucun nouvel essai
  sans nouvelle demande.
- **Événement envoyé depuis le SaaS** (`EventPushService`) : lu toutes les 20 s sur Home ou
  EventSetup en ligne ; chargé seulement hors séance, puis confirmé au SaaS.
- **Scripts** `apply-update.ps1` et `watchdog.ps1` : en **UTF-8 avec BOM** (sinon Windows
  PowerShell 5.1 casse les accents). Watchdog : contrôle toutes les 15 s, respecte `update.lock`
  (ignoré au-delà de 10 min), lancé par un raccourci du dossier Démarrage.
- **Installeur** : par utilisateur dans `%LocalAppData%\Programs\PolaKiosk`, exclut
  `appsettings.local.json`. Éditeur affiché : `AppPublisher` de `installer/instance.iss` s'il existe,
  sinon « PolaKiosk ».
- **ffmpeg** : `installer/build.ps1` lance `scripts/fetch-ffmpeg.ps1` avant `dotnet publish` ;
  `PolaKiosk.iss` s'arrête si `ffmpeg.exe` manque dans la publication et installe `licenses\ffmpeg`.
- **Signature** (facultative, LAB-424) : `installer/build.ps1` signe `PolaKiosk.exe`, `PolaKiosk.dll`,
  l'installeur et le désinstalleur si `KIOSK_SIGN_CERT_THUMBPRINT`, `KIOSK_SIGN_CERT_FILE` (+ mot de passe)
  ou `KIOSK_SIGN_COMMAND` est défini (`installer/sign.ps1`, Authenticode SHA-256 horodaté) ; sinon
  installeur non signé, comme avant. Une signature ratée arrête la construction. Scripts en UTF-8 avec BOM.
- **Version** : une seule source, `<Version>` du `.csproj` (l'installeur la lit dans la DLL publiée).

---

## Impression (`PrintService`)

`PrintDocument` avec un délai de 45 s. Compteur (`PrintCounts`) et journal (`PrintLogs`) écrits **à
l'envoi**, dans une même transaction. Une seule impression à la fois (`PrintGate`) : pas de double
impression. Plafonds par photo et par événement, le plus strict s'applique. Imprimante choisie dans
l'Admin (`machine-settings.json`).

Envoi au SaaS (`PrintLogSyncService`) : RPC `kiosk_record_print`, juste après l'impression puis à
chaque cycle et au retour du réseau. `true` (doublon compris) ou `22023` → ligne sortie de la file ;
autre refus → gardée ; erreur réseau → passage arrêté.

---

## Configuration locale (couches)

`AppSettings` : `Supabase {Url, AnonKey}`, `Kiosk {DataDirectory, PrinterName, LicenseSecret (dev),
DevAdminPin, KioskMode, SaasUrl, PairingUrl, PairingPollSeconds, IdleTimeoutSeconds, LicenseGraceDays}`,
`Camera {ForcedSource, WebcamIndex}`, `Contact {CompanyName, PhoneNumber, Email}`.

Ordre de chargement :
1. `appsettings.json` (versionné, neutre : adresse Supabase, clé anon, `SaasUrl` et contact vides,
   `KioskMode = true`, aucun PIN).
2. `appsettings.Instance.json` (facultatif, propre à l'instance : `Kiosk.SaasUrl`, `Kiosk.PairingUrl`,
   `Contact.*`). Sans `PairingUrl`, la borne prend `{SaasUrl}/associer`.
3. `appsettings.{Environment}.json` : `Development` (versionné : `KioskMode = false`, `DevAdminPin`)
   ou `Production` (non versionné, intégré à l'installeur ; ne doit pas remettre `KioskMode` à `false`).
4. `appsettings.local.json` : **Development seulement** (non versionné, jamais installé).
5. `machine-settings.json` : imprimante, caméra, taille des photos, délai de nettoyage, et **adresse
   du SaaS saisie sur la borne** (utilisée seulement si les appsettings n'ont pas d'adresse
   complète). Tout changement d'adresse redémarre l'app.

Ne jamais afficher ni committer `appsettings.local.json` / `appsettings.Production.json`.

---

## Tests (`PolaKiosk.Tests`)

Tests unitaires, base SQLite en mémoire (`TestDb`) quand il en faut une, HTTP simulé pour les
appels Supabase (noms exacts des paramètres SQL, codes d'erreur), minuteries et horloges factices
pour les écrans. Les cas importants : géométrie des zones photo (mêmes cas que le SaaS), plafonds
d'impression, envois idempotents, repli `.pola`, licence et cache signé, PIN (vecteur commun avec
le SaaS), mises à jour (empreinte, échecs), association, questionnaire et consentements, garde-fous
du nettoyage du PC.

Pas de test EDSDK natif (matériel requis ; la logique d'attribution des photos est isolée dans
`CaptureSlot`), d'UI XAML ni d'appel Supabase réel. Tests manuels sur le terrain :
`docs/checklist-tests-terrain.md`.

---

## Commandes (depuis `kiosk/`)

```bash
dotnet build PolaKiosk.slnx
dotnet run --project PolaKiosk                                   # profil Development
dotnet run --project PolaKiosk --launch-profile Production
dotnet test PolaKiosk.slnx
dotnet publish PolaKiosk/PolaKiosk.csproj -c Release -r win-x64 --self-contained true   # avant l'installeur
```

---

## Points d'attention

- Appels EDSDK uniquement sur le thread STA de `EdsdkCameraService`.
- Chemins : `Path.Combine`, jamais de concaténation ; `%AppData%` =
  `Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData)`.
- Ne jamais bloquer l'écran : pas de `MessageBox`, toujours un retour automatique à un écran sûr.
- Journaux : jamais de donnée personnelle, de code d'accès ni de secret.
- `form_config.kiosk` est édité dans le SaaS : vérifier l'effet côté SaaS avant de changer un champ.
- Version : modifier seulement `<Version>` du `.csproj`.
