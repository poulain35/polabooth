// Réglages › Services : tuile d'un réglage non secret (organizations.service_settings), partagée entre
// la page ouverte et les compléments des modules privés (emplacement 'settings.services', LAB-422).
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

// Tuile d'une clé ou d'un réglage, posée dans la carte de son service.
export const SETTING_TILE = 'rounded-xl bg-muted p-3.5';
export const SETTING_LINK = 'inline-flex items-center gap-1 rounded-sm text-muted-foreground underline hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function SettingField({ id, label, help, placeholder, value, onSave, disabled, children }) {
  const [draft, setDraft] = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDraft(value ?? ''); }, [value]);
  const dirty = draft.trim() !== (value ?? '');

  async function save() {
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={SETTING_TILE}>
      <Label htmlFor={id} className="text-foreground">{label}</Label>
      {help && <p className="mt-1 text-[13px] text-muted-foreground">{help}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Input
          id={id}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          disabled={disabled || saving}
          spellCheck={false}
          className="min-w-[10rem] flex-1"
        />
        <Button className="shrink-0" onClick={save} disabled={disabled || saving || !dirty}>
          {saving && <Loader2 className="animate-spin" />}
          Enregistrer
        </Button>
      </div>
      {children?.(setDraft)}
    </div>
  );
}
