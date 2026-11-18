// Section « Emails aux clients » de la page Réglages (/admin/reglages#emails, LAB-338) : emails
// automatiques envoyés au client (LAB-262), déplacés d'AdminSettings sans changer l'enregistrement,
// puis l'historique des emails envoyés (AdminEmails, LAB-124).
import { lazy, Suspense, useState } from 'react';
import { X, Plus } from 'lucide-react';
import { saveBusinessProfile } from '../../../lib/supabase';
import { businessProfileForm } from '../../../lib/businessProfile';
import { clientEmailsSave, clientEmailsSummary, designRemindersForm } from '../../../lib/clientEmails';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Card, CardTitle } from '../../../components/ui/card';
import { useFeatures } from '../../../hooks/useFeatures';
import { toast } from 'sonner';
import MiniToggle from './MiniToggle';
import { Spinner } from '../../../components/ui/spinner';

const AdminEmails = lazy(() => import('../AdminEmails'));

const spinner = (
  <div className="flex justify-center py-12">
    <Spinner />
  </div>
);

/** Un email automatique : titre, explication, interrupteur, puis ses réglages quand il est actif. */
function ClientEmailRow({ step, title, help, checked, onChange, children, footer }) {
  return (
    <div className="rounded-xl bg-muted p-3.5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-card text-xs font-medium text-foreground">{step}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{help}</p>
        </div>
        <MiniToggle checked={checked} onChange={onChange} />
      </div>
      {checked && children && <div className="mt-3 flex flex-col gap-3 sm:pl-9">{children}</div>}
      {footer && <div className="mt-3 sm:pl-9">{footer}</div>}
    </div>
  );
}

/** Numéro du modèle d'email Brevo, avec ses variables repliées. */
function BrevoTemplateField({ id, label, value, onChange, help, variables }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input id={id} type="number" min={1} value={value} onChange={(e) => onChange(e.target.value)} placeholder="vide = email intégré à l'app" className="sm:w-64" />
      <p className="text-xs text-muted-foreground">{help}</p>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Variables disponibles dans Brevo</summary>
        <p className="mt-1 break-words">{variables.map((v) => `{{ params.${v} }}`).join(', ')}</p>
      </details>
    </div>
  );
}

// LAB-262 : les emails envoyés au client sans action de l'admin, dans l'ordre de son parcours,
// chacun avec son délai et son modèle Brevo (avant : éparpillés dans trois cartes).
function ClientEmailsSection({ org }) {
  const [profile,   setProfile]   = useState(() => businessProfileForm(org.business_profile));
  const [accessTpl, setAccessTpl] = useState(org.brevo_access_template_id ?? '');
  const [reminders, setReminders] = useState(() => designRemindersForm(org.design_reminders));
  const [saving,    setSaving]    = useState(false);

  const setAuto = (key, field) => (value) => setProfile((p) => ({ ...p, [key]: { ...p[key], [field]: value } }));
  const setReminder = (field, value) => setReminders((r) => ({ ...r, [field]: value }));
  const updateMilestone = (idx, value) => setReminder('milestones', reminders.milestones.map((m, i) => (i === idx ? value : m)));
  const summary = clientEmailsSummary({ profile, reminders });

  async function handleSave() {
    setSaving(true);
    try {
      const { businessPatch, columns } = clientEmailsSave({ profile, accessTemplateId: accessTpl, reminders });
      await saveBusinessProfile(org.id, businessPatch, columns);
      setReminders(designRemindersForm(columns.design_reminders));
      setAccessTpl(columns.brevo_access_template_id ?? '');
      toast.success('Sauvegardé !');
    } catch (err) {
      toast.error(err.message);
    } finally { setSaving(false); }
  }

  return (
    <Card className="p-card">
      <CardTitle as="h2">Emails automatiques au client</CardTitle>
      <p className="mb-3 mt-0.5 text-[13px] text-muted-foreground">
        Envoyés par l'app chaque matin, selon la date de l'événement, à l'email client de la fiche.
        Un client ne reçoit jamais deux fois le même email.
      </p>
      <div className="mb-5 rounded-xl bg-primary-soft px-3 py-2 text-[13px] text-primary-ink">
        {summary.length ? (
          <ul className="space-y-0.5">{summary.map((line) => <li key={line}>{line}</li>)}</ul>
        ) : "Aucun email automatique : tout s'envoie à la main depuis la fiche de l'événement."}
      </div>

      <div className="mb-5 flex flex-col gap-3">
        <ClientEmailRow
          step={1}
          title="Avant l'événement : lien de l'éditeur du cadre photo"
          help="Le client reçoit son code d'accès et le lien pour créer son cadre photo. S'il l'a déjà reçu depuis la fiche (« Envoyer le lien au client »), il n'est pas renvoyé. Réservation faite après J-n : envoyé le lendemain matin."
          checked={profile.access_email_auto.enabled}
          onChange={setAuto('access_email_auto', 'enabled')}
          footer={(
            <BrevoTemplateField
              id="access-template" label="Modèle d'email Brevo (n°)" value={accessTpl} onChange={setAccessTpl}
              help="Sert aussi à l'envoi manuel depuis la fiche de l'événement."
              variables={['CLIENT_NAME', 'EVENT_NAME', 'ACCESS_CODE', 'EDITOR_URL', 'EXPIRES_DATE']}
            />
          )}
        >
          <label className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            Envoyer à J-
            <Input type="number" min={1} max={365} value={profile.access_email_auto.days_before}
              onChange={(e) => setAuto('access_email_auto', 'days_before')(e.target.value)} className="w-16 px-2 text-center text-foreground" />
            avant l'événement
          </label>
        </ClientEmailRow>

        <ClientEmailRow
          step={2}
          title="Relances tant que le cadre photo n'est pas soumis"
          help="Rappel avec le lien de l'éditeur, aux jalons choisis avant l'événement. Rien ne part si le cadre photo est soumis ou validé."
          checked={reminders.enabled}
          onChange={(v) => setReminder('enabled', v)}
        >
          <div className="flex flex-wrap items-center gap-2">
            {reminders.milestones.map((m, idx) => (
              <div key={idx} className="flex items-center gap-1 rounded-xl bg-card py-1 pl-2.5 pr-1">
                <span className="text-xs text-muted-foreground">J-</span>
                <Input type="number" min={1} max={365} value={m} onChange={(e) => updateMilestone(idx, e.target.value)}
                  className="w-16 px-2 text-center" aria-label={`Jalon de relance ${idx + 1}`} />
                <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive"
                  onClick={() => setReminder('milestones', reminders.milestones.filter((_, i) => i !== idx))} aria-label="Retirer ce jalon">
                  <X />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setReminder('milestones', [...reminders.milestones, 5])}>
              <Plus />Ajouter une relance
            </Button>
          </div>
          <BrevoTemplateField
            id="reminder-template" label="Modèle d'email Brevo (n°)" value={reminders.brevo_template_id}
            onChange={(v) => setReminder('brevo_template_id', v)}
            help="Le même modèle pour toutes les relances."
            variables={['CLIENT_NAME', 'EVENT_NAME', 'ACCESS_CODE', 'EDITOR_URL', 'DAYS_LEFT']}
          />
        </ClientEmailRow>

        <ClientEmailRow
          step={3}
          title="Après l'événement : lien des photos"
          help="Lien de la galerie (et du livre d'or audio s'il est activé), invitation à laisser un avis Google, facture jointe si elle est sur la fiche. Seulement si le lien de la galerie est renseigné sur la fiche de l'événement."
          checked={profile.delivery_auto.enabled}
          onChange={setAuto('delivery_auto', 'enabled')}
        >
          <label className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            Envoyer à J+
            <Input type="number" min={0} max={365} value={profile.delivery_auto.days_after}
              onChange={(e) => setAuto('delivery_auto', 'days_after')(e.target.value)} className="w-16 px-2 text-center text-foreground" />
            après l'événement
          </label>
        </ClientEmailRow>
      </div>

      <div className="flex items-center gap-3 border-t border-border pt-4">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>
    </Card>
  );
}

export default function ClientEmailsSettings({ org }) {
  const { isAvailable } = useFeatures();
  return (
    <div className="flex flex-col gap-5">
      {/* Emails automatiques au client (LAB-262) */}
      {org && (isAvailable('client_design') || isAvailable('delivery_email')) && <ClientEmailsSection org={org} />}

      {/* Historique des emails envoyés (LAB-124) */}
      <div>
        <CardTitle as="h3" className="mb-3">Emails envoyés</CardTitle>
        <Suspense fallback={spinner}>
          <AdminEmails />
        </Suspense>
      </div>
    </div>
  );
}
