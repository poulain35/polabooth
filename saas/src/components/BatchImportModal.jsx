import { useState, useRef, useCallback } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { uploadTemplateBackground, saveDbTemplate, activateTemplate, fetchDraftTemplates } from '../lib/supabase';
import { FORMATS } from '../utils/formats';
import { Button } from './ui/button';
import { Dialog, DialogOverlay, DialogPortal } from './ui/dialog';
import { Spinner } from './ui/spinner';
import { CardHeading } from './admin/CardParts';

// ─── Formats : canvasW/H = dimensions éditeur, exportW/H = résolution finale ──
// On crop à exportW/H pour conserver la qualité maximale.
// Fabric.js affiche à l'échelle canvasW/exportW (= 1/6) et exporte en ×6 → résolution native.
const TARGET_FORMATS = [
  { id: 'portrait',  label: 'Portrait',  canvasW: 400, canvasH: 600,  exportW: 2400, exportH: 3600 },
  { id: 'landscape', label: 'Paysage',   canvasW: 600, canvasH: 400,  exportW: 3600, exportH: 2400 },
  { id: 'stripV',    label: 'Band. V',   canvasW: 200, canvasH: 600,  exportW: 1200, exportH: 3600 },
  { id: 'stripH',    label: 'Band. H',   canvasW: 600, canvasH: 200,  exportW: 3600, exportH: 1200 },
];

// ─── Crop/redimensionnement cover (centre) ────────────────────────────────────
function cropImageToFormat(imgEl, targetW, targetH) {
  const canvas = document.createElement('canvas');
  canvas.width  = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');

  const scale  = Math.max(targetW / imgEl.naturalWidth, targetH / imgEl.naturalHeight);
  const drawW  = imgEl.naturalWidth  * scale;
  const drawH  = imgEl.naturalHeight * scale;
  const drawX  = (targetW - drawW) / 2;
  const drawY  = (targetH - drawH) / 2;

  ctx.drawImage(imgEl, drawX, drawY, drawW, drawH);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
}

// ─── Charge un File en HTMLImageElement ───────────────────────────────────────
function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Impossible de lire l\'image')); };
    img.src = url;
  });
}

// ─── Slug sûr à partir du nom de fichier ──────────────────────────────────────
function toSlug(name) {
  return name
    .toLowerCase()
    .replace(/\.[^.]+$/, '')         // extension
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

// ─── Statut d'un fichier ──────────────────────────────────────────────────────
const STATUS_ICON = {
  pending:    <span className="w-4 h-4 rounded-full bg-border" />,
  processing: <Spinner className="h-4 w-4 shrink-0" />,
  done:       <svg className="w-4 h-4 text-state-green-fg shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>,
  error:      <svg className="w-4 h-4 text-destructive shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>,
  skipped:    <svg className="w-4 h-4 text-state-amber-fg shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>,
};

// ─── Composant principal ──────────────────────────────────────────────────────
export default function BatchImportModal({ onClose }) {
  const [files,       setFiles]       = useState([]); // [{ file, status, error, created }]
  const [running,     setRunning]     = useState(false);
  const [done,        setDone]        = useState(false);
  const [drafts,      setDrafts]      = useState([]);  // templates en attente de validation
  const [loadingDrafts, setLoadingDrafts] = useState(false);
  const [templatePrefix, setTemplatePrefix] = useState('');
  const [dragOver,    setDragOver]    = useState(false);
  const fileInputRef = useRef(null);

  // ── Drag & drop ──────────────────────────────────────────────────────────────
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    addFiles([...e.dataTransfer.files]);
  }, []);

  function addFiles(rawFiles) {
    const entries = rawFiles.map((f) => {
      const ext  = f.name.split('.').pop().toLowerCase();
      const ok   = ['jpg', 'jpeg', 'png', 'webp'].includes(ext);
      return {
        file:    f,
        status:  ok ? 'pending' : 'skipped',
        error:   ok ? '' : `Format .${ext} non supporté — convertissez en JPG/PNG`,
        created: 0,
      };
    });
    setFiles((prev) => {
      const existing = new Set(prev.map((e) => e.file.name));
      return [...prev, ...entries.filter((e) => !existing.has(e.file.name))];
    });
  }

  function updateFile(name, patch) {
    setFiles((prev) => prev.map((e) => e.file.name === name ? { ...e, ...patch } : e));
  }

  // ── Traitement d'un fichier → 4 templates ───────────────────────────────────
  async function processFile(entry, prefix) {
    const slug = toSlug(entry.file.name);
    const ts   = Date.now();
    let created = 0;

    const imgEl = await loadImageFile(entry.file);

    for (const fmt of TARGET_FORMATS) {
      const fmtDef = FORMATS[fmt.id];

      // Crop à la résolution d'export pour conserver la qualité
      const blob = await cropImageToFormat(imgEl, fmt.exportW, fmt.exportH);
      const path = `${ts}-${slug}-${fmt.id}.jpg`;
      const url  = await uploadTemplateBackground(path, blob);

      // L'image est stockée à exportW×exportH.
      // Dans le canvas éditeur (canvasW×canvasH), on la scale à 1/6.
      // À l'export final (×6), elle revient à sa résolution native → qualité maximale.
      const displayScale = fmt.canvasW / fmt.exportW; // = 1/6

      const canvasJson = {
        bg: '#ffffff', bgType: 'solid', bgGradient: null,
        objects: [
          {
            type: 'image', version: '5.3.0',
            originX: 'left', originY: 'top',
            left: 0, top: 0,
            width: fmt.exportW, height: fmt.exportH,
            scaleX: displayScale, scaleY: displayScale,
            src: url,
            selectable: false, evented: false, hoverCursor: 'default',
            isAIBackground: true,
          },
          ...fmtDef.photoZones.map((zone) => ({
            type: 'rect', version: '5.3.0',
            originX: 'left', originY: 'top',
            left: zone.x, top: zone.y,
            width: zone.w, height: zone.h,
            fill: 'transparent', stroke: 'transparent', strokeWidth: 0,
            isPhotoZone: true, lockRotation: true, selectable: true, evented: true,
          })),
        ],
      };

      const name = prefix
        ? `${prefix} · ${fmt.label}`
        : `${entry.file.name.replace(/\.[^.]+$/, '')} · ${fmt.label}`;

      await saveDbTemplate({ name, format_id: fmt.id, canvas_json: canvasJson, preview_url: url, is_active: false });
      created++;
    }

    return created;
  }

  // ── Lancement du batch ───────────────────────────────────────────────────────
  async function handleStart() {
    const toProcess = files.filter((e) => e.status === 'pending');
    if (!toProcess.length) return;
    setRunning(true);
    setDone(false);

    for (const entry of toProcess) {
      updateFile(entry.file.name, { status: 'processing' });
      try {
        const n = await processFile(entry, templatePrefix.trim());
        updateFile(entry.file.name, { status: 'done', created: n });
      } catch (err) {
        updateFile(entry.file.name, { status: 'error', error: err.message ?? 'Erreur' });
      }
    }

    setRunning(false);
    setDone(true);
    loadDraftsForValidation();
  }

  async function loadDraftsForValidation() {
    setLoadingDrafts(true);
    try {
      const data = await fetchDraftTemplates();
      setDrafts(data);
    } catch { /* ignore */ }
    finally { setLoadingDrafts(false); }
  }

  async function handleActivate(id) {
    await activateTemplate(id);
    setDrafts((prev) => prev.filter((t) => t.id !== id));
  }

  async function handleActivateAll() {
    await Promise.all(drafts.map((t) => activateTemplate(t.id)));
    setDrafts([]);
  }

  const pendingCount    = files.filter((e) => e.status === 'pending').length;
  const doneCount       = files.filter((e) => e.status === 'done').length;
  const errorCount      = files.filter((e) => e.status === 'error').length;
  const skippedCount    = files.filter((e) => e.status === 'skipped').length;

  return (
    // Fenêtre Radix sans la croix de DialogContent : la croix de l'en-tête disparaît pendant le traitement,
    // et Échap ou un clic à côté ne ferment pas tant qu'il tourne.
    <Dialog open onOpenChange={(open) => { if (!open && !running) onClose(); }}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 flex w-[780px] max-w-[95vw] max-h-[88vh] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-dialog bg-card shadow-float focus:outline-none">

        {/* Header */}
        <CardHeading
          as={DialogPrimitive.Title}
          className="items-center border-b border-border px-6 py-4"
          title="Import en lot"
          description="JPG · PNG · WebP — chaque image génère 4 cadres photo (un par format)"
          descriptionClassName="text-xs"
          actions={!running && (
            <Button variant="ghost" size="icon-sm" className="text-muted-foreground" onClick={onClose} aria-label="Fermer">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </Button>
          )}
        />

        <div className="flex flex-1 overflow-hidden">

          {/* Colonne gauche — import */}
          <div className="w-[360px] shrink-0 flex flex-col border-r border-border overflow-hidden">

            {/* Nom de préfixe */}
            <div className="px-4 pt-4 pb-3 border-b border-border">
              <label htmlFor="batch-import-prefix" className="text-[11px] font-medium text-muted-foreground block mb-1">
                Préfixe de nom (optionnel)
              </label>
              <input
                id="batch-import-prefix"
                type="text"
                value={templatePrefix}
                onChange={(e) => setTemplatePrefix(e.target.value)}
                disabled={running}
                placeholder="Ex: Mariage 2025 — sinon utilise le nom du fichier"
                className="w-full text-xs text-foreground bg-card border border-input rounded-sm px-2.5 py-2
                  focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent
                  disabled:opacity-50 placeholder:text-muted-foreground"
              />
            </div>

            {/* Zone drag & drop */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => !running && fileInputRef.current?.click()}
              className={`mx-4 mt-4 rounded-xl border-2 border-dashed flex flex-col items-center justify-center
                gap-2 py-6 cursor-pointer transition-colors shrink-0
                ${dragOver
                  ? 'border-primary bg-primary-soft'
                  : 'border-input bg-soft hover:border-primary hover:bg-primary-soft'
                } ${running ? 'pointer-events-none opacity-50' : ''}`}
            >
              <svg className="w-8 h-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              <p className="text-xs font-medium text-ink">Glissez des images ici</p>
              <p className="text-[11px] text-muted-foreground">ou cliquez pour parcourir</p>
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp"
                multiple className="hidden"
                onChange={(e) => { addFiles([...e.target.files]); e.target.value = ''; }} />
            </div>

            {/* Liste des fichiers */}
            <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-1">
              {files.length === 0 && (
                <p className="text-xs text-muted-foreground text-center mt-4">Aucun fichier sélectionné</p>
              )}
              {files.map((entry) => (
                <div key={entry.file.name}
                  className="flex items-start gap-2 px-2.5 py-2 rounded-sm bg-soft text-xs">
                  <div className="mt-0.5">{STATUS_ICON[entry.status]}</div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium text-foreground">{entry.file.name}</p>
                    {entry.error  && <p className="text-[11px] text-state-amber-fg mt-0.5">{entry.error}</p>}
                    {entry.status === 'done' && (
                      <p className="text-[11px] text-state-green-fg mt-0.5">{entry.created} cadres photo créés</p>
                    )}
                  </div>
                  {!running && entry.status === 'pending' && (
                    <button onClick={() => setFiles((p) => p.filter((e) => e.file.name !== entry.file.name))}
                      aria-label={`Retirer ${entry.file.name}`}
                      className="text-muted-foreground hover:text-destructive transition-colors mt-0.5">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Bouton lancer */}
            <div className="px-4 py-3 border-t border-border">
              {done && (
                <p className="text-[11px] text-center text-muted-foreground mb-2">
                  {doneCount > 0 && <span className="text-state-green-fg">{doneCount * 4} cadres photo créés</span>}
                  {errorCount > 0 && <span className="text-destructive ml-2">{errorCount} erreur(s)</span>}
                  {skippedCount > 0 && <span className="text-state-amber-fg ml-2">{skippedCount} ignoré(s)</span>}
                </p>
              )}
              <Button size="sm" className="w-full" onClick={handleStart}
                disabled={pendingCount === 0 || running}>
                {running ? (
                  <><Spinner className="h-3.5 w-3.5 border-current" label="Traitement en cours" />
                  Traitement en cours…</>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 3l14 9-14 9V3z" />
                    </svg>
                    Lancer le traitement
                    {pendingCount > 0 && <span className="bg-primary-foreground/20 px-1.5 py-0.5 rounded-full text-xs">{pendingCount} fichier{pendingCount > 1 ? 's' : ''}</span>}
                  </>
                )}
              </Button>
              <p className="text-[10px] text-muted-foreground text-center mt-1.5">
                Les cadres photo créés seront en mode brouillon — à valider à droite
              </p>
            </div>
          </div>

          {/* Colonne droite — validation */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <p className="text-[13px] font-medium text-foreground">
                Validation des brouillons
                {drafts.length > 0 && (
                  <span className="ml-2 bg-primary-soft text-primary-ink text-[11px] px-1.5 py-0.5 rounded-full font-medium">
                    {drafts.length}
                  </span>
                )}
              </p>
              {drafts.length > 0 && (
                <Button variant="link" size="xs" onClick={handleActivateAll}>
                  Tout valider
                </Button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {loadingDrafts && (
                <div className="flex items-center justify-center h-32">
                  <Spinner className="h-5 w-5" />
                </div>
              )}
              {!loadingDrafts && drafts.length === 0 && (
                <div className="flex flex-col items-center justify-center h-32 gap-2 text-center">
                  <svg className="w-8 h-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 20.25h18A1.5 1.5 0 0021 18.75V5.25A1.5 1.5 0 0019.5 3.75H4.5A1.5 1.5 0 003 5.25v13.5A1.5 1.5 0 004.5 20.25z" />
                  </svg>
                  <p className="text-xs text-muted-foreground">Les brouillons apparaîtront ici après traitement</p>
                </div>
              )}
              {!loadingDrafts && drafts.length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  {drafts.map((tpl) => (
                    <div key={tpl.id} className="bg-soft rounded-xl overflow-hidden border border-border">
                      <div className="aspect-video bg-muted overflow-hidden">
                        {tpl.preview_url && (
                          <img src={tpl.preview_url} alt={tpl.name}
                            className="w-full h-full object-cover" />
                        )}
                      </div>
                      <div className="p-2.5">
                        <p className="text-[11px] font-medium text-foreground truncate">{tpl.name}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{tpl.format_id}</p>
                        <Button size="xs" className="mt-2 w-full" onClick={() => handleActivate(tpl.id)}>
                          Valider
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Charger les brouillons manuellement */}
            {!done && drafts.length === 0 && !loadingDrafts && (
              <div className="px-4 pb-4">
                <Button variant="outline" size="sm" className="w-full" onClick={loadDraftsForValidation}>
                  Charger les brouillons existants
                </Button>
              </div>
            )}
          </div>
        </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
