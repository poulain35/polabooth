# Nouveautés de Polabooth

Ce fichier dit ce qui change à chaque publication, et ce que vous devez faire pour mettre votre
instance à jour. La plus récente est en haut.

---

## Comment mettre à jour

Chaque version a un numéro (`1.2.0`) et sa page **Releases** sur GitHub, avec le même texte que
ce fichier. Pour être prévenu : **Watch** › **Custom** › cochez **Releases**. La version installée
s'affiche dans l'admin, en bas du menu du compte.

**Le SaaS.** Depuis le dossier de votre copie :

```bash
cd polabooth/saas
npm run update-instance
```

La commande récupère la nouvelle version, applique les nouvelles migrations de la base, redéploie
les fonctions serveur, reconstruit `dist/` et le remet en ligne si `HOSTING` est rempli dans
`instance.env` (sinon, remettez `dist/` en ligne vous-même). Elle s'arrête avant tout changement si
vous avez modifié des fichiers du dépôt : ne modifiez que `instance.env`. Voir
[docs/installation-instance.md](docs/installation-instance.md), sections 6 et 10. La relancer est
sans risque : elle reprend où elle s'était arrêtée, sans deuxième compte ni doublon.

Ne modifiez pas les fichiers de `saas/supabase/migrations/` : le script n'applique que les migrations
qu'il n'a pas encore vues. Une migration modifiée après coup ne serait jamais rejouée.

**La borne.** Téléchargez le nouvel installeur (onglet **Releases**) et lancez-le sur la borne, ou
publiez-le dans le SaaS (page Bornes, onglet Versions) puis cliquez sur « Mettre à jour » pour
chaque borne : elle s'installe toute seule quand personne ne s'en sert (voir
[docs/installation-borne.md](docs/installation-borne.md), section 7).

Une publication peut toucher le SaaS seul, la borne seule ou les deux : la section « À faire » de
chaque version le dit.

---

## 1.3.0 (19 novembre 2026)

### À faire

Mettez à jour le SaaS (`npm run update-instance`) : une nouvelle migration est appliquée. Rien pour
la borne : les bornes déjà installées affichent le nouvel accueil sans mise à jour.

### SaaS

- Écrans de la borne (Bornes > Écrans) : en plus de l'accueil portrait, trois accueils au format du
  cadre photo, avec le cadre à droite aux bonnes proportions : paysage, bandelette horizontale et
  bandelette verticale. La borne affiche celui du format du cadre principal de l'événement (le cadre
  validé au plus petit numéro), sinon l'accueil portrait. Même règle dans le fichier `.pola`.
  Tant que vous ne publiez pas une variante, vos événements gardent l'accueil portrait.

---

## 1.2.0 (19 novembre 2026)

### À faire

Rien pour le SaaS. Installez la borne **1.0.23** sur chaque PC (facultatif).

### Borne (1.0.23)

- Décalage de l'impression dans l'Admin de la borne (carte Imprimante) : gauche / droite et haut /
  bas par pas de 0,5 mm (5 mm au plus), et léger agrandissement (5 % au plus) pour cacher un bord
  blanc. Utile quand la marge change d'un rouleau de papier à l'autre. Un seul réglage pour tous les
  formats, gardé par borne.
- « Imprimer une feuille de test » : un trait tous les millimètres depuis chaque bord, pour voir
  de combien décaler. Elle ne compte pas dans les tirages de l'événement.

---

## 1.1.0 (19 novembre 2026)

### À faire

1. **Avant la mise à jour du SaaS**, ajoutez un jeton d'accès Supabase dans `instance.env` :
   `SUPABASE_ACCESS_TOKEN=sbp_…`. Créez-le sur https://supabase.com/dashboard/account/tokens
   (« Generate new token ») et copiez-le tout de suite, il n'est affiché qu'une fois. Le script en
   a besoin à chaque mise à jour. Le modèle `saas/instance.env.example` l'explique.
2. Mettez à jour le SaaS. Cette fois-ci, la commande n'est pas encore dans votre copie : lancez
   `git pull`, puis `npm run update-instance` depuis `saas/` (les fois suivantes, la seconde
   suffit). Facultatif : remplissez avant `HOSTING` dans `instance.env` (`vercel`, `netlify` ou
   `cloudflare`) pour que le site soit remis en ligne tout seul. Dix-sept nouvelles migrations sont
   appliquées.
3. Installez la borne **1.0.22** sur chaque PC, puis enregistrez le réglage « Bandes coupées » de
   l'imprimante dans l'Admin de la borne (voir plus bas).
4. Facultatif : dans Supabase (Edge Functions), supprimez les fonctions `generate-background`,
   `remove-background`, `assistant-chat` et `gcal-sync`, qui ne sont plus livrées (voir plus bas).
   Les clés Replicate, Anthropic et Google déjà enregistrées ne servent plus.

Vous n'avez plus besoin d'installer la CLI Supabase vous-même ni de lancer `supabase login` : le
script la télécharge la première fois.

### Installation

- Installation plus simple : avec le jeton d'accès, le script règle lui-même le projet Supabase
  (adresse du site, envoi des emails par votre messagerie, emails des comptes en français, mots de
  passe de 8 caractères, anciennes clés API, inscriptions fermées : les comptes se créent par
  invitation seulement).
- Le script vérifie la messagerie et le stockage avant de rien modifier : email de test, fichier de
  test lu par l'adresse publique, règle CORS posée si elle manque.
- Guide pas à pas avec formulaire : `docs/guide-installation.html`, à ouvrir par un double-clic.
- Mise à jour en une commande : `npm run update-instance` (récupère la version, met à jour la base
  et les fonctions, remet le site en ligne chez Vercel, Netlify ou Cloudflare Pages selon `HOSTING`).
- Numéros de version : chaque publication a sa page Releases sur GitHub, et la version installée
  s'affiche dans l'admin (menu du compte).
- Construction de l'installeur de la borne en une commande (`kiosk/installer/build.ps1`), avec
  signature Authenticode facultative si vous avez un certificat de signature de code (moins
  d'alertes SmartScreen chez vos clients) : voir `kiosk/installer/README.md`.

### Dépôt

- Code de conduite (`CODE_OF_CONDUCT.md`) et modèles d'issue (bug, fonctionnalité) ; les questions
  passent par les Discussions, les failles par le signalement privé (voir `SECURITY.md`).

### SaaS

- Nouvelle navigation et nouveau style de l'admin, mode sombre compris.
- Page Aujourd'hui avec une liste « À faire » : reporter ou masquer une action.
- Fiche de l'événement en cinq onglets.
- Écrans de la borne (Bornes > Écrans) : composez l'écran d'accueil et l'écran de partage de vos
  bornes, avec vos images et vos polices.
- Écran d'accueil créé par le client : votre client peut composer lui-même l'accueil de la borne, vous
  le validez avant l'événement.
- Choix du cadre : jusqu'à 4 cadres par événement, l'invité choisit le sien sur la borne.
- Galerie aux couleurs de l'événement.
- Journal de la borne dans la fiche de l'événement.
- Bornes > Alertes : les journaux de toutes vos bornes sous les alertes, filtrables par événement,
  avec un sommaire pour passer d'un bloc à l'autre.
- Réglages de l'appareil photo par borne (Bornes, fiche de la borne) : vitesse, ouverture, ISO,
  balance des blancs et température, lus sur l'appareil et appliqués par la borne quand personne ne
  fait de photo. Appareils Canon seulement.
- Bornes > Versions : « Télécharger » et « Copier le lien » pour chaque version, et l'adresse
  courte `/installer-borne` de votre SaaS, qui télécharge toujours la dernière version publiée
  (pratique sur le PC d'une nouvelle borne).
- Ménage quotidien des images des modèles qui ne servent plus.
- Croix pour retirer une notification de la cloche.
- Page d'aide (`/aide`) aux couleurs des pages client.
- Sécurité renforcée : la liste des comptes et les alertes des bornes ne sont plus lisibles sans
  connexion, fichiers des buckets ni listables ni hors des types et des tailles prévus, types de
  fichiers vérifiés à l'envoi des photos des invités.
- Dépendances du SaaS mises à jour (react-router, vite, postcss, ws, tar…). Il reste une alerte
  sur fabric (export SVG, que l'éditeur n'utilise pas) : sa correction demande fabric 7.
- Le secret de chaque borne n'est plus gardé en clair dans la base, seulement son empreinte : une
  copie de la base ne permet plus de se faire passer pour une borne. Les bornes déjà associées
  continuent de marcher, sans nouvelle association.
- L'IA visuelle (détourage, fond généré) et le chat de l'assistant ne font plus partie de Polabooth :
  ce sont des modules sur demande. La page d'aide garde la FAQ et le message à votre entreprise ; les
  clés Replicate et Anthropic disparaissent des Services connectés.
- Réglages > Fonctionnalités : groupe « Modules sur demande », avec un lien « Contactez-moi pour en
  parler » pour chaque module absent.
- Le planning (vue Calendrier des événements, stock de matériel de Bornes > Matériel) et la synchro
  Google Calendar ne font plus partie de Polabooth. Une borne sert un événement à la fois. Les tables
  restent dans la base, sans effet ; rien à faire de votre côté. Le code publié le 13 novembre 2026
  reste disponible sous sa licence.

### Borne (1.0.17 à 1.0.22)

- Affiche les écrans composés dans le SaaS et l'écran d'accueil créé par le client.
- Choix du cadre par l'invité.
- Bandes 5×15 imprimées par deux sur une feuille 10×15, coupée par l'imprimante. **Obligatoire :**
  enregistrez une fois le réglage « Bandes coupées » du pilote dans l'Admin de chaque borne, sinon
  les bandes ne s'impriment pas correctement (voir docs/installation-borne.md, 5.3).
- Historique des fichiers `.pola` importés, rechargeables depuis l'Admin.
- Journaux rattachés à l'événement et à la séance ; les plantages sont envoyés au redémarrage.
- Canon EOS R : aperçu en direct clair même avec des réglages faits pour le flash (la borne
  désactive la simulation d'exposition). Testé sur un EOS R100.
- « Retour » dans l'Admin revient à l'accueil de l'événement en cours, sans redemander le code.
- La barre des tâches de Windows reste cachée en sortant de l'Admin.
- Mise à jour plus sûre : installeur téléchargé en https seulement, empreinte vérifiée, fichiers
  reçus contrôlés avant d'être lus (1.0.19).
- Réglages de l'appareil photo Canon dans l'Admin de la borne (vitesse, ouverture, ISO, balance des
  blancs, appareil en mode M), gardés d'un événement à l'autre et remis à chaque connexion de
  l'appareil ; réglages demandés depuis le SaaS appliqués sur l'accueil, jamais pendant une prise de
  vue (1.0.20).
- « Quitter vers Windows » dans l'Admin de la borne : elle se ferme sans être relancée par le
  watchdog, et repart à la prochaine ouverture de session Windows (1.0.21). Le nouveau watchdog
  prend effet à l'ouverture de session qui suit l'installation.
- Lancement au démarrage de Windows au choix : case « Lancer la borne au démarrage de Windows » dans
  l'Admin de la borne (1.0.22). Une nouvelle installation ne démarre plus avec Windows tant que la
  case n'est pas cochée ; une borne déjà installée garde son démarrage automatique. Ouverte à la
  main, la borne se relance quand même après un plantage ou une mise à jour.

---

## 1.0.0 (13 novembre 2026)

Première publication.
