// Point d'entrée unique de Fabric.js (LAB-435, passage à Fabric 7).
//
// Tout le SaaS importe Fabric depuis ce module, jamais depuis 'fabric' directement (règle ESLint
// no-restricted-imports). Importer ce module force, une seule fois et avant tout usage, les réglages
// de Fabric 5 que Fabric 7 a changés. Ainsi les canvas_json déjà enregistrés gardent exactement la
// même géométrie, et le JSON écrit reste lisible par la borne (qui suit la géométrie de Fabric 5.3.0).
//
// Réglages forcés :
// - originX 'left' / originY 'top' : Fabric 7 a passé l'origine par défaut au centre. Les designs
//   existants n'ont pas toujours ces champs, et la borne lit left/top comme le coin haut gauche.
// - types en minuscules ('rect', 'group', 'i-text', 'activeSelection'…) : Fabric 7 écrit 'Rect',
//   'Group'… dans le JSON. La borne et le SaaS comparent les types tels que Fabric 5 les écrivait.
// - stopContextMenu, fireRightClick, fireMiddleClick à false (vrai en Fabric 7) : sinon Fabric
//   bloque le menu contextuel natif et l'éditeur ne reçoit plus son clic droit.
// - NUM_FRACTION_DIGITS à 6 : précision des nombres écrits dans le JSON (4 par défaut en Fabric 7).
//
// Le décalage des lignes barrées et surlignées a changé de valeur en Fabric 7, mais le calcul a
// changé avec : le rendu est le même qu'en Fabric 5, on n'y touche pas.

// eslint-disable-next-line no-restricted-imports
import {
  ActiveSelection,
  BaseFabricObject,
  Canvas,
  Circle,
  Ellipse,
  FabricImage,
  FabricText,
  Group,
  IText,
  Line,
  Path,
  Polygon,
  Polyline,
  Rect,
  Textbox,
  Triangle,
  config,
} from 'fabric'

// eslint-disable-next-line no-restricted-imports
export * from 'fabric'

BaseFabricObject.ownDefaults.originX = 'left'
BaseFabricObject.ownDefaults.originY = 'top'

// Canvas.ownDefaults est l'objet des défauts du canvas interactif (hérité de SelectableCanvas).
Canvas.ownDefaults.stopContextMenu = false
Canvas.ownDefaults.fireRightClick = false
Canvas.ownDefaults.fireMiddleClick = false

config.configure({ NUM_FRACTION_DIGITS: 6 })

// Noms de type de Fabric 5. Le registre des classes connaît déjà ces noms (Fabric les enregistre aussi
// en minuscules), donc un JSON écrit par Fabric 5 ou par Fabric 7 se recharge dans les deux cas.
const LEGACY_TYPES = [
  [Rect, 'rect'],
  [Circle, 'circle'],
  [Ellipse, 'ellipse'],
  [Line, 'line'],
  [Path, 'path'],
  [Polygon, 'polygon'],
  [Polyline, 'polyline'],
  [Triangle, 'triangle'],
  [FabricText, 'text'],
  [IText, 'i-text'],
  [Textbox, 'textbox'],
  [FabricImage, 'image'],
  [Group, 'group'],
  [ActiveSelection, 'activeSelection'],
]
for (const [klass, type] of LEGACY_TYPES) klass.type = type

// Image introuvable (fichier supprimé, réseau) : Fabric 5 la sautait et chargeait le reste du design ;
// Fabric 7 fait échouer tout le chargement. On garde le comportement de Fabric 5 pour le reste du
// design, sans perdre l'image : elle est remplacée par une image vide (rien n'est dessiné), à sa
// place et à sa taille, et elle est réécrite telle quelle (même adresse) à l'enregistrement.
const loadImageFromObject = FabricImage.fromObject
FabricImage.fromObject = async function fromObjectOrPlaceholder(object, options) {
  try {
    return await loadImageFromObject.call(this, object, options)
  } catch (err) {
    if (options?.signal?.aborted) throw err
    console.warn('Image du design introuvable, laissée vide :', object?.src, err?.message ?? err)
    const { src, filters, resizeFilter, ...rest } = object
    const placeholder = await loadImageFromObject.call(this, { ...rest, src: '' }, options)
    placeholder.missingImage = true
    placeholder.toObject = function toObjectWithMissingImage(propertiesToInclude) {
      const out = FabricImage.prototype.toObject.call(this, propertiesToInclude)
      return { ...out, src, filters: filters ?? [], ...(resizeFilter ? { resizeFilter } : {}) }
    }
    return placeholder
  }
}

// Fabric 7 met le type de l'instance en minuscules ('activeselection') : on rend le nom de Fabric 5
// tel quel ('activeSelection'), que l'éditeur compare.
Object.defineProperty(BaseFabricObject.prototype, 'type', {
  get() {
    const name = this.constructor.type
    return name === 'FabricObject' ? 'object' : name
  },
  set() {},
  configurable: true,
})
