import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchPhotosByAccessCode, getGalleryConfig, getPublicFeatures } from '../lib/supabase';
import { FEATURE_UNAVAILABLE_MESSAGE, hasPublicFeature, isFeatureDisabledError } from '../features/featureGate';
import { animatedMediaLabel, isVideoPhoto } from '../utils/media';
import { Spinner } from '../components/ui/spinner';
import { usePfFonts } from '../components/public/clientEditorStyles';

const SLIDE_MS   = 6000;   // durée d'affichage d'une photo
const REFRESH_MS = 45000;  // intervalle de récupération des nouvelles photos

// Vidéo d'une diapositive : lancée (muette, en boucle) quand elle devient visible, arrêtée et
// rembobinée quand elle disparaît. `autoPlay` ne joue qu'au montage : les diapositives suivantes,
// déjà montées, resteraient figées sur leur affiche. Un GIF ou un boomerang (MP4 courts) tourne
// ainsi en boucle pendant toute la durée de la diapositive.
function SlideVideo({ photo, active }) {
  const ref = useRef(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (active) {
      video.currentTime = 0;
      video.play()?.catch?.(() => {});
    } else {
      video.pause();
    }
  }, [active]);
  return (
    <video
      ref={ref}
      src={photo.photo_url}
      poster={photo.thumbnail_url ?? undefined}
      className="max-h-screen max-w-full object-contain"
      muted
      loop
      playsInline
      preload={active ? 'auto' : 'metadata'}
    />
  );
}

export default function Slideshow() {
  usePfFonts();
  const { code } = useParams();
  const [status,  setStatus]  = useState('loading'); // loading | disabled | unavailable | ready | error
  const [errorMsg, setErrorMsg] = useState('');
  const [photos,  setPhotos]  = useState([]);
  const [index,   setIndex]   = useState(0);

  const lengthRef = useRef(0);
  useEffect(() => { lengthRef.current = photos.length; }, [photos.length]);

  // Chargement initial : vérifie l'activation puis récupère les photos.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [gallery, features] = await Promise.all([getGalleryConfig(code), getPublicFeatures(code)]);
        if (cancelled) return;
        // Galerie désactivée pour l'organisation (fonctionnalité gallery).
        if (!hasPublicFeature(features, 'gallery')) { setStatus('unavailable'); return; }
        if (!gallery?.slideshow_enabled) { setStatus('disabled'); return; }

        const { photos: ph } = await fetchPhotosByAccessCode(code);
        if (cancelled) return;
        setPhotos(ph);
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        if (isFeatureDisabledError(err)) { setStatus('unavailable'); return; }
        setErrorMsg('Impossible de charger le diaporama.'); setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [code]);

  // Rafraîchissement périodique : intègre les nouvelles photos sans recharger.
  useEffect(() => {
    if (status !== 'ready') return;
    const id = setInterval(async () => {
      try {
        const { photos: ph } = await fetchPhotosByAccessCode(code);
        setPhotos((prev) => (ph.length !== prev.length ? ph : prev));
      } catch { /* ignore, on réessaiera au prochain tick */ }
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [status, code]);

  // Défilement automatique.
  useEffect(() => {
    if (status !== 'ready' || photos.length === 0) return;
    const id = setInterval(() => {
      setIndex((i) => (lengthRef.current ? (i + 1) % lengthRef.current : 0));
    }, SLIDE_MS);
    return () => clearInterval(id);
  }, [status, photos.length]);

  if (status === 'loading') return (
    <div className="min-h-screen bg-black font-pola flex items-center justify-center">
      <Spinner className="w-8 h-8 border-white/70" label="Chargement du diaporama" />
    </div>
  );

  if (status === 'disabled') return (
    <div className="min-h-screen bg-black font-pola flex items-center justify-center px-6">
      <p className="text-white/60 text-sm text-center">Le diaporama n'est pas activé pour cet événement.</p>
    </div>
  );

  if (status === 'unavailable') return (
    <div className="min-h-screen bg-black font-pola flex items-center justify-center px-6">
      <p className="text-white/60 text-sm text-center">{FEATURE_UNAVAILABLE_MESSAGE}</p>
    </div>
  );

  if (status === 'error') return (
    <div className="min-h-screen bg-black font-pola flex items-center justify-center px-6">
      <p className="text-white/60 text-sm text-center">{errorMsg}</p>
    </div>
  );

  if (photos.length === 0) return (
    <div className="min-h-screen bg-black font-pola flex flex-col items-center justify-center px-6 gap-4">
      <Spinner className="border-white/70" label="En attente des photos" />
      <p className="text-white/60 text-sm text-center">En attente des premières photos…</p>
    </div>
  );

  const activeIndex = Math.min(index, photos.length - 1);

  return (
    <div className="fixed inset-0 bg-black font-pola overflow-hidden">
      {photos.map((photo, i) => (
        <div
          key={photo.id}
          className="absolute inset-0 flex items-center justify-center transition-opacity duration-1000 ease-in-out"
          style={{ opacity: i === activeIndex ? 1 : 0 }}
        >
          {isVideoPhoto(photo) ? (
            <SlideVideo photo={photo} active={i === activeIndex} />
          ) : (
            <img
              src={photo.photo_url}
              alt=""
              className="max-h-screen max-w-full object-contain"
              draggable={false}
            />
          )}
        </div>
      ))}

      {animatedMediaLabel(photos[activeIndex]) && (
        <div className="absolute top-6 left-6 pointer-events-none">
          <span className="px-3 py-1 rounded-full bg-black/50 text-white/90 text-sm font-semibold tracking-wide">
            {animatedMediaLabel(photos[activeIndex])}
          </span>
        </div>
      )}

      {/* Compteur discret */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none">
        <span className="text-white/40 text-sm">{activeIndex + 1} / {photos.length}</span>
      </div>
    </div>
  );
}
