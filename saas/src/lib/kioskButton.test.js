import { test } from 'node:test';
import assert from 'node:assert/strict';
import './fabricTestEnv.js';
import { FabricText, Group, Rect, util } from './fabric.js';
import {
  applyButtonShapeChange,
  applyButtonTextChange,
  buttonShape,
  buttonShapeStyle,
  buttonTextFields,
  colorForInput,
  textIndexAt,
} from './kioskButton.js';
import { boundingBox, buildScreenLayout, ownMatrix } from './kioskScreenLayout.js';
import { kioskScreenTemplate } from './kioskScreenTemplates.js';

const close = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;
const enliven = async (o) => (await util.enlivenObjects([o]))[0];
const templateButtons = async (kind) => Promise.all(
  kioskScreenTemplate(kind).objects.filter((o) => o.type === 'group' && o.kioskAction).map((o) => enliven(o)),
);
const absCenter = (g) => ({ x: ownMatrix(g).cx, y: ownMatrix(g).cy });
const kids = (g) => g._objects;
const shapeOf = (g) => buttonShape(g);

// Contour dans la boîte du groupe (le PNG est recadré sur cette boîte).
function assertShapeInsideGroup(g, where) {
  const b = boundingBox(shapeOf(g));
  assert.ok(b.minX >= -g.width / 2 - 0.02 && b.maxX <= g.width / 2 + 0.02, `${where} : déborde en largeur`);
  assert.ok(b.minY >= -g.height / 2 - 0.02 && b.maxY <= g.height / 2 + 0.02, `${where} : déborde en hauteur`);
}

function toolButton(label = 'Photos') {
  const caption = new FabricText(label, {
    fontFamily: 'DM Sans', fontWeight: '600', fontSize: 14, fill: '#F7F1E7',
    originX: 'center', originY: 'center', left: 0, top: 0,
  });
  const w = Math.max(110, Math.ceil(caption.width) + 48);
  const shape = new Rect({
    width: w, height: 52, rx: 26, ry: 26, fill: '#24412F', strokeWidth: 0,
    originX: 'center', originY: 'center', left: 0, top: 0,
  });
  const g = new Group([shape, caption], { left: 480, top: 270, originX: 'center', originY: 'center' });
  g.kioskAction = 'gallery';
  return g;
}

test('champs : un par texte, « Titre » et « Sous-titre » pour une tuile', async () => {
  const home = await templateButtons('home');
  for (const g of home) assert.deepEqual(buttonTextFields(g).map((f) => f.label), ['Texte du bouton'], g.kioskAction);
  const result = await templateButtons('result');
  const tile = result.find((g) => g.kioskAction === 'email');
  const fields = buttonTextFields(tile);
  assert.deepEqual(fields.map((f) => f.label), ['Titre', 'Sous-titre']);
  assert.equal(kids(tile)[fields[0].index].text, 'Email');
  assert.equal(kids(tile)[fields[1].index].text, 'Dans votre boîte mail');
  for (const g of result.filter((x) => !['email', 'qr'].includes(x.kioskAction))) {
    assert.deepEqual(buttonTextFields(g).map((f) => f.label), ['Texte du bouton'], g.kioskAction);
  }
  assert.deepEqual(buttonTextFields(toolButton()).map((f) => f.label), ['Texte du bouton']);
});

test('double-clic : le texte sous le point, sinon null', async () => {
  const tile = (await templateButtons('result')).find((g) => g.kioskAction === 'qr');
  const [title, subtitle] = buttonTextFields(tile).map((f) => f.index);
  const at = (i) => { const b = boundingBox(kids(tile)[i]); return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }; };
  assert.equal(textIndexAt(tile, at(title)), title);
  assert.equal(textIndexAt(tile, at(subtitle)), subtitle);
  assert.equal(textIndexAt(tile, { x: tile.width / 2 - 1, y: tile.height / 2 - 1 }), null);
});

test('forme réglée : la plus grande du groupe (pilule de l’accueil, pas la pastille)', async () => {
  const start = (await templateButtons('home')).find((g) => g.kioskAction === 'start');
  assert.equal(shapeOf(start).type, 'rect');
  assert.equal(shapeOf(start).fill, '#24412F');
  const minus = (await templateButtons('result')).find((g) => g.kioskAction === 'copies_minus');
  assert.equal(shapeOf(minus).type, 'circle');
  assert.equal(buttonShape(new Group([new FabricText('x')])), null);
});

test('texte modifié sur chaque bouton des modèles : action, centre et contour gardés', async () => {
  for (const kind of ['home', 'result']) {
    for (const g of await templateButtons(kind)) {
      const where = `${kind} : ${g.kioskAction}`;
      const c0 = absCenter(g);
      for (const { index } of buttonTextFields(g)) {
        assert.ok(applyButtonTextChange(g, index, { text: 'Un texte bien plus long que celui du modèle' }, { minSize: 50 }), where);
        assert.equal(kids(g)[index].text, 'Un texte bien plus long que celui du modèle');
      }
      assert.ok(g.kioskAction, where);
      const c1 = absCenter(g);
      assert.ok(close(c0.x, c1.x) && close(c0.y, c1.y), `${where} : centre déplacé`);
      // Le groupe englobe tous ses enfants, centrés sur lui.
      for (const o of kids(g)) {
        const b = boundingBox(o);
        assert.ok(b.minX >= -g.width / 2 - 0.02 && b.maxX <= g.width / 2 + 0.02, `${where} : enfant hors du groupe`);
        assert.ok(b.minY >= -g.height / 2 - 0.02 && b.maxY <= g.height / 2 + 0.02, `${where} : enfant hors du groupe`);
      }
      assertShapeInsideGroup(g, where);
      // Les textes restent dans la forme.
      const s = boundingBox(shapeOf(g));
      for (const { index } of buttonTextFields(g)) {
        const b = boundingBox(kids(g)[index]);
        assert.ok(b.minY >= s.minY - 0.02 && b.maxY <= s.maxY + 0.02, `${where} : texte hors de la forme`);
      }
    }
  }
});

test('texte long dans un modèle : passe à la ligne, la forme grandit en hauteur, marges gardées', async () => {
  const gallery = (await templateButtons('home')).find((g) => g.kioskAction === 'gallery');
  const shape = shapeOf(gallery);
  const [{ index }] = buttonTextFields(gallery);
  const text = kids(gallery)[index];
  const w0 = gallery.width;
  const h0 = gallery.height;
  const textW0 = text.width;
  const marginTop0 = boundingBox(text).minY - boundingBox(shape).minY;
  applyButtonTextChange(gallery, index, { text: 'Voir toutes les photos de la soirée' });
  assert.equal(text.width, textW0, 'largeur du Textbox gardée');
  assert.ok(text.textLines.length > 1, 'retour à la ligne');
  assert.ok(close(gallery.width, w0), 'largeur du bouton gardée');
  assert.ok(gallery.height > h0 + 5, 'le bouton grandit en hauteur');
  assert.ok(close(boundingBox(text).minY - boundingBox(shape).minY, marginTop0), 'marge du haut gardée');
  assert.ok(close(shape.rx, shape.height / 2), 'pilule gardée');
});

test('tuile : le sous-titre suit le titre qui passe sur deux lignes', async () => {
  const tile = (await templateButtons('result')).find((g) => g.kioskAction === 'email');
  const [t, s] = buttonTextFields(tile).map((f) => kids(tile)[f.index]);
  const gap0 = boundingBox(s).minY - boundingBox(t).maxY;
  applyButtonTextChange(tile, kids(tile).indexOf(t), { text: 'Recevoir les photos par email tout de suite' });
  assert.ok(t.textLines.length > 1);
  assert.ok(close(boundingBox(s).minY - boundingBox(t).maxY, gap0), 'écart titre / sous-titre gardé');
});

test('bouton de l’outil « Bouton » : le texte simple élargit la forme, puis la rend', () => {
  const g = toolButton('Photos');
  const shape = shapeOf(g);
  const w0 = shape.width;
  const left0 = g.left;
  applyButtonTextChange(g, 1, { text: 'Voir toutes les photos de la soirée' }, { minSize: 50 });
  assert.ok(shape.width > w0 + 50, 'la forme s’élargit');
  assert.ok(close(shape.width - kids(g)[1].width, w0 - 42 - 1, 1), 'marges gardées');
  assert.equal(g.left, left0, 'centre gardé (origine centre)');
  applyButtonTextChange(g, 1, { text: 'Photos' }, { minSize: 50 });
  assert.ok(close(shape.width, w0), 'retour à la taille d’origine');
  assert.ok(close(g.width, w0), 'groupe recalculé');
});

test('texte court : la forme ne descend pas sous la taille minimale', () => {
  const g = toolButton('Voir toutes les photos');
  applyButtonTextChange(g, 1, { text: 'A', fontSize: 4 }, { minSize: 50 });
  assert.ok(shapeOf(g).width >= 50 - 1e-6);
  assert.ok(shapeOf(g).height >= 50 - 1e-6);
});

test('police, taille et couleur d’un texte du bouton', async () => {
  const finish = (await templateButtons('result')).find((g) => g.kioskAction === 'finish');
  const [{ index }] = buttonTextFields(finish);
  const h0 = finish.height;
  applyButtonTextChange(finish, index, { fontFamily: 'Fraunces', fontWeight: '600', fontSize: 20, fill: '#6E5140' });
  const t = kids(finish)[index];
  assert.equal(t.fontFamily, 'Fraunces');
  assert.equal(t.fontSize, 20);
  assert.equal(t.fill, '#6E5140');
  assert.ok(finish.height > h0, 'texte plus grand : bouton plus haut');
});

test('groupe tourné et agrandi : il garde sa transformation et son centre', () => {
  const g = toolButton('Photos');
  g.set({ angle: 30, scaleX: 1.5, scaleY: 1.5 });
  const c0 = absCenter(g);
  applyButtonTextChange(g, 1, { text: 'Toutes les photos' });
  assert.equal(g.angle, 30);
  assert.equal(g.scaleX, 1.5);
  const c1 = absCenter(g);
  assert.ok(close(c0.x, c1.x) && close(c0.y, c1.y));
});

test('l’état relu par Fabric garde le texte, la forme et l’action', async () => {
  const qr = (await templateButtons('result')).find((g) => g.kioskAction === 'qr');
  const [{ index }] = buttonTextFields(qr);
  applyButtonTextChange(qr, index, { text: 'Code QR à scanner avec votre téléphone' });
  applyButtonShapeChange(qr, { stroke: '#24412F', strokeWidth: 2 });
  const json = { ...qr.toObject(['kioskAction']), kioskAction: qr.kioskAction };
  const again = await enliven(JSON.parse(JSON.stringify(json)));
  assert.equal(again.kioskAction, 'qr');
  assert.equal(again._objects[index].text, 'Code QR à scanner avec votre téléphone');
  assert.ok(close(again.width, qr.width) && close(again.height, qr.height));
  assert.equal(shapeOf(again).stroke, '#24412F');
});

test('plan de l’écran : le bouton suit sa nouvelle boîte', async () => {
  const state = kioskScreenTemplate('home');
  const g = await enliven(state.objects.find((o) => o.kioskAction === 'gallery'));
  const before = buildScreenLayout([g.toObject(['kioskAction'])], 'home').layout.buttons[0];
  applyButtonTextChange(g, buttonTextFields(g)[0].index, { text: 'Voir toutes les photos de la soirée' });
  const after = buildScreenLayout([{ ...g.toObject(['kioskAction']), kioskAction: 'gallery' }], 'home').layout.buttons[0];
  assert.equal(after.action, 'gallery');
  assert.ok(after.h > before.h, 'boîte plus haute');
  assert.ok(Math.abs((after.y + after.h / 2) - (before.y + before.h / 2)) <= 1, 'centre gardé');
});

// ── Forme ──

test('style de la forme : remplissage, arrondi (rectangle seulement), contour', async () => {
  const [start, gallery] = await templateButtons('home');
  const s = buttonShapeStyle(start);
  assert.equal(s.fill, '#24412F');
  assert.equal(s.hasRadius, true);
  assert.ok(close(s.radius, s.radiusMax), 'pilule');
  assert.equal(s.stroke, null);
  assert.equal(s.strokeWidth, 0);
  const sg = buttonShapeStyle(gallery);
  assert.equal(sg.stroke, '#24412F');
  assert.ok(sg.strokeWidth > 0);
  const minus = (await templateButtons('result')).find((g) => g.kioskAction === 'copies_minus');
  const sc = buttonShapeStyle(minus);
  assert.equal(sc.type, 'circle');
  assert.equal(sc.hasRadius, false);
});

test('remplissage et arrondi : bornés, le groupe ne bouge pas', async () => {
  const print = (await templateButtons('result')).find((g) => g.kioskAction === 'print');
  const box0 = { w: print.width, h: print.height, l: print.left, t: print.top };
  applyButtonShapeChange(print, { fill: '#EBC9C3' });
  assert.equal(shapeOf(print).fill, '#EBC9C3');
  applyButtonShapeChange(print, { radius: 4 });
  assert.equal(shapeOf(print).rx, 4);
  assert.equal(shapeOf(print).ry, 4);
  applyButtonShapeChange(print, { radius: 9999 });
  assert.ok(close(shapeOf(print).rx, Math.min(shapeOf(print).width, shapeOf(print).height) / 2));
  applyButtonShapeChange(print, { radius: -3 });
  assert.equal(shapeOf(print).rx, 0);
  for (const [k, v] of Object.entries({ w: print.width, h: print.height, l: print.left, t: print.top })) {
    assert.ok(close(v, box0[k], 1e-6), `${k} : ${v} ≠ ${box0[k]}`);
  }
});

test('contour ajouté, épaissi, retiré : il reste dans la boîte du groupe, la boîte ne bouge pas', async () => {
  const buttons = [...await templateButtons('home'), ...await templateButtons('result'), toolButton()];
  for (const g of buttons) {
    const where = g.kioskAction;
    const box0 = { w: g.width, h: g.height, cx: absCenter(g).x, cy: absCenter(g).y };
    const sameBox = () => close(g.width, box0.w) && close(g.height, box0.h)
      && close(absCenter(g).x, box0.cx) && close(absCenter(g).y, box0.cy);
    for (const strokeWidth of [1, 3, 8]) {
      applyButtonShapeChange(g, { stroke: '#9DB09A', strokeWidth });
      assert.equal(shapeOf(g).stroke, '#9DB09A');
      assert.equal(shapeOf(g).strokeWidth, strokeWidth, `${where} : épaisseur ${strokeWidth}`);
      assertShapeInsideGroup(g, `${where} contour ${strokeWidth}`);
      assert.ok(sameBox(), `${where} : boîte du groupe modifiée (contour ${strokeWidth})`);
    }
    applyButtonShapeChange(g, { stroke: null });
    assert.equal(shapeOf(g).stroke, null);
    assert.equal(shapeOf(g).strokeWidth, 0);
    assert.ok(sameBox(), `${where} : boîte modifiée après retrait du contour`);
  }
});

test('contour : épaisseur bornée par la moitié de la forme ; un cercle relu ne bouge pas', async () => {
  const minus = (await templateButtons('result')).find((g) => g.kioskAction === 'copies_minus');
  applyButtonShapeChange(minus, { stroke: '#FFFFFF', strokeWidth: 999 });
  const c = shapeOf(minus);
  assert.ok(c.radius >= 0.5);
  assertShapeInsideGroup(minus, 'cercle');
  applyButtonShapeChange(minus, { strokeWidth: 3.3 });
  const first = c.toObject();
  const second = (await enliven(JSON.parse(JSON.stringify(first)))).toObject();
  assert.deepEqual(second, first, 'cercle modifié à la relecture (LAB-317)');
});

test('couleurs du sélecteur', () => {
  assert.equal(colorForInput('#24412F'), '#24412F');
  assert.equal(colorForInput('rgba(0,0,0,0)'), 'transparent');
  assert.equal(colorForInput(null), 'transparent');
  assert.equal(colorForInput('rgba(247,241,231,0.5)'), '#F7F1E7');
});
