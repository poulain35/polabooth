import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Copy, Pencil, Trash2, Image as ImageIcon, Loader2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Card, CardContent } from '../../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../components/ui/dialog';
import { Skeleton } from '../../components/ui/skeleton';
import { fetchDbTemplatesMeta, fetchDbTemplateById, deleteDbTemplate, saveDbTemplate, invalidateTemplatesCache } from '../../lib/supabase';
import { FORMATS } from '../../utils/formats';
import { withoutPhotoZones } from '../../lib/photoZones';

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
    setTimeout(() => { onDone(); onClose(); }, 700);
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !loading) onClose(); }}>
      <DialogContent className="w-[340px] sm:max-w-[340px]">
        <DialogHeader>
          <DialogTitle>Dupliquer vers d'autres formats</DialogTitle>
          <DialogDescription>
            Source : <span className="font-medium text-gray-700">{template.name}</span>
            {' '}· <span className="text-primary font-medium">{sourceFormat.label}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {targets.map((fmt) => {
            const active = selected.includes(fmt.id);
            return (
              <button
                key={fmt.id}
                onClick={() => toggle(fmt.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors text-left
                  ${active ? 'border-primary bg-primary/10' : 'border-gray-200 bg-card hover:border-gray-300'}`}
              >
                <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors
                  ${active ? 'bg-primary border-primary' : 'border-gray-300'}`}>
                  {active && (
                    <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <div>
                  <p className={`text-sm font-medium ${active ? 'text-primary' : 'text-gray-800'}`}>{fmt.label}</p>
                  <p className="text-xs text-gray-400">{fmt.subtitle}</p>
                </div>
              </button>
            );
          })}
        </div>

        {loading && (
          <p className="text-sm text-primary text-center">
            {created}/{selected.length} modèle{created > 1 ? 's' : ''} créé{created > 1 ? 's' : ''}…
          </p>
        )}

        <DialogFooter className="gap-3 sm:gap-3">
          <Button variant="outline" onClick={onClose} disabled={loading} className="flex-1">
            Annuler
          </Button>
          <Button onClick={handleCreate} disabled={loading || !selected.length} className="flex-1">
            {loading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <><Copy className="w-4 h-4" />Créer {selected.length} modèle{selected.length > 1 ? 's' : ''}</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FormatBadge({ formatId }) {
  const fmt = FORMATS[formatId];
  return (
    <span className="inline-block px-2 py-0.5 bg-primary/10 text-primary text-[10px] font-medium rounded-full">
      {fmt?.label ?? formatId}
    </span>
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
    if (!confirm('Supprimer ce modèle définitivement ?')) return;
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
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Modèles</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {loading ? (
              <Skeleton className="inline-block w-32 h-4 align-middle" />
            ) : (
              <>{templates.length} modèle{templates.length !== 1 ? 's' : ''} sauvegardé{templates.length !== 1 ? 's' : ''}</>
            )}
          </p>
        </div>
        <Button asChild className="self-start sm:self-auto">
          <Link to="/admin/templates/new">
            <Plus className="w-4 h-4" />
            Nouveau modèle
          </Link>
        </Button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="rounded-2xl bg-card border border-gray-100 overflow-hidden">
              <Skeleton className="w-full h-32 rounded-none" />
              <div className="px-3 py-2.5 space-y-2">
                <Skeleton className="h-3 rounded-full w-3/4" />
                <Skeleton className="h-4 rounded-full w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="text-center py-24">
          <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 13a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1h-4a1 1 0 01-1-1v-6z" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-foreground mb-1">Aucun modèle</h3>
          <p className="text-sm text-muted-foreground mb-6">Créez votre premier modèle depuis l'éditeur.</p>
          <Button asChild>
            <Link to="/admin/templates/new">
              <Plus className="w-4 h-4" />
              Créer un modèle
            </Link>
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          {templates.map((tpl) => (
            <Card key={tpl.id} className="group relative rounded-2xl overflow-hidden hover:shadow-md transition-shadow p-0">
              {/* Preview — hauteur fixe pour tous les formats */}
              <div className="relative w-full h-32 bg-muted flex items-center justify-center overflow-hidden">
                {tpl.preview_url ? (
                  <img
                    src={tpl.preview_url}
                    alt={tpl.name}
                    className="max-w-full max-h-full object-contain"
                    style={{ width: 'auto', height: 'auto' }}
                  />
                ) : (
                  <ImageIcon className="w-8 h-8 text-muted-foreground/40" strokeWidth={1.5} />
                )}

                {/* Hover overlay */}
                <div className="absolute inset-0 bg-black/0 md:group-hover:bg-black/30 transition-colors flex items-center justify-center gap-1.5 opacity-100 md:opacity-0 md:group-hover:opacity-100">
                  <Button asChild variant="secondary" size="icon" className="h-7 w-7 shadow" title="Modifier">
                    <Link to={`/admin/templates/${tpl.id}/edit`}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Link>
                  </Button>
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-7 w-7 shadow"
                    onClick={() => setDupeModal(tpl)}
                    title="Dupliquer vers d'autres formats"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-7 w-7 shadow hover:text-destructive"
                    onClick={() => handleDelete(tpl.id)}
                    disabled={deleting === tpl.id}
                    title="Supprimer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              {/* Info */}
              <CardContent className="px-2.5 py-2">
                <p className="text-xs font-semibold text-foreground truncate">{tpl.name}</p>
                <div className="mt-0.5">
                  <FormatBadge formatId={tpl.format_id} />
                </div>
              </CardContent>
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
