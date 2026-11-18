# Checklist de tests terrain — PolaKiosk

À dérouler avant un événement, surtout après une mise à jour. L'objectif : vérifier
que le kiosk **ne reste jamais bloqué** et **récupère seul** des pannes courantes.

Cocher `[x]` quand le test passe. Noter la date et la version testée.

- **Date :** ____________________
- **Version (setup) :** ____________________
- **Machine / PC :** ____________________

> Astuce : pour ne pas attendre, règle un délai court (ex. 20 s) dans le SaaS, page admin de
> l'événement, configuration kiosk, « Retour auto à l'accueil » (`result.auto_return_seconds`),
> puis remets la valeur habituelle (30 s par défaut) avant l'événement. Ne pas passer par
> `appsettings.local.json` : ce fichier n'est lu qu'en développement et n'est pas installé.

---

## 1. Parcours nominal (tout branché, en ligne)

- [ ] **Démarrage** : l'app se lance en plein écran sur le bon fond (pas d'ancien fond qui clignote).
- [ ] **Saisie code** : entrer le code événement → écran d'accueil de l'événement.
- [ ] **Accueil → photo** : toucher l'écran → live view caméra visible, cadrage aligné avec la zone du template.
- [ ] **Compte à rebours** : le cercle s'affiche, opacité correcte (on voit la caméra derrière).
- [ ] **Capture + composite** : la photo est prise, le template appliqué, l'écran résultat s'affiche.
- [ ] **Impression** : − / + dans le bloc « Imprimer » (bloqués à 1 et au reste du quota), « Imprimer N exemplaires » imprime le bon nombre, « encore N tirages possibles » décrémente si « Afficher le compteur restant » est coché (le plus strict du plafond par photo et du plafond par événement). Plafond par événement déjà atteint : le bloc Imprimer n'apparaît pas, y compris sur une nouvelle photo et sur une photo rouverte depuis la galerie (LAB-194) ; atteint en imprimant ici : bloc grisé « Plus de tirage disponible ».
- [ ] **QR code** : tuile QR code → écran QR, scannable, mène à la galerie avec la bonne photo ; l'adresse de repli « <adresse du SaaS>/photos/{code} » ouvre bien la galerie ; « C'est bon, merci ! » → accueil.
- [ ] **Email** (si activé) : tuile Email → case d'accord décochée (même avec une adresse pré-remplie), « Envoyer » grisé tant qu'elle ne l'est pas ; envoi → « C'est envoyé ! » avec l'adresse, « Terminer » → accueil, e-mail bien reçu.
  Saisie au clavier tactile de la borne (le clavier Windows ne s'ouvre pas), domaines proposés sous le champ (`@gmail.com`…), le curseur reste en fin d'adresse après un domaine, effacer maintenu, mode kiosk actif.
- [ ] **Boutons résultat** (LAB-252) : couper dans le SaaS l'impression, le QR, l'e-mail, Refaire, Terminer, un par un puis ensemble (impression seule, numérique seul, QR seul) → l'élément disparaît, l'écran reste équilibré ; plein écran, bandes crème acceptées sur un écran 16:9.
- [ ] **Refaire les photos / Terminer** : ramènent bien aux bons écrans ; photo rouverte depuis la galerie → pas de « Refaire les photos ».
- [ ] **Hors ligne** : photo prise sans réseau → tuiles Email et QR grisées avec « Photo gardée sur la borne… », impression possible.
- [ ] **Bande multi-photos (3–4 zones)** : avec un template bande (stripV ou stripH) à 3 ou 4 zones → indicateur « Photo N / M », une capture par zone, chaque zone remplie par sa propre photo, impression au format 2x6.

---

## 2. Trous noirs — l'app ne doit jamais rester figée (P1)

- [ ] **Inactivité sur l'écran résultat** : prendre une photo, ne rien faire → « Retour à l'accueil dans N s » décompte, retour automatique à l'accueil à 0 ; tout appui (y compris sur l'écran QR ou Email, ou une touche du clavier) relance le décompte ; pas de retour pendant une impression.
- [ ] **Inactivité sur l'écran d'effets** (si activé) : idem → retour accueil.
- [ ] **L'inactivité ne perturbe PAS les écrans staff** : rester sur la saisie de code ou l'admin → pas de retour accueil intempestif.
- [ ] **Caméra absente au lancement de la photo** : débrancher l'USB caméra, toucher l'écran → 3 tentatives d'initialisation, message « Aucune caméra détectée. Vérifiez que l'appareil est branché en USB et allumé, puis réessayez. », **retour auto à l'accueil après ~6 s** (pas de fenêtre d'erreur bloquante).
- [ ] **Le timer remet à zéro sur interaction** : toucher l'écran régulièrement → pas de retour accueil tant qu'on interagit.

---

## 3. Pannes matérielles — récupération (P2)

### Caméra
- [ ] **Coupure USB pendant le live view** : débrancher la caméra pendant le compte à rebours → l'app ne se fige pas ; au pire retour accueil avec message (≤ 25 s : 18 s de délai de capture + 6 s d'affichage).
- [ ] **À-coup USB au démarrage** : débrancher/rebrancher rapidement juste avant de lancer une photo → l'app retente l'init (jusqu'à 3 fois) et démarre si la caméra revient.
- [ ] **Caméra durablement absente** : laisser débranché, lancer plusieurs photos d'affilée → chaque essai revient proprement à l'accueil, **jamais de gel** (le thread caméra survit).

### Imprimante
- [ ] **Imprimante éteinte** : éteindre l'imprimante, cliquer Imprimer → toast rouge non bloquant "Impression indisponible…", les autres boutons restent utilisables.
- [ ] **Imprimante en pause / plus de papier** : mettre la file d'impression en pause Windows, cliquer Imprimer → au-delà de ~45s, message d'erreur, **pas de gel**, et le compteur d'impressions **n'a pas** décrémenté.
- [ ] **Reprise** : rallumer/réactiver l'imprimante, réessayer → l'impression repart normalement.
- [ ] **Bandes coupées (LAB-334)**, sur la DS620 puis la RX1-HS : Admin → Imprimante → « Enregistrer le réglage bandes coupées » (cocher la coupe 2 pouces, valider) puis « Enregistrer le réglage normal » (coupe décochée) → états « enregistré le … ». Une bande stripV → une feuille 10×15 avec deux bandes identiques côte à côte, coupée au milieu exact, rien de rogné ni de décalé ; compteur à 1. Une bande stripH → deux bandes l'une au-dessus de l'autre, idem. Un 10×15 juste après → feuille entière, non coupée. Photo partagée (QR, e-mail) = une seule bande. Sans réglage coupé (machine-settings.json sans `PrinterDriverSettings`) → bande seule en 2x6 et avertissement `print`.
- [ ] **Papier exact (LAB-320)** : un tirage 10×15 puis une bande (choix du cadre) → journaux `print` : la liste des formats du pilote apparaît une fois, puis le format retenu pour 4x6 et pour 2x6 (relever les noms DS620 / RX1-HS). Le 10×15 n'est ni agrandi ni rogné ; la bande sort sur le papier bande (DNP : une feuille = 2 bandes si « (2x6) x2 » est retenu).

---

## 4. Durabilité & réseau (P3)

- [ ] **Coupure de courant brutale** : pendant une session, couper l'alimentation du PC. Au redémarrage → l'app se relance et la base locale n'est pas corrompue (les sessions/compteurs précédents sont intacts). *(Test à faire avec précaution.)*
- [ ] **Wifi instable à la saisie de code** : couper le wifi 2-3s pendant la validation du code → message "Connexion instable, nouvel essai…", puis succès quand le réseau revient (pas d'échec immédiat).
- [ ] **Mode hors ligne** : couper le réseau, prendre une photo → la photo est enregistrée localement, message « Photo enregistrée sur la borne — elle sera envoyée au retour du réseau ». Rebrancher → la photo apparaît dans la galerie SaaS sous 15 s environ. Variante : réseau présent mais Supabase injoignable → message « Envoi impossible pour le moment… », renvoi automatique dans les 2 minutes.
- [ ] **Envoi différé** : vérifier qu'après reconnexion la photo apparaît bien dans la galerie SaaS (corrigé par LAB-194).
- [ ] **Tenue sur une longue soirée** : enchaîner les sessions pendant plusieurs heures (ou au moins 100 photos) en surveillant la mémoire de `PolaKiosk.exe` dans le Gestionnaire des tâches → pas de croissance continue, pas de ralentissement du live view ni de plantage.

---

## 5. Sécurité (P3)

- [ ] **PIN admin correct** : ouvrir le pavé, saisir le bon PIN → accès admin.
- [ ] **PIN incorrect** : saisir un mauvais code → "Code incorrect (N essais restants)".
- [ ] **Verrouillage** : se tromper 5 fois → « Trop de tentatives. Réessayez dans 30s. », le pavé refuse les chiffres pendant le délai.
- [ ] **Le verrou persiste** : fermer puis rouvrir le pavé, ou changer d'écran, pendant le verrouillage → toujours verrouillé (pas de contournement) (à corriger).
- [ ] **Pas de PIN par défaut** : borne fraîchement installée, aucun PIN envoyé → le pavé affiche « Définissez le PIN de cette borne dans le SaaS (page Licences) puis envoyez-le » et `1234` est refusé.
- [ ] **PIN envoyé depuis le SaaS** : Admin → Licences, définir le PIN de la borne puis « Envoyer à la borne » → rouvrir le pavé sur la borne : le nouveau PIN fonctionne, la page Licences affiche « reçu par la borne le … ».
- [ ] **PIN hors ligne** : couper le réseau, redémarrer la borne → le dernier PIN reçu fonctionne toujours.
- [ ] **Mode kiosk en production** : Win, Alt+Tab, Alt+F4, Ctrl+Échap et Ctrl+Maj+Échap sans effet sur l'accueil.
- [ ] **Association** : écran Pairing, scanner le QR code à ~1 m (ou taper le code « XXX-XXX » dans le SaaS) → « Borne associée à {compte} — {nom} » puis saisie du code événement ; code expiré → nouveau code ; borne retirée dans le SaaS → retour à l'association avec le nom du compte.
- [ ] **MAJ au mauvais hash** : publier une version dont le `sha256` ne correspond pas à l'installeur (base de dev), puis **Mettre à jour** la borne → elle n'installe rien, le fichier est supprimé, la carte Licences affiche « échec » avec « Installeur refusé : son empreinte SHA-256… ».

---

## 6. Watchdog & relance auto

- [ ] **Installation** : `setup-polakiosk.exe` installe l'app dans `%LocalAppData%\Programs\PolaKiosk` + crée le raccourci « PolaKiosk Watchdog » dans le dossier Démarrage (`shell:startup`).
- [ ] **Démarrage auto** : fermer la session Windows et rouvrir → l'app se lance toute seule.
- [ ] **Relance après crash** : terminer `PolaKiosk.exe` via le Gestionnaire des tâches → l'app **redémarre automatiquement** sous ~30 s (vérification toutes les 15 s).
- [ ] **Journal watchdog** : vérifier `%LocalAppData%\PolaKiosk\watchdog.log` (lignes de relance horodatées).
- [ ] **Une seule instance** : lancer `PolaKiosk.exe` à la main alors qu'il tourne déjà → la seconde copie se ferme aussitôt (`fatal.log` : « déjà lancé »).
- [ ] **Verrou orphelin** : créer un `update.lock` daté de plus de 10 min et fermer l'app → le watchdog le supprime (`watchdog.log` : « orphelin ») et relance l'app.
- [ ] **Désinstallation propre** : désinstaller via Paramètres Windows → le watchdog et l'app sont arrêtés, le raccourci du dossier Démarrage disparaît.

---

## 7. Mise à jour de version

- [ ] **Conservation config** : après installation d'une nouvelle version, l'imprimante et la caméra choisies (`machine-settings.json`), le contact du loueur (`state.json`) et la licence (`license.json`) dans `%AppData%\PolaKiosk` sont conservés. Le PIN et la clé Supabase viennent du build (`appsettings.Production.json`) : vérifier qu'ils sont corrects dans la nouvelle version.
- [ ] **Conservation données** : la base locale (`%AppData%\PolaKiosk`) et l'historique d'impressions sont conservés.
- [ ] **Jamais sans demande** : publier une nouvelle version sans cliquer sur **Mettre à jour** → la borne ne fait rien, même après redémarrage.
- [ ] **Demande depuis le SaaS** : **Mettre à jour** sur la carte de la borne (accueil affiché) → sous 2 min la carte affiche « reçue », la borne installe puis redémarre ; la carte affiche « installée ».
- [ ] **Jamais pendant une séance invité** : demander la MAJ pendant une prise de vue (ou sur l'écran résultat) → rien ne se passe pendant la séance ; elle démarre au retour sur l'accueil.
- [ ] **Échec de téléchargement** : couper le réseau pendant « Mise à jour en cours… » → retour à l'écran précédent sous ~60 s, la carte affiche « échec » une fois le réseau revenu ; **aucun nouvel essai** tant qu'on ne reclique pas sur **Mettre à jour**.
- [ ] **Échec d'installation** : en cas d'installeur en erreur, l'ancienne version redémarre, `update.log` indique « ÉCHOUÉE », la carte affiche « échec » (« L'installeur de la version … a échoué ») et la borne ne réessaie pas.

---

## 8. Questionnaire des invités (LAB-208)

À faire avec le questionnaire activé dans le SaaS (fiche de l'événement), une question e-mail, et
« Pré-remplir l'e-mail de partage » coché.

- [ ] **Validation (mode obligatoire)** : répondre, laisser la case de prospection **décochée**, valider → la photo s'affiche. Dans le SaaS, la réponse apparaît (sous 2 min si la borne est en ligne) avec le lien vers la photo et « Non » en consentement prospection.
- [ ] **E-mail pré-rempli** : sur l'écran résultat, bouton e-mail → l'adresse saisie au questionnaire est déjà dans le champ. Retour à l'accueil, invité suivant → le champ est vide.
- [ ] **Annulation confirmée (mode obligatoire)** : « Annuler » puis confirmer → retour à l'accueil. La photo n'est ni dans la galerie de la borne, ni sur la vignette de l'accueil, ni dans la galerie SaaS ; rien n'a été imprimé ; aucune réponse n'arrive dans le SaaS.
- [ ] **Inactivité** : ne plus toucher l'écran pendant le questionnaire → avertissement après 90 s, puis 15 s plus tard : retour à l'accueil sans photo (mode obligatoire) ou photo affichée sans réponse (mode facultatif).
- [ ] **Coupure secteur pendant le questionnaire (mode obligatoire)** : prendre une photo, couper l'alimentation du PC sur une question. Au redémarrage → la photo n'existe nulle part (galerie de la borne, vignette, galerie SaaS) et aucune réponse n'arrive dans le SaaS.
- [ ] **Borne hors ligne** : couper le réseau, prendre une photo et répondre → la photo s'affiche sans attendre. Rebrancher → la réponse apparaît dans le SaaS sous 2 minutes environ.
- [ ] **Réglage changé en cours d'événement** : pendant l'événement, passer d'obligatoire à facultatif (ou ajouter une question) dans le SaaS, puis redémarrer la borne ou ressaisir le code. Un invité déjà sur le questionnaire garde l'ancien réglage ; l'invité suivant a le nouveau. L'export contient les deux versions des questions.
- [ ] **Journaux sans donnée personnelle** : dans les journaux de la borne (page Licences du SaaS), les lignes « guest_responses » ne donnent que des nombres et des codes, jamais d'e-mail, de téléphone ni de réponse.

---

## 9. Consentement photo (LAB-223)

À faire avec le consentement photo activé dans le SaaS (`rgpd.enabled`). Il n'y a pas encore d'écran
dans le SaaS : contrôler dans l'éditeur SQL de Supabase (table `kiosk_photo_consents`, filtrer sur
l'`event_id` de l'événement).

- [ ] **Accepter** : « J'accepte » → la prise de vue démarre tout de suite, sans attente réseau. Sous 2 min (borne en ligne), une ligne arrive avec le message affiché et l'heure de la séance.
- [ ] **Refuser** : « Je refuse » → retour à l'accueil ; aucune ligne n'arrive.
- [ ] **Reprendre** : accepter, prendre une photo, « Reprendre », reprendre une photo → l'écran de consentement n'est pas reposé ; deux lignes arrivent, une par séance, avec la même heure de consentement.
- [ ] **Annulation (questionnaire obligatoire)** : accepter, prendre une photo, annuler le questionnaire → aucune ligne n'arrive. Idem si l'invité laisse le questionnaire expirer ou si le PC est coupé pendant le questionnaire.
- [ ] **Validation (questionnaire obligatoire)** : accepter, prendre une photo, valider le questionnaire → une ligne arrive, comme la réponse.
- [ ] **Borne hors ligne** : couper le réseau, accepter, prendre une photo → rien ne bloque. Rebrancher → la ligne arrive sous 2 minutes environ, une seule fois (pas de doublon après un redémarrage).
- [ ] **Invité suivant** : retour à l'accueil, invité suivant → l'écran de consentement est reposé.
- [ ] **Journaux sans donnée personnelle** : dans les journaux de la borne (page Licences du SaaS), les lignes « photo_consents » ne donnent que des nombres et des codes, jamais le code d'accès ni le message.

---

## 10. Événement envoyé depuis le SaaS (LAB-245, LAB-246)

À faire avec une borne associée au compte (Canon R100 branché) et deux événements en cours du même
compte, chacun avec un design approuvé. Envoi depuis la fiche de l'événement (« Envoyer sur la
borne ») ou la page Licences (section « Événement sur la borne » de la carte).

- [ ] **Borne sur l'accueil** : envoyer l'événement B alors que la borne affiche l'accueil de A → **30 s au plus** (chronomètre), écran de chargement avec le nom de B puis accueil de B (fond, thème), sans rien toucher sur la borne. Le SaaS affiche « La borne va le charger dans les prochaines secondes » sous « Envoyé à HH:MM — en attente de la borne », puis passe à « Reçu par la borne à HH:MM » et « Affiché sur la borne à HH:MM ✓ » sans recharger la page.
- [ ] **Cadre présent** : sur B, prendre une photo → le montage a le cadre (design approuvé) de B, à l'écran et à l'impression.
- [ ] **Borne sur la saisie du code** : même essai depuis l'écran de saisie du code → l'événement se charge sans code, en 30 s au plus, avec le cadre.
- [ ] **Fonds sur un PC neuf** : PC neuf (ou dossier de données supprimé), associer la borne → l'écran de saisie du code a l'image choisie dans les paramètres admin du SaaS (« Écran de saisie du code »), sinon le fond crème. Envoyer un événement sans fond d'accueil → son accueil reste crème.
- [ ] **Échec du chargement** : couper le réseau juste après l'apparition de l'écran de chargement → la borne revient à l'écran d'avant (accueil de A ou saisie du code) ; rebrancher → B se charge dans les 30 s qui suivent.
- [ ] **Pendant une séance** : envoyer pendant une prise de vue (ou sur l'écran résultat, ou dans l'Admin) → rien ne change pendant la séance ; l'événement se charge au retour sur l'accueil.
- [ ] **Photos en attente** : couper le réseau, prendre 2 photos sur A, rebrancher puis envoyer B tout de suite → les 2 photos arrivent dans la galerie de A, pas dans celle de B.
- [ ] **Borne éteinte** : éteindre la borne, envoyer l'événement → le SaaS affiche « Borne hors ligne : l'événement sera chargé à son prochain démarrage. » au bout de 10 min. Rallumer → la borne passe par l'écran de chargement et ouvre l'accueil de l'événement, sans écran de saisie du code.
- [ ] **Annuler l'envoi** : borne éteinte (ou pendant une séance), envoyer, puis « Annuler l'envoi » → au retour, la borne ne change pas d'événement. Le bouton disparaît une fois l'événement affiché.
- [ ] **Envoi remplacé** : envoyer A puis B avant que la borne ne lise → seule B se charge.
- [ ] **Code et .pola toujours possibles** : après un envoi, « Changer d'événement » dans l'Admin puis saisie d'un code (ou import .pola) → fonctionne comme avant.
- [ ] **Droits** : avec un compte qui n'est pas propriétaire de la borne, la borne n'apparaît pas dans le choix ; un événement archivé ne peut pas être envoyé.

---

## Notes / anomalies constatées

```
(consigner ici tout comportement inattendu : écran, action, ce qui s'est passé)
```
