// Ligne « Matériel » de l'onglet Résumé (LAB-358, spec docs/specs/stock-materiel.md, flux E) :
// besoin de matériel de l'événement (events.equipment_needs). null = 1 du type par défaut. Visible dès
// qu'un type non archivé existe (Bornes › Matériel). Fonctionnalité du socle.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { fetchEquipment, updateEventEquipmentNeeds } from '../../../lib/supabase';
import {
  MAX_NEED_QUANTITY, compareTypes, defaultTypeKey, eventNeeds, needsSummary, parseNeedQuantity,
} from '../../../lib/equipment';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '../../../components/ui/dialog';
import { CardHeading } from './shared';

function NeedsDialog({ event, types, onClose, onSaved }) {
  const current = eventNeeds(event, defaultTypeKey(types));
  const [values, setValues] = useState(() => Object.fromEntries(types.map((t) => [t.key, String(current[t.key] ?? 0)])));
  const [saving, setSaving] = useState(false);
  const invalid = types.filter((t) => parseNeedQuantity(values[t.key]) === null).map((t) => t.key);

  async function submit(e) {
    e.preventDefault();
    if (invalid.length) return;
    setSaving(true);
    try {
      // Les besoins des types archivés (non affichés) sont gardés tels quels.
      const next = { ...current };
      for (const t of types) next[t.key] = parseNeedQuantity(values[t.key]);
      const saved = await updateEventEquipmentNeeds(event.id, next);
      toast.success('Matériel enregistré');
      onSaved(saved);
    } catch (err) {
      toast.error(err?.message || 'Enregistrement impossible');
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>Matériel de l’événement</DialogTitle>
            <DialogDescription>Quantité de chaque type de matériel mobilisée par cet événement.</DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-3">
            {types.map((t) => (
              <div key={t.key} className="flex items-center gap-3">
                <Label htmlFor={`need-${t.key}`} className="min-w-0 flex-1">{t.label}</Label>
                <Input id={`need-${t.key}`} type="number" inputMode="numeric" min={0} max={MAX_NEED_QUANTITY} step={1}
                  className="w-20" value={values[t.key]} aria-invalid={invalid.includes(t.key)}
                  onChange={(e) => setValues((v) => ({ ...v, [t.key]: e.target.value }))} />
              </div>
            ))}
            {invalid.length > 0 && (
              <p className="text-xs text-destructive" role="alert">Indiquez un nombre entier de 0 à {MAX_NEED_QUANTITY}.</p>
            )}
          </div>
          <DialogFooter className="mt-6 gap-3 sm:gap-3">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Annuler</Button>
            <Button type="submit" disabled={saving || invalid.length > 0}>{saving ? 'Enregistrement…' : 'Enregistrer'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function EquipmentNeedsCard({ event, setEvent }) {
  const [types, setTypes] = useState(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchEquipment()
      .then(({ types: rows }) => { if (alive) setTypes(rows.filter((t) => !t.archived_at).sort(compareTypes)); })
      // Ligne facultative : sans lecture possible (table absente, autre organisation), on la cache.
      .catch(() => { if (alive) setTypes([]); });
    return () => { alive = false; };
  }, []);

  if (!types?.length) return null;

  return (
    <Card className="p-card">
      <CardHeading
        title="Matériel"
        actions={(
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil />Modifier
          </Button>
        )}
      />
      <p className="mt-3 text-sm text-foreground">{needsSummary(event.equipment_needs, types)}</p>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Votre parc se règle dans <Link to="/admin/bornes?tab=materiel" className="font-medium text-primary-ink hover:underline">Bornes › Matériel</Link>.
      </p>
      {editing && (
        <NeedsDialog
          event={event}
          types={types}
          onClose={() => setEditing(false)}
          onSaved={(equipment_needs) => {
            setEvent((e) => ({ ...e, equipment_needs }));
            setEditing(false);
          }}
        />
      )}
    </Card>
  );
}
