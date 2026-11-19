// Environnement Fabric pour les tests node (LAB-435) : node n'a ni document ni canvas 2D.
// À importer AVANT tout objet Fabric dans un fichier de test. Fabric 7 mesure les textes avec le
// contexte 2D d'un canvas qu'il crée lui-même : on lui donne un faux document dont le canvas mesure
// chaque caractère à 0,5 × la taille de la police. Ce fichier n'est jamais importé par l'application.
import { setEnv } from './fabric.js';

const fakeContext = () => ({
  font: '',
  textBaseline: 'alphabetic',
  measureText(s) {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 16);
    return { width: s.length * size * 0.5 };
  },
  save() {}, restore() {}, scale() {}, translate() {}, setTransform() {}, transform() {},
  beginPath() {}, closePath() {}, rect() {}, fill() {}, stroke() {}, clip() {}, clearRect() {},
  fillRect() {}, strokeRect() {}, fillText() {}, strokeText() {}, drawImage() {}, moveTo() {},
  lineTo() {}, arc() {}, bezierCurveTo() {}, quadraticCurveTo() {}, setLineDash() {},
});

const fakeCanvas = () => ({
  width: 0,
  height: 0,
  style: {},
  getContext: () => fakeContext(),
  setAttribute() {},
  removeAttribute() {},
  hasAttribute: () => false,
});

// Image : aucune n'est téléchargée, toute adresse échoue (comme un fichier introuvable).
const fakeImage = () => {
  const img = { style: {}, width: 0, height: 0, naturalWidth: 0, naturalHeight: 0, setAttribute() {}, onload: null, onerror: null };
  let src = '';
  Object.defineProperty(img, 'src', {
    get: () => src,
    set(value) {
      src = value;
      queueMicrotask(() => img.onerror?.());
    },
  });
  return img;
};

const fakeDocument = {
  createElement: (tag) => (tag === 'canvas' ? fakeCanvas() : tag === 'img' ? fakeImage() : { style: {}, setAttribute() {} }),
  documentElement: { style: {} },
};

setEnv({
  document: fakeDocument,
  window: { devicePixelRatio: 1, navigator: {} },
  isTouchSupported: false,
  WebGLProbe: { queryWebGL() {}, isSupported: () => false },
  dispose() {},
  copyPasteData: {},
});
