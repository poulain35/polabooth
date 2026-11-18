// Carte « Choix du cadre par l'invité » de l'onglet Création du client (LAB-314, spec choix-cadre-invite) :
// form_config.kiosk.frame_choice = { enabled, max_frames }. Coupé par défaut ; tant qu'il l'est, le
// client n'a qu'un cadre et la borne n'en imprime qu'un (le cadre validé au plus petit numéro).
import { FRAME_CHOICE_MAX_FRAMES } from '../../lib/designKind';
import { withFrameChoiceDefaults } from '../../lib/kioskFormats';
import { frameWarnings, kioskFrames } from '../../lib/clientDesigns';
import { Card } from '../ui/card';
import { CardHeading, Notice } from './CardParts';
import { Switch } from '../ui/switch';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/select';

export default function FrameChoiceCard({ kioskCfg, setKiosk, frames, rowCls, labelCls }) {
  const choice = withFrameChoiceDefaults(kioskCfg.frame_choice);
  const warnings = frameWarnings(frames, kioskCfg);
  const approvedCount = kioskFrames(frames, { frame_choice: { enabled: true } }).length;

  return (
    <Card className="p-card">
      <CardHeading className="mb-3" title="Choix du cadre par l'invité"
        description="Le client peut créer plusieurs cadres ; la borne demande alors à l'invité lequel imprimer. Coupé : un seul cadre." />
      <div>
        <div className={`${rowCls} gap-4`}>
          <div className="min-w-0">
            <p className={labelCls}>Proposer plusieurs cadres</p>
            <p className="text-xs text-muted-foreground">Chaque cadre est validé séparément, plus haut dans cet onglet.</p>
          </div>
          <Switch checked={choice.enabled} onCheckedChange={v => setKiosk('frame_choice.enabled', v === true)}
            aria-label="Proposer plusieurs cadres" />
        </div>
        <div className={`${rowCls} gap-4`}>
          <div className="min-w-0">
            <p className={labelCls}>Nombre de cadres</p>
            <p className="text-xs text-muted-foreground">Cadres que le client peut créer.</p>
          </div>
          <Select value={String(choice.max_frames)} disabled={!choice.enabled}
            onValueChange={v => setKiosk('frame_choice.max_frames', Number(v))}>
            <SelectTrigger className="w-28" aria-label="Nombre de cadres">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FRAME_CHOICE_MAX_FRAMES.map(n => <SelectItem key={n} value={String(n)}>{n} cadres</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      {choice.enabled && approvedCount > choice.max_frames && (
        <p className="text-xs text-muted-foreground mt-3">
          {approvedCount} cadres sont déjà validés : ils restent tous sur la borne. Le client ne peut plus modifier
          les cadres au-delà du cadre {choice.max_frames}.
        </p>
      )}
      {warnings.map(w => (
        <Notice key={w.code} tone="amber" className="mt-3">{w.message}</Notice>
      ))}
    </Card>
  );
}
