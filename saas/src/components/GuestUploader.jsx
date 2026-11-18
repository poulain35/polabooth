import { useEffect, useRef, useState } from 'react';
import { getGuestUploadUrl, recordGuestPhoto } from '../lib/supabase';
import { normalizeGuestImage } from '../utils/guestImage';
import { isVideoFile } from '../utils/media';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';

const NAME_KEY = 'guest_uploader_name';

// Upload d'un Blob vers R2 via presigned PUT, avec progression.
function uploadToR2(presignedUrl, blob, contentType, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload  = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`Upload échoué (${xhr.status})`));
    xhr.onerror = () => reject(new Error('Erreur réseau'));
    xhr.open('PUT', presignedUrl);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.send(blob);
  });
}

// États d'un fichier dans la file : queued → converting → uploading → done | error
function makeItem(file) {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, file, name: file.name, status: 'queued', progress: 0, error: null, previewUrl: null };
}

export default function GuestUploader({ code, config, onClose, onUploaded }) {
  const moderation   = config?.moderation === true;
  const allowVideo   = config?.allow_video === true;
  const maxUploadMb  = Number(config?.max_upload_mb) > 0 ? Number(config.max_upload_mb) : 100;
  const welcomeText  = config?.welcome_text || 'Ajoutez vos photos à la galerie du couple.';

  const [phase, setPhase] = useState('idle'); // idle | uploading | allDone
  const [name, setName]   = useState('');
  const [items, setItems] = useState([]);
  const [doneCount, setDoneCount] = useState(0);
  const cameraRef = useRef(null);
  const pickRef   = useRef(null);
  const runningRef = useRef(false);

  useEffect(() => {
    try { setName(localStorage.getItem(NAME_KEY) || ''); } catch { /* ignore */ }
  }, []);

  useEffect(() => () => { items.forEach((it) => it.previewUrl && URL.revokeObjectURL(it.previewUrl)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function persistName(value) {
    setName(value);
    try { value.trim() ? localStorage.setItem(NAME_KEY, value.trim()) : localStorage.removeItem(NAME_KEY); } catch { /* ignore */ }
  }

  function patchItem(id, patch) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  async function processItem(item) {
    const uploaderName = name.trim() || null;
    try {
      const isVideo = isVideoFile(item.file);

      if (isVideo) {
        if (!allowVideo) throw new Error('Les vidéos ne sont pas acceptées');
        if (item.file.size > maxUploadMb * 1024 * 1024) throw new Error(`Vidéo trop lourde (max ${maxUploadMb} Mo)`);
        // Pas de transcodage : on envoie la vidéo telle quelle.
        // Bémol connu : les .mov/HEVC iPhone ne sont pas lisibles par tous les navigateurs Android.
        patchItem(item.id, { status: 'uploading', progress: 0 });
        const contentType = item.file.type || 'video/mp4';
        const up = await getGuestUploadUrl(code, { filename: item.file.name, content_type: contentType, content_length: item.file.size });
        await uploadToR2(up.presigned_url, item.file, contentType, (p) => patchItem(item.id, { progress: p }));
        await recordGuestPhoto(code, {
          photo_url: up.public_url, storage_path: up.storage_path,
          thumbnail_url: null, width: null, height: null, uploader_name: uploaderName,
        });
        patchItem(item.id, { status: 'done', progress: 100 });
        return true;
      }

      // Image : normalisation client (HEIC → JPEG, orientation, resize, compression, vignette).
      patchItem(item.id, { status: 'converting', progress: 0 });
      const { full, thumb, width, height } = await normalizeGuestImage(item.file);

      patchItem(item.id, { status: 'uploading', progress: 0 });
      const baseName = item.file.name.replace(/\.[^.]+$/, '');
      const [fullUp, thumbUp] = await Promise.all([
        getGuestUploadUrl(code, { filename: `${baseName}.jpg`, content_type: 'image/jpeg', content_length: full.size }),
        getGuestUploadUrl(code, { filename: `${baseName}-thumb.jpg`, content_type: 'image/jpeg', content_length: thumb.size }),
      ]);
      await Promise.all([
        uploadToR2(fullUp.presigned_url, full, 'image/jpeg', (p) => patchItem(item.id, { progress: p })),
        uploadToR2(thumbUp.presigned_url, thumb, 'image/jpeg', () => {}),
      ]);
      await recordGuestPhoto(code, {
        photo_url: fullUp.public_url, storage_path: fullUp.storage_path,
        thumbnail_url: thumbUp.public_url, width, height, uploader_name: uploaderName,
      });
      patchItem(item.id, { status: 'done', progress: 100 });
      return true;
    } catch (err) {
      patchItem(item.id, { status: 'error', error: err?.message ?? 'Échec' });
      return false;
    }
  }

  // Traite la file séquentiellement ; un échec ne bloque pas les suivants.
  async function runQueue(list) {
    setPhase('uploading');
    if (runningRef.current) return; // une passe est déjà en cours : elle prendra les nouveaux items
    runningRef.current = true;
    let uploaded = false;
    for (const item of list) {
      const ok = await processItem(item);
      if (ok) uploaded = true;
    }
    runningRef.current = false;
    if (uploaded) onUploaded?.();
  }

  // Bascule vers l'écran de succès quand tout est terminé sans échec restant.
  useEffect(() => {
    if (phase !== 'uploading' || runningRef.current || items.length === 0) return;
    const pending = items.some((it) => it.status !== 'done' && it.status !== 'error');
    const errored = items.some((it) => it.status === 'error');
    const done = items.filter((it) => it.status === 'done').length;
    if (!pending && !errored && done > 0) { setDoneCount(done); setPhase('allDone'); }
  }, [items, phase]);

  function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const newItems = files.map((f) => {
      const it = makeItem(f);
      if (f.type.startsWith('image/') && !/\.(heic|heif)$/i.test(f.name)) {
        try { it.previewUrl = URL.createObjectURL(f); } catch { /* ignore */ }
      }
      return it;
    });
    setItems((prev) => [...prev, ...newItems]);
    runQueue(newItems);
  }

  async function retryItem(item) {
    setPhase('uploading');
    patchItem(item.id, { status: 'queued', error: null, progress: 0 });
    const ok = await processItem({ ...item, status: 'queued' });
    if (ok) onUploaded?.();
  }

  const accept = allowVideo ? 'image/*,video/*' : 'image/*';

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      {/* Feuille en bas de l'écran sur téléphone, fenêtre centrée dès sm. `pola-client` : accent noyer dans le portail. */}
      <DialogContent className="pola-client font-pola text-pf-text block left-0 top-auto bottom-0 translate-x-0 translate-y-0 max-w-none max-h-[90vh] overflow-y-auto border-0 rounded-none rounded-t-[28px] p-6 shadow-editor-float sm:left-[50%] sm:top-[50%] sm:bottom-auto sm:translate-x-[-50%] sm:translate-y-[-50%] sm:max-w-md sm:rounded-[28px]">
        {/* Poignée */}
        <div className="sm:hidden w-10 h-1.5 bg-pf-line rounded-full mx-auto mb-4" aria-hidden="true" />

        {/* ── Écran de saisie ─────────────────────────────────────────── */}
        {phase === 'idle' && (
          <>
            <DialogTitle className="font-pf-serif font-normal text-[24px] leading-tight tracking-normal text-pf-text text-center px-8">Ajouter mes photos</DialogTitle>
            <DialogDescription className="text-[15px] text-pf-muted mt-1 mb-5 text-center">{welcomeText}</DialogDescription>

            <label htmlFor="guest-uploader-name" className="pola-pf-label mb-1.5">Votre prénom (optionnel)</label>
            <input
              id="guest-uploader-name"
              type="text"
              value={name}
              onChange={(e) => persistName(e.target.value)}
              placeholder="Ex : Camille"
              className="pola-pf-input mb-5"
            />

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => cameraRef.current?.click()}
                className="pola-pf-focus flex flex-col items-center justify-center gap-2.5 py-7 rounded-2xl text-white font-semibold bg-pf-noyer hover:bg-pf-noyer-h shadow-sm transition-colors"
              >
                <span className="flex items-center justify-center w-12 h-12 rounded-full bg-white/15">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                  </svg>
                </span>
                <span className="text-sm">Prendre une photo</span>
              </button>
              <button
                type="button"
                onClick={() => pickRef.current?.click()}
                className="pola-pf-focus flex flex-col items-center justify-center gap-2.5 py-7 rounded-2xl font-semibold bg-pf-surface text-pf-noyer border border-pf-line hover:bg-pf-surface-2 transition-colors"
              >
                <span className="flex items-center justify-center w-12 h-12 rounded-full bg-white text-pf-noyer shadow-sm">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25z" />
                  </svg>
                </span>
                <span className="text-sm">Galerie</span>
              </button>
            </div>

            <input ref={cameraRef} type="file" accept={accept} capture="environment" className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
            <input ref={pickRef} type="file" accept={accept} multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          </>
        )}

        {/* ── File d'attente / envoi ──────────────────────────────────── */}
        {phase === 'uploading' && (
          <>
            <DialogTitle className="font-pf-serif font-normal text-[24px] leading-tight tracking-normal text-pf-text pr-8">Envoi en cours…</DialogTitle>
            <DialogDescription className="text-[15px] text-pf-muted mt-1 mb-5">Gardez cette page ouverte jusqu'à la fin.</DialogDescription>
            <div className="space-y-3">
              {items.map((it) => <FileRow key={it.id} item={it} onRetry={() => retryItem(it)} />)}
            </div>
            <button
              type="button"
              onClick={() => pickRef.current?.click()}
              className="pola-pf-btn-secondary w-full mt-5 px-4 py-3 text-[15px]"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m-7-7h14" />
              </svg>
              Ajouter d'autres photos
            </button>
            <input ref={pickRef} type="file" accept={accept} multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          </>
        )}

        {/* ── Succès ──────────────────────────────────────────────────── */}
        {phase === 'allDone' && (
          <div className="text-center py-4">
            <div className="pola-pf-icon-circle mx-auto mb-4">
              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <DialogTitle className="font-pf-serif font-normal text-[24px] leading-tight tracking-normal text-pf-text">Merci {name.trim() || ''} !</DialogTitle>
            <DialogDescription className="text-[15px] text-pf-muted mt-2">
              {doneCount} photo{doneCount > 1 ? 's' : ''} envoyée{doneCount > 1 ? 's' : ''}.
            </DialogDescription>
            {moderation && (
              <p className="text-sm mt-3 bg-pf-surface text-pf-text rounded-2xl px-4 py-3">
                Vos photos seront visibles dans la galerie après validation par les mariés.
              </p>
            )}
            <div className="mt-6 space-y-2">
              <button
                type="button"
                onClick={() => { setItems([]); setDoneCount(0); setPhase('idle'); }}
                className="pola-pf-btn-primary w-full px-4 py-3 text-[15px]"
              >
                Ajouter d'autres photos
              </button>
              <button
                type="button"
                onClick={onClose}
                className="pola-pf-btn-secondary w-full px-4 py-3 text-[15px]"
              >
                Voir la galerie
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const FILE_ICON = {
  video: 'm15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z',
  image: 'm2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z',
};

function FileRow({ item, onRetry }) {
  const label =
    item.status === 'queued'     ? 'En attente…'
    : item.status === 'converting' ? 'Conversion HEIC…'
    : item.status === 'uploading'  ? `Envoi ${item.progress}%`
    : item.status === 'done'       ? 'Envoyée'
    : item.error ?? 'Erreur';

  const barColor = item.status === 'error' ? 'bg-pola-error' : item.status === 'done' ? 'bg-pf-sage' : 'bg-pf-noyer';
  const barWidth = item.status === 'done' ? 100 : item.status === 'uploading' ? item.progress : item.status === 'converting' ? 40 : 8;

  return (
    <div className="flex items-center gap-3">
      <div className="w-12 h-12 rounded-lg bg-pf-surface text-pf-muted overflow-hidden shrink-0 flex items-center justify-center">
        {item.previewUrl
          ? <img src={item.previewUrl} alt="" className="w-full h-full object-cover" />
          : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d={item.file.type.startsWith('video/') ? FILE_ICON.video : FILE_ICON.image} />
            </svg>
          )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-pf-text truncate">{item.name}</p>
          {item.status === 'error' && (
            <button type="button" onClick={onRetry} className="pola-pf-link text-xs shrink-0">Réessayer</button>
          )}
        </div>
        <div className="mt-1 h-1.5 bg-pf-surface rounded-full overflow-hidden">
          <div className={`h-full ${barColor} transition-all`} style={{ width: `${barWidth}%` }} />
        </div>
        <p className={`text-xs mt-0.5 flex items-center gap-1 ${item.status === 'error' ? 'text-pola-error' : item.status === 'done' ? 'text-pf-sage' : 'text-pf-muted'}`}>
          {item.status === 'done' && (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
          {label}
        </p>
      </div>
    </div>
  );
}
