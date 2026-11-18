import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Sticker, UploadCloud, X } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Card, CardTitle } from '../../components/ui/card';
import { IconCircle } from '../../components/ui/icon-circle';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { fetchDecorations, uploadDecoration, deleteDecoration } from '../../lib/supabase';
import { cn } from '../../lib/utils';
import { Spinner } from '../../components/ui/spinner';

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
  return <img src={src} alt="" className="h-full w-full object-contain p-1" />;
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

  const busy = queue.some((q) => q.uploading);
  const queueCount = `${queue.length} sticker${queue.length > 1 ? 's' : ''}`;

  return (
    // Onglet Décorations de la Bibliothèque (titre et onglets : AdminLibrary, LAB-335).
    <div className="flex flex-col gap-5">
      <p className="text-[13px] text-muted-foreground">Décorations et stickers : envoyez vos SVG ou PNG pour les utiliser dans l'éditeur de cadres photo.</p>

      {/* Zone d'upload */}
      <Card className="flex flex-col gap-4 p-card">

        {/* Catégorie */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="decoration-category">Catégorie</Label>
          <Select
            value={category}
            onValueChange={(v) => {
              setCategory(v);
              if (v !== NEW_CAT_SENTINEL) setNewCatInput('');
            }}
          >
            <SelectTrigger id="decoration-category"><SelectValue placeholder="Catégorie" /></SelectTrigger>
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
              aria-label="Nom de la nouvelle catégorie"
            />
          )}
        </div>

        {/* Zone de dépôt */}
        <div
          role="button"
          tabIndex={0}
          className={cn(
            'cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            dragging ? 'border-primary bg-soft' : 'border-input bg-muted hover:border-primary',
          )}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); }
          }}
        >
          <input ref={fileInputRef} type="file" accept={ACCEPTED} multiple className="hidden" onChange={handleFileInput} />
          <div className="flex flex-col items-center gap-2">
            <IconCircle tone="white"><UploadCloud /></IconCircle>
            <p className="text-sm font-medium text-foreground">Glissez vos fichiers ici</p>
            <p className="text-xs text-muted-foreground">SVG, PNG, WEBP · fond transparent recommandé</p>
          </div>
        </div>

        {/* File d'attente */}
        {queue.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-muted-foreground">Nommez vos stickers avant d'uploader :</p>
            {queue.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-muted p-2">
                {/* Miniature */}
                <div className="light-island h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-card ring-1 ring-border">
                  <FilePreview file={item.file} />
                </div>

                {/* Nom éditable */}
                <Input
                  value={item.name}
                  onChange={(e) => updateName(item.id, e.target.value)}
                  placeholder="Nom du sticker…"
                  aria-label="Nom du sticker"
                  disabled={item.uploading}
                  className="min-w-0 flex-1"
                />

                {/* État */}
                {item.uploading && (
                  <Loader2 className="mx-2 size-4 shrink-0 animate-spin text-primary" aria-label="Envoi en cours" />
                )}

                {/* Supprimer de la file */}
                {!item.uploading && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0 text-muted-foreground"
                    onClick={() => removeFromQueue(item.id)}
                    aria-label={`Retirer ${item.name || 'ce sticker'} de la liste`}
                  >
                    <X aria-hidden="true" />
                  </Button>
                )}

                {/* Erreur : sur sa propre ligne, pour ne pas écraser le champ sur téléphone */}
                {item.error && (
                  <p role="alert" className="basis-full break-words px-1 text-xs text-state-red-fg">{item.error}</p>
                )}
              </div>
            ))}

            {/* Libellé court sur téléphone : un bouton ne passe pas à la ligne. */}
            <Button onClick={uploadAll} disabled={busy || !effectiveCategory} className="mt-1 w-full">
              {busy ? 'Upload en cours…' : (
                <>
                  <span className="sm:hidden">Uploader {queueCount}</span>
                  <span className="hidden min-w-0 truncate sm:inline">
                    {`Uploader ${queueCount} dans "${effectiveCategory || '…'}"`}
                  </span>
                </>
              )}
            </Button>
          </div>
        )}
      </Card>

      {/* Grille par catégorie */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : decorations.length === 0 ? (
        <Card className="flex flex-col items-center px-6 py-12 text-center">
          <IconCircle tone="sky"><Sticker /></IconCircle>
          <p className="mt-3 text-[13px] text-muted-foreground">Aucun sticker uploadé.</p>
        </Card>
      ) : (
        Object.entries(byCategory).map(([cat, items]) => (
          <Card key={cat} className="p-card">
            <CardTitle as="h2" className="mb-4">
              {cat} <span className="ml-1 text-[13px] font-normal text-muted-foreground">({items.length})</span>
            </CardTitle>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
              {items.map((deco) => (
                <div key={deco.id} className="group relative min-w-0">
                  {/* Aperçu du sticker : zone claire dans les deux modes (un sticker est dessiné pour un fond clair). */}
                  <div className="light-island flex aspect-square items-center justify-center overflow-hidden rounded-xl bg-muted">
                    <img src={deco.url} alt={deco.name} className="h-full w-full object-contain p-1"
                      onError={(e) => { e.target.style.opacity = '0.3'; }} />
                  </div>
                  {deco.name && (
                    <p className="mt-1 truncate text-center text-[11px] text-muted-foreground">{deco.name}</p>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDelete(deco)}
                    disabled={deleting.has(deco.id)}
                    title="Supprimer"
                    aria-label={`Supprimer ${deco.name || 'ce sticker'}`}
                    className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 md:opacity-0 md:focus-visible:opacity-100 md:group-hover:opacity-100"
                  >
                    {deleting.has(deco.id)
                      ? <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                      : <X className="size-3" strokeWidth={3} aria-hidden="true" />}
                  </button>
                </div>
              ))}
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
