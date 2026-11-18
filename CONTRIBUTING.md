# Contribuer à Polabooth

Merci de votre intérêt. Ce guide explique comment proposer une modification et ce qui se passe
ensuite.

*English summary at the end.*

---

## 1. Avant de commencer

- **Une faille de sécurité ?** Ne passez pas par une issue publique : voir [SECURITY.md](SECURITY.md).
- **Une question ?** Posez-la dans l'onglet **Discussions** du dépôt, pas dans une issue.
- **Un bug ?** Ouvrez une issue : ce que vous avez fait, ce qui s'est passé, ce que vous attendiez,
  la version (SaaS ou borne), et les messages d'erreur ou journaux utiles. Retirez-en toute donnée
  personnelle (noms des invités, emails, clés).
- **Une nouvelle fonctionnalité ?** Ouvrez d'abord une issue pour en discuter. Une grosse pull
  request sans discussion préalable risque d'être refusée, même si elle est bien faite.

## 2. Ce qui est accepté

Bienvenu :

- corrections de bugs, avec un test qui les reproduit quand c'est possible ;
- prise en charge de matériel (appareils photo, imprimantes), de fournisseurs de stockage S3 ou
  de messagerie ;
- améliorations des guides d'installation et de la documentation ;
- tests, accessibilité, performances.

Refusé, ou à discuter avant :

- un changement qui casse une instance déjà installée sans migration ni explication ;
- une dépendance lourde pour un petit besoin ;
- du code qui envoie des données vers un service tiers sans que l'administrateur l'ait activé ;
- une modification du format `.pola` qui ne suit pas [docs/format-pola.md](docs/format-pola.md)
  (section « Changer le format ») ;
- tout contenu dont vous n'avez pas les droits (code copié, images, polices).

## 3. Préparer votre modification

Partez de la branche principale à jour et créez une branche à vous.

**Langue**

- Interfaces, messages d'erreur affichés, documentation, commentaires : en **français**.
- Noms dans le code (variables, fonctions, classes, fichiers) : en **anglais**.
- Messages de commit : en français ou en anglais, courts et clairs.

**SaaS (`saas/`)**

Node 24 recommandé (les tests lisent le TypeScript nativement).

```bash
cd saas
npm ci
npm run lint
npm test
VITE_PRIVATE_MODULES=none npm run build
npm run check:open-build
```

- Les règles techniques sont dans [saas/CLAUDE.md](saas/CLAUDE.md) : à lire avant de toucher au
  code.
- Un changement de schéma passe par une nouvelle migration dans `saas/supabase/migrations/`
  (nom horodaté). Vérifiez son effet sur le SaaS **et** sur la borne.
- Une nouvelle fonction serveur, table ou fonction SQL liée à une fonctionnalité activable doit
  être déclarée dans `saas/supabase/features.json`.
- Jamais de clé `service_role` côté navigateur, jamais de fichier `.env` dans un commit.

**Borne (`kiosk/`)**

SDK .NET 10, sous Windows.

```powershell
dotnet build kiosk/PolaKiosk.slnx
dotnet test kiosk/PolaKiosk.slnx
```

- Les règles techniques sont dans [kiosk/CLAUDE.md](kiosk/CLAUDE.md).
- Les DLL du kit Canon EDSDK ne doivent jamais être commitées (Canon interdit de les
  redistribuer).
- Ne commitez pas `appsettings.local.json`, ni un `appsettings.Instance.json` ou un
  `installer/instance.iss` à votre nom.

**Les deux**

- Ajoutez ou mettez à jour les tests de ce que vous changez.
- Une modification qui change l'installation (nouvelle variable, nouveau secret, nouveau service,
  nouveau prérequis de la borne) met à jour `docs/installation*.md` dans la même pull request.
- La CI lance ces contrôles sur chaque pull request : elle doit être verte.

## 4. Ouvrir la pull request

- Une pull request = un sujet. Expliquez le problème, la solution et comment vous l'avez testée.
- Pour un changement visible, ajoutez une capture d'écran.
- Liez l'issue concernée.

## 5. Accepter le CLA

À votre première pull request, un robot vous demande d'accepter l'accord de contribution
([CLA.md](CLA.md)). Lisez-le, puis publiez sur la pull request un commentaire qui contient
**seulement** cette phrase :

```
Je confirme avoir lu et accepter le CLA de Polabooth. I have read and agree to the Polabooth CLA.
```

Copiez-la telle quelle : le robot compare le texte exact. Si la vérification ne repart pas,
commentez `recheck`.

L'accord vaut pour toutes vos contributions suivantes. Sans lui, la pull request ne peut pas être
acceptée.

Pourquoi un CLA : vous gardez la propriété de votre code, mais vous autorisez le mainteneur à le
distribuer sous la licence du projet et, si besoin, sous une autre licence. C'est ce qui permet de
faire évoluer la licence du projet sans devoir retrouver chaque contributeur.

## 6. Ce qui se passe ensuite

Ce dépôt est publié à partir d'un dépôt amont, où le développement a lieu. Une pull request
acceptée suit donc ce chemin :

1. revue, puis acceptation sur GitHub ;
2. la modification est reportée dans le dépôt amont, avec vous comme auteur ;
3. elle revient ici lors de la publication suivante, dans un commit « Synchronisation … ».

Votre pull request peut donc être fermée plutôt que fusionnée : c'est normal. Votre modification
apparaît dans le commit de synchronisation suivant.

---

## English summary

- Report security issues privately: see [SECURITY.md](SECURITY.md).
- Ask questions in the Discussions tab; report bugs in Issues.
- Open an issue before any large change.
- User-facing text and documentation are in French; code identifiers are in English.
- Run the checks above (SaaS: lint, tests, build, `check:open-build`; kiosk: `dotnet build` and
  `dotnet test`). CI must pass.
- On your first pull request, accept the [CLA](CLA.md) by posting a comment that contains only the
  sentence shown in section 5.
- This repository is published from an upstream repository. Accepted pull requests are applied
  upstream, then come back here in the next "Synchronisation" commit. Your pull request may be
  closed instead of merged.
