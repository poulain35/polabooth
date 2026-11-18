// LAB-289 : règles serveur du design par kind, et accord avec le miroir de l'éditeur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as server from './design-kind.ts';
// @ts-ignore module JS de l'éditeur, sans types
import * as client from '../../../src/lib/designKind.js';

test('parseDesignKind : print par défaut, print/home acceptés, le reste refusé', () => {
  assert.equal(server.parseDesignKind(undefined), 'print');
  assert.equal(server.parseDesignKind(null), 'print');
  assert.equal(server.parseDesignKind('home'), 'home');
  for (const v of ['', 'HOME', 'banner', 1, {}, []]) assert.equal(server.parseDesignKind(v), null);
});

test("formatAllowedForKind : un écran d'accueil n'est jamais au format d'impression, et inversement", () => {
  assert.equal(server.formatAllowedForKind('home', 'home'), true);
  assert.equal(server.formatAllowedForKind('home', 'portrait'), false);
  assert.equal(server.formatAllowedForKind('print', 'home'), false);
  assert.equal(server.formatAllowedForKind('print', 'stripH'), true);
});

test('clientCanWriteDesign : un design validé (écran ou cadre) est refusé (LAB-294)', () => {
  assert.equal(server.clientCanWriteDesign('home', 'approved'), false);
  assert.equal(server.clientCanWriteDesign('home', 'rejected'), true);
  assert.equal(server.clientCanWriteDesign('print', 'approved'), false);
  for (const s of [undefined, 'draft', 'submitted', 'rejected']) {
    assert.equal(server.clientCanWriteDesign('print', s), true, String(s));
  }
});

test('designLockedError : message propre à chaque kind, cadre sans « modèle » ni « template »', () => {
  assert.equal(server.designLockedError('home'), server.HOME_LOCKED_ERROR);
  assert.equal(server.designLockedError('print'), 'Votre cadre est validé. Contactez-nous pour le modifier.');
  assert.equal(server.DESIGN_LOCKED_CODE, 'design_locked');
});

test('clientDesignLocked : lit le statut du design de ce kind et de ce slot', async () => {
  const calls: unknown[][] = [];
  const db = (status: string | null) => ({
    from: (table: string) => {
      const q = {
        select: (cols: string) => { calls.push(['select', table, cols]); return q; },
        eq: (col: string, val: unknown) => { calls.push(['eq', col, val]); return q; },
        maybeSingle: async () => ({ data: status ? { status } : null }),
      };
      return q;
    },
  });
  assert.equal(await server.clientDesignLocked(db('approved'), 'e1', 'print', 2), true);
  assert.deepEqual(calls, [
    ['select', 'client_designs', 'status'], ['eq', 'event_id', 'e1'], ['eq', 'kind', 'print'], ['eq', 'slot', 2],
  ]);
  assert.equal(await server.clientDesignLocked(db('submitted'), 'e1', 'print', 1), false);
  assert.equal(await server.clientDesignLocked(db(null), 'e1', 'home', 1), false);
});

test('serveur et éditeur appliquent les mêmes règles', () => {
  assert.deepEqual([...server.DESIGN_KINDS], client.DESIGN_KINDS);
  assert.deepEqual([...server.PRINT_FORMATS], client.PRINT_FORMATS);
  assert.equal(server.HOME_FORMAT_ID, client.HOME_FORMAT_ID);
  assert.equal(server.HOME_LOCKED_ERROR, client.HOME_LOCKED_MESSAGE);
  assert.equal(server.PRINT_LOCKED_ERROR, client.PRINT_LOCKED_MESSAGE);
  for (const kind of ['print', 'home'] as const) assert.equal(server.designLockedError(kind), client.designLockedMessage(kind));
  const values = [undefined, null, 'print', 'home', 'x', 1];
  const formats = ['portrait', 'landscape', 'stripV', 'stripH', 'home', 'carre', undefined];
  const statuses = [undefined, 'draft', 'submitted', 'approved', 'rejected'];
  const configs = [null, {}, { kiosk: { home: { personalized: true, client_design: true } } },
    { kiosk: { home: { personalized: true, client_design: false } } },
    { kiosk: { home: { personalized: false, client_design: true } } }];
  for (const v of values) assert.equal(server.parseDesignKind(v), client.parseDesignKind(v));
  for (const kind of ['print', 'home'] as const) {
    for (const f of formats) assert.equal(server.formatAllowedForKind(kind, f), client.formatAllowedForKind(kind, f));
    for (const s of statuses) assert.equal(server.clientCanWriteDesign(kind, s), client.clientCanWriteDesign(kind, s));
  }
  for (const c of configs) assert.equal(server.homeEditorEnabled(c), client.homeEditorEnabled(c));
});

// ── LAB-312 : plusieurs cadres (slot) ────────────────────────────────────────

const frames = (enabled: unknown, max_frames?: unknown) => ({ kiosk: { frame_choice: { enabled, max_frames } } });

test('parseDesignSlot : 1 par défaut, entiers de 1 à 4 acceptés, le reste refusé', () => {
  assert.equal(server.parseDesignSlot(undefined), 1);
  assert.equal(server.parseDesignSlot(null), 1);
  for (const v of [1, 2, 3, 4]) assert.equal(server.parseDesignSlot(v), v);
  for (const v of [0, 5, -1, 1.5, '2', '', true, {}, [], NaN]) assert.equal(server.parseDesignSlot(v), null, String(v));
});

test("slotAllowedForKind : l'écran d'accueil reste en slot 1", () => {
  assert.equal(server.slotAllowedForKind('home', 1), true);
  assert.equal(server.slotAllowedForKind('home', 2), false);
  assert.equal(server.slotAllowedForKind('print', 4), true);
});

test('frameChoiceConfig : faux et 2 cadres par défaut, booléen strict, max_frames 2 à 4', () => {
  assert.deepEqual(server.frameChoiceConfig(null), { enabled: false, max_frames: 2 });
  assert.deepEqual(server.frameChoiceConfig({}), { enabled: false, max_frames: 2 });
  assert.deepEqual(server.frameChoiceConfig(frames(true, 3)), { enabled: true, max_frames: 3 });
  assert.deepEqual(server.frameChoiceConfig(frames('true', 4)), { enabled: false, max_frames: 4 });
  for (const max of [1, 5, '3', null, 2.5]) assert.equal(server.frameChoiceConfig(frames(true, max)).max_frames, 2, String(max));
});

test('maxFrameSlot / clientCanWriteSlot : choix coupé = cadre 1 seul, sinon jusqu\'à max_frames', () => {
  assert.equal(server.maxFrameSlot(null), 1);
  assert.equal(server.maxFrameSlot(frames(false, 4)), 1);
  assert.equal(server.maxFrameSlot(frames(true)), 2);
  assert.equal(server.maxFrameSlot(frames(true, 3)), 3);
  assert.equal(server.clientCanWriteSlot('print', 1, null), true);
  assert.equal(server.clientCanWriteSlot('print', 2, null), false);
  assert.equal(server.clientCanWriteSlot('print', 3, frames(true, 3)), true);
  assert.equal(server.clientCanWriteSlot('print', 4, frames(true, 3)), false);
  assert.equal(server.clientCanWriteSlot('home', 1, null), true);
  assert.equal(server.clientCanWriteSlot('home', 2, frames(true, 4)), false);
});

test('clientCanDeleteFrame : jamais le cadre 1, ni un cadre validé, ni l\'écran d\'accueil', () => {
  assert.equal(server.clientCanDeleteFrame('print', 2, 'draft'), true);
  assert.equal(server.clientCanDeleteFrame('print', 3, 'submitted'), true);
  assert.equal(server.clientCanDeleteFrame('print', 2, 'rejected'), true);
  assert.equal(server.clientCanDeleteFrame('print', 2, 'approved'), false);
  assert.equal(server.clientCanDeleteFrame('print', 1, 'draft'), false);
  assert.equal(server.clientCanDeleteFrame('home', 2, 'draft'), false);
});

test('parseFrameLabel : absent = inchangé, blanc = null, 24 caractères au plus', () => {
  assert.equal(server.parseFrameLabel(undefined), undefined);
  assert.equal(server.parseFrameLabel(42), undefined);
  assert.equal(server.parseFrameLabel(null), null);
  assert.equal(server.parseFrameLabel('   '), null);
  assert.equal(server.parseFrameLabel('  Bande  '), 'Bande');
  assert.equal(server.parseFrameLabel('x'.repeat(40)), 'x'.repeat(24));
  assert.equal(Array.from(server.parseFrameLabel('🎉'.repeat(30)) as string).length, 24);
});

test('cadres : serveur et éditeur appliquent les mêmes règles', () => {
  assert.equal(server.MAX_FRAME_SLOTS, client.MAX_FRAME_SLOTS);
  assert.deepEqual([...server.FRAME_CHOICE_MAX_FRAMES], client.FRAME_CHOICE_MAX_FRAMES);
  assert.equal(server.DEFAULT_MAX_FRAMES, client.DEFAULT_MAX_FRAMES);
  assert.equal(server.FRAME_LABEL_MAX_LENGTH, client.FRAME_LABEL_MAX_LENGTH);
  assert.equal(server.FRAME_LIMIT_ERROR, client.FRAME_LIMIT_MESSAGE);
  assert.equal(server.FRAME_LOCKED_ERROR, client.FRAME_LOCKED_MESSAGE);
  assert.equal(server.FIRST_FRAME_ERROR, client.FIRST_FRAME_MESSAGE);
  const slots = [undefined, null, 0, 1, 2, 3, 4, 5, '2', 1.5];
  const configs = [null, {}, frames(true), frames(true, 3), frames(true, 4), frames(false, 4), frames('true', 3), frames(true, 9)];
  const labels = [undefined, null, '', '  ', 'Cadre 1', 'x'.repeat(30), 7];
  for (const v of slots) assert.equal(server.parseDesignSlot(v), client.parseDesignSlot(v));
  for (const c of configs) {
    assert.deepEqual(server.frameChoiceConfig(c), client.frameChoiceConfig(c));
    assert.equal(server.maxFrameSlot(c), client.maxFrameSlot(c));
  }
  for (const l of labels) assert.equal(server.parseFrameLabel(l), client.parseFrameLabel(l));
  for (const kind of ['print', 'home'] as const) {
    for (const slot of [1, 2, 3, 4]) {
      assert.equal(server.slotAllowedForKind(kind, slot), client.slotAllowedForKind(kind, slot));
      for (const c of configs) assert.equal(server.clientCanWriteSlot(kind, slot, c), client.clientCanWriteSlot(kind, slot, c));
      for (const s of [undefined, 'draft', 'submitted', 'approved', 'rejected']) {
        assert.equal(server.clientCanDeleteFrame(kind, slot, s), client.clientCanDeleteFrame(kind, slot, s));
      }
    }
  }
});
