import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Check, Copy, Pencil, Trash2, Image as ImageIcon, LayoutGrid, Loader2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../components/ui/dialog';
import { IconCircle } from '../../components/ui/icon-circle';
import { Skeleton } from '../../components/ui/skeleton';
import { fetchDbTemplatesMeta, fetchDbTemplateById, deleteDbTemplate, saveDbTemplate, invalidateTemplatesCache } from '../../lib/supabase';
import { FORMATS } from '../../utils/formats';
import { withoutPhotoZones } from '../../lib/photoZones';
import { cn } from '../../lib/utils';
import { CreateButton } from '../../components/admin/AdminPage';

const GRID = 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6';

function adaptCanvasJson(canvasJson, sourceFormat, targetFormat) {
  const rx = targetFormat.canvasWidth  / sourceFormat.canvasWidth;
  const ry = targetFormat.canvasHeight / sourceFormat.canvasHeight;
  const rm = Math.min(rx, ry);

  // Zones du format source retirées, groupes compris : celles du format cible les remplacent.
  const adapted = withoutPhotoZones(canvasJson.objects)
    .map((o) => {
      const base = { ...o, left: (o.left || 0) * rx, top: (o.top || 0) * ry };
      if (o.type === 'i-text' || o.type === 'text')
        return { ...base, fontSize: Math.round((o.fontSize || 20) * rm) };
      if (o.type === 'image')
        return { ...base, scaleX: (o.scaleX || 1) * rx, scaleY: (o.scaleY || 1) * ry };
      if (o.type === 'rect')
        return { ...base, width: (o.width || 0) * rx, height: (o.height || 0) * ry };
      if (o.type === 'circle')
        return { ...base, radius: (o.radius || 0) * rm };
      if (o.type === 'line')
        return { ...base, x1: (o.x1||0)*rx, y1: (o.y1||0)*ry, x2: (o.x2||0)*rx, y2: (o.y2||0)*ry };
      return { ...base, scaleX: (o.scaleX || 1) * rx, scaleY: (o.scaleY || 1) * ry };
    });

  const photoZones = targetFormat.photoZones.map((zone) => ({
    type: 'rect', version: '5.3.0',
    originX: 'left', originY: 'top',
    left: zone.x, top: zone.y, width: zone.w, height: zone.h,
    fill: 'transparent', stroke: 'transparent', strokeWidth: 0,
    isPhotoZone: true, lockRotation: true, selectable: true, evented: true,
  }));

  return {
    // Fond du cadre photo enregistré (donnée du dessin, pas une couleur de l'interface).
    bg: canvasJson.bg || '#ffffff',
    bgType: canvasJson.bgType || 'solid',
    bgGradient: canvasJson.bgGradient || null,
    objects: [...adapted, ...photoZones],
  };
}

function DuplicateFormatsModal({ template, onClose, onDone }) {
  const sourceFormat = FORMATS[template.format_id] ?? FORMATS.portrait;
  const targets = Object.values(FORMATS).filter((f) => f.id !== template.format_id);
  const [selected, setSelected] = useState(targets.map((f) => f.id));
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState(0);

  function toggle(id) {
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  async function handleCreate() {
    if (!selected.length) return;
    setLoading(true);
    const full = await fetchDbTemplateById(template.id);
    const canvasJson = typeof full.canvas_json === 'string'
      ? JSON.parse(full.canvas_json)
      : (full.canvas_json ?? {});
    let count = 0;
    for (const fmtId of selected) {
      const adapted = adaptCanvasJson(canvasJson, sourceFormat, FORMATS[fmtId]);
      await saveDbTemplate({
        name: `${template.name} · ${FORMATS[fmtId].label}`,
        format_id: fmtId,
        canvas_json: adapted,
        preview_url: null,
      });
      count++;
      setCreated(count);
    }
    setLoading(false);
    invalidateTemplatesCache();
    toast.success(`${count} cadre${count > 1 ? 's' : ''} photo créé${count > 1 ? 's' : ''}`);
    onDone();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !loading) onClose(); }}>
      <DialogContent className="w-[340px] sm:max-w-[340px]">
        <DialogHeader>
          <DialogTitle>Dupliquer vers d'autres formats</DialogTitle>
          <DialogDescription>
            Source : <span className="font-medium text-foreground">{template.name}</span>
            {' '}· <span className="font-medium text-primary-ink">{sourceFormat.label}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {targets.map((fmt) => {
            const active = selected.includes(fmt.id);
            return (
              <button
                key={fmt.id}
                type="button"
                aria-pressed={active}
                onClick={() => toggle(fmt.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active ? 'bg-primary-soft text-primary-ink' : 'bg-muted text-muted-foreground hover:bg-soft',
                )}
              >
                {/* La coche porte le choix : la couleur seule ne suffit pas. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                    active ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card',
                  )}
                >
                  {active && <Check className="size-3" strokeWidth={3} />}
                </span>
                <span className="min-w-0">
                  <span className={cn('block text-sm font-medium', !active && 'text-foreground')}>{fmt.label}</span>
                  <span className="block text-xs">{fmt.subtitle}</span>
                </span>
              </button>
            );
          })}
        </div>

        {loading && (
          <p role="status" className="text-center text-[13px] text-primary-ink">
            {created}/{selected.length} cadre{created > 1 ? 's' : ''} photo créé{created > 1 ? 's' : ''}…
          </p>
        )}

        <DialogFooter className="gap-2 sm:space-x-0">
          <Button variant="outline" onClick={onClose} disabled={loading} className="flex-1">
            Annuler
          </Button>
          <Button onClick={handleCreate} disabled={loading || !selected.length} className="flex-1">
            {loading
              ? <Loader2 className="animate-spin" aria-label="Création en cours" />
              : <><Copy aria-hidden="true" />Créer {selected.length} cadre{selected.length > 1 ? 's' : ''} photo</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminTemplates() {
  const [templates, setTemplates] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [deleting,  setDeleting]  = useState(null);
  const [dupeModal, setDupeModal] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try { setTemplates(await fetchDbTemplatesMeta()); }
    catch { setTemplates([]); }
    finally { setLoading(false); }
  }

  async function handleDelete(id) {
    if (!confirm('Supprimer ce cadre photo définitivement ?')) return;
    setDeleting(id);
    try {
      await deleteDbTemplate(id);
      invalidateTemplatesCache();
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch (e) {
      alert(e.message ?? 'Erreur lors de la suppression');
    } finally {
      setDeleting(null);
    }
  }

  return (
    // Onglet Cadres photo de la Bibliothèque (titre et onglets : AdminLibrary, LAB-335).
    <div className="flex flex-col gap-5">
      {/* Nombre de cadres photo et création */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[13px] text-muted-foreground">
          {loading ? (
            <Skeleton className="h-4 w-32" />
          ) : (
            <>{templates.length} cadre{templates.length > 1 ? 's' : ''} photo sauvegardé{templates.length > 1 ? 's' : ''}</>
          )}
        </div>
        <CreateButton to="/admin/templates/new">Nouveau cadre photo</CreateButton>
      </div>

      {loading ? (
        <div className={GRID}>
          {[...Array(8)].map((_, i) => (
            <div key={i} className="overflow-hidden rounded-card bg-card shadow-card">
              <Skeleton className="h-32 w-full rounded-none" />
              <div className="flex flex-col gap-2 p-3">
                <Skeleton className="h-3 w-3/4 rounded-full" />
                <Skeleton className="h-3 w-1/2 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      ) : templates.length === 0 ? (
        <Card className="flex flex-col items-center px-6 py-14 text-center">
          <IconCircle tone="sky"><LayoutGrid /></IconCircle>
          <h2 className="mt-3 font-medium text-foreground">Aucun cadre photo</h2>
          <p className="mb-5 mt-1 text-[13px] text-muted-foreground">Créez votre premier cadre photo depuis l'éditeur.</p>
          <CreateButton to="/admin/templates/new">Créer un cadre photo</CreateButton>
        </Card>
      ) : (
        <div className={GRID}>
          {templates.map((tpl) => (
            <Card key={tpl.id} className="flex min-w-0 flex-col overflow-hidden">
              {/* Aperçu du cadre photo : zone claire dans les deux modes, hauteur fixe pour tous les formats. */}
              <div className="light-island flex h-32 w-full items-center justify-center overflow-hidden bg-muted p-2">
                {tpl.preview_url ? (
                  <img src={tpl.preview_url} alt={tpl.name} className="max-h-full max-w-full object-contain" />
                ) : (
                  <ImageIcon className="h-8 w-8 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
                )}
              </div>

              <div className="flex flex-col px-3 pb-1.5 pt-2.5">
                <p className="truncate text-[13px] font-medium text-foreground">{tpl.name}</p>
                <p className="truncate text-xs text-muted-foreground">{FORMATS[tpl.format_id]?.label ?? tpl.format_id}</p>
                {/* Actions toujours visibles (plus de voile au survol) : mêmes actions au doigt et à la souris. */}
                <div className="-mx-1.5 mt-1 flex items-center gap-0.5">
                  <Button asChild variant="ghost" size="icon-sm" title="Modifier" aria-label={`Modifier ${tpl.name}`}>
                    <Link to={`/admin/templates/${tpl.id}/edit`}><Pencil aria-hidden="true" /></Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setDupeModal(tpl)}
                    title="Dupliquer vers d'autres formats"
                    aria-label={`Dupliquer ${tpl.name} vers d'autres formats`}
                  >
                    <Copy aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="ml-auto text-muted-foreground"
                    onClick={() => handleDelete(tpl.id)}
                    disabled={deleting === tpl.id}
                    title="Supprimer"
                    aria-label={`Supprimer ${tpl.name}`}
                  >
                    {deleting === tpl.id ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {dupeModal && (
        <DuplicateFormatsModal
          template={dupeModal}
          onClose={() => setDupeModal(null)}
          onDone={load}
        />
      )}
    </div>
  );
}
