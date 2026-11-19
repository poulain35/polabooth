// LAB-429 (spec docs/specs/reglages-appareil-photo.md) : réglages de l'appareil photo d'une borne, carte de la
// borne (Bornes › État). La borne envoie ses réglages et les listes de son appareil avec son signal
// (camera_report) ; l'admin choisit, la demande (camera_request) est appliquée par la borne à son retour à
// l'accueil, jamais pendant une séance. Règles pures : lib/kioskCamera.js.
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { setKioskCameraSettings } from '../../lib/supabase';
import {
  NO_REPORT_HINT, NO_REPORT_MESSAGE, UNSUPPORTED_MESSAGE,
  cameraPanel, cameraRequestStatus, changedValues, currentValues, flashWarning, initialDraft, optionLabel,
  valuesSummary, visibleSettings,
} from '../../lib/kioskCamera';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Notice } from './CardParts';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/select';

const STATE_STYLE = {
  amber: 'text-state-amber-fg',
  green: 'text-state-green-fg',
  red: 'text-destructive',
};

/** Heure courante relue chaque minute tant qu'une demande attend (bascule « Borne hors ligne »). */
function useMinuteClock(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** onLicenseUpdate(id, colonnes) fusionne la nouvelle demande dans la borne affichée. */
export function KioskCameraSection({ lic, onLicenseUpdate }) {
  const panel = cameraPanel(lic);
  const report = panel.kind === 'ready' ? panel.report : null;
  const request = lic.camera_request ?? null;

  // Le brouillon repart de l'appareil (et d'une demande en attente) à chaque nouveau rapport ou demande.
  const baseKey = JSON.stringify([report?.values ?? null, request?.requested_at ?? null, request?.status ?? null]);
  const base = useMemo(() => initialDraft(report, request), [baseKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [draft, setDraft] = useState(base);
  useEffect(() => { setDraft(base); }, [base]);

  const [saving, setSaving] = useState(false);
  const pending = request?.status === 'pending' || request?.status === 'received';
  const now = useMinuteClock(pending);
  const status = cameraRequestStatus(lic, { now });

  const settings = report ? visibleSettings(report, draft) : [];
  const changes = report ? changedValues(report, draft) : {};
  const hasChanges = Object.keys(changes).length > 0;
  const tvLabel = report ? optionLabel(report, 'tv', draft.tv) : null;
  const warning = flashWarning(tvLabel);

  async function save() {
    if (!hasChanges) return;
    setSaving(true);
    try {
      const next = await setKioskCameraSettings(lic.id, changes);
      onLicenseUpdate(lic.id, { camera_request: next });
      toast.success('Réglages envoyés à la borne');
    } catch (err) {
      toast.error(err.message);
    } finally { setSaving(false); }
  }

  return (
    <div className="border-t border-border pt-4">
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        Appareil photo{panel.model ? ` · ${panel.model}` : ''}
        {panel.mode ? ` · molette sur ${panel.mode}` : ''}
      </p>

      {panel.kind === 'none' && (
        <>
          <p className="text-xs text-muted-foreground">{NO_REPORT_MESSAGE}</p>
          <p className="text-xs text-muted-foreground">{NO_REPORT_HINT}</p>
        </>
      )}

      {panel.kind === 'unsupported' && <p className="text-xs text-muted-foreground">{UNSUPPORTED_MESSAGE}</p>}

      {report && (
        <div className="space-y-3">
          <p className="text-xs text-foreground">
            <span className="text-muted-foreground">Réglages actuels : </span>
            {valuesSummary(report) || '—'}
          </p>

          {panel.locked && <Notice tone="amber">{panel.lockedMessage}</Notice>}

          {!lic.is_active ? (
            <p className="text-xs text-muted-foreground">Borne désactivée : réactivez-la pour changer ses réglages.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {settings.map(s => (
                  <div key={s.key} className="space-y-1">
                    <Label htmlFor={`cam-${lic.id}-${s.key}`} className="text-xs">{s.label}</Label>
                    <Select
                      value={s.value === null ? undefined : String(s.value)}
                      onValueChange={(v) => setDraft(d => ({ ...d, [s.key]: Number(v) }))}
                      disabled={panel.locked || saving}
                    >
                      <SelectTrigger id={`cam-${lic.id}-${s.key}`} className="w-full">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        {s.options.map(o => <SelectItem key={o.code} value={String(o.code)}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>

              {warning && <Notice tone="amber">{warning}</Notice>}

              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={save} disabled={panel.locked || !hasChanges || saving}>
                  {saving ? 'Envoi…' : 'Enregistrer'}
                </Button>
                {hasChanges && !saving && (
                  <Button variant="ghost" onClick={() => setDraft(base)}>Annuler</Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                La borne applique les réglages à son retour à l'accueil, jamais pendant une séance.
              </p>
            </>
          )}
        </div>
      )}

      {status.message && (
        <div className="mt-2 space-y-1">
          <p className={`text-xs ${STATE_STYLE[status.tone] ?? 'text-muted-foreground'}`}>
            {status.message}
            {report && pending && Object.keys(status.values).length > 0 && (
              <span className="text-muted-foreground"> · {valuesSummary(report, { ...currentValues(report), ...status.values })}</span>
            )}
          </p>
          {status.hint && <p className="text-xs text-muted-foreground">{status.hint}</p>}
        </div>
      )}
    </div>
  );
}
