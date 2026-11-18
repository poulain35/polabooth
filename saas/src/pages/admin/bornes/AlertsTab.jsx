// Onglet Alertes de la page Bornes (/admin/bornes?tab=alertes, LAB-338) : alertes en cours et
// récentes, puis réglage des alertes envoyées par email (déplacé de Paramètres sans changer
// l'enregistrement). Une alerte précise : ?tab=alertes&alerte=<id> (défilement et surbrillance).
// Visible avec la fonctionnalité kiosk_alerts. Logique pure : lib/kioskAlerts.js.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { supabase, fetchKioskAlerts, fetchLicenses } from '../../../lib/supabase';
import {
  alertConfigForm, alertDetailText, alertLabel, alertLinks, alertMachineName, parseAlertParam,
  splitAlerts, RESOLVED_DAYS,
} from '../../../lib/kioskAlerts';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardTitle } from '../../../components/ui/card';
import { IconCircle } from '../../../components/ui/icon-circle';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Skeleton } from '../../../components/ui/skeleton';
import { StatusPill } from '../../../components/ui/status-pill';
import { Switch } from '../../../components/ui/switch';
import { cn } from '../../../lib/utils';
import { toast } from 'sonner';
import { useOwnOrganization } from '../reglages/useOwnOrganization';
import { formatDateTime } from '../../../lib/dates';
import { Notice } from '../../../components/admin/CardParts';

const ALERT_COLUMNS = 'id, event_id, machine_id, alert_type, detail, sent_at, resolved_at, events(name)';
const ALERTS_LIMIT = 100;

// Champ d'un seuil (minutes, pourcentage, nombre d'erreurs) et texte qui l'entoure.
const THRESHOLD_INPUT = 'w-16 px-2 text-center';
const THRESHOLD_TEXT = 'flex items-center gap-2 text-[13px] text-muted-foreground';


function AlertsSection({ org }) {
  const [cfg,    setCfg]    = useState(() => alertConfigForm(org.alert_config));
  const [saving, setSaving] = useState(false);

  function set(path, value) {
    setCfg(prev => {
      const next = structuredClone(prev);
      const keys = path.split('.');
      let cur = next;
      for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]];
      cur[keys[keys.length - 1]] = value;
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const { error } = await supabase.from('organizations').update({ alert_config: cfg }).eq('id', org.id);
      if (error) throw error;
      toast.success('Sauvegardé !');
    } catch (err) {
      toast.error(err.message);
    } finally { setSaving(false); }
  }

  const rows = [
    {
      key: 'machine_offline',
      label: 'Borne hors ligne',
      desc: 'Quand une borne assignée à un événement en cours ne donne plus de signe de vie.',
      param: (
        <span className={THRESHOLD_TEXT}>
          après
          <Input type="number" min={2} max={120} value={cfg.machine_offline.after_minutes}
            onChange={e => set('machine_offline.after_minutes', Math.max(2, Number(e.target.value) || 10))}
            aria-label="Minutes sans signe de vie avant l'alerte"
            className={THRESHOLD_INPUT} />
          min
        </span>
      ),
    },
    {
      key: 'printer_problem',
      label: 'Problème imprimante',
      desc: 'Plus de papier, bourrage, erreur ou imprimante hors ligne.',
      param: null,
    },
    {
      key: 'camera_problem',
      label: 'Appareil photo débranché',
      desc: 'Quand la borne ne détecte plus son appareil photo : les invités ne peuvent plus prendre de photo.',
      param: null,
    },
    {
      key: 'print_quota_near',
      label: 'Quota d\'impressions',
      desc: 'Quand le nombre de tirages approche du maximum défini pour l\'événement.',
      param: (
        <span className={THRESHOLD_TEXT}>
          à
          <Input type="number" min={50} max={100} value={cfg.print_quota_near.threshold_pct}
            onChange={e => set('print_quota_near.threshold_pct', Math.min(100, Math.max(50, Number(e.target.value) || 90)))}
            aria-label="Part du quota d'impressions qui déclenche l'alerte, en pourcentage"
            className={THRESHOLD_INPUT} />
          %
        </span>
      ),
    },
    {
      key: 'paper_low',
      label: 'Papier bientôt vide',
      desc: 'Estimation du stock de papier restant (capacité du rouleau définie dans Mes bornes).',
      param: (
        <span className={THRESHOLD_TEXT}>
          à
          <Input type="number" min={2} max={50} value={cfg.paper_low.threshold_pct}
            onChange={e => set('paper_low.threshold_pct', Math.min(50, Math.max(2, Number(e.target.value) || 10)))}
            aria-label="Part de papier restant qui déclenche l'alerte, en pourcentage"
            className={THRESHOLD_INPUT} />
          % restant
        </span>
      ),
    },
    {
      key: 'kiosk_errors',
      label: 'Erreurs graves sur la borne',
      desc: "Pendant un événement : plantage de l'application, ou erreurs répétées de l'appareil photo. Un email quand ça commence, un autre quand tout est rentré dans l'ordre (30 min sans erreur).",
      param: (
        <span className={THRESHOLD_TEXT}>
          dès
          <Input type="number" min={1} max={50} value={cfg.kiosk_errors.camera_errors}
            onChange={e => set('kiosk_errors.camera_errors', Math.min(50, Math.max(1, Number(e.target.value) || 5)))}
            aria-label="Nombre d'erreurs d'appareil photo en 15 minutes"
            className={THRESHOLD_INPUT} />
          erreurs photo en 15 min
        </span>
      ),
    },
  ];

  return (
    <Card className="p-card">
      <div className="flex items-center justify-between gap-3">
        <CardTitle as="h2" id="reglage-alertes">Alertes des bornes</CardTitle>
        <Switch checked={cfg.enabled} onCheckedChange={v => set('enabled', v)} aria-labelledby="reglage-alertes" />
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {cfg.enabled
          ? 'Recevez un email quand une borne en prestation rencontre un problème. Choisissez les alertes ci-dessous.'
          : 'Désactivé — aucune alerte ne sera envoyée.'}
      </p>

      {cfg.enabled && (
        <>
          {/* Destinataire */}
          <div className="mt-5 flex max-w-md flex-col gap-1.5">
            <Label htmlFor="alert-recipient-email">Email destinataire</Label>
            <Input id="alert-recipient-email" type="email" value={cfg.recipient_email}
              onChange={e => set('recipient_email', e.target.value)}
              placeholder={org.notify_email || 'admin@exemple.fr'} />
            <p className="text-[13px] text-muted-foreground">
              Laissez vide pour utiliser l'email de notification de l'organisation{org.notify_email ? ` (${org.notify_email})` : ''}.
            </p>
          </div>

          {/* Types d'alertes : sur téléphone, le seuil passe sous le texte. */}
          <div className="mt-5 divide-y border-t">
            {rows.map(r => {
              const on = cfg[r.key].enabled;
              return (
                <div key={r.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5">
                  <div className="min-w-0 flex-1 basis-48">
                    <p id={`alerte-type-${r.key}`} className={cn('text-sm font-medium', on ? 'text-foreground' : 'text-muted-foreground')}>{r.label}</p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">{r.desc}</p>
                  </div>
                  {on && r.param && <div className="order-last w-full sm:order-none sm:w-auto">{r.param}</div>}
                  <Switch checked={on} onCheckedChange={v => set(`${r.key}.enabled`, v)} aria-labelledby={`alerte-type-${r.key}`} />
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className={cn('flex items-center gap-3 border-t pt-4', !cfg.enabled && 'mt-5')}>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>
    </Card>
  );
}

/** Une alerte : type, borne, événement, détail et liens. `highlighted` : alerte visée par l'adresse. */
function AlertRow({ alert, licenses, highlighted }) {
  const open = !alert.resolved_at;
  const detail = alertDetailText(alert.detail);
  return (
    <li id={`alerte-${alert.id}`} className="scroll-mt-20">
      <Card className={cn('p-4 sm:px-card', highlighted && 'ring-2 ring-ring')}>
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
          <p className="min-w-0 text-sm font-medium text-foreground">
            {alertLabel(alert.alert_type)}
            <span className="font-normal text-muted-foreground"> · {alertMachineName(alert, licenses)}</span>
          </p>
          <StatusPill tone={open ? 'red' : 'green'}>{open ? 'En cours' : 'Résolue'}</StatusPill>
        </div>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {alert.events?.name ? `${alert.events.name} · ` : ''}
          Envoyée le {formatDateTime(alert.sent_at)}
          {alert.resolved_at && ` · résolue le ${formatDateTime(alert.resolved_at)}`}
        </p>
        {detail && <p className="mt-2 text-sm text-foreground">{detail}</p>}
        {alertLinks(alert).length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
            {alertLinks(alert).map((link) => (
              <Link key={link.to} to={link.to}
                className="rounded-md text-sm font-medium text-primary-ink underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {link.label}
              </Link>
            ))}
          </div>
        )}
      </Card>
    </li>
  );
}

/** Alertes en cours et résolues récemment, relues en temps réel. */
function AlertsList({ targetId }) {
  const [alerts, setAlerts] = useState([]);
  const [licenses, setLicenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const list = await fetchKioskAlerts(ALERTS_LIMIT);
        // L'alerte visée peut être plus ancienne que la liste : on la lit à part.
        if (targetId && !list.some((a) => a.id === targetId)) {
          const { data } = await supabase.from('kiosk_alerts').select(ALERT_COLUMNS).eq('id', targetId).maybeSingle();
          if (data) list.push(data);
        }
        if (!cancelled) { setAlerts(list); setError(''); }
      } catch (e) {
        if (!cancelled) setError(e.message || 'Chargement impossible.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    fetchLicenses({ includeRetired: true }).then((l) => { if (!cancelled) setLicenses(l); }).catch(() => {});
    const channel = supabase
      .channel(`kiosk-alerts-tab-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kiosk_alerts' }, load)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [targetId]);

  // Lien d'une alerte précise : défilement jusqu'à elle, une fois la liste chargée.
  useEffect(() => {
    if (loading || !targetId) return;
    document.getElementById(`alerte-${targetId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [loading, targetId]);

  const { open, resolved } = splitAlerts(alerts, { keepId: targetId });

  return (
    <section aria-labelledby="alertes-en-cours">
      <CardTitle as="h2" id="alertes-en-cours" className="mb-3 flex items-center gap-2">
        Alertes en cours
        {open.length > 0 && <Badge variant="secondary">{open.length}</Badge>}
      </CardTitle>
      {loading ? (
        <div className="space-y-3">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-20 rounded-card" />)}</div>
      ) : error ? (
        <Notice tone="red" role="alert">{error}</Notice>
      ) : (
        <>
          {open.length === 0
            ? (
              <Card className="flex items-center gap-3 p-card">
                <IconCircle tone="muted" size="sm"><CheckCircle2 /></IconCircle>
                <p className="text-sm text-muted-foreground">Aucune alerte en cours.</p>
              </Card>
            )
            : <ul className="space-y-3">{open.map((a) => <AlertRow key={a.id} alert={a} licenses={licenses} highlighted={a.id === targetId} />)}</ul>}
          {resolved.length > 0 && (
            <details className="mt-4" open={resolved.some((a) => a.id === targetId) || undefined}>
              <summary className="w-fit cursor-pointer select-none rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Résolues ces {RESOLVED_DAYS} derniers jours ({resolved.length})
              </summary>
              <ul className="mt-3 space-y-3">
                {resolved.map((a) => <AlertRow key={a.id} alert={a} licenses={licenses} highlighted={a.id === targetId} />)}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}

export default function AlertsTab() {
  const [searchParams] = useSearchParams();
  const targetId = parseAlertParam(searchParams.get('alerte'));
  const { org, loading } = useOwnOrganization();

  return (
    <div className="flex flex-col gap-5">
      <AlertsList targetId={targetId} />
      {loading
        ? <Skeleton className="h-40 rounded-card" />
        : org && <AlertsSection org={org} />}
    </div>
  );
}
