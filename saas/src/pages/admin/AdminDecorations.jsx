import { useCallback, useEffect, useRef, useState } from 'react';
import { UploadCloud, X } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { fetchDecorations, uploadDecoration, deleteDecoration } from '../../lib/supabase';

const ACCEPTED = 'image/svg+xml,image/png,image/jpeg,image/webp,image/gif';
const ACCEPTED_EXT = /\.(svg|png|jpg|jpeg|webp|gif)$/i;

// Génère un thumbnail PNG 120px depuis un fichier SVG (canvas offscreen)
async function generateSvgThumbnail(file) {
  if (!file.name.match(/\.svg$/i)) return null;
  const svgText = await file.text();
  const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const SIZE  = 120;
      const scale = SIZE / Math.max(img.naturalWidth || SIZE, img.naturalHeight || SIZE);
      const oc    = document.createElement('canvas');
      oc.width    = Math.round((img.naturalWidth  || SIZE) * scale);
      oc.height   = Math.round((img.naturalHeight || SIZE) * scale);
      oc.getContext('2d').drawImage(img, 0, 0, oc.width, oc.height);
      URL.revokeObjectURL(url);
      oc.toBlob((b) => resolve(b), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

function FilePreview({ file }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (!src) return null;
  const isSvg = file.name.toLowerCase().endsWith('.svg');
  return isSvg
    ? <img src={src} alt="" className="w-full h-full object-contain p-1" />
    : <img src={src} alt="" className="w-full h-full object-contain p-1" />;
}

const NEW_CAT_SENTINEL = '__new__';

export default function AdminDecorations() {
  const [decorations,  setDecorations]  = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [category,     setCategory]     = useState('');      // catégorie sélectionnée
  const [newCatInput,  setNewCatInput]  = useState('');      // valeur si "Nouvelle"
  const [dragging,     setDragging]     = useState(false);
  const [deleting,     setDeleting]     = useState(new Set());

  // File d'attente : { id, file, name, uploading, error }
  const [queue, setQueue] = useState([]);

  const fileInputRef = useRef(null);

  useEffect(() => {
    fetchDecorations()
      .then((data) => {
        setDecorations(data);
        // Pré-sélectionner la première catégorie existante (ou défaut)
        const cats = [...new Set(data.map((d) => d.category || 'Mes stickers'))].sort();
        setCategory(cats[0] ?? 'Mes stickers');
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Catégories existantes extraites de la DB
  const existingCategories = [...new Set(
    decorations.map((d) => d.category || 'Mes stickers')
  )].sort();

  // Catégorie effective (résout le sentinel "nouvelle")
  const effectiveCategory = category === NEW_CAT_SENTINEL
    ? newCatInput.trim()
    : category;

  // ── Ajout à la file d'attente ────────────────────────────────────────────────

  const enqueue = useCallback((files) => {
    const valid = Array.from(files).filter(
      (f) => f.type.startsWith('image/') || ACCEPTED_EXT.test(f.name)
    );
    if (!valid.length) return;
    setQueue((prev) => [
      ...prev,
      ...valid.map((file) => ({
        id:        `${file.name}-${file.lastModified}-${Math.random()}`,
        file,
        name:      file.name.replace(/\.[^.]+$/, ''),
        uploading: false,
        error:     null,
      })),
    ]);
  }, []);

  function handleFileInput(e) { enqueue(e.target.files); e.target.value = ''; }
  function handleDrop(e)      { e.preventDefault(); setDragging(false); enqueue(e.dataTransfer.files); }

  function updateName(id, name) {
    setQueue((prev) => prev.map((q) => q.id === id ? { ...q, name } : q));
  }

  function removeFromQueue(id) {
    setQueue((prev) => prev.filter((q) => q.id !== id));
  }

  // ── Upload ──────────────────────────────────────────────────────────────────

  async function uploadAll() {
    for (const item of queue) {
      if (item.uploading) continue;
      setQueue((prev) => prev.map((q) => q.id === item.id ? { ...q, uploading: true, error: null } : q));
      try {
        const thumbnailBlob = await generateSvgThumbnail(item.file);
        const record = await uploadDecoration(item.file, effectiveCategory, item.name, thumbnailBlob);
        setDecorations((prev) => [record, ...prev]);
        setQueue((prev) => prev.filter((q) => q.id !== item.id));
      } catch (err) {
        setQueue((prev) => prev.map((q) => q.id === item.id
          ? { ...q, uploading: false, error: err.message }
          : q
        ));
      }
    }
  }

  // ── Suppression ─────────────────────────────────────────────────────────────

  async function handleDelete(deco) {
    if (!confirm(`Supprimer "${deco.name || deco.id}" ?`)) return;
    setDeleting((prev) => new Set([...prev, deco.id]));
    try {
      await deleteDecoration(deco.id, deco.storage_path);
      setDecorations((prev) => prev.filter((d) => d.id !== deco.id));
    } catch (err) {
      alert(`Erreur : ${err.message}`);
    } finally {
      setDeleting((prev) => { const next = new Set(prev); next.delete(deco.id); return next; });
    }
  }

  const byCategory = decorations.reduce((acc, d) => {
    const cat = d.category || 'Mes stickers';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(d);
    return acc;
  }, {});

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Décorations & Stickers</h1>
        <p className="text-sm text-muted-foreground mt-1">Uploadez vos SVG ou PNG pour les utiliser dans l'éditeur de templates.</p>
      </div>

      {/* Zone d'upload */}
      <div className="bg-card border rounded-2xl p-5 mb-6 space-y-4">

        {/* Catégorie */}
        <div className="space-y-2">
          <Label>Catégorie</Label>
          <Select
            value={category}
            onValueChange={(v) => {
              setCategory(v);
              if (v !== NEW_CAT_SENTINEL) setNewCatInput('');
            }}
          >
            <SelectTrigger><SelectValue placeholder="Catégorie" /></SelectTrigger>
            <SelectContent>
              {existingCategories.length === 0 && (
                <SelectItem value="Mes stickers">Mes stickers</SelectItem>
              )}
              {existingCategories.map((cat) => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
              <SelectItem value={NEW_CAT_SENTINEL}>+ Nouvelle catégorie…</SelectItem>
            </SelectContent>
          </Select>
          {category === NEW_CAT_SENTINEL && (
            <Input
              autoFocus
              value={newCatInput}
              onChange={(e) => setNewCatInput(e.target.value)}
              placeholder="Ex : Mariage, Fleurs, Noël…"
            />
          )}
        </div>

        {/* Zone de dépôt */}
        <div
          className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
            dragging ? 'border-primary bg-primary/10' : 'border-gray-200 bg-gray-50 hover:border-primary hover:bg-primary/10'
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input ref={fileInputRef} type="file" accept={ACCEPTED} multiple className="hidden" onChange={handleFileInput} />
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <UploadCloud className="w-8 h-8" />
            <p className="text-sm font-medium text-foreground">Glissez vos fichiers ici</p>
            <p className="text-xs">SVG, PNG, WEBP · fond transparent recommandé</p>
          </div>
        </div>

        {/* File d'attente */}
        {queue.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-500">Nommez vos stickers avant d'uploader :</p>
            {queue.map((item) => (
              <div key={item.id} className="flex items-center gap-3 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
                {/* Miniature */}
                <div className="w-10 h-10 shrink-0 rounded-lg overflow-hidden bg-card border border-gray-200"
                  style={{ backgroundImage: 'repeating-conic-gradient(#e5e5e5 0% 25%, #fff 0% 50%) 0 0 / 8px 8px' }}>
                  <FilePreview file={item.file} />
                </div>

                {/* Nom éditable */}
                <Input
                  value={item.name}
                  onChange={(e) => updateName(item.id, e.target.value)}
                  placeholder="Nom du sticker…"
                  disabled={item.uploading}
                  className="flex-1 h-9"
                />

                {/* État */}
                {item.uploading && (
                  <div className="w-4 h-4 border-2 border-primary/100 border-t-transparent rounded-full animate-spin shrink-0" />
                )}
                {item.error && (
                  <span className="text-xs text-red-500 shrink-0 max-w-[140px] truncate" title={item.error}>{item.error}</span>
                )}

                {/* Supprimer de la file */}
                {!item.uploading && (
                  <button onClick={() => removeFromQueue(item.id)}
                    className="text-muted-foreground/60 hover:text-destructive transition-colors shrink-0">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}

            <Button
              onClick={uploadAll}
              disabled={queue.some((q) => q.uploading) || !effectiveCategory}
              className="w-full mt-1"
            >
              {queue.some((q) => q.uploading)
                ? 'Upload en cours…'
                : `Uploader ${queue.length} sticker${queue.length > 1 ? 's' : ''} dans "${effectiveCategory || '…'}"`}
            </Button>
          </div>
        )}
      </div>

      {/* Grille par catégorie */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-primary/100 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : decorations.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-12">Aucun sticker uploadé.</p>
      ) : (
        <div className="space-y-8">
          {Object.entries(byCategory).map(([cat, items]) => (
            <div key={cat}>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                {cat} <span className="ml-1 font-normal text-gray-400">({items.length})</span>
              </h2>
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                {items.map((deco) => (
                  <div key={deco.id} className="relative group">
                    <div className="aspect-square bg-gray-50 border border-gray-200 rounded-xl overflow-hidden
                      flex items-center justify-center"
                      style={{ backgroundImage: 'repeating-conic-gradient(#e5e5e5 0% 25%, #fff 0% 50%) 0 0 / 10px 10px' }}>
                      <img src={deco.url} alt={deco.name} className="w-full h-full object-contain p-1"
                        onError={(e) => { e.target.style.opacity = '0.3'; }} />
                    </div>
                    {deco.name && (
                      <p className="text-[10px] text-gray-400 truncate mt-1 text-center">{deco.name}</p>
                    )}
                    <button onClick={() => handleDelete(deco)} disabled={deleting.has(deco.id)}
                      className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full
                        flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100
                        transition-opacity disabled:opacity-50" title="Supprimer">
                      {deleting.has(deco.id)
                        ? <div className="w-2.5 h-2.5 border border-white border-t-transparent rounded-full animate-spin" />
                        : <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                      }
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
