import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Link2, ExternalLink, ImageIcon, X, RotateCcw, Trash2, Check, Loader2, Play } from 'lucide-react';
import {
  supabase, fetchPhotos, getPhotoUploadUrl,
  savePhoto, deletePhoto, fetchGalleryStats,
  setPhotoStatus, setPhotosStatus,
} from '../../lib/supabase';
import { isVideoFile, isHeicFile, heicToJpeg, videoPoster, isVideoPhoto } from '../../utils/media';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Checkbox } from '../../components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { PageContainer, PageHeader } from '../../components/admin/AdminPage';
import { cn } from '../../lib/utils';
import { CopyButton } from '../../components/ui/copy-button';
import { Spinner } from '../../components/ui/spinner';
import { Lightbox } from '../../components/ui/lightbox';

const APP_URL = (import.meta.env.VITE_APP_URL ?? window.location.origin).replace(/\/$/, "");

// Posés sur une photo : fonds pleins, lisibles quelle que soit l'image dessous.
const TILE_CHECKBOX_CLASS = 'absolute left-2 top-2 z-10 rounded bg-card shadow-card';
const TILE_HOVER_CLASS = 'transition-opacity md:opacity-0 md:group-hover:opacity-100';
const TILE_ACTION_CLASS = 'pointer-events-auto flex h-7 w-7 items-center justify-center rounded-md bg-card text-muted-foreground shadow-card transition-colors';

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

// Origine d'une photo : la borne ('kiosk'/'admin') ou un invité ('guest').
function SourceBadge({ source }) {
  const isGuest = source === 'guest';
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium shadow-card',
      isGuest ? 'bg-primary text-primary-foreground' : 'bg-card text-foreground',
    )}>
      {isGuest ? 'Invité' : 'Borne'}
    </span>
  );
}

// `embedded` : affichée dans l'onglet « Photos et livraison » de la fiche (LAB-337), sans fil
// d'Ariane ni titre ni marges.
export default function AdminPhotoEvent({ embedded = false } = {}) {
  const { id } = useParams();
  const [event,    setEvent]    = useState(null);
  const [photos,   setPhotos]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [upload,   setUpload]   = useState(null); // { total, done, failed, percent } pendant un import
  const [summary,  setSummary]  = useState(null); // { total, uploaded, failed:[{name,error}] } après import
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(false);
  const [dragging, setDragging] = useState(false);
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
        .select('id, name, client_name, access_code')
        .eq('id', id)
        .single();
      setEvent(ev);
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

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex justify-center py-24">
      <Spinner />
    </div>
  );

  const galleryUrl = event ? `${APP_URL}/photos/${event.access_code}` : '';

  const content = (
    <>
      {/* Lien client */}
      {event && (
        <Card className="flex items-center gap-2 px-4 py-3">
          <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{galleryUrl}</span>
          <CopyButton value={galleryUrl} className="shrink-0" />
          <Button variant="ghost" size="icon-sm" asChild className="shrink-0 text-muted-foreground">
            <a href={galleryUrl} target="_blank" rel="noopener noreferrer" aria-label="Ouvrir la galerie" title="Ouvrir la galerie">
              <ExternalLink />
            </a>
          </Button>
        </Card>
      )}

      {/* Statistiques du lien partagé */}
      {stats && (
        <div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Ouvertures', value: stats.views, hint: 'du lien' },
              { label: 'Téléchargements', value: stats.downloads, hint: 'de photos' },
              { label: 'Partages', value: stats.shares, hint: 'de photos' },
            ].map((s) => (
              <Card key={s.label} className="min-w-0 px-3 py-4 text-center">
                <p className="text-figure text-foreground">{s.value}</p>
                <p className="mt-1 truncate text-[13px] font-medium text-foreground">{s.label}</p>
                <p className="truncate text-xs text-muted-foreground">{s.hint}</p>
              </Card>
            ))}
          </div>
          {stats.lastActivity && (
            <p className="mt-2 text-xs text-muted-foreground">
              Dernière activité : {new Date(stats.lastActivity).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </div>
      )}

      {/* Zone d'upload */}
      <div
        className={cn(
          'cursor-pointer rounded-card border-2 border-dashed p-4 text-center transition-colors sm:p-8',
          dragging ? 'border-primary bg-primary-soft' : 'border-input bg-card hover:border-primary hover:bg-primary-soft',
        )}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input ref={fileInputRef} type="file" accept="image/*,video/*,.heic,.heif,.mov,.mp4" multiple className="hidden" onChange={handleFileInput} />
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <ImageIcon className="h-8 w-8" />
          <p className="text-sm font-medium text-foreground">Glissez vos photos et vidéos ici</p>
          <p className="text-xs">ou cliquez pour choisir · JPG, PNG, HEIC, MP4, MOV…</p>
        </div>
      </div>

      {/* Progression d'import (barre unique pour tous les fichiers) */}
      {upload && (
        <Card className="px-4 py-3">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="font-medium text-foreground">
              {upload.done + upload.failed < upload.total
                ? `Import de ${upload.total} photo${upload.total > 1 ? 's' : ''}…`
                : 'Import terminé'}
            </span>
            <span className="shrink-0 text-muted-foreground">
              {upload.done}/{upload.total}
              {upload.failed > 0 && <span className="text-state-red-fg"> · {upload.failed} échec{upload.failed > 1 ? 's' : ''}</span>}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${upload.percent}%` }} />
          </div>
        </Card>
      )}

      {/* Récap de fin d'import */}
      {summary && (
        <div className={cn('rounded-xl px-4 py-3', summary.failed.length === 0 ? 'bg-state-green' : 'bg-state-amber')}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 text-sm">
              <p className={cn('font-medium', summary.failed.length === 0 ? 'text-state-green-fg' : 'text-state-amber-fg')}>
                {summary.uploaded}/{summary.total} fichier{summary.total > 1 ? 's' : ''} importé{summary.uploaded > 1 ? 's' : ''}
                {summary.failed.length === 0 && ' ✓'}
              </p>
              {summary.failed.length > 0 && (
                <div className="mt-2">
                  <p className="font-medium text-state-red-fg">
                    {summary.failed.length} échec{summary.failed.length > 1 ? 's' : ''} :
                  </p>
                  <ul className="mt-1 space-y-0.5 text-xs text-state-red-fg">
                    {summary.failed.map((f, i) => (
                      <li key={i} className="truncate">• {f.name} — {f.error}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <button
              onClick={() => setSummary(null)}
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              title="Fermer"
              aria-label="Fermer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {summary.failed.length > 0 && (
            <Button variant="outline" size="sm" className="mt-2" onClick={retryFailed}>
              <RotateCcw />
              Réessayer les échecs
            </Button>
          )}
        </div>
      )}

      {/* Onglets galerie / modération */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="all">Toutes <span className="opacity-70">{photos.length}</span></TabsTrigger>
          <TabsTrigger value="pending">À valider <span className="opacity-70">{pendingPhotos.length}</span></TabsTrigger>
        </TabsList>
      </Tabs>

      {/* ════ MODÉRATION (à valider) ════ */}
      {tab === 'pending' && (
        <section>
          <div className="mb-3 flex min-h-[34px] flex-wrap items-center gap-3">
            {pendingPhotos.length > 0 && (
              <Checkbox
                checked={modSelected.size === pendingPhotos.length}
                onCheckedChange={toggleModSelectAll}
                aria-label="Tout sélectionner"
              />
            )}
            <h2 className="flex-1 text-sm font-medium text-foreground">
              À valider ({pendingPhotos.length})
            </h2>
            {modSelected.size > 0 && (
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => reviewSelected('approved')} disabled={moderating}>
                  <Check />
                  Approuver ({modSelected.size})
                </Button>
                <Button variant="destructive" size="sm" onClick={() => reviewSelected('rejected')} disabled={moderating}>
                  <X />
                  Rejeter ({modSelected.size})
                </Button>
              </div>
            )}
          </div>

          {pendingPhotos.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Aucune photo en attente de validation.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {pendingPhotos.map((photo) => (
                <div
                  key={photo.id}
                  className={cn(
                    'overflow-hidden rounded-xl border-2 bg-card shadow-card transition-colors',
                    modSelected.has(photo.id) ? 'border-primary' : 'border-transparent',
                  )}
                >
                  <div className="relative bg-muted">
                    <Checkbox
                      className={TILE_CHECKBOX_CLASS}
                      checked={modSelected.has(photo.id)}
                      onCheckedChange={() => toggleModSelect(photo.id)}
                      aria-label="Sélectionner la photo"
                    />
                    <div className="absolute right-2 top-2 z-10"><SourceBadge source={photo.source} /></div>
                    <img
                      src={photo.thumbnail_url ?? photo.photo_url}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="aspect-square w-full cursor-pointer object-cover"
                      onClick={() => setLightbox(photo)}
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  </div>
                  <div className="flex gap-1.5 p-1.5">
                    <Button size="xs" className="flex-1" onClick={() => reviewOne(photo.id, 'approved')} title="Approuver" aria-label="Approuver">
                      <Check />
                    </Button>
                    <Button variant="destructive" size="xs" className="flex-1" onClick={() => reviewOne(photo.id, 'rejected')} title="Rejeter" aria-label="Rejeter">
                      <X />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === 'all' && (
        <section>
          {/* En-tête liste photos */}
          <div className="mb-3 flex min-h-[34px] flex-wrap items-center gap-3">
            {photos.length > 0 && (
              <Checkbox
                checked={selected.size === photos.length}
                onCheckedChange={toggleSelectAll}
                aria-label="Tout sélectionner"
              />
            )}
            <h2 className="flex-1 text-sm font-medium text-foreground">
              Photos ({photos.length})
            </h2>
            {selected.size > 0 && (
              <Button variant="destructive" size="sm" onClick={handleDeleteSelected} disabled={deleting}>
                {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
                Supprimer ({selected.size})
              </Button>
            )}
          </div>

          {photos.length === 0 && !upload && (
            <p className="py-8 text-center text-sm text-muted-foreground">Aucune photo pour cet événement.</p>
          )}

          {/* Grille photos */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {photos.map((photo) => (
              <div
                key={photo.id}
                className={cn(
                  'group relative overflow-hidden rounded-xl border-2 bg-muted transition-colors',
                  selected.has(photo.id) ? 'border-destructive' : 'border-transparent',
                )}
              >
                <Checkbox
                  className={cn(TILE_CHECKBOX_CLASS, TILE_HOVER_CLASS, 'md:focus-visible:opacity-100 md:data-[state=checked]:opacity-100')}
                  checked={selected.has(photo.id)}
                  onCheckedChange={() => toggleSelect(photo.id)}
                  aria-label="Sélectionner la photo"
                />
                <div className={cn('absolute right-2 top-2 z-10', TILE_HOVER_CLASS)}>
                  <SourceBadge source={photo.source} />
                </div>
                {/* Média (poster + badge play pour les vidéos) */}
                {isVideoPhoto(photo) && !photo.thumbnail_url ? (
                  <div
                    className="flex aspect-square w-full cursor-pointer items-center justify-center text-muted-foreground"
                    onClick={() => setLightbox(photo)}
                  >
                    <Play className="h-8 w-8" fill="currentColor" />
                  </div>
                ) : (
                  <img
                    src={photo.thumbnail_url ?? photo.photo_url}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="aspect-square w-full cursor-pointer object-cover"
                    onClick={() => setLightbox(photo)}
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                )}
                {isVideoPhoto(photo) && photo.thumbnail_url && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-foreground shadow-card">
                      <Play className="ml-0.5 h-5 w-5" fill="currentColor" />
                    </div>
                  </div>
                )}
                {/* Actions au survol (bandeau non cliquable → laisse passer le tap vers la visionneuse) */}
                <div className={cn('pointer-events-none absolute inset-x-0 bottom-0 flex justify-end gap-1 p-2', TILE_HOVER_CLASS)}>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(photo.id); }}
                    className={cn(TILE_ACTION_CLASS, 'hover:text-state-red-fg')}
                    title="Supprimer"
                    aria-label="Supprimer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Visionneuse : fond noir dans les deux thèmes, pour voir la photo sans que le thème la teinte. */}
      <Lightbox open={Boolean(lightbox)} onClose={() => setLightbox(null)} className="bg-black/90">
        {lightbox && (isVideoPhoto(lightbox) ? (
          <video
            src={lightbox.photo_url}
            controls
            autoPlay
            playsInline
            className="max-h-[90vh] max-w-full rounded-xl"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <img
            src={lightbox.photo_url}
            alt=""
            className="max-h-[90vh] max-w-full rounded-xl"
            onClick={(e) => e.stopPropagation()}
          />
        ))}
      </Lightbox>
    </>
  );

  if (embedded) return <div className="flex flex-col gap-5">{content}</div>;

  return (
    <PageContainer>
      <PageHeader
        back={`/admin/events/${id}`}
        backLabel="Fiche de l’événement"
        title={event?.name ?? 'Photos'}
        description={event && (
          <>{event.client_name} · Code : <span className="font-mono font-medium">{event.access_code}</span></>
        )}
      />
      {content}
    </PageContainer>
  );
}
