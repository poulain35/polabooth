// Onglet Matériel de la page Bornes (/admin/bornes?tab=materiel, LAB-358, spec
// docs/specs/stock-materiel.md, flux A) : types de matériel de l'organisation (Borne photo, Livre
// d'or audio, Vidéobooth…) et, pour chacun, ses matériels, leur état (en service ou retiré) et leur
// période d'indisponibilité. Compteurs du jour : « 5 disponibles sur 6 ». Fonctionnalité du socle.
// Logique pure : lib/equipment.js.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Archive, ArchiveRestore, Boxes, MoreHorizontal, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  archiveEquipmentType, deleteEquipmentItem, deleteEquipmentType, fetchEquipment, saveEquipmentItem, saveEquipmentType,
} from '../../../lib/supabase';
import {
  SUGGESTED_TYPE_LABELS, availabilityLabel, groupEquipment, itemPayload, itemStatus, lastUnavailabilityLabel, localDay,
  moveType, nextSortOrder, periodState, retiredToggleLabel, suggestItemName, uniqueTypeKey, validateItemDraft,
  validateTypeLabel, isDuplicateTypeLabel, ITEM_NAME_MAX_LENGTH, NOTES_MAX_LENGTH, REASON_MAX_LENGTH, TYPE_LABEL_MAX_LENGTH,
} from '../../../lib/equipment';
import { CreateButton } from '../../../components/admin/AdminPage';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardTitle } from '../../../components/ui/card';
import { Notice } from '../../../components/admin/CardParts';
import { IconCircle } from '../../../components/ui/icon-circle';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { SegmentedControl } from '../../../components/ui/segmented-control';
import { Skeleton } from '../../../components/ui/skeleton';
import { StatusPill } from '../../../components/ui/status-pill';
import { Textarea } from '../../../components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '../../../components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu';

// Ton de la pastille (StatusPill) pour l'état d'un matériel (`itemStatus`) : disponible, indisponible,
// indisponibilité prévue, retiré.
const STATUS_TONE = { ok: 'green', off: 'red', planned: 'amber', retired: 'gray' };

/** Message lisible pour une erreur de la base (contraintes de la migration LAB-358). */
function saveErrorMessage(err) {
  if (err?.code === '23505') return 'Ce type existe déjà';
  if (err?.code === '23503') return 'Ce type a encore des matériels : archivez-le plutôt';
  if (err?.code === '23514') return 'Enregistrement refusé : vérifiez le nom et les dates';
  return err?.message || 'Enregistrement impossible';
}

// ── Fenêtre d'un type (création ou renommage) ───────────────────────────────────────────────

function TypeDialog({ dialog, types, onClose, onSaved }) {
  const editing = dialog.type ?? null;
  const [label, setLabel] = useState(editing?.label ?? '');
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const error = validateTypeLabel(label, types, editing?.id ?? null);
  const key = editing ? editing.key : uniqueTypeKey(label, types);

  async function submit(e) {
    e.preventDefault();
    setTouched(true);
    if (error) return;
    setSaving(true);
    try {
      if (editing) {
        await saveEquipmentType({ id: editing.id, label: label.trim() });
      } else {
        const active = types.filter((t) => !t.archived_at);
        await saveEquipmentType({
          key,
          label: label.trim(),
          // Premier type (ou aucun défaut) : il devient le type par défaut (D3).
          is_default: !active.some((t) => t.is_default),
          sort_order: nextSortOrder(active),
        });
      }
      toast.success(editing ? 'Type renommé' : 'Type créé');
      onSaved();
    } catch (err) {
      toast.error(saveErrorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{editing ? 'Renommer le type' : 'Nouveau type de matériel'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Le nouveau nom s’affiche partout. Le catalogue et les événements gardent le lien.'
                : 'Par exemple Vidéobooth, Livre d’or audio ou Cabine photo.'}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex flex-col gap-1.5">
            <Label htmlFor="equipment-type-label">Nom du type</Label>
            <Input
              id="equipment-type-label"
              autoFocus
              value={label}
              maxLength={TYPE_LABEL_MAX_LENGTH}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={touched && !!error}
            />
            {touched && error
              ? <p className="text-[13px] text-destructive" role="alert">{error}</p>
              : !editing && label.trim() && <p className="text-[13px] text-muted-foreground">Identifiant : {key}</p>}
          </div>
          <DialogFooter className="mt-6 gap-3 sm:gap-3">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Annuler</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Enregistrement…' : editing ? 'Renommer' : 'Créer'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Fenêtre d'un matériel (ajout ou modification) ───────────────────────────────────────────

function ItemDialog({ dialog, today, onClose, onSaved }) {
  const { type, item, suggestedName, sortOrder } = dialog;
  const [draft, setDraft] = useState(() => ({
    name: item?.name ?? suggestedName,
    status: item?.status ?? 'in_service',
    notes: item?.notes ?? '',
    unavailable_from: item?.unavailable_from ?? '',
    unavailable_until: item?.unavailable_until ?? '',
    unavailable_reason: item?.unavailable_reason ?? '',
  }));
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const errors = validateItemDraft(draft);
  const shown = submitted ? errors : { unavailable_until: errors.unavailable_until, unavailable_from: errors.unavailable_from };
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const hasPeriod = !!draft.unavailable_from;
  const past = hasPeriod && periodState(draft, today) === 'past';
  const clearPeriod = () => set({ unavailable_from: '', unavailable_until: '', unavailable_reason: '' });

  async function submit(e) {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length) return;
    setSaving(true);
    try {
      const payload = itemPayload(draft);
      await saveEquipmentItem(item ? { id: item.id, ...payload } : { ...payload, type_id: type.id, sort_order: sortOrder });
      toast.success(item ? 'Matériel enregistré' : 'Matériel ajouté');
      onSaved();
    } catch (err) {
      toast.error(saveErrorMessage(err));
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Supprimer « ${item.name} » ? Pour un matériel vendu ou cassé, choisissez plutôt « Retiré » : il reste dans l’historique.`)) return;
    setSaving(true);
    try {
      await deleteEquipmentItem(item.id);
      toast.success('Matériel supprimé');
      onSaved();
    } catch (err) {
      toast.error(saveErrorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{item ? `Modifier « ${item.name} »` : `Ajouter : ${type.label}`}</DialogTitle>
            <DialogDescription>
              Un matériel en service est compté chaque jour, sauf pendant sa période d’indisponibilité.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="equipment-item-name">Nom</Label>
              <Input id="equipment-item-name" value={draft.name} maxLength={ITEM_NAME_MAX_LENGTH}
                onChange={(e) => set({ name: e.target.value })} aria-invalid={!!shown.name} />
              {shown.name && <p className="text-[13px] text-destructive" role="alert">{shown.name}</p>}
            </div>

            <div>
              <p id="equipment-item-status" className="mb-1.5 text-sm font-medium text-foreground">État</p>
              <SegmentedControl
                aria-labelledby="equipment-item-status"
                value={draft.status}
                onValueChange={(value) => set({ status: value })}
                options={[{ value: 'in_service', label: 'En service' }, { value: 'retired', label: 'Retiré' }]}
              />
              {draft.status === 'retired' && (
                <p className="mt-1.5 text-[13px] text-muted-foreground">Un matériel retiré n’est plus jamais compté. Vous pourrez le remettre en service.</p>
              )}
            </div>

            {draft.status !== 'retired' && (
              <div className="rounded-xl bg-soft p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">Indisponibilité</p>
                  {hasPeriod && (
                    <Button type="button" variant="ghost" size="xs" onClick={clearPeriod}>Retirer la période</Button>
                  )}
                </div>
                {!hasPeriod && (
                  <div className="mt-1">
                    <p className="text-[13px] text-muted-foreground">Réparation, prêt, entretien : le matériel n’est pas compté pendant la période.</p>
                    <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => set({ unavailable_from: today })}>
                      Rendre indisponible
                    </Button>
                  </div>
                )}
                {hasPeriod && past && (
                  <p className="mt-1 text-[13px] text-muted-foreground">{lastUnavailabilityLabel(draft, today)}. La période est terminée, le matériel est compté.</p>
                )}
                {hasPeriod && (
                  <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="equipment-item-from" className="text-xs">Début</Label>
                      <Input id="equipment-item-from" type="date" value={draft.unavailable_from}
                        max={draft.unavailable_until || undefined}
                        onChange={(e) => set({ unavailable_from: e.target.value })} aria-invalid={!!shown.unavailable_from} />
                      {shown.unavailable_from && <p className="text-[13px] text-destructive" role="alert">{shown.unavailable_from}</p>}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="equipment-item-until" className="text-xs">Fin (facultative, comprise)</Label>
                      <Input id="equipment-item-until" type="date" value={draft.unavailable_until}
                        min={draft.unavailable_from || undefined}
                        onChange={(e) => set({ unavailable_until: e.target.value })} aria-invalid={!!shown.unavailable_until} />
                      {shown.unavailable_until && <p className="text-[13px] text-destructive" role="alert">{shown.unavailable_until}</p>}
                    </div>
                    <div className="flex flex-col gap-1.5 sm:col-span-2">
                      <Label htmlFor="equipment-item-reason" className="text-xs">Motif (facultatif)</Label>
                      <Input id="equipment-item-reason" value={draft.unavailable_reason} maxLength={REASON_MAX_LENGTH}
                        placeholder="Ex : réparation de l’écran" onChange={(e) => set({ unavailable_reason: e.target.value })} />
                    </div>
                    {!draft.unavailable_until && (
                      <p className="text-[13px] text-muted-foreground sm:col-span-2">Sans date de fin, le matériel n’est plus compté à partir du début.</p>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="equipment-item-notes">Notes</Label>
              <Textarea id="equipment-item-notes" rows={3} value={draft.notes} maxLength={NOTES_MAX_LENGTH}
                placeholder="Numéro de série, accessoires, emplacement…" onChange={(e) => set({ notes: e.target.value })} />
              {shown.notes && <p className="text-[13px] text-destructive" role="alert">{shown.notes}</p>}
            </div>
          </div>

          <DialogFooter className="mt-6 gap-3 sm:gap-3">
            {item && (
              <Button type="button" variant="ghost" className="text-destructive hover:bg-state-red hover:text-state-red-fg sm:mr-auto" onClick={remove} disabled={saving}>
                <Trash2 />Supprimer
              </Button>
            )}
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Annuler</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Enregistrement…' : item ? 'Enregistrer' : 'Ajouter'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Blocs ───────────────────────────────────────────────────────────────────────────────────

function ItemRow({ item, today, onEdit }) {
  const status = itemStatus(item, today);
  const showReason = item.unavailable_reason && (status.tone === 'off' || status.tone === 'planned');
  return (
    <li className="flex items-start gap-3 px-card py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="text-sm font-medium text-foreground">{item.name}</span>
          <StatusPill tone={STATUS_TONE[status.tone]}>{status.label}</StatusPill>
        </div>
        {showReason && <p className="mt-1 text-[13px] text-muted-foreground">{item.unavailable_reason}</p>}
        {item.notes && <p className="mt-0.5 truncate text-[13px] text-muted-foreground" title={item.notes}>{item.notes}</p>}
      </div>
      <Button variant="ghost" size="sm" onClick={() => onEdit(item)}>
        <Pencil />Modifier
      </Button>
    </li>
  );
}

function TypeBlock({ block, index, count, today, onAction, onAddItem, onEditItem }) {
  const { type, active, retired, available, total, itemCount } = block;
  const [showRetired, setShowRetired] = useState(false);
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 px-card py-4">
        <div className="min-w-0 flex-1">
          <CardTitle as="h2" className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{type.label}</span>
            <span className="text-sm font-normal tracking-normal text-muted-foreground">· {availabilityLabel(available, total)}</span>
            {type.is_default && <Badge variant="secondary">Par défaut</Badge>}
          </CardTitle>
          {total === 0 && (
            <p className="mt-1 text-[13px] text-muted-foreground">Stock non renseigné : ce type n’est pas vérifié tant qu’il n’a aucun matériel en service.</p>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Actions sur ${type.label}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={() => onAction('rename', block)}><Pencil className="w-4 h-4" />Renommer</DropdownMenuItem>
            {!type.is_default && (
              <DropdownMenuItem onSelect={() => onAction('default', block)}><Star className="w-4 h-4" />Type par défaut</DropdownMenuItem>
            )}
            <DropdownMenuItem disabled={index === 0} onSelect={() => onAction('up', block)}><ArrowUp className="w-4 h-4" />Monter</DropdownMenuItem>
            <DropdownMenuItem disabled={index === count - 1} onSelect={() => onAction('down', block)}><ArrowDown className="w-4 h-4" />Descendre</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onAction('archive', block)}><Archive className="w-4 h-4" />Archiver</DropdownMenuItem>
            {itemCount === 0 && (
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => onAction('delete', block)}>
                <Trash2 className="w-4 h-4" />Supprimer
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {active.length > 0 && (
        <ul className="divide-y border-t">
          {active.map((item) => <ItemRow key={item.id} item={item} today={today} onEdit={(i) => onEditItem(block, i)} />)}
        </ul>
      )}

      {showRetired && retired.length > 0 && (
        <ul className="divide-y border-t bg-soft">
          {retired.map((item) => <ItemRow key={item.id} item={item} today={today} onEdit={(i) => onEditItem(block, i)} />)}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t px-card py-3">
        <Button variant="outline" size="sm" onClick={() => onAddItem(block)}><Plus />Ajouter</Button>
        {retired.length > 0 && (
          <button type="button" onClick={() => setShowRetired((v) => !v)} aria-expanded={showRetired}
            className="rounded-md text-[13px] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {retiredToggleLabel(retired.length, showRetired)}
          </button>
        )}
      </div>
    </Card>
  );
}

function EmptyState({ types, busy, onSuggest, onOther }) {
  const suggestions = SUGGESTED_TYPE_LABELS.filter((label) => !isDuplicateTypeLabel(label, types));
  return (
    <Card className="flex items-start gap-4 p-card">
      <IconCircle tone="lilac" className="hidden sm:inline-flex"><Boxes /></IconCircle>
      <div className="min-w-0 flex-1">
        <CardTitle as="h2">Décrivez votre matériel</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          Créez un type par sorte de matériel que vous louez, puis ajoutez chaque appareil. Tant qu’un type n’a aucun
          matériel, la disponibilité n’est pas vérifiée.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {suggestions.map((label) => (
            <Button key={label} variant="outline" size="sm" disabled={busy} onClick={() => onSuggest(label)}>
              <Plus />{label}
            </Button>
          ))}
          <Button variant="ghost" size="sm" disabled={busy} onClick={onOther}>Autre type…</Button>
        </div>
      </div>
    </Card>
  );
}

function ArchivedTypes({ blocks, onAction }) {
  if (!blocks.length) return null;
  return (
    <details>
      <summary className="w-fit cursor-pointer select-none rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Types archivés ({blocks.length})
      </summary>
      <Card className="mt-3">
        <ul className="divide-y">
          {blocks.map((block) => (
            <li key={block.type.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-card py-2.5">
              <span className="min-w-0 flex-1 basis-40 text-sm text-foreground">
                {block.type.label}
                <span className="text-muted-foreground"> · {block.itemCount} {block.itemCount > 1 ? 'matériels' : 'matériel'}</span>
              </span>
              <Button variant="ghost" size="sm" onClick={() => onAction('restore', block)}><ArchiveRestore />Restaurer</Button>
              {block.itemCount === 0 && (
                <Button variant="ghost" size="sm" className="text-destructive hover:bg-state-red hover:text-state-red-fg" onClick={() => onAction('delete', block)}><Trash2 />Supprimer</Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </details>
  );
}

// ── Onglet ──────────────────────────────────────────────────────────────────────────────────

export default function EquipmentTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [typeDialog, setTypeDialog] = useState(null);
  const [itemDialog, setItemDialog] = useState(null);
  const today = localDay();

  const load = useCallback(async () => {
    try {
      setData(await fetchEquipment());
      setError('');
    } catch (err) {
      setError(err.message || 'Chargement impossible');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const types = useMemo(() => data?.types ?? [], [data]);
  const items = useMemo(() => data?.items ?? [], [data]);
  const groups = useMemo(() => groupEquipment(types, items, today), [types, items, today]);

  async function run(action, success) {
    setBusy(true);
    try {
      await action();
      if (success) toast.success(success);
      await load();
    } catch (err) {
      toast.error(saveErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function createSuggested(label) {
    const active = types.filter((t) => !t.archived_at);
    run(() => saveEquipmentType({
      key: uniqueTypeKey(label, types),
      label,
      is_default: !active.some((t) => t.is_default),
      sort_order: nextSortOrder(active),
    }), `Type « ${label} » créé`);
  }

  function onAction(action, block) {
    const { type, active, itemCount } = block;
    if (busy) return;
    switch (action) {
      case 'rename':
        setTypeDialog({ type });
        break;
      case 'default':
        run(() => saveEquipmentType({ id: type.id, is_default: true }), `« ${type.label} » est le type par défaut`);
        break;
      case 'up':
      case 'down': {
        const updates = moveType(types, type.id, action);
        if (updates.length) run(() => Promise.all(updates.map((u) => saveEquipmentType(u))));
        break;
      }
      case 'archive':
        if (type.is_default) {
          toast.error('Choisissez d’abord un autre type par défaut');
        } else if (active.length > 0) {
          toast.error('Retirez d’abord tous ses matériels : un type archivé n’est plus compté');
        } else if (window.confirm(`Archiver « ${type.label} » ? Il ne sera plus compté ni proposé.`)) {
          run(() => archiveEquipmentType(type.id), 'Type archivé');
        }
        break;
      case 'restore':
        run(() => archiveEquipmentType(type.id, false), 'Type restauré');
        break;
      case 'delete': {
        const others = types.some((t) => t.id !== type.id && !t.archived_at);
        if (itemCount > 0) {
          toast.error('Ce type a des matériels : archivez-le plutôt');
        } else if (type.is_default && !type.archived_at && others) {
          toast.error('Choisissez d’abord un autre type par défaut');
        } else if (window.confirm(`Supprimer le type « ${type.label} » ?`)) {
          run(() => deleteEquipmentType(type.id), 'Type supprimé');
        }
        break;
      }
      default:
        break;
    }
  }

  function addItem(block) {
    const typeItems = [...block.active, ...block.retired];
    setItemDialog({
      type: block.type,
      item: null,
      suggestedName: suggestItemName(block.type.label, typeItems),
      sortOrder: nextSortOrder(typeItems),
    });
  }

  const afterSave = (close) => async () => {
    close(null);
    await load();
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          Votre parc, par type de matériel. Le nombre de matériels disponibles à une date sert à savoir ce que vous
          pouvez encore louer ce jour-là.
        </p>
        {data && types.length > 0 && (
          <CreateButton onClick={() => setTypeDialog({ type: null })}>Nouveau type</CreateButton>
        )}
      </div>

      {error && (
        <Notice as="div" tone="red" role="alert" className="flex flex-wrap items-center justify-between gap-3">
          <p>{error}</p>
          <Button variant="outline" size="sm" className="text-foreground" onClick={load}>Réessayer</Button>
        </Notice>
      )}

      {!data && !error && (
        <div className="grid grid-cols-1 items-start gap-card xl:grid-cols-2">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-32 rounded-card" />)}</div>
      )}

      {data && groups.active.length === 0 && (
        <EmptyState types={types} busy={busy} onSuggest={createSuggested} onOther={() => setTypeDialog({ type: null })} />
      )}

      {data && groups.active.length > 0 && (
        <div className="grid grid-cols-1 items-start gap-card xl:grid-cols-2">
          {groups.active.map((block, index) => (
            <TypeBlock
              key={block.type.id}
              block={block}
              index={index}
              count={groups.active.length}
              today={today}
              onAction={onAction}
              onAddItem={addItem}
              onEditItem={(b, item) => setItemDialog({ type: b.type, item })}
            />
          ))}
        </div>
      )}

      {data && <ArchivedTypes blocks={groups.archived} onAction={onAction} />}

      {typeDialog && (
        <TypeDialog dialog={typeDialog} types={types} onClose={() => setTypeDialog(null)} onSaved={afterSave(setTypeDialog)} />
      )}
      {itemDialog && (
        <ItemDialog dialog={itemDialog} today={today} onClose={() => setItemDialog(null)} onSaved={afterSave(setItemDialog)} />
      )}
    </div>
  );
}
