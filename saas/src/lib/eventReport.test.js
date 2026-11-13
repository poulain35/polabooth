// LAB-236 : mise en forme du bilan client (fonctions pures de eventReport.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PHOTOS, REPORT_UTM, UNAVAILABLE_MESSAGE, buildReportView, count, eventDateLabel, formatCount,
  formatDuration, frozenLabel, isProEvent, isReportToken, rebookUrl, reportAudio, reportFigures,
  reportHours, reportPhotos, reportQuestionnaire, reviewUrl,
} from './eventReport.js';
import { bookingBannerLinks } from './galleryBanner.js';
import { BRAND } from './instanceBrand.js';

const TOKEN = '3f2b8c1e-9d4a-4c6b-8e2f-1a2b3c4d5e6f';
const APP = 'https://photobooth.exemple.fr';
// Site vitrine passé explicitement : les tests ne dépendent pas de la marque installée (open core L7).
const SITE = 'https://exemple.fr';
const NBSP = ' ';

const fullReport = () => ({
  name: 'Mariage de Léa et Hugo',
  start_date: '2026-12-12',
  end_date: '2026-12-12',
  company: 'Studio Exemple',
  frozen_at: '2026-12-19T09:30:00+00:00',
  expires_at: '2027-12-19T09:30:00+00:00',
  metrics: {
    sessions: 1234,
    timed_sessions: 1200,
    hours: [
      { day: '2026-12-12', hour: 20, sessions: 300 },
      { day: '2026-12-12', hour: 22, sessions: 500 },
      { day: '2026-12-13', hour: 1, sessions: 400 },
    ],
    prints: 980,
    qr_photos: 210,
    kiosk_emails: 35,
    gallery_opens: 412,
    downloads: 189,
    audio: { messages: 23, seconds: 2460 },
    questionnaire: { responses: 57, consents: 12 },
  },
  photos: [
    { id: 'p1', url: 'https://pub.r2.dev/p1.jpg', thumbnail_url: 'https://pub.r2.dev/p1_t.jpg' },
    { id: 'p2', url: 'https://pub.r2.dev/p2.jpg', thumbnail_url: null },
  ],
  gallery_online: true,
  audio_online: true,
  access_code: 'LEAHUGO',
  review_url: 'https://g.page/r/abc/review',
  client_type: 'particulier',
  event_type: 'mariage',
});

test('jeton : seul un UUID est envoyé au serveur', () => {
  assert.equal(isReportToken(TOKEN), true);
  assert.equal(isReportToken(TOKEN.toUpperCase()), true);
  for (const bad of ['', 'abc', `${TOKEN}x`, null, undefined, 42, "'; drop table x;--"]) assert.equal(isReportToken(bad), false);
});

test('bilan indisponible : payload null ou sans metrics → null, un seul message', () => {
  assert.equal(UNAVAILABLE_MESSAGE, 'Ce bilan n’est plus disponible');
  for (const p of [null, undefined, 'x', {}, { name: 'X' }, { metrics: null }]) assert.equal(buildReportView(p), null);
});

test('nombres : entiers positifs seulement, format français', () => {
  assert.equal(count(12), 12);
  assert.equal(count(0), 0);
  assert.equal(count(2.6), 3);
  for (const bad of [-1, NaN, Infinity, '12', null, undefined]) assert.equal(count(bad), null);
  assert.equal(formatCount(1234), `1${NBSP}234`);
  assert.equal(formatCount(0), '0');
});

test('dates : jour unique, plusieurs jours, gel', () => {
  assert.equal(eventDateLabel('2026-12-12', '2026-12-12'), 'Samedi 12 décembre 2026');
  assert.equal(eventDateLabel('2026-12-12', null), 'Samedi 12 décembre 2026');
  assert.equal(eventDateLabel('2026-12-12', '2026-12-13'), 'Du samedi 12 décembre 2026 au dimanche 13 décembre 2026');
  assert.equal(eventDateLabel(null, null), '');
  assert.equal(frozenLabel('2026-12-19T23:30:00Z'), 'Bilan arrêté au 20 décembre 2026'); // date de Paris
  assert.equal(frozenLabel(null), '');
  assert.equal(frozenLabel('pas une date'), '');
});

test('durée du livre d\'or', () => {
  assert.equal(formatDuration(2460), '41 min');
  assert.equal(formatDuration(3900), '1 h 05 min');
  assert.equal(formatDuration(3600), '1 h');
  assert.equal(formatDuration(20), 'moins d’une minute');
  assert.equal(formatDuration(0), '0 min');
  assert.equal(formatDuration(null), '');
});

test('chiffres : ordre fixe, libellés au pluriel, « ouvertures de la galerie »', () => {
  const figures = reportFigures(fullReport().metrics);
  assert.deepEqual(figures.map((f) => f.key), ['sessions', 'prints', 'qr_photos', 'kiosk_emails', 'gallery_opens', 'downloads']);
  assert.deepEqual(figures.find((f) => f.key === 'gallery_opens'), { key: 'gallery_opens', value: '412', label: 'ouvertures de la galerie' });
  assert.equal(figures[0].value, `1${NBSP}234`);
  assert.equal(figures[0].label, 'séances photo');
});

test('chiffres : clé absente = carte masquée ; 0 affiché au singulier', () => {
  const figures = reportFigures({ sessions: 1, gallery_opens: 0 });
  assert.deepEqual(figures, [
    { key: 'sessions', value: '1', label: 'séance photo' },
    { key: 'gallery_opens', value: '0', label: 'ouverture de la galerie' },
  ]);
  assert.deepEqual(reportFigures({}), []);
  assert.deepEqual(reportFigures(null), []);
  assert.deepEqual(reportFigures({ prints: 'beaucoup' }), []);
});

test('heures : soirée qui passe minuit rattachée à la veille, trous à 0, pic', () => {
  const h = reportHours(fullReport().metrics);
  assert.equal(h.days.length, 1);
  const [d] = h.days;
  assert.equal(d.day, '2026-12-12');
  assert.equal(d.dayLabel, 'Samedi 12 décembre');
  assert.deepEqual(d.rows.map((r) => [r.label, r.sessions]), [['20 h', 300], ['21 h', 0], ['22 h', 500], ['23 h', 0], ['0 h', 0], ['1 h', 400]]);
  assert.equal(d.peak, '22 h – 23 h');
  assert.equal(d.rows[2].ratio, 1);
  assert.equal(h.note, `Calculé sur 1${NBSP}200 séances horodatées sur 1${NBSP}234.`);
});

test('heures : matin sans veille animée = jour à part ; note absente si tout est horodaté', () => {
  const h = reportHours({ sessions: 5, timed_sessions: 5, hours: [{ day: '2026-12-13', hour: 2, sessions: 5 }] });
  assert.equal(h.days[0].day, '2026-12-13');
  assert.equal(h.days[0].peak, '2 h – 3 h');
  assert.equal(h.note, '');
});

test('heures : plusieurs jours (3 au plus), sinon bloc masqué', () => {
  const day = (d) => ({ day: `2026-12-${d}`, hour: 15, sessions: 2 });
  assert.equal(reportHours({ hours: [day(10), day(11), day(12)] }).days.length, 3);
  assert.equal(reportHours({ hours: [day(10), day(11), day(12), day(13)] }), null);
  assert.equal(reportHours({ hours: [] }), null);
  assert.equal(reportHours({}), null);
  assert.equal(reportHours({ hours: [{ day: 'x', hour: 30, sessions: 2 }, { day: '2026-12-10', hour: 4, sessions: 0 }] }), null);
});

test('livre d\'or : messages et durée ; durée inconnue omise ; absent = masqué', () => {
  assert.deepEqual(reportAudio({ audio: { messages: 23, seconds: 2460 } }), { messages: 23, text: '23 messages, 41 min au total' });
  assert.deepEqual(reportAudio({ audio: { messages: 1, seconds: null } }), { messages: 1, text: '1 message' });
  assert.deepEqual(reportAudio({ audio: { messages: 0, seconds: 0 } }), { messages: 0, text: '0 message' });
  assert.equal(reportAudio({}), null);
  assert.equal(reportAudio({ audio: {} }), null);
});

test('questionnaire : compteurs seulement, consentements omis à 0', () => {
  assert.equal(reportQuestionnaire({ questionnaire: { responses: 57, consents: 12 } }).text,
    '57 invités ont répondu au questionnaire, dont 12 ont accepté d’être recontactés.');
  assert.equal(reportQuestionnaire({ questionnaire: { responses: 1, consents: 1 } }).text,
    '1 invité a répondu au questionnaire, dont 1 a accepté d’être recontacté.');
  assert.equal(reportQuestionnaire({ questionnaire: { responses: 4, consents: 0 } }).text, '4 invités ont répondu au questionnaire.');
  assert.equal(reportQuestionnaire({ questionnaire: { responses: 0, consents: 0 } }).text, 'Aucun invité n’a répondu au questionnaire.');
  assert.equal(reportQuestionnaire({}), null);
});

test('photos : miniature sinon photo (pas de vidéo), https seulement, 6 au plus', () => {
  const photos = reportPhotos([
    { id: 'a', url: 'https://x.r2.dev/a.jpg', thumbnail_url: 'https://x.r2.dev/a_t.jpg' },
    { id: 'b', url: 'https://x.r2.dev/b.jpg' },
    { id: 'c', url: 'https://x.r2.dev/c.mp4' },
    { id: 'd', url: 'http://x.r2.dev/d.jpg' },
    { id: 'e', url: 'javascript:alert(1)' },
  ]);
  assert.deepEqual(photos, [{ id: 'a', src: 'https://x.r2.dev/a_t.jpg' }, { id: 'b', src: 'https://x.r2.dev/b.jpg' }]);
  const many = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, url: `https://x.r2.dev/${i}.jpg` }));
  assert.equal(reportPhotos(many).length, MAX_PHOTOS);
  assert.deepEqual(reportPhotos(null), []);
});

test('réserver à nouveau : particulier → disponibilités, utm rapport/email + type', () => {
  assert.equal(rebookUrl(fullReport(), SITE), 'https://exemple.fr/disponibilites/?utm_source=rapport&utm_medium=email&utm_campaign=mariage');
  assert.equal(rebookUrl({ event_type: null }, SITE), 'https://exemple.fr/disponibilites/?utm_source=rapport&utm_medium=email');
});

test('réserver à nouveau : pro → page entreprises avec utm_source=rapport&utm_medium=email', () => {
  assert.equal(isProEvent({ client_type: 'professionnel', event_type: 'soiree' }), true);
  assert.equal(isProEvent({ client_type: null, event_type: ' Entreprise ' }), true);
  assert.equal(isProEvent({ client_type: 'particulier', event_type: 'mariage' }), false);
  const url = rebookUrl({ client_type: 'professionnel', event_type: 'entreprise' }, SITE);
  assert.ok(url.startsWith('https://exemple.fr/pour-les-entreprises/?utm_source=rapport&utm_medium=email'), url);
  assert.equal(new URL(url).searchParams.get('utm_campaign'), 'entreprise');
  assert.equal(rebookUrl({ client_type: 'professionnel' }, SITE), 'https://exemple.fr/pour-les-entreprises/?utm_source=rapport&utm_medium=email');
});

test('bandeau des galeries inchangé par les nouvelles options', () => {
  assert.deepEqual(bookingBannerLinks('mariage', SITE), {
    booking: 'https://exemple.fr/disponibilites/?utm_source=galerie&utm_medium=web&utm_campaign=mariage',
    business: 'https://exemple.fr/pour-les-entreprises/?utm_source=galerie&utm_medium=web',
  });
  assert.equal(bookingBannerLinks('mariage', SITE, { utm: REPORT_UTM }).business,
    'https://exemple.fr/pour-les-entreprises/?utm_source=rapport&utm_medium=email');
});

test('avis : seulement une URL https', () => {
  assert.equal(reviewUrl(fullReport()), 'https://g.page/r/abc/review');
  for (const bad of [null, '', 'http://g.page/r/abc', 'javascript:alert(1)', 'https://a b']) assert.equal(reviewUrl({ review_url: bad }), null);
});

test('vue complète : liens de galerie et d\'écoute avec le code, seulement si en ligne', () => {
  const v = buildReportView(fullReport(), { appUrl: `${APP}/` });
  assert.equal(v.title, 'Mariage de Léa et Hugo');
  assert.equal(v.company, 'Studio Exemple');
  assert.equal(v.date, 'Samedi 12 décembre 2026');
  assert.equal(v.frozen, 'Bilan arrêté au 19 décembre 2026');
  assert.equal(v.galleryUrl, `${APP}/photos/LEAHUGO`);
  assert.equal(v.audio.url, `${APP}/audio/LEAHUGO`);
  assert.equal(v.photos.length, 2);

  const off = buildReportView({ ...fullReport(), gallery_online: false, audio_online: false, access_code: undefined }, { appUrl: APP });
  assert.equal(off.galleryUrl, null);
  assert.equal(off.audio.url, null);
  assert.equal(off.audio.text, '23 messages, 41 min au total');
});

test('vue minimale : blocs sans données masqués, pas de bouton d\'avis, repli des textes', () => {
  const v = buildReportView({ metrics: { sessions: 3 } }, { appUrl: APP, site: SITE });
  assert.equal(v.title, 'Votre événement');
  assert.equal(v.company, BRAND.name, 'repli : nom de la marque installée');
  assert.equal(v.date, '');
  assert.equal(v.frozen, '');
  assert.equal(v.figures.length, 1);
  assert.equal(v.hours, null);
  assert.deepEqual(v.photos, []);
  assert.equal(v.galleryUrl, null);
  assert.equal(v.audio, null);
  assert.equal(v.questionnaire, null);
  assert.equal(v.reviewUrl, null);
  assert.equal(v.rebookUrl, 'https://exemple.fr/disponibilites/?utm_source=rapport&utm_medium=email');
});
