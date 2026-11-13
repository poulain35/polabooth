# Le fichier `.pola` (version 2)

Un fichier `.pola` emporte un événement sur une borne qui n'a pas de réseau. Il contient tout ce que
la borne récupère en ligne quand on tape le code de l'événement, et rien de plus.

- **Produit par** le SaaS : fiche de l'événement, bouton « Télécharger .pola ».
- **Lu par** la borne : écran d'administration, import d'un fichier (clé USB).
- **Code de référence** : `saas/src/lib/polaBundle.js` (construction, testée) et
  `kiosk/PolaKiosk/Services/PolaBundle.cs` (lecture, testée).

---

## 1. Enveloppe

- Un document JSON, encodé en UTF-8, compressé en **GZip**.
- Extension `.pola`. Nom donné par le SaaS : `<nom de l'événement>_<code d'accès>.pola` (nom en
  minuscules, caractères autres que lettres et chiffres remplacés par `_`).
- Les images sont dans le JSON, encodées en **base64** (sans préfixe `data:`).

Pour lire un fichier à la main :

```bash
gzip -dc < mariage_alice_et_bruno_AB12CD.pola | python -m json.tool | less
```

---

## 2. Structure

```
{
  version       entier, vaut 2
  exported_at   date de l'export (ISO 8601)
  event         l'événement
  design        le design approuvé de l'événement
  assets        les images, en base64
  contact       le contact du compte, ou null
}
```

### `event`

Les mêmes champs que la réponse de la fonction `kiosk_get_event`, que la borne appelle en ligne.

| Champ | Type | Obligatoire | Contenu |
|---|---|---|---|
| `id` | uuid | oui | Identifiant de l'événement. |
| `org_id` | uuid ou null | non | Compte qui possède l'événement. Sert à refuser un fichier d'un autre compte (voir 3). |
| `name` | texte | oui | Nom de l'événement. |
| `access_code` | texte | oui | Code d'accès de l'événement. La borne le retrouve par ce code, sans réseau. |
| `start_date` | date ISO 8601 ou null | non | Début de l'événement. |
| `end_date` | date ISO 8601 ou null | non | Fin de l'événement. |
| `form_config` | objet | oui | Ne contient que `kiosk` : la configuration de la borne pour cet événement (accueil, prise de vue, consentement, écran de partage, impression, questionnaire…). |

`form_config.kiosk` a la même forme qu'en base (`events.form_config.kiosk`). Si la fonctionnalité
« questionnaire de la borne » est désactivée sur le compte, `kiosk.questionnaire` est retiré.

### `design`

Le design de l'événement, approuvé dans le SaaS. C'est lui qui encadre les photos.

| Champ | Type | Obligatoire | Contenu |
|---|---|---|---|
| `id` | uuid | oui | Identifiant du design. |
| `format` | texte ou null | non | `portrait`, `landscape`, `stripV` ou `stripH`. Absent : `portrait`. |
| `canvas_json` | objet ou null | non | Le canevas Fabric.js du design. La borne y lit les zones photo (objets `isPhotoZone: true`, aussi dans les groupes). |
| `final_png_url` | texte | oui | Adresse du PNG final du design (zones photo transparentes). |

Les zones photo sont en pixels du canevas. La borne les convertit vers la taille d'impression
(300 dpi) avec `échelle = largeur d'impression en px / largeur du canevas en px` :

| Format | Canevas (px) | Impression (px) | Papier |
|---|---|---|---|
| `portrait` | 400 × 600 | 2400 × 3600 | 10 × 15 |
| `landscape` | 600 × 400 | 3600 × 2400 | 15 × 10 |
| `stripV` | 200 × 600 | 1200 × 3600 | 5 × 15 |
| `stripH` | 600 × 200 | 3600 × 1200 | 15 × 5 |

### `assets`

| Champ | Obligatoire | Contenu |
|---|---|---|
| `design_png` | oui | Le PNG du design (celui de `final_png_url`), en base64. |
| `home_background` | non | L'image de fond de l'accueil (`kiosk.home.background_url`). Présent seulement si l'événement en a une et qu'elle a pu être téléchargée. |
| `logo` | non | Le logo du compte (`contact.logo_url`). Présent seulement si le compte a un logo et qu'il a pu être téléchargé. |

### `contact`

Le contact du compte, affiché sur la borne. Mêmes données que la fonction
`get_org_contact_by_event`. `null` si le compte n'a pas de nom de société.

| Champ | Type | Obligatoire | Contenu |
|---|---|---|---|
| `company` | texte | oui | Nom de la société. Vide : tout le contact est ignoré. |
| `phone` | texte ou null | non | Téléphone. |
| `logo_url` | texte ou null | non | Adresse du logo. Voir les règles du logo en 3. |
| `email` | texte ou null | non | Email de contact. |

---

## 3. Règles

**Création (SaaS)**

- Sans design approuvé, ou sans son PNG, l'export est bloqué : le bouton est désactivé, avec une
  explication.
- Fond d'accueil, logo ou contact manquants : le fichier est produit quand même, et le SaaS affiche
  un avertissement.

**Lecture (borne)**

- `version` plus grande que 2 : refusé, il faut mettre la borne à jour.
- `version` plus petite que 2, ou absente : refusé comme ancien format. Il faut télécharger le
  fichier à nouveau.
- `event` sans `id` ou sans `access_code` : refusé (fichier incomplet).
- `design` sans `id`, `final_png_url` vide, ou `assets.design_png` absent : refusé. Sans design, les
  photos sortiraient sans cadre.
- JSON ou base64 illisible : refusé (fichier abîmé).
- `event.org_id` différent du compte de la borne : refusé. Si la borne ne connaît pas encore son
  compte (aucun événement chargé en ligne depuis l'association), le fichier est accepté.
- Champs inconnus : ignorés.

**Logo**

| `contact.logo_url` | `assets.logo` | Ce que fait la borne |
|---|---|---|
| null ou absent | (ignoré) | Efface le logo qu'elle avait en cache. |
| renseigné | présent | Affiche ce logo et le garde en cache. |
| renseigné | absent | Garde le logo qu'elle avait en cache. |

**Après l'import**

La borne garde une copie du fichier. Sans réseau, quand on tape un code d'événement, elle cherche
parmi ces copies celle qui a le même `access_code`. Les photos prises sont envoyées au retour du
réseau.

---

## 4. Exemple abrégé

Les valeurs base64 et la configuration de la borne sont raccourcies.

```json
{
  "version": 2,
  "exported_at": "2026-06-12T09:30:00.000Z",
  "event": {
    "id": "6f1c2a52-6a7e-4d0b-9a51-2f3e8c1d4b70",
    "org_id": "0b8e4d6a-1f2c-4a3b-8c7d-5e6f7a8b9c0d",
    "name": "Mariage Alice et Bruno",
    "access_code": "AB12CD",
    "start_date": "2026-06-13T14:00:00+00:00",
    "end_date": "2026-06-14T02:00:00+00:00",
    "form_config": {
      "kiosk": {
        "home": { "background_url": "https://medias.example.com/fonds/accueil.jpg", "personalized": true },
        "capture": { "…": "…" },
        "printer": { "…": "…" },
        "locale": "fr"
      }
    }
  },
  "design": {
    "id": "c3d4e5f6-0718-4293-a4b5-c6d7e8f90a1b",
    "format": "portrait",
    "canvas_json": {
      "version": "5.3.0",
      "objects": [
        { "type": "rect", "left": 40, "top": 60, "width": 320, "height": 400, "isPhotoZone": true }
      ]
    },
    "final_png_url": "https://example.supabase.co/storage/v1/object/public/designs/c3d4e5f6.png"
  },
  "assets": {
    "design_png": "iVBORw0KGgoAAAANSUhEUgAA…",
    "home_background": "/9j/4AAQSkZJRgABAQAAAQAB…",
    "logo": "iVBORw0KGgoAAAANSUhEUgAA…"
  },
  "contact": {
    "company": "Studio Exemple",
    "phone": "+33 1 XX XX XX XX",
    "logo_url": "https://medias.example.com/org/logo.png?v=1718000000",
    "email": "contact@example.com"
  }
}
```

---

## 5. Changer le format

Toute évolution qui casse la lecture d'un ancien fichier fait monter `version`. Il faut alors
modifier ensemble `polaBundle.js` et `PolaBundle.cs`, ainsi que leurs tests, et mettre à jour ce
document.
