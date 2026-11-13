# Polabooth

Polabooth est une suite logicielle pour les loueurs de photobooth. Elle a deux parties :

- **un SaaS** (site web) : vous y gérez vos événements, vos clients, les designs des photos et
  vos bornes. Vos clients y créent leur design, les invités y retrouvent leurs photos ;
- **une borne** (application Windows, PolaKiosk) : elle prend les photos avec un appareil Canon ou
  une webcam, applique le design, imprime, et partage les photos par QR code et email. Elle
  fonctionne aussi sans réseau.

Vous installez tout chez vous : votre base de données, votre stockage, votre messagerie. Aucun
service central n'est nécessaire.

> **In English.** Polabooth is a photo booth software suite for photo booth rental businesses: a
> web app (events, clients, photo designs, online galleries, kiosk fleet) and a Windows kiosk app
> (Canon or webcam capture, printing, QR code and email sharing, offline mode). You host
> everything yourself (Supabase, S3-compatible storage, SMTP). The interface and the
> documentation are in French. License: PolyForm Shield 1.0.0 with an additional permission for
> photo booth businesses (see [Licence](#licence)).

---

## Fonctionnalités

Le socle est toujours présent. Les autres fonctionnalités s'activent ou se désactivent par compte.

| Fonctionnalité | Contenu |
|---|---|
| Événements et bornes (socle) | Créez vos événements, envoyez-les à la borne par code ou par fichier `.pola`, gérez vos bornes associées. |
| Modèles et éditeur (socle) | Préparez vos modèles d'impression dans l'éditeur, avec vos décorations et vos polices. Formats 10×15 (portrait, paysage) et bandes 5×15. |
| Design par le client | Vos clients personnalisent leur modèle en ligne, vous le validez avant l'événement. Emails et relances inclus. |
| Galerie photo en ligne | Les invités retrouvent leurs photos en ligne, avec un diaporama et l'envoi de leurs propres photos. |
| Questionnaire de la borne | La borne pose quelques questions aux invités, vous exportez leurs réponses. |
| Bilan d'événement | Un bilan chiffré de l'événement pour votre client : photos, impressions, partages. |
| Email de livraison | Après l'événement, votre client reçoit un email avec le lien vers ses photos. |
| Alertes de la borne | Un email quand une borne a un souci d'imprimante ou manque de papier. |
| Planning et parc de bornes | Un calendrier pour savoir quelle borne part sur quel événement. |
| Synchro Google Calendar | Vos événements et votre planning dans votre agenda Google. |
| IA visuelle | Détourage d'une image ou fond généré, dans l'éditeur (avec votre propre clé). |
| Aide et support | Une page d'aide pour vos clients, qui peuvent vous envoyer un message. |
| Assistant | Un assistant répond aux questions de vos clients dans la page d'aide (avec votre propre clé). |

La réservation en ligne, la facturation, le suivi de prospects et le livre d'or audio ne font pas
partie de Polabooth.

---

## Ce qu'il faut

**Pour le SaaS**

- un projet [Supabase](https://supabase.com) (base de données, comptes, fonctions serveur) ;
- un stockage compatible S3 (Cloudflare R2, Scaleway, OVHcloud, Backblaze B2, MinIO…) ;
- une messagerie SMTP (port 465) ou un compte Brevo ;
- un hébergement de site statique (Netlify, Cloudflare Pages, Vercel ou votre serveur) et un nom
  de domaine.

**Pour chaque borne**

- un PC Windows 10 ou 11 (64 bits), idéalement avec un écran tactile ;
- un appareil Canon compatible EDSDK (le kit Canon se demande à Canon), ou une webcam ;
- une imprimante photo avec pilote Windows.

---

## Installer

Commencez par [docs/installation.md](docs/installation.md) : composants, coûts, ordre des étapes.

1. Le SaaS : [docs/installation-instance.md](docs/installation-instance.md). Un script
   (`npm run install-instance`) crée la base, déploie les fonctions et construit le site.
2. La borne : [docs/installation-borne.md](docs/installation-borne.md). Matériel, kit Canon,
   construction de l'installeur, mise en service.

Le format du fichier `.pola`, qui emporte un événement sur une borne sans réseau, est décrit dans
[docs/format-pola.md](docs/format-pola.md).

---

## Organisation du dépôt

| Dossier | Contenu | Technique |
|---|---|---|
| `saas/` | SaaS : administration, éditeur de designs, galeries | React, Vite, Tailwind, Fabric.js, Supabase |
| `kiosk/` | Borne PolaKiosk et son installeur | WPF, .NET 10, Canon EDSDK, SQLite, Inno Setup |
| `docs/` | Guides d'installation et format `.pola` | |

Détails techniques : [saas/CLAUDE.md](saas/CLAUDE.md) et [kiosk/CLAUDE.md](kiosk/CLAUDE.md).

---

## Contribuer

Les contributions sont bienvenues. Avant votre première pull request, lisez
[CONTRIBUTING.md](CONTRIBUTING.md) : vous devrez accepter l'accord de contribution
([CLA.md](CLA.md)) par un simple commentaire sur la pull request.

Une faille de sécurité ne se signale pas dans une issue publique : voir [SECURITY.md](SECURITY.md).

---

## Licence

Polabooth est distribué sous la licence [PolyForm Shield 1.0.0](LICENSE.md), avec une permission
supplémentaire.

- **Vous pouvez** utiliser Polabooth, modifié ou non, pour votre propre activité de location ou de
  prestation de photobooth (location de bornes, animation, impression, galeries et partage des
  photos), même si elle fait concurrence à La Boîte à Pola.
- **Vous ne pouvez pas** fournir Polabooth, ou un logiciel qui en est dérivé, à d'autres
  entreprises : le vendre, le louer, l'héberger pour elles ou le proposer comme service (par
  exemple un SaaS ou une application de borne pour d'autres loueurs). Ces usages restent soumis à
  la clause « Noncompete » de la licence.
- **Non couverts** : les noms, logos et marques « La Boîte à Pola » et « PolaKiosk ». Les
  composants de tiers gardent leur licence (polices sous SIL Open Font License, dépendances npm et
  NuGet). Le kit Canon EDSDK n'est pas fourni.
- Si vous redistribuez le logiciel, transmettez les termes de la licence et la mention suivante :

  ```
  Required Notice: Copyright Jérémy Poulain, La Boîte à Pola (https://laboiteapola.com)
  ```

Le logiciel est fourni sans garantie. Ce résumé ne remplace pas le texte : en cas de doute,
[LICENSE.md](LICENSE.md) fait foi.
