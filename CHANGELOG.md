# Nouveautés de Polabooth

Ce fichier dit ce qui change à chaque publication, et ce que vous devez faire pour mettre votre
instance à jour. La plus récente est en haut.

---

## Comment mettre à jour

**Le SaaS.** Depuis le dossier de votre copie :

```bash
cd polabooth/saas
git pull
npm ci
npm run install-instance
```

Le script applique les nouvelles migrations de la base, redéploie les fonctions serveur et
reconstruit `dist/`. Remettez ensuite `dist/` en ligne (voir
[docs/installation-instance.md](docs/installation-instance.md), sections 6 et 10). Relancer le
script est sans risque : il ne crée ni deuxième compte ni doublon.

Ne modifiez pas les fichiers de `saas/supabase/migrations/` : le script n'applique que les migrations
qu'il n'a pas encore vues. Une migration modifiée après coup ne serait jamais rejouée.

**La borne.** Téléchargez le nouvel installeur (onglet **Releases**) et lancez-le sur la borne, ou
publiez-le dans le SaaS (page Bornes, onglet Versions) puis cliquez sur « Mettre à jour » pour
chaque borne : elle s'installe toute seule quand personne ne s'en sert (voir
[docs/installation-borne.md](docs/installation-borne.md), section 7).

Une publication peut toucher le SaaS seul, la borne seule ou les deux : la section « À faire » de
chaque version le dit.

---

## Prochaine publication

### À faire

1. **Avant la mise à jour du SaaS**, ajoutez un jeton d'accès Supabase dans `instance.env` :
   `SUPABASE_ACCESS_TOKEN=sbp_…`. Créez-le sur https://supabase.com/dashboard/account/tokens
   (« Generate new token ») et copiez-le tout de suite, il n'est affiché qu'une fois. Le script en
   a besoin à chaque mise à jour. Le modèle `saas/instance.env.example` l'explique.
2. Mettez à jour le SaaS (voir plus haut). Treize nouvelles migrations sont appliquées.
3. Installez la borne **1.0.19** sur chaque PC, puis enregistrez le réglage « Bandes coupées » de
   l'imprimante dans l'Admin de la borne (voir plus bas).

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
- Stock de matériel par type (Bornes > Matériel) : combien de bornes vous avez, et lesquelles sont
  indisponibles.
- Une couleur différente par borne dans le calendrier.
- Ménage quotidien des images des modèles qui ne servent plus.
- Croix pour retirer une notification de la cloche.
- Page d'aide (`/aide`) aux couleurs des pages client.
- Sécurité renforcée : la liste des comptes et les alertes des bornes ne sont plus lisibles sans
  connexion, fichiers des buckets ni listables ni hors des types et des tailles prévus, types de
  fichiers vérifiés à l'envoi des photos des invités.

### Borne (1.0.17 à 1.0.19)

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

---

## 13 novembre 2026

Première publication.
