import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Link2, ExternalLink, ImageIcon, X, RotateCcw, Trash2, Check, Loader2, Play } from 'lucide-react';
import {
  supabase, fetchPhotos, getPhotoUploadUrl,
  savePhoto, deletePhoto, updateEventAlbumName, fetchGalleryStats,
  setPhotoStatus, setPhotosStatus,
} from '../../lib/supabase';
import { isVideoFile, isHeicFile, heicToJpeg, videoPoster, isVideoPhoto } from '../../utils/media';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs';

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const APP_URL = (import.meta.env.VITE_APP_URL ?? window.location.origin).replace(/\/$/, "");

function generateThumbnail(file, maxWidth = 800) {
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const width = img.width, height = img.height; // dimensions natives
      const ratio = Math.min(1, maxWidth / width);
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(width  * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => resolve({ blob, width, height }), 'image/jpeg', 0.75);
    };
    img.src = objectUrl;
  });
}

function uploadToR2(presignedUrl, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload  = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`Upload échoué: ${xhr.status}`));
    xhr.onerror = () => reject(new Error('Erreur réseau'));
    xhr.open('PUT', presignedUrl);
    xhr.setRequestHeader('Content-Type', file.type || 'image/jpeg');
    xhr.send(file);
  });
}

// Réessaie une opération asynchrone (backoff linéaire) face aux erreurs réseau transitoires
async function withRetry(fn, { attempts = 3, delayMs = 1500 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw lastErr;
}

// Origine d'une photo : le photobooth ('kiosk'/'admin') ou un invité ('guest').
function SourceBadge({ source }) {
  const isGuest = source === 'guest';
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full shadow-sm ${
      isGuest ? 'bg-violet-600/90 text-white' : 'bg-card/90 text-gray-600'
    }`}>
      {isGuest ? 'Invité' : 'Photobooth'}
    </span>
  );
}

export default function AdminPhotoEvent() {
  const { id } = useParams();
  const [event,    setEvent]    = useState(null);
  const [photos,   setPhotos]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [upload,   setUpload]   = useState(null); // { total, done, failed, percent } pendant un import
  const [summary,  setSummary]  = useState(null); // { total, uploaded, failed:[{name,error}] } après import
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [copied,   setCopied]   = useState(false);
  const [albumName, setAlbumName] = useState('');
  const [savingAlbum, setSavingAlbum] = useState(false);
  const [lightbox, setLightbox] = useState(null); // photo en plein écran
  const [stats, setStats] = useState(null);
  const [tab, setTab] = useState('all'); // 'all' | 'pending'
  const [modSelected, setModSelected] = useState(new Set()); // sélection pour la modération par lot
  const [moderating, setModerating] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    async function load() {
      const { data: ev } = await supabase
        .from('events')
        .select('id, name, client_name, access_code, album_name')
        .eq('id', id)
        .single();
      setEvent(ev);
      setAlbumName(ev?.album_name ?? '');
      const ph = await fetchPhotos(id).catch(() => []);
      setPhotos(ph);
      setLoading(false);
      fetchGalleryStats(id).then(setStats).catch(() => {});
    }
    load();
  }, [id]);

  // ── Upload ──────────────────────────────────────────────────────────────────

  const processFiles = useCallback(async (files) => {
    const mediaFiles = Array.from(files).filter(
      (f) => f.type.startsWith('image/') || f.type.startsWith('video/')
        || /\.(jpg|jpeg|png|gif|webp|heic|heif|mp4|mov|m4v|webm)$/i.test(f.name)
    );
    if (mediaFiles.length === 0) return;

    const total = mediaFiles.length;
    const progressByKey = {};
    let done = 0, failed = 0;
    const failedDetails = [];
    const recompute = () => {
      const sum = Object.values(progressByKey).reduce((a, b) => a + b, 0);
      setUpload({ total, done, failed, percent: Math.round(sum / total) });
    };

    setSummary(null);
    setUpload({ total, done: 0, failed: 0, percent: 0 });

    for (let i = 0; i < mediaFiles.length; i++) {
      let file = mediaFiles[i];
      const originalName = file.name;
      progressByKey[i] = 0;
      recompute();
      try {
        // Vidéo : on garde le fichier original, la vignette est un poster extrait d'une frame.
        // HEIC : converti en JPEG pour être lisible dans tous les navigateurs.
        const isVideo = isVideoFile(file);
        let thumb = null;
        if (isVideo) {
          thumb = await videoPoster(file).catch(() => null);
        } else {
          if (isHeicFile(file)) file = await heicToJpeg(file);
          thumb = await generateThumbnail(file);
        }

        const contentType = file.type || (isVideo ? 'video/mp4' : 'image/jpeg');

        // Uploads + enregistrement avec retry (seule la partie réseau est réessayée)
        const photo = await withRetry(async () => {
          const { presigned_url, public_url, storage_path } =
            await getPhotoUploadUrl({ event_id: id, filename: file.name, content_type: contentType });

          let thumbnail_url = null;
          if (thumb) {
            const thumbFilename = file.name.replace(/\.[^.]+$/, '') + '-thumb.jpg';
            const t = await getPhotoUploadUrl({ event_id: id, filename: thumbFilename, content_type: 'image/jpeg' });
            thumbnail_url = t.public_url;
            await Promise.all([
              uploadToR2(presigned_url,   file,       (pct) => { progressByKey[i] = pct; recompute(); }),
              uploadToR2(t.presigned_url, thumb.blob, () => {}),
            ]);
          } else {
            await uploadToR2(presigned_url, file, (pct) => { progressByKey[i] = pct; recompute(); });
          }

          return await savePhoto({
            event_id: id, photo_url: public_url, storage_path, thumbnail_url,
            width: thumb?.width ?? null, height: thumb?.height ?? null,
          });
        });

        setPhotos((prev) => [...prev, photo]);
        done++;
      } catch (err) {
        failed++;
        failedDetails.push({ name: originalName, error: err?.message ?? 'Erreur inconnue', file: mediaFiles[i] });
      }
      progressByKey[i] = 100;
      recompute();
    }

    // Masque la barre de progression et affiche le récap
    setUpload(null);
    setSummary({ total, uploaded: done, failed: failedDetails });
  }, [id]);

  // Ré-import : reprend uniquement les fichiers qui ont échoué
  const retryFailed = useCallback(() => {
    const files = summary?.failed?.map((f) => f.file).filter(Boolean) ?? [];
    if (files.length === 0) return;
    setSummary(null);
    processFiles(files);
  }, [summary, processFiles]);

  function handleFileInput(e) { processFiles(e.target.files); e.target.value = ''; }
  function handleDrop(e) { e.preventDefault(); setDragging(false); processFiles(e.dataTransfer.files); }

  // ── Suppression ─────────────────────────────────────────────────────────────

  async function handleDelete(photoId) {
    if (!window.confirm('Supprimer cette photo ?')) return;
    await deletePhoto(photoId).catch(() => {});
    setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    setSelected((prev) => { const next = new Set(prev); next.delete(photoId); return next; });
  }

  async function handleDeleteSelected() {
    if (!window.confirm(`Supprimer ${selected.size} photo${selected.size > 1 ? 's' : ''} ?`)) return;
    setDeleting(true);
    await Promise.allSettled([...selected].map(deletePhoto));
    setPhotos((prev) => prev.filter((p) => !selected.has(p.id)));
    setSelected(new Set());
    setDeleting(false);
  }

  function toggleSelect(photoId) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(photoId) ? next.delete(photoId) : next.add(photoId);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => prev.size === photos.length ? new Set() : new Set(photos.map((p) => p.id)));
  }

  // ── Modération ────────────────────────────────────────────────────────────────

  const pendingPhotos = photos.filter((p) => p.status === 'pending');

  function toggleModSelect(photoId) {
    setModSelected((prev) => {
      const next = new Set(prev);
      next.has(photoId) ? next.delete(photoId) : next.add(photoId);
      return next;
    });
  }

  function toggleModSelectAll() {
    setModSelected((prev) => prev.size === pendingPhotos.length ? new Set() : new Set(pendingPhotos.map((p) => p.id)));
  }

  async function reviewOne(photoId, status) {
    await setPhotoStatus(photoId, status).catch(() => {});
    setPhotos((prev) => prev.map((p) => (p.id === photoId ? { ...p, status } : p)));
    setModSelected((prev) => { const next = new Set(prev); next.delete(photoId); return next; });
  }

  async function reviewSelected(status) {
    if (modSelected.size === 0) return;
    setModerating(true);
    const ids = [...modSelected];
    await setPhotosStatus(ids, status).catch(() => {});
    setPhotos((prev) => prev.map((p) => (modSelected.has(p.id) ? { ...p, status } : p)));
    setModSelected(new Set());
    setModerating(false);
  }

  // ── Album name ──────────────────────────────────────────────────────────────

  async function saveAlbumName() {
    setSavingAlbum(true);
    await updateEventAlbumName(id, albumName.trim()).catch(() => {});
    setEvent((prev) => ({ ...prev, album_name: albumName.trim() }));
    setSavingAlbum(false);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const webhookUrl = `${FUNCTIONS_URL}/photo-webhook`;

  if (loading) return (
    <div className="flex justify-center py-24">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-4">
        <Link to="/admin/photos" className="hover:text-gray-600 transition-colors">Galerie photos</Link>
        <span>›</span>
        <span className="text-gray-700 font-medium">{event?.name ?? id}</span>
      </div>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">{event?.name}</h1>
        {event && (
          <p className="text-sm text-gray-400 mt-0.5">
            {event.client_name} · Code : <span className="font-mono font-medium text-gray-600">{event.access_code}</span>
          </p>
        )}

        {/* Lien client */}
        {event && (
          <div className="mt-3 flex items-center gap-2 bg-muted/50 border border-gray-200 rounded-xl px-3 py-2">
            <Link2 className="w-4 h-4 text-gray-400 shrink-0" />
            <span className="flex-1 text-xs text-gray-500 font-mono truncate">
              {APP_URL}/photos/{event.access_code}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 shrink-0"
              onClick={() => { navigator.clipboard.writeText(`${APP_URL}/photos/${event.access_code}`); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
            >
              {copied ? '✓ Copié' : 'Copier'}
            </Button>
            <a href={`${APP_URL}/photos/${event.access_code}`} target="_blank" rel="noopener noreferrer"
              className="shrink-0 text-gray-400 hover:text-primary transition-colors">
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        )}

        {/* Statistiques du lien partagé */}
        {stats && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
            {[
              { label: 'Ouvertures', value: stats.views, hint: 'du lien' },
              { label: 'Téléchargements', value: stats.downloads, hint: 'de photos' },
              { label: 'Partages', value: stats.shares, hint: 'de photos' },
            ].map((s) => (
              <div key={s.label} className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-center">
                <p className="text-2xl font-semibold text-gray-900 leading-tight">{s.value}</p>
                <p className="text-xs font-medium text-gray-600">{s.label}</p>
                <p className="text-[11px] text-gray-400">{s.hint}</p>
              </div>
            ))}
          </div>
        )}
        {stats?.lastActivity && (
          <p className="text-[11px] text-gray-400 mt-1.5">
            Dernière activité : {new Date(stats.lastActivity).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
      </div>

      {/* Configuration webhook */}
      <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 mb-6">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Configuration webhook photobooth</p>
        <div className="flex flex-col gap-3">
          {/* Album name */}
          <div className="flex items-center gap-2">
            <Label className="text-xs text-gray-500 w-24 shrink-0">Nom d'album</Label>
            <Input
              value={albumName}
              onChange={(e) => setAlbumName(e.target.value)}
              onBlur={saveAlbumName}
              onKeyDown={(e) => e.key === 'Enter' && saveAlbumName()}
              placeholder={event?.name ?? 'Nom de l\'album dans le logiciel'}
              className="flex-1 h-8 text-xs"
            />
            {savingAlbum && <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />}
          </div>
          {/* Webhook URL */}
          <div className="flex items-center gap-2">
            <Label className="text-xs text-gray-500 w-24 shrink-0">URL webhook</Label>
            <code className="flex-1 text-[11px] bg-card border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-700 truncate">{webhookUrl}</code>
            <Button
              variant="outline"
              size="sm"
              className="h-8 whitespace-nowrap"
              onClick={() => navigator.clipboard.writeText(webhookUrl)}
            >
              Copier
            </Button>
          </div>
          {/* Params */}
          <div className="text-[11px] text-gray-400 leading-relaxed pl-26">
            <span className="text-gray-500 font-medium">Paramètres : </span>
            param1 = chemin fichier · param2 = URL photo · param3 = type · param4 = nom album
          </div>
        </div>
      </div>

      {/* Zone d'upload */}
      <div
        className={`border-2 border-dashed rounded-2xl p-4 sm:p-8 text-center cursor-pointer transition-all mb-6 ${
          dragging ? 'border-primary bg-primary/10' : 'border-gray-200 bg-gray-50 hover:border-primary hover:bg-primary/10'
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input ref={fileInputRef} type="file" accept="image/*,video/*,.heic,.heif,.mov,.mp4" multiple className="hidden" onChange={handleFileInput} />
        <div className="flex flex-col items-center gap-2 text-gray-400">
          <ImageIcon className="w-8 h-8" />
          <p className="text-sm font-medium text-gray-600">Glissez vos photos et vidéos ici</p>
          <p className="text-xs">ou cliquez pour choisir · JPG, PNG, HEIC, MP4, MOV…</p>
        </div>
      </div>

      {/* Progression d'import (barre unique pour tous les fichiers) */}
      {upload && (
        <div className="bg-card rounded-xl border border-gray-200 px-4 py-3 mb-4">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="font-medium text-gray-600">
              {upload.done + upload.failed < upload.total
                ? `Import de ${upload.total} photo${upload.total > 1 ? 's' : ''}…`
                : 'Import terminé'}
            </span>
            <span className="text-gray-400 shrink-0">
              {upload.done}/{upload.total}
              {upload.failed > 0 && <span className="text-destructive"> · {upload.failed} échec{upload.failed > 1 ? 's' : ''}</span>}
            </span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${upload.percent}%` }} />
          </div>
        </div>
      )}

      {/* Récap de fin d'import */}
      {summary && (
        <div className={`mb-4 rounded-xl border px-4 py-3 ${
          summary.failed.length === 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'
        }`}>
          <div className="flex items-start justify-between gap-3">
            <div className="text-sm">
              <p className="font-semibold text-gray-800">
                {summary.uploaded}/{summary.total} fichier{summary.total > 1 ? 's' : ''} importé{summary.uploaded > 1 ? 's' : ''}
                {summary.failed.length === 0 && ' ✓'}
              </p>
              {summary.failed.length > 0 && (
                <div className="mt-2">
                  <p className="text-destructive font-medium">
                    {summary.failed.length} échec{summary.failed.length > 1 ? 's' : ''} :
                  </p>
                  <ul className="mt-1 space-y-0.5 text-xs text-destructive">
                    {summary.failed.map((f, i) => (
                      <li key={i} className="truncate">• {f.name} — {f.error}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <button
              onClick={() => setSummary(null)}
              className="shrink-0 text-gray-400 hover:text-gray-600"
              title="Fermer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {summary.failed.length > 0 && (
            <button
              onClick={retryFailed}
              className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
                bg-card border border-amber-300 text-amber-700 hover:bg-amber-100 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Réessayer les échecs
            </button>
          )}
        </div>
      )}

      {/* Onglets galerie / modération */}
      <Tabs value={tab} onValueChange={setTab} className="mb-4">
        <TabsList className="flex gap-1 border-b border-gray-100 justify-start h-auto p-0 bg-transparent rounded-none">
          {[
            { id: 'all',     label: `Toutes (${photos.length})` },
            { id: 'pending', label: `À valider (${pendingPhotos.length})` },
          ].map((t) => (
            <TabsTrigger
              key={t.id}
              value={t.id}
              className="relative px-4 py-2 text-sm font-medium border-b-2 border-transparent -mb-px rounded-none shadow-none text-gray-500 hover:text-gray-800 data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=active]:bg-transparent"
            >
              {t.label}
              {t.id === 'pending' && pendingPhotos.length > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold align-middle">
                  {pendingPhotos.length}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* ════ MODÉRATION (à valider) ════ */}
      {tab === 'pending' && (
        <>
          <div className="flex items-center gap-3 mb-3">
            {pendingPhotos.length > 0 && (
              <input
                type="checkbox"
                checked={modSelected.size === pendingPhotos.length && pendingPhotos.length > 0}
                onChange={toggleModSelectAll}
                className="w-4 h-4 rounded border-gray-300 text-primary cursor-pointer"
              />
            )}
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider flex-1">
              À valider ({pendingPhotos.length})
            </h2>
            {modSelected.size > 0 && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700"
                  onClick={() => reviewSelected('approved')}
                  disabled={moderating}
                >
                  <Check className="w-3.5 h-3.5" />
                  Approuver ({modSelected.size})
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => reviewSelected('rejected')}
                  disabled={moderating}
                >
                  <X className="w-3.5 h-3.5" />
                  Rejeter ({modSelected.size})
                </Button>
              </div>
            )}
          </div>

          {pendingPhotos.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">Aucune photo en attente de validation.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {pendingPhotos.map((photo) => (
                <div key={photo.id} className={`relative group rounded-xl overflow-hidden border-2 transition-all ${
                  modSelected.has(photo.id) ? 'border-primary' : 'border-transparent'
                }`}>
                  <input
                    type="checkbox"
                    checked={modSelected.has(photo.id)}
                    onChange={() => toggleModSelect(photo.id)}
                    className="absolute top-2 left-2 z-10 w-4 h-4 rounded border-white shadow cursor-pointer"
                  />
                  <div className="absolute top-2 right-2 z-10"><SourceBadge source={photo.source} /></div>
                  <img
                    src={photo.thumbnail_url ?? photo.photo_url}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="w-full aspect-square object-cover cursor-pointer"
                    onClick={() => setLightbox(photo)}
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                  <div className="absolute inset-x-0 bottom-0 flex gap-1 p-1.5 bg-gradient-to-t from-black/50 to-transparent">
                    <button
                      onClick={(e) => { e.stopPropagation(); reviewOne(photo.id, 'approved'); }}
                      className="flex-1 flex items-center justify-center gap-1 py-1 rounded-lg bg-emerald-500/90 text-white text-xs font-medium hover:bg-emerald-600 transition-colors"
                      title="Approuver"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); reviewOne(photo.id, 'rejected'); }}
                      className="flex-1 flex items-center justify-center gap-1 py-1 rounded-lg bg-red-500/90 text-white text-xs font-medium hover:bg-red-600 transition-colors"
                      title="Rejeter"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'all' && (
      <>
      {/* En-tête liste photos */}
      <div className="flex items-center gap-3 mb-3">
        {photos.length > 0 && (
          <input
            type="checkbox"
            checked={selected.size === photos.length && photos.length > 0}
            onChange={toggleSelectAll}
            className="w-4 h-4 rounded border-gray-300 text-primary cursor-pointer"
          />
        )}
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider flex-1">
          Photos ({photos.length})
        </h2>
        {selected.size > 0 && (
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDeleteSelected}
            disabled={deleting}
          >
            {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            Supprimer ({selected.size})
          </Button>
        )}
      </div>

      {photos.length === 0 && !upload && (
        <p className="text-sm text-gray-400 text-center py-8">Aucune photo pour cet événement.</p>
      )}

      {/* Grille photos */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {photos.map((photo) => (
          <div key={photo.id} className={`relative group rounded-xl overflow-hidden border-2 transition-all ${
            selected.has(photo.id) ? 'border-destructive' : 'border-transparent'
          }`}>
            {/* Checkbox */}
            <input
              type="checkbox"
              checked={selected.has(photo.id)}
              onChange={() => toggleSelect(photo.id)}
              className="absolute top-2 left-2 z-10 w-4 h-4 rounded border-white shadow cursor-pointer
                opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity checked:opacity-100"
            />
            {/* Badge source */}
            <div className="absolute top-2 right-2 z-10 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
              <SourceBadge source={photo.source} />
            </div>
            {/* Média (poster + badge play pour les vidéos) */}
            {isVideoPhoto(photo) && !photo.thumbnail_url ? (
              <div
                className="w-full aspect-square bg-gray-800 flex items-center justify-center cursor-pointer"
                onClick={() => setLightbox(photo)}
              >
                <Play className="w-8 h-8 text-white/70" fill="currentColor" />
              </div>
            ) : (
              <img
                src={photo.thumbnail_url ?? photo.photo_url}
                alt=""
                loading="lazy"
                decoding="async"
                className="w-full aspect-square object-cover cursor-pointer"
                onClick={() => setLightbox(photo)}
                onError={(e) => { e.target.style.display = 'none'; }}
              />
            )}
            {isVideoPhoto(photo) && photo.thumbnail_url && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-10 h-10 rounded-full bg-black/45 flex items-center justify-center">
                  <Play className="w-5 h-5 text-white" fill="currentColor" />
                </div>
              </div>
            )}
            {/* Actions au survol (fond non cliquable → laisse passer le tap vers la lightbox) */}
            <div className="absolute inset-0 bg-black/0 md:group-hover:bg-black/30 transition-all flex items-end justify-end p-2 gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 pointer-events-none">
              {photo.share_url && (
                <a
                  href={photo.share_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="pointer-events-auto w-7 h-7 bg-card/90 rounded-lg flex items-center justify-center text-gray-600 hover:text-primary"
                  title="Voir sur fotoshare"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(photo.id); }}
                className="pointer-events-auto w-7 h-7 bg-card/90 rounded-lg flex items-center justify-center text-gray-600 hover:text-destructive"
                title="Supprimer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
      </>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            className="absolute top-4 right-4 text-white/70 hover:text-white"
            onClick={() => setLightbox(null)}
          >
            <X className="w-8 h-8" />
          </button>
          {isVideoPhoto(lightbox) ? (
            <video
              src={lightbox.photo_url}
              controls
              autoPlay
              playsInline
              className="max-h-[90vh] max-w-full rounded-xl shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <img
              src={lightbox.photo_url}
              alt=""
              className="max-h-[90vh] max-w-full rounded-xl shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>
      )}
    </div>
  );
}
