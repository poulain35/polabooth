import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Card } from '../../components/ui/card';
import { fetchCustomFonts, uploadCustomFont, deleteCustomFont } from '../../lib/supabase';

const ACCEPTED = '.woff2,.woff,.ttf,.otf';

async function loadFontFace(font) {
  if ([...document.fonts].some((f) => f.family === font.name)) return;
  try {
    const ff = new FontFace(font.name, `url(${font.url})`);
    await ff.load();
    document.fonts.add(ff);
  } catch (_) {}
}

export default function AdminFonts() {
  const [fonts,    setFonts]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [deleting, setDeleting] = useState(new Set());

  const [pendingFile,  setPendingFile]  = useState(null);
  const [fontName,     setFontName]     = useState('');
  const [uploading,    setUploading]    = useState(false);
  const [uploadError,  setUploadError]  = useState('');
  const [dragging,     setDragging]     = useState(false);

  const inputRef = useRef(null);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const data = await fetchCustomFonts();
      setFonts(data);
      await Promise.allSettled(data.map(loadFontFace));
    } catch (_) {
      setFonts([]);
    } finally {
      setLoading(false);
    }
  }

  function handleFileSelect(files) {
    const file = files?.[0];
    if (!file) return;
    const name = file.name.replace(/\.(woff2?|[ot]tf)$/i, '').replace(/[-_]/g, ' ');
    setPendingFile(file);
    setFontName(name);
    setUploadError('');
  }

  async function handleUpload() {
    if (!pendingFile || !fontName.trim()) return;
    setUploading(true);
    setUploadError('');
    try {
      const record = await uploadCustomFont(pendingFile, fontName.trim());
      setFonts((prev) => [...prev, record]);
      await loadFontFace(record);
      setPendingFile(null);
      setFontName('');
    } catch (err) {
      setUploadError(err.message ?? 'Erreur lors de l\'upload.');
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(font) {
    if (!confirm(`Supprimer la police « ${font.name} » ? Elle ne sera plus disponible dans l'éditeur.`)) return;
    setDeleting((prev) => new Set([...prev, font.id]));
    try {
      await deleteCustomFont(font.id, font.storage_path);
      setFonts((prev) => prev.filter((f) => f.id !== font.id));
    } catch (err) {
      alert(`Erreur : ${err.message}`);
    } finally {
      setDeleting((prev) => { const s = new Set(prev); s.delete(font.id); return s; });
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl space-y-8">
      <h1 className="text-2xl font-bold text-foreground">Polices personnalisées</h1>

      {/* ── Zone upload ── */}
      <Card className="p-4 sm:p-6">
        <h2 className="font-semibold text-gray-800 mb-1">Ajouter une police</h2>
        <p className="text-sm text-gray-500 mb-5">
          Formats acceptés : WOFF2, WOFF, TTF, OTF. La police sera disponible dans l'éditeur pour tous les événements.
        </p>

        {!pendingFile ? (
          <div
            className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center gap-3 cursor-pointer transition-colors
              ${dragging ? 'border-primary bg-primary/10' : 'border-gray-200 hover:border-primary hover:bg-primary/10'}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); handleFileSelect(e.dataTransfer.files); }}
          >
            <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center">
              <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-gray-700">Glissez un fichier ou cliquez pour parcourir</p>
              <p className="text-xs text-gray-400 mt-0.5">WOFF2 · WOFF · TTF · OTF</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Fichier sélectionné */}
            <div className="flex items-center gap-3 bg-primary/10 border border-primary/15 rounded-xl p-4">
              <div className="w-10 h-10 bg-primary/15 rounded-lg flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{pendingFile.name}</p>
                <p className="text-xs text-gray-400">{(pendingFile.size / 1024).toFixed(0)} Ko</p>
              </div>
              <button
                onClick={() => { setPendingFile(null); setFontName(''); }}
                className="text-gray-300 hover:text-red-500 transition-colors shrink-0"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Nom */}
            <div className="space-y-1.5">
              <Label htmlFor="fontName">Nom de la police</Label>
              <Input
                id="fontName"
                type="text"
                value={fontName}
                onChange={(e) => setFontName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleUpload()}
                placeholder="ex: ITC Eras, Futura, Gotham…"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">Ce nom apparaîtra dans le sélecteur de police de l'éditeur.</p>
            </div>

            {uploadError && (
              <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                {uploadError}
              </p>
            )}

            <div className="flex gap-2">
              <Button onClick={handleUpload} disabled={!fontName.trim() || uploading}>
                {uploading ? (<><Loader2 className="w-4 h-4 animate-spin" />Upload en cours…</>) : 'Ajouter la police'}
              </Button>
              <Button variant="outline" onClick={() => { setPendingFile(null); setFontName(''); }}>
                Annuler
              </Button>
            </div>
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={(e) => { handleFileSelect(e.target.files); e.target.value = ''; }}
        />
      </Card>

      {/* ── Liste des polices installées ── */}
      <Card className="p-4 sm:p-6">
        <h2 className="font-semibold text-gray-800 mb-4">
          Polices installées
          {fonts.length > 0 && (
            <span className="ml-2 text-sm font-normal text-gray-400">({fonts.length})</span>
          )}
        </h2>

        {loading && (
          <div className="flex justify-center py-8">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && fonts.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">Aucune police installée.</p>
        )}

        {!loading && fonts.length > 0 && (
          <div className="space-y-2">
            {fonts.map((font) => (
              <div
                key={font.id}
                className="flex items-center justify-between gap-4 p-4 bg-gray-50 border border-gray-100 rounded-xl"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">{font.name}</p>
                  <p className="text-xl text-gray-700 truncate leading-snug" style={{ fontFamily: font.name }}>
                    Aa Bb Cc · 0123456789
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(font)}
                  disabled={deleting.has(font.id)}
                  className="p-2 text-gray-300 hover:text-red-500 disabled:opacity-40 transition-colors shrink-0"
                  title="Supprimer cette police"
                >
                  {deleting.has(font.id) ? (
                    <span className="w-4 h-4 border-2 border-red-300 border-t-transparent rounded-full animate-spin block" />
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round"
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── Setup SQL ── */}
      <section className="bg-slate-900 rounded-xl p-5 text-slate-300 text-sm">
        <h2 className="font-semibold text-white mb-2">Configuration requise (une seule fois)</h2>
        <p className="text-xs text-slate-400 mb-3">SQL Editor dans Supabase Dashboard :</p>
        <pre className="text-xs font-mono leading-relaxed overflow-x-auto bg-slate-800 rounded-lg p-3">{`CREATE TABLE IF NOT EXISTS custom_fonts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  url           TEXT NOT NULL,
  storage_path  TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE custom_fonts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_select" ON custom_fonts
  FOR SELECT TO anon USING (true);
CREATE POLICY "admin_all" ON custom_fonts
  FOR ALL TO authenticated USING (true);`}</pre>
        <p className="text-xs text-slate-400 mt-3">
          Créez aussi un bucket Storage nommé{' '}
          <code className="bg-slate-800 px-1.5 py-0.5 rounded">fonts</code>{' '}
          avec accès public activé.
        </p>
      </section>
    </div>
  );
}
