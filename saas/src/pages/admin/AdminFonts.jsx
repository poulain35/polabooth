import { useEffect, useRef, useState } from 'react';
import { FilePlus, Loader2, Trash2, X } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Card, CardTitle } from '../../components/ui/card';
import { IconCircle } from '../../components/ui/icon-circle';
import { registerCustomFonts, uploadCustomFont, deleteCustomFont } from '../../lib/supabase';
import { cn } from '../../lib/utils';
import LazyFontText from '../../components/LazyFontText';
import GoogleFontsCard from './fonts/GoogleFontsCard';
import { Spinner } from '../../components/ui/spinner';
import { Notice } from '../../components/admin/CardParts';

const ACCEPTED = '.woff2,.woff,.ttf,.otf';

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
      // Polices déclarées sans être téléchargées : chaque aperçu se charge en s'affichant (LAB-347).
      const data = await registerCustomFonts();
      setFonts(data);
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
      await registerCustomFonts().catch(() => {});
      setPendingFile(null);
      setFontName('');
    } catch (err) {
      setUploadError(err.message ?? 'Erreur lors de l\'upload.');
    } finally {
      setUploading(false);
    }
  }

  async function handleGoogleImported(record) {
    setFonts((prev) => [...prev, record]);
    await registerCustomFonts().catch(() => {});
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
    // Onglet Polices de la Bibliothèque (titre et onglets : AdminLibrary, LAB-335).
    <div className="flex flex-col gap-5">

      {/* ── Polices Google : recherche, aperçu, ajout en un clic ── */}
      <GoogleFontsCard customNames={fonts.map((f) => f.name)} onImported={handleGoogleImported} />

      {/* ── Zone upload ── */}
      <Card className="p-card">
        <CardTitle as="h2">Ajouter une police depuis un fichier</CardTitle>
        <p className="mb-5 mt-0.5 text-[13px] text-muted-foreground">
          Formats acceptés : WOFF2, WOFF, TTF, OTF. La police sera disponible dans l'éditeur pour tous les événements.
        </p>

        {!pendingFile ? (
          <div
            role="button"
            tabIndex={0}
            className={cn(
              'flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              dragging ? 'border-primary bg-soft' : 'border-input bg-muted hover:border-primary',
            )}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); }
            }}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); handleFileSelect(e.dataTransfer.files); }}
          >
            <IconCircle tone="white"><FilePlus /></IconCircle>
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">Glissez un fichier ou cliquez pour parcourir</p>
              <p className="mt-0.5 text-xs text-muted-foreground">WOFF2 · WOFF · TTF · OTF</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Fichier sélectionné */}
            <div className="flex items-center gap-3 rounded-xl bg-muted p-3.5">
              <IconCircle tone="white"><FilePlus /></IconCircle>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{pendingFile.name}</p>
                <p className="text-xs text-muted-foreground">{(pendingFile.size / 1024).toFixed(0)} Ko</p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-muted-foreground"
                onClick={() => { setPendingFile(null); setFontName(''); }}
                aria-label="Retirer ce fichier"
              >
                <X aria-hidden="true" />
              </Button>
            </div>

            {/* Nom */}
            <div className="flex flex-col gap-1.5">
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
              <Notice tone="red" role="alert">
                {uploadError}
              </Notice>
            )}

            <div className="flex flex-wrap gap-2">
              <Button onClick={handleUpload} disabled={!fontName.trim() || uploading}>
                {uploading ? (<><Loader2 className="animate-spin" aria-hidden="true" />Upload en cours…</>) : 'Ajouter la police'}
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
      <Card className="p-card">
        <CardTitle as="h2" className="mb-4">
          Polices installées
          {fonts.length > 0 && (
            <span className="ml-2 text-[13px] font-normal text-muted-foreground">({fonts.length})</span>
          )}
        </CardTitle>

        {loading && (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        )}

        {!loading && fonts.length === 0 && (
          <p className="py-8 text-center text-[13px] text-muted-foreground">Aucune police installée.</p>
        )}

        {!loading && fonts.length > 0 && (
          <div className="flex flex-col gap-2">
            {fonts.map((font) => (
              <div
                key={font.id}
                className="flex items-center justify-between gap-3 rounded-xl bg-muted py-3 pl-3.5 pr-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="mb-1 truncate text-xs font-medium text-muted-foreground">{font.name}</p>
                  {/* L'exemple garde la police qu'il présente. */}
                  <p className="truncate text-xl leading-snug text-foreground">
                    <LazyFontText font={font.name}>Aa Bb Cc · 0123456789</LazyFontText>
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-muted-foreground"
                  onClick={() => handleDelete(font)}
                  disabled={deleting.has(font.id)}
                  title="Supprimer cette police"
                  aria-label={`Supprimer la police ${font.name}`}
                >
                  {deleting.has(font.id) ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── Setup SQL : bloc de code sombre dans les deux modes. Ses 5 lignes de couleurs fixes sont comptées
          par lib/adminColors.test.js (FIXED) : ne pas en ajouter ni en retirer sans ajuster le test. ── */}
      <section className="rounded-card bg-slate-900 p-card text-sm text-slate-300 dark:ring-1 dark:ring-border">
        <CardTitle as="h2" className="mb-2 text-white">Configuration requise (une seule fois)</CardTitle>
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
