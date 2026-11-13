import { useEffect, useRef, useState } from 'react';
import { getGuestUploadUrl, recordGuestPhoto } from '../lib/supabase';
import { normalizeGuestImage } from '../utils/guestImage';
import { isVideoFile } from '../utils/media';

const GRADIENT = 'bg-gradient-to-r from-pink-500 to-violet-600';
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
  const welcomeText  = config?.welcome_text || 'Ajoutez vos photos à la galerie du couple 💕';

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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-card rounded-t-3xl sm:rounded-3xl p-6 max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Poignée */}
        <div className="sm:hidden w-10 h-1.5 bg-gray-200 rounded-full mx-auto mb-4" />
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600" aria-label="Fermer">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* ── Écran de saisie ─────────────────────────────────────────── */}
        {phase === 'idle' && (
          <>
            <h2 className="text-xl font-bold text-gray-900 text-center px-8">Ajouter mes photos</h2>
            <p className="text-sm text-gray-500 mt-1 mb-5 text-center">{welcomeText}</p>

            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Votre prénom (optionnel)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => persistName(e.target.value)}
              placeholder="Ex : Camille"
              className="w-full mb-5 px-4 py-3 rounded-xl border border-gray-200 text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-400"
            />

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => cameraRef.current?.click()}
                className={`group relative flex flex-col items-center justify-center gap-2.5 py-7 rounded-2xl text-white font-semibold overflow-hidden ${GRADIENT} shadow-lg shadow-violet-500/25 hover:shadow-xl hover:shadow-violet-500/30 hover:-translate-y-0.5 active:translate-y-0 transition-all`}
              >
                <span className="absolute inset-0 bg-card/0 group-hover:bg-card/10 transition-colors" />
                <span className="relative flex items-center justify-center w-12 h-12 rounded-full bg-card/20">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                  </svg>
                </span>
                <span className="relative text-sm">Prendre une photo</span>
              </button>
              <button
                onClick={() => pickRef.current?.click()}
                className="group flex flex-col items-center justify-center gap-2.5 py-7 rounded-2xl font-semibold bg-violet-50 text-violet-700 border border-violet-100 hover:bg-violet-100 hover:-translate-y-0.5 active:translate-y-0 transition-all"
              >
                <span className="flex items-center justify-center w-12 h-12 rounded-full bg-card text-violet-600 shadow-sm">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
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
            <h2 className="text-xl font-bold text-gray-900 pr-8">Envoi en cours…</h2>
            <p className="text-sm text-gray-500 mt-1 mb-5">Gardez cette page ouverte jusqu'à la fin.</p>
            <div className="space-y-3">
              {items.map((it) => <FileRow key={it.id} item={it} onRetry={() => retryItem(it)} />)}
            </div>
            <button
              onClick={() => pickRef.current?.click()}
              className="w-full mt-5 py-3 rounded-xl border-2 border-gray-200 text-gray-700 font-semibold hover:bg-gray-50 transition-all"
            >
              ＋ Ajouter d'autres photos
            </button>
            <input ref={pickRef} type="file" accept={accept} multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          </>
        )}

        {/* ── Succès ──────────────────────────────────────────────────── */}
        {phase === 'allDone' && (
          <div className="text-center py-4">
            <div className="text-5xl mb-4">🎉</div>
            <h2 className="text-xl font-bold text-gray-900">Merci {name.trim() || ''} !</h2>
            <p className="text-sm text-gray-600 mt-2">
              {doneCount} photo{doneCount > 1 ? 's' : ''} envoyée{doneCount > 1 ? 's' : ''}.
            </p>
            {moderation && (
              <p className="text-xs text-gray-500 mt-3 bg-amber-50 text-amber-700 rounded-xl px-4 py-3">
                Vos photos seront visibles dans la galerie après validation par les mariés.
              </p>
            )}
            <div className="mt-6 space-y-2">
              <button
                onClick={() => { setItems([]); setDoneCount(0); setPhase('idle'); }}
                className={`w-full py-3 rounded-xl text-white font-semibold ${GRADIENT} hover:from-pink-600 hover:to-violet-700 transition-all`}
              >
                Ajouter d'autres photos
              </button>
              <button
                onClick={onClose}
                className="w-full py-3 rounded-xl border border-gray-200 text-gray-700 font-semibold hover:bg-gray-50 transition-all"
              >
                Voir la galerie
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FileRow({ item, onRetry }) {
  const label =
    item.status === 'queued'     ? 'En attente…'
    : item.status === 'converting' ? 'Conversion HEIC…'
    : item.status === 'uploading'  ? `Envoi ${item.progress}%`
    : item.status === 'done'       ? 'Envoyée ✓'
    : item.error ?? 'Erreur';

  const barColor = item.status === 'error' ? 'bg-red-400' : item.status === 'done' ? 'bg-emerald-500' : 'bg-violet-500';
  const barWidth = item.status === 'done' ? 100 : item.status === 'uploading' ? item.progress : item.status === 'converting' ? 40 : 8;

  return (
    <div className="flex items-center gap-3">
      <div className="w-12 h-12 rounded-lg bg-gray-100 overflow-hidden shrink-0 flex items-center justify-center">
        {item.previewUrl
          ? <img src={item.previewUrl} alt="" className="w-full h-full object-cover" />
          : <span className="text-lg">{item.file.type.startsWith('video/') ? '🎬' : '🖼️'}</span>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-gray-800 truncate">{item.name}</p>
          {item.status === 'error' && (
            <button onClick={onRetry} className="text-xs font-semibold text-violet-600 hover:text-violet-800 shrink-0">Réessayer</button>
          )}
        </div>
        <div className="mt-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full ${barColor} transition-all`} style={{ width: `${barWidth}%` }} />
        </div>
        <p className={`text-xs mt-0.5 ${item.status === 'error' ? 'text-red-500' : 'text-gray-400'}`}>{label}</p>
      </div>
    </div>
  );
}
