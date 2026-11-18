import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyGuestMedia, fileExtension } from './media-types.ts';

test('fileExtension : dernier segment en minuscules, null sans extension', () => {
  assert.equal(fileExtension('IMG_0001.JPG'), 'jpg');
  assert.equal(fileExtension('photo.final.Png'), 'png');
  assert.equal(fileExtension('sans-extension'), null);
  assert.equal(fileExtension('point-final.'), null);
});

test('images courantes acceptées, extension de la même famille', () => {
  assert.deepEqual(classifyGuestMedia('image/jpeg', 'photo.jpg'), { ok: true, kind: 'image', ext: 'jpg' });
  assert.deepEqual(classifyGuestMedia('image/jpeg', 'photo-thumb.JPEG'), { ok: true, kind: 'image', ext: 'jpeg' });
  assert.equal(classifyGuestMedia('image/png', 'a.png').ok, true);
  assert.equal(classifyGuestMedia('image/webp', 'a.webp').ok, true);
  assert.equal(classifyGuestMedia('image/heic', 'a.heic').ok, true);
  assert.equal(classifyGuestMedia(' IMAGE/JPEG ', 'a.jpg').ok, true);
});

test('vidéos courantes acceptées, y compris un .mov annoncé video/mp4 (repli du navigateur)', () => {
  assert.deepEqual(classifyGuestMedia('video/mp4', 'clip.mp4'), { ok: true, kind: 'video', ext: 'mp4' });
  assert.deepEqual(classifyGuestMedia('video/quicktime', 'IMG_1234.MOV'), { ok: true, kind: 'video', ext: 'mov' });
  assert.equal(classifyGuestMedia('video/mp4', 'IMG_1234.mov').ok, true);
  assert.equal(classifyGuestMedia('video/webm', 'a.webm').ok, true);
  assert.equal(classifyGuestMedia('video/x-m4v', 'a.m4v').ok, true);
});

test('refus : type hors liste, extension incohérente ou absente', () => {
  assert.equal(classifyGuestMedia('image/svg+xml', 'a.svg').ok, false);
  assert.equal(classifyGuestMedia('image/gif', 'a.gif').ok, false);
  assert.equal(classifyGuestMedia('text/html', 'a.html').ok, false);
  assert.equal(classifyGuestMedia('video/x-matroska', 'a.mkv').ok, false);
  assert.equal(classifyGuestMedia('image/jpeg', 'a.html').ok, false);
  assert.equal(classifyGuestMedia('image/jpeg', 'a.mp4').ok, false);
  assert.equal(classifyGuestMedia('video/mp4', 'a.jpg').ok, false);
  assert.equal(classifyGuestMedia('image/jpeg', 'sans-extension').ok, false);
});
