# Premiers pas : avant d'installer Polabooth

Ce guide s'adresse à vous si vous n'avez jamais utilisé GitHub ni un terminal. Il répond aux
questions qu'on se pose avant de commencer : faut-il un compte GitHub ? Comment récupérer le code ?
Comment « lancer » le projet, puis le mettre à jour ? Comptez 10 minutes de lecture.

---

## En bref

- **Pas besoin de compte GitHub** pour installer Polabooth ni pour le mettre à jour.
- Polabooth **n'est pas un logiciel qui tourne sur votre ordinateur**. C'est un site web installé
  chez des services en ligne (Supabase et un hébergeur). Votre ordinateur sert à l'installer, puis
  à le mettre à jour. Le reste du temps, il peut être éteint.
- Vous installez deux outils gratuits : **Node.js** et **Git**.
- Une mise à jour se fait en **une commande** : `npm run update-instance`.
- Ne branchez **pas** Vercel, Netlify ou Cloudflare sur GitHub (voir plus bas).

---

## Faut-il un compte GitHub ?

Non. Le code de Polabooth est public : tout le monde peut le télécharger sans compte, et les mises
à jour se récupèrent aussi sans compte.

Un compte GitHub (gratuit) sert seulement à :

- **être prévenu par email** de chaque nouvelle version : sur la page GitHub de Polabooth,
  **Watch** › **Custom** › cochez **Releases** ;
- **poser une question** dans l'onglet **Discussions** ;
- **signaler un problème** dans l'onglet **Issues**.

Pas besoin non plus de « fork » (une copie du dépôt sous votre compte) : un fork sert à proposer
des modifications du code, pas à l'utiliser.

Les comptes dont vous aurez vraiment besoin :

| Compte | Pour quoi |
|---|---|
| Supabase | La base de données, les comptes et les fonctions serveur |
| Un hébergeur (Netlify, Cloudflare Pages ou Vercel) | Mettre le site en ligne |
| Un stockage compatible S3 (Cloudflare R2, Scaleway…) | Les photos des bornes |
| Votre messagerie (SMTP) | Envoyer les emails, depuis votre adresse |

Les coûts de chaque service sont dans [installation.md](installation.md#ce-que-ça-coûte).

---

## GitHub, Git, ZIP : quelle différence ?

- **GitHub** est le site où le code est publié.
- **Git** est un petit outil qui copie ce code sur votre ordinateur. Plus tard, il récupère les
  nouvelles versions en une commande, sans toucher à vos réglages.
- Le **ZIP** (bouton « Code » › « Download ZIP ») marche aussi, sans Git. Mais à chaque nouvelle
  version, il faut retélécharger le ZIP, recopier votre configuration et tout relancer à la main.

**Prenez Git** : les mises à jour seront beaucoup plus simples.

---

## Ouvrir un terminal

Un terminal est une fenêtre où l'on tape des commandes. Vous n'aurez qu'à copier celles de ce
guide.

- **Windows** : touche <kbd>Windows</kbd>, tapez `cmd`, puis <kbd>Entrée</kbd>. Pour coller une
  commande, faites un clic droit dans la fenêtre.
- **Mac** : <kbd>Cmd</kbd> + <kbd>Espace</kbd>, tapez « Terminal », puis <kbd>Entrée</kbd>. Pour
  coller : <kbd>Cmd</kbd> + <kbd>V</kbd>.

Collez une commande à la fois, appuyez sur <kbd>Entrée</kbd>, et attendez que la fenêtre vous rende
la main (une ligne qui se termine par `>` ou `%`) avant la suivante.

---

## Installer Node.js et Git

**Windows** : dans le terminal, collez cette commande et acceptez les questions éventuelles.

```
winget install OpenJS.NodeJS.LTS Git.Git
```

Fermez ensuite le terminal et ouvrez-en un nouveau : les outils ne sont reconnus que dans une
nouvelle fenêtre.

**Mac** : installez Node.js, version « LTS », depuis https://nodejs.org (fichier `.pkg`). Pour Git,
lancez `xcode-select --install` dans le Terminal et acceptez l'installation proposée.

Pour vérifier, dans un nouveau terminal :

```
node --version
git --version
```

La première commande doit afficher `v20` ou plus.

---

## Récupérer le code

1. Sur la page GitHub de Polabooth, cliquez sur le bouton vert **Code**, onglet **HTTPS**, et
   copiez l'adresse (elle se termine par `.git`).
2. Dans le terminal, placez-vous dans votre dossier personnel, puis copiez le code :

   Windows :

   ```
   cd /d %USERPROFILE%
   git clone <adresse copiée>
   ```

   Mac :

   ```
   cd ~
   git clone <adresse copiée>
   ```

3. Un dossier `polabooth` est créé : `C:\Users\<vous>\polabooth` sous Windows,
   `/Users/<vous>/polabooth` sur Mac. **C'est votre copie : gardez-la à cet endroit**, elle sert
   aussi aux mises à jour.

Évitez les dossiers synchronisés (OneDrive, iCloud, Dropbox) : l'installation y crée beaucoup de
petits fichiers. Sous Windows, le dossier `Documents` l'est souvent, d'où le dossier personnel.

---

## « Lancer le projet » : ce qui se passe vraiment

Il n'y a pas de programme à garder ouvert. Polabooth a trois morceaux :

1. **Supabase**, en ligne : la base de données, les comptes, les fonctions serveur.
2. **Le site**, chez votre hébergeur : c'est lui que vous, vos clients et leurs invités ouvrez dans
   le navigateur.
3. **La borne** : l'application Windows installée sur le PC de chaque photobooth.

Le programme d'installation, lancé une fois depuis votre ordinateur, prépare tout cela : il crée la
base dans votre projet Supabase, y installe les fonctions, puis fabrique le site dans le dossier
`saas/dist`. Vous mettez ce dossier en ligne chez l'hébergeur (sur Netlify, un simple
glisser-déposer). Ensuite, le site fonctionne jour et nuit, même ordinateur éteint.

Les étapes, dans l'ordre :

1. Créez les comptes du tableau plus haut.
2. Ouvrez `docs/guide-installation.html` par un double-clic, dans le dossier `polabooth`. Ce guide
   pas à pas vous fait remplir un formulaire et télécharger votre fichier de configuration,
   `instance.env`, à placer dans le dossier `saas`.
3. Lancez le programme d'installation : double-clic sur `saas/installer.cmd` sous Windows ; sur Mac,
   `bash ~/polabooth/saas/installer.sh` dans le Terminal. Il fait d'abord un essai sans rien
   modifier, puis vous demande de confirmer.
4. Mettez le dossier `saas/dist` en ligne chez votre hébergeur.
5. Connectez-vous à votre admin et suivez la carte « Mise en route ».
6. Installez la borne : [installation-borne.md](installation-borne.md).

Toutes les explications détaillées : [installation-instance.md](installation-instance.md).

---

## Ce qu'il faut garder

- **Le dossier `polabooth`** : ne modifiez aucun de ses fichiers, sauf `saas/instance.env`. Une
  mise à jour s'arrête si un autre fichier a été modifié.
- **Le fichier `saas/instance.env`** : il contient vos mots de passe (base, messagerie, stockage).
  Il n'est jamais envoyé sur GitHub. Gardez-en une copie en lieu sûr, par exemple dans votre
  gestionnaire de mots de passe, et ne l'envoyez à personne.
- **Le mot de passe de l'administrateur**, affiché une seule fois à la fin de l'installation.

Vous changez d'ordinateur ? Installez Node.js et Git, récupérez le code comme plus haut, remettez
votre copie de `instance.env` dans le dossier `saas`, puis lancez la mise à jour ci-dessous. L'outil
de votre hébergeur vous redemandera de vous connecter une fois.

---

## Mettre à jour

Quand une nouvelle version sort (email de GitHub si vous suivez les **Releases**, ou page
**Releases** et fichier `CHANGELOG.md` du dépôt) :

Windows :

```
cd /d %USERPROFILE%\polabooth\saas
npm run update-instance
```

Mac :

```
cd ~/polabooth/saas
npm run update-instance
```

La commande récupère la nouvelle version, met à jour la base et les fonctions, fabrique le nouveau
site et le remet en ligne si vous avez rempli `HOSTING` dans `instance.env` (sinon, redéposez
`saas/dist` chez l'hébergeur). Elle affiche les éventuelles actions à faire à la main. Une erreur ?
Corrigez, relancez : elle reprend où elle s'était arrêtée.

La version installée s'affiche dans l'admin, en bas du menu du compte. La borne se met à jour à
part : [installation-borne.md](installation-borne.md), section 7.

---

## Brancher Vercel, Netlify ou Cloudflare sur GitHub ? Non

Ces hébergeurs proposent d'« importer un dépôt GitHub » pour reconstruire le site à chaque
changement du code. **Ne le faites pas avec Polabooth** :

- seul le site serait mis à jour : pas la base de données ni les fonctions serveur. Un site neuf
  avec une base ancienne donne des pages en erreur ;
- une nouvelle version passerait en ligne sans que vous l'ayez décidé, ni lu ses actions à faire ;
- il faudrait recopier vos réglages à la main chez l'hébergeur.

`npm run update-instance` fait tout, dans le bon ordre : la base d'abord, le site ensuite. Avec
`HOSTING` rempli, il remet même le site en ligne tout seul.

Votre site est déjà relié à GitHub chez l'hébergeur ? Coupez ce lien dans les réglages du projet
(rubrique Git, ou déploiement continu), ou créez un nouveau projet en envoi direct (« upload »), puis
mettez à jour avec `npm run update-instance`.

---

## Questions fréquentes

**Faut-il savoir programmer ?** Non. Il faut savoir copier une commande et remplir un formulaire.

**Puis-je modifier le code ?** C'est possible, mais les mises à jour s'arrêtent alors sur vos
fichiers modifiés. Votre logo, vos couleurs, vos textes et vos fonctionnalités se règlent dans
l'admin, sans toucher au code.

**Où poser une question ?** Dans l'onglet **Discussions** de la page GitHub de Polabooth (compte
GitHub gratuit nécessaire).
