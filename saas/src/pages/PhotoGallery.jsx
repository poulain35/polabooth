import JSZip from 'jszip';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { fetchPhotosByAccessCode, getGalleryConfig, getPublicFeatures, trackGalleryEvent } from '../lib/supabase';
import { FEATURE_UNAVAILABLE_MESSAGE, hasPublicFeature, isFeatureDisabledError } from '../features/featureGate';
import { shouldShowBookingBanner } from '../lib/galleryBanner';
import { qrLinkParams } from '../lib/galleryTracking';
import { animatedMediaLabel, isVideoPhoto } from '../utils/media';
import GalleryBookingBanner, { BAR_OFFSET_VAR } from '../components/GalleryBookingBanner';
import GuestUploader from '../components/GuestUploader';
import BrandLogo from '../components/BrandLogo';
import { BRAND } from '../lib/instanceBrand';

const PAGE_SIZE = 60; // photos rendues par paquet (défilement infini)

// ── Helpers fichier ───────────────────────────────────────────────────────────
const pad2 = (n) => String(n).padStart(2, '0');

// Base de nom horodatée (heure locale du visiteur) → tri chronologique = ordre d'upload.
// Repli sur un index si created_at est absent/invalide.
function timestampBase(createdAt, index) {
  const d = createdAt ? new Date(createdAt) : null;
  if (!d || Number.isNaN(d.getTime())) return `photo-${String(index + 1).padStart(3, '0')}`;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`;
}

function photoFilename(photo, index) {
  const src = photo.storage_path ?? photo.photo_url ?? '';
  const ext = src.split('?')[0].split('.').pop()?.toLowerCase() || 'jpg';
  return `${timestampBase(photo.created_at, index)}.${ext}`;
}

async function fetchPhotoFile(photo, index) {
  const res = await fetch(photo.download_url ?? photo.photo_url);
  if (!res.ok) throw new Error(`Téléchargement échoué (${res.status})`);
  const blob = await res.blob();
  return new File([blob], photoFilename(photo, index), { type: blob.type || 'image/jpeg' });
}

// ── Télécharger une photo ─────────────────────────────────────────────────────
async function downloadPhoto(photo, index, code) {
  if (!photo.storage_path && !photo.download_url) {
    trackGalleryEvent(code, 'download');
    window.open(photo.share_url ?? photo.photo_url, '_blank'); // photo fotoshare externe
    return;
  }
  const file = await fetchPhotoFile(photo, index);
  const url  = URL.createObjectURL(file);
  const a    = document.createElement('a');
  a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  trackGalleryEvent(code, 'download');
}

// ── Partager une photo (Web Share API, repli copie du lien) ────────────────────
async function sharePhoto(photo, index, code) {
  // 1) Partage natif du fichier (mobile) — permet d'enregistrer dans la pellicule
  try {
    const file = await fetchPhotoFile(photo, index);
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
      trackGalleryEvent(code, 'share');
      return;
    }
  } catch (e) {
    if (e?.name === 'AbortError') return; // annulé par l'utilisateur
  }
  // 2) Repli : partager / copier le lien direct vers la photo
  const link = `${window.location.origin}${window.location.pathname}?photo=${photo.id}`;
  try {
    if (navigator.share) { await navigator.share({ url: link }); trackGalleryEvent(code, 'share'); return; }
  } catch (e) {
    if (e?.name === 'AbortError') return;
  }
  await navigator.clipboard.writeText(link);
  trackGalleryEvent(code, 'share');
}

// ── ZIP d'une liste de photos ─────────────────────────────────────────────────
async function zipDownload(list, filename, onProgress) {
  const items = list.filter((p) => p.download_url || p.storage_path);
  if (items.length === 0) return 0;
  const zip = new JSZip();
  const used = new Map(); // dédoublonne les noms identiques (photos de la même seconde)
  for (let i = 0; i < items.length; i++) {
    const p   = items[i];
    const res = await fetch(p.download_url ?? p.photo_url);
    if (!res.ok) throw new Error(`Téléchargement échoué (${res.status})`);
    let name = photoFilename(p, i);
    const seen = used.get(name) ?? 0;
    used.set(name, seen + 1);
    if (seen > 0) {
      const dot = name.lastIndexOf('.');
      name = `${name.slice(0, dot)}-${seen + 1}${name.slice(dot)}`;
    }
    zip.file(name, await res.arrayBuffer());
    onProgress?.(Math.round(((i + 1) / items.length) * 100));
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  return items.length;
}

// ── Icônes ────────────────────────────────────────────────────────────────────
const ICON = {
  download: <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />,
  share:    <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />,
  check:    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />,
};
const Spinner = ({ sz = 'w-4 h-4' }) => (
  <svg className={`${sz} animate-spin`} viewBox="0 0 24 24" fill="none">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

// ── Petit bouton d'action (télécharger / partager) ────────────────────────────
function ActionBtn({ action, icon, title, photo, index, code, small = false, idleClass = 'text-gray-400 hover:text-primary' }) {
  const [state, setState] = useState('idle');
  async function handle(e) {
    e.stopPropagation();
    setState('loading');
    try { await action(photo, index, code); setState('done'); }
    catch { setState('error'); }
    setTimeout(() => setState('idle'), 2000);
  }
  const sz  = small ? 'w-4 h-4' : 'w-5 h-5';
  const cls = `shrink-0 transition-colors ${
    state === 'done' ? 'text-green-500' : state === 'error' ? 'text-red-400' : state === 'loading' ? 'text-gray-300' : idleClass
  }`;
  return (
    <button onClick={handle} title={title} className={cls}>
      {state === 'loading' ? <Spinner sz={sz} />
        : state === 'done' ? <svg className={sz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>{ICON.check}</svg>
        : <svg className={sz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>{icon}</svg>}
    </button>
  );
}

// ── Bouton tout télécharger (ZIP) ─────────────────────────────────────────────
function DownloadAllBtn({ photos, eventName, code }) {
  const [state, setState] = useState('idle');
  const [progress, setProgress] = useState(0);
  async function handle() {
    if (state === 'loading') return;
    setState('loading'); setProgress(0);
    try {
      const n = await zipDownload(photos, `${eventName || 'photos'}.zip`, setProgress);
      trackGalleryEvent(code, 'download_all', n);
      setState('done');
    } catch { setState('error'); }
    setTimeout(() => setState('idle'), 3000);
  }
  return (
    <button onClick={handle} disabled={state === 'loading'}
      className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-all ${
        state === 'done' ? 'bg-green-50 text-green-600 border-green-200' :
        state === 'error' ? 'bg-red-50 text-red-500 border-red-200' :
        state === 'loading' ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed' :
        'bg-card text-gray-600 border-gray-200 hover:border-primary hover:text-primary shadow-sm'
      }`}>
      {state === 'loading' ? <><Spinner />{progress}%</>
        : state === 'done' ? <><svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>{ICON.check}</svg>Téléchargé !</>
        : <><svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>{ICON.download}</svg>Tout télécharger</>}
    </button>
  );
}

export default function PhotoGallery() {
  const { code } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [status,      setStatus]      = useState('loading');
  const [errorMsg,    setErrorMsg]    = useState('');
  const [photos,      setPhotos]      = useState([]);
  const [eventId,     setEventId]     = useState(null);
  const [eventName,   setEventName]   = useState('');
  const [companyName, setCompanyName] = useState('');
  const [banner,      setBanner]      = useState({ enabled: false, eventType: '' });
  const [lightbox,    setLightbox]    = useState(null);
  const [slideDir,    setSlideDir]    = useState(null);          // 'next' | 'prev' | null
  const [zoom,        setZoom]        = useState({ scale: 1, x: 0, y: 0 });
  const [interacting, setInteracting] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);   // défilement infini
  const [selectMode,  setSelectMode]  = useState(false);
  const [selected,    setSelected]    = useState(() => new Set());
  const [selProgress, setSelProgress] = useState(null);
  const [showTop,     setShowTop]     = useState(false);
  const [galleryConfig, setGalleryConfig] = useState(null);
  const [showUploader,  setShowUploader]  = useState(false);
  const [activeTab,   setActiveTab]   = useState('all');          // 'all' | 'photobooth' | 'guest'

  const sentinelRef = useRef(null);
  const gestureRef  = useRef(null);
  const lastTapRef  = useRef(0);
  // Lien du QR code de la borne (?photo=…&via=qr) : transmis au premier chargement seulement (LAB-232).
  const qrLinkRef   = useRef(qrLinkParams(searchParams));

  useEffect(() => {
    const featuresPromise = getPublicFeatures(code); // ne rejette jamais
    const link = qrLinkRef.current;
    qrLinkRef.current = {};
    fetchPhotosByAccessCode(code, link)
      .then(async (result) => [result, await featuresPromise])
      .then(([{ event, photos: ph, companyName: cn, bookingBanner: bannerSetting, eventType }, features]) => {
        // Galerie désactivée pour l'organisation (fonctionnalité gallery).
        if (!hasPublicFeature(features, 'gallery')) { setStatus('unavailable'); return; }
        setEventId(event.id);
        setEventName(event.name ?? '');
        setCompanyName(cn);
        // Bandeau de réservation : seulement si la réservation en ligne (booking) est active.
        const bookingBanner = bannerSetting && hasPublicFeature(features, 'booking');
        setBanner({ enabled: bookingBanner, eventType });
        setPhotos(ph);
        if (ph.length === 0) { setErrorMsg('Aucune photo disponible pour cet événement.'); setStatus('error'); }
        else { setStatus('ready'); trackGalleryEvent(code, 'view'); }
      })
      .catch((err) => {
        if (isFeatureDisabledError(err)) { setStatus('unavailable'); return; }
        setErrorMsg('Impossible de charger la galerie.'); setStatus('error');
      });
  }, [code]);

  useEffect(() => {
    getGalleryConfig(code).then(setGalleryConfig).catch(() => setGalleryConfig({}));
  }, [code]);

  const guestUploadEnabled = galleryConfig?.guest_upload_enabled === true;

  // ── Onglets par source (filtrage 100 % client) ───────────────────────────────
  const isGuest = (p) => p.source === 'guest';
  const isPhotobooth = (p) => p.source === 'kiosk' || p.source === 'admin';
  const guestCount = useMemo(() => photos.filter(isGuest).length, [photos]);
  const photoboothCount = useMemo(() => photos.filter(isPhotobooth).length, [photos]);
  const showTabs = guestCount > 0 && photoboothCount > 0;
  const filtered = useMemo(() => {
    if (!showTabs || activeTab === 'all') return photos;
    if (activeTab === 'guest') return photos.filter(isGuest);
    return photos.filter(isPhotobooth);
  }, [photos, activeTab, showTabs]);

  // Applique default_tab une fois la config chargée (si présent et pertinent)
  useEffect(() => {
    const def = galleryConfig?.default_tab;
    if (def === 'photobooth' || def === 'guest' || def === 'all') setActiveTab(def);
  }, [galleryConfig?.default_tab]);

  // Reset défilement infini + sélection au changement d'onglet
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    setSelectMode(false);
    setSelected(new Set());
  }, [activeTab]);

  const openLightbox = useCallback((photo) => {
    setLightbox(photo);
    setVisibleCount((c) => Math.max(c, filtered.findIndex((p) => p.id === photo.id) + 1));
    setSearchParams({ photo: photo.id }, { replace: true });
  }, [setSearchParams, filtered]);

  const closeLightbox = useCallback(() => {
    setLightbox(null);
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  // Auto-ouvre le lightbox si ?photo= présent dans l'URL (QR code kiosk, lien partagé)
  useEffect(() => {
    const photoId = searchParams.get('photo');
    if (photoId && photos.length > 0) {
      const found = photos.find((p) => p.id === photoId);
      if (found && (!lightbox || lightbox.id !== found.id)) {
        // Bascule sur « Tout » si la photo liée n'est pas dans l'onglet actif (nav/compteur cohérents)
        if (showTabs && !filtered.some((p) => p.id === found.id)) setActiveTab('all');
        setLightbox(found);
      }
    }
  }, [searchParams, photos]); // eslint-disable-line react-hooks/exhaustive-deps

  function showPrev() {
    const idx = filtered.findIndex((p) => p.id === lightbox.id);
    if (idx > 0) { setSlideDir('prev'); openLightbox(filtered[idx - 1]); }
  }
  function showNext() {
    const idx = filtered.findIndex((p) => p.id === lightbox.id);
    if (idx >= 0 && idx < filtered.length - 1) { setSlideDir('next'); openLightbox(filtered[idx + 1]); }
  }

  const toggleZoom = () => setZoom((z) => (z.scale > 1 ? { scale: 1, x: 0, y: 0 } : { scale: 2.5, x: 0, y: 0 }));

  // Réinitialise le zoom à chaque changement de photo
  useEffect(() => { setZoom({ scale: 1, x: 0, y: 0 }); }, [lightbox?.id]);

  // Précharge les voisines pour une transition sans blanc
  useEffect(() => {
    if (!lightbox) return;
    const idx = filtered.findIndex((p) => p.id === lightbox.id);
    [idx - 1, idx + 1].forEach((i) => {
      if (i >= 0 && i < filtered.length && !isVideoPhoto(filtered[i])) { const im = new Image(); im.src = filtered[i].photo_url; }
    });
  }, [lightbox, filtered]);

  // Clavier
  useEffect(() => {
    if (!lightbox) return;
    function onKey(e) {
      if (e.key === 'ArrowLeft')  showPrev();
      if (e.key === 'ArrowRight') showNext();
      if (e.key === 'Escape')     zoom.scale > 1 ? setZoom({ scale: 1, x: 0, y: 0 }) : closeLightbox();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox, photos, zoom.scale]); // eslint-disable-line react-hooks/exhaustive-deps

  // Défilement infini
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) setVisibleCount((c) => Math.min(c + PAGE_SIZE, filtered.length));
    }, { rootMargin: '600px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [filtered.length]);

  // Bouton « remonter en haut »
  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 800);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // ── Gestes tactiles lightbox (pinch zoom, pan, swipe nav, swipe-down close) ──
  const tDist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  function onTouchStart(e) {
    setInteracting(true);
    if (e.touches.length === 2) {
      gestureRef.current = { type: 'pinch', d0: tDist(e.touches[0], e.touches[1]), s0: zoom.scale };
    } else if (e.touches.length === 1) {
      const t = e.touches[0];
      gestureRef.current = { type: 'drag', x0: t.clientX, y0: t.clientY, ox: zoom.x, oy: zoom.y, s: zoom.scale, moved: false };
    }
  }
  function onTouchMove(e) {
    const g = gestureRef.current;
    if (!g) return;
    if (g.type === 'pinch' && e.touches.length >= 2) {
      const scale = Math.min(4, Math.max(1, g.s0 * tDist(e.touches[0], e.touches[1]) / g.d0));
      setZoom((z) => ({ ...z, scale }));
    } else if (g.type === 'drag' && e.touches.length === 1) {
      const t = e.touches[0];
      const dx = t.clientX - g.x0, dy = t.clientY - g.y0;
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) g.moved = true;
      if (g.s > 1) setZoom((z) => ({ ...z, x: g.ox + dx, y: g.oy + dy }));
    }
  }
  function onTouchEnd(e) {
    const g = gestureRef.current;
    gestureRef.current = null;
    setInteracting(false);
    if (!g) return;
    if (g.type === 'pinch') { if (zoom.scale <= 1.05) setZoom({ scale: 1, x: 0, y: 0 }); return; }
    const t = e.changedTouches[0];
    const dx = t.clientX - g.x0, dy = t.clientY - g.y0;
    if (!g.moved) { // tap → double-tap = zoom
      const now = Date.now();
      if (now - lastTapRef.current < 300) { toggleZoom(); lastTapRef.current = 0; }
      else lastTapRef.current = now;
      return;
    }
    if (g.s > 1) return; // on panne une image zoomée : pas de navigation
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { dx < 0 ? showNext() : showPrev(); return; }
    if (dy > 90 && dy > Math.abs(dx)) closeLightbox(); // swipe vers le bas = fermer
  }

  // ── Sélection multiple ───────────────────────────────────────────────────────
  function toggleSelect(id) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function exitSelect() { setSelectMode(false); setSelected(new Set()); }
  async function downloadSelected() {
    const list = filtered.filter((p) => selected.has(p.id));
    if (!list.length || selProgress !== null) return;
    setSelProgress(0);
    try {
      const n = await zipDownload(list, `${eventName || 'photos'}-selection.zip`, setSelProgress);
      trackGalleryEvent(code, 'download_selection', n);
    }
    catch { /* ignore */ }
    finally { setSelProgress(null); }
  }

  function onTileClick(photo) {
    if (selectMode) toggleSelect(photo.id);
    else { setSlideDir(null); openLightbox(photo); }
  }

  if (status === 'loading') return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (status === 'unavailable') return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6">
      <p className="text-gray-500 text-sm text-center">{FEATURE_UNAVAILABLE_MESSAGE}</p>
    </div>
  );

  if (status === 'error') return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6">
      <div className="text-center">
        <svg className="w-12 h-12 text-gray-300 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <p className="text-gray-500 text-sm">{errorMsg}</p>
        {guestUploadEnabled && eventId && (
          <button
            onClick={() => setShowUploader(true)}
            className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-pink-500 to-violet-600 hover:from-pink-600 hover:to-violet-700 transition-all shadow-sm"
          >
            ＋ Ajouter mes photos
          </button>
        )}
      </div>
      {showUploader && guestUploadEnabled && eventId && (
        <GuestUploader
          code={code} eventId={eventId} config={galleryConfig}
          onClose={() => setShowUploader(false)}
          onUploaded={() => fetchPhotosByAccessCode(code).then(({ photos: ph }) => { if (ph.length) { setPhotos(ph); setStatus('ready'); } }).catch(() => {})}
        />
      )}
    </div>
  );

  const lightboxIdx = lightbox ? filtered.findIndex((p) => p.id === lightbox.id) : -1;
  const visible = filtered.slice(0, visibleCount);
  // Barre réservation fixe en bas (LAB-142), masquée sous la visionneuse, l'upload et la sélection.
  const showBanner = shouldShowBookingBanner({ enabled: banner.enabled, itemCount: filtered.length });
  const bannerHidden = Boolean(lightbox) || showUploader || selectMode;
  // Boutons fixes du bas posés au-dessus de la barre (0 px quand elle est masquée ou fermée).
  const aboveBar = { bottom: `calc(var(${BAR_OFFSET_VAR}, 0px) + 1rem)` };

  const renderTile = (photo) => {
    const isSel = selected.has(photo.id);
    return (
      <div key={photo.id} className="break-inside-avoid mb-2">
        <div
          className={`relative group overflow-hidden rounded-xl cursor-pointer bg-gray-100 transition-all ${
            isSel ? 'ring-2 ring-primary ring-offset-2' : ''
          }`}
          style={{ aspectRatio: photo.width && photo.height ? `${photo.width} / ${photo.height}` : '3 / 4' }}
          onClick={() => onTileClick(photo)}
        >
          {/* Skeleton pulsé sous l'image */}
          <div className="absolute inset-0 animate-pulse bg-gray-200" />
          <img
            src={photo.thumbnail_url ?? (isVideoPhoto(photo) ? undefined : photo.photo_url)}
            alt=""
            className="absolute inset-0 w-full h-full object-cover opacity-0 transition-all duration-300 group-hover:scale-[1.02]"
            loading="lazy"
            onLoad={(e) => { e.currentTarget.style.opacity = '1'; }}
            onError={(e) => { e.currentTarget.style.opacity = '1'; }}
          />

          {/* Badge lecture pour les vidéos */}
          {isVideoPhoto(photo) && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-11 h-11 rounded-full bg-black/45 flex items-center justify-center">
                <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              </div>
            </div>
          )}

          {/* Badge GIF / Boomerang de la borne (LAB-235), en haut à droite : la sélection est à gauche */}
          {animatedMediaLabel(photo) && (
            <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/55 text-white text-[11px] font-semibold tracking-wide pointer-events-none">
              {animatedMediaLabel(photo)}
            </span>
          )}

          {/* Pastille de sélection */}
          {selectMode && (
            <div className={`absolute top-2 left-2 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
              isSel ? 'bg-primary/100 border-primary' : 'bg-black/20 border-white/80'
            }`}>
              {isSel && <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>{ICON.check}</svg>}
            </div>
          )}

          {/* Actions au survol (masquées en mode sélection) */}
          {!selectMode && (
            <>
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all" />
              <div className="absolute bottom-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                <div className="w-7 h-7 bg-card/90 rounded-lg flex items-center justify-center">
                  <ActionBtn action={sharePhoto} icon={ICON.share} title="Partager" photo={photo} index={filtered.indexOf(photo)} code={code} small />
                </div>
                <div className="w-7 h-7 bg-card/90 rounded-lg flex items-center justify-center">
                  <ActionBtn action={downloadPhoto} icon={ICON.download} title="Télécharger" photo={photo} index={filtered.indexOf(photo)} code={code} small />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-16">
      {/* Header */}
      <div className="flex flex-col items-center pt-10 pb-6 px-4">
        <div className="mb-4"><BrandLogo variant="square" alt={companyName || BRAND.name} className="h-10 w-auto" /></div>
        {companyName && <p className="text-xs font-semibold text-primary uppercase tracking-widest mb-1">{companyName}</p>}
        {eventName && <h1 className="text-xl font-semibold text-gray-800 text-center">{eventName}</h1>}
        <p className="text-xs text-gray-400 mt-0.5">{filtered.length} photo{filtered.length !== 1 ? 's' : ''}</p>

        {/* Onglets par source (masqués si une seule source présente) */}
        {showTabs && (
          <div className="mt-4 inline-flex items-center gap-1 p-1 rounded-full bg-gray-100">
            {[
              { key: 'all',        label: 'Tout',       count: photos.length },
              { key: 'photobooth', label: 'Photobooth', count: photoboothCount },
              { key: 'guest',      label: 'Invités',    count: guestCount },
            ].map((t) => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                  activeTab === t.key ? 'bg-card text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.label} <span className={activeTab === t.key ? 'text-primary' : 'text-gray-400'}>{t.count}</span>
              </button>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          {guestUploadEnabled && (
            <button
              onClick={() => setShowUploader(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-pink-500 to-violet-600 hover:from-pink-600 hover:to-violet-700 transition-all shadow-sm"
            >
              ＋ Ajouter mes photos
            </button>
          )}
          {filtered.length > 1 && (
            <>
              <DownloadAllBtn photos={filtered} eventName={eventName} code={code} />
              <button
                onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
                className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${
                  selectMode ? 'bg-primary/10 text-primary border-primary/20' : 'bg-card text-gray-600 border-gray-200 hover:border-primary hover:text-primary shadow-sm'
                }`}
              >
                {selectMode ? 'Annuler' : 'Sélectionner'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Grille masonry */}
      <div className="columns-2 sm:columns-3 md:columns-4 gap-2 px-4">
        {visible.map(renderTile)}
      </div>

      {/* Sentinelle défilement infini */}
      {visibleCount < filtered.length && (
        <div ref={sentinelRef} className="flex justify-center py-8">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Barre réservation fixe (son espaceur réserve sa hauteur en bas de page) */}
      {showBanner && <GalleryBookingBanner eventType={banner.eventType} hidden={bannerHidden} />}

      {/* Barre de sélection */}
      {selectMode && selected.size > 0 && (
        <div style={aboveBar} className="fixed left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-card shadow-lg border border-gray-200 rounded-2xl px-4 py-2.5">
          <span className="text-sm text-gray-600 font-medium">{selected.size} sélectionnée{selected.size > 1 ? 's' : ''}</span>
          <button
            onClick={downloadSelected}
            disabled={selProgress !== null}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium bg-primary text-white hover:bg-primary disabled:opacity-60 transition-colors"
          >
            {selProgress !== null
              ? <><Spinner />{selProgress}%</>
              : <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>{ICON.download}</svg>Télécharger</>}
          </button>
        </div>
      )}

      {/* Remonter en haut */}
      {showTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          style={aboveBar}
          className="fixed right-4 z-40 w-11 h-11 rounded-full bg-card shadow-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:text-primary transition-colors"
          title="Remonter en haut" aria-label="Remonter en haut"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </svg>
        </button>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 bg-black/95 z-50 flex items-center justify-center"
          onClick={closeLightbox}
          role="dialog" aria-modal="true" aria-label="Photo en plein écran"
        >
          {/* Contrôles haut-droite */}
          <div className="absolute top-4 right-4 flex items-center gap-3 z-10" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-card/10 border border-white/20 backdrop-blur-sm">
              <ActionBtn action={sharePhoto} icon={ICON.share} title="Partager" photo={lightbox} index={lightboxIdx} code={code} idleClass="text-white hover:text-primary" />
              <ActionBtn action={downloadPhoto} icon={ICON.download} title="Télécharger" photo={lightbox} index={lightboxIdx} code={code} idleClass="text-white hover:text-primary" />
            </div>
            <button className="text-white/60 hover:text-white" onClick={closeLightbox} aria-label="Fermer">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Précédent */}
          {lightboxIdx > 0 && zoom.scale === 1 && (
            <button className="absolute left-4 text-white/60 hover:text-white z-10 p-2 hidden sm:block"
              onClick={(e) => { e.stopPropagation(); showPrev(); }} aria-label="Photo précédente">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}

          {/* Média (wrapper = animation d'entrée ; img = zoom/pan, vidéo = contrôles natifs) */}
          {isVideoPhoto(lightbox) ? (
            <div
              key={lightbox.id}
              className={slideDir === 'next' ? 'lb-anim-next' : slideDir === 'prev' ? 'lb-anim-prev' : 'lb-anim-fade'}
              onClick={(e) => e.stopPropagation()}
            >
              {/* GIF et boomerang : joués en boucle, sans son ni contrôles, comme une image animée. */}
              {animatedMediaLabel(lightbox) ? (
                <video
                  src={lightbox.photo_url}
                  poster={lightbox.thumbnail_url ?? undefined}
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg"
                />
              ) : (
                <video
                  src={lightbox.photo_url}
                  poster={lightbox.thumbnail_url ?? undefined}
                  controls
                  autoPlay
                  playsInline
                  className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg"
                />
              )}
            </div>
          ) : (
            <div
              key={lightbox.id}
              className={slideDir === 'next' ? 'lb-anim-next' : slideDir === 'prev' ? 'lb-anim-prev' : 'lb-anim-fade'}
              style={{ touchAction: 'none' }}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={toggleZoom}
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
            >
              <img
                src={lightbox.photo_url}
                alt=""
                draggable={false}
                className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg select-none"
                style={{
                  transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`,
                  transition: interacting ? 'none' : 'transform 0.2s ease-out',
                  cursor: zoom.scale > 1 ? 'grab' : 'zoom-in',
                }}
              />
            </div>
          )}

          {/* Suivant */}
          {lightboxIdx < filtered.length - 1 && zoom.scale === 1 && (
            <button className="absolute right-4 text-white/60 hover:text-white z-10 p-2 hidden sm:block"
              onClick={(e) => { e.stopPropagation(); showNext(); }} aria-label="Photo suivante">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}

          {/* Compteur */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 pointer-events-none">
            <span className="text-white/50 text-sm">{lightboxIdx + 1} / {filtered.length}</span>
          </div>
        </div>
      )}

      {/* Feuille d'upload invité */}
      {showUploader && guestUploadEnabled && eventId && (
        <GuestUploader
          code={code} eventId={eventId} config={galleryConfig}
          onClose={() => setShowUploader(false)}
          onUploaded={() => fetchPhotosByAccessCode(code).then(({ photos: ph }) => setPhotos(ph)).catch(() => {})}
        />
      )}
    </div>
  );
}
