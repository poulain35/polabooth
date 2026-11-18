// Section Entreprise de la page Réglages (/admin/reglages#entreprise, LAB-338) : identité de
// l'entreprise, logo, expéditeur des emails, organisation et mot de passe. Déplacé d'AdminSettings
// sans changer l'enregistrement.
import { useState } from 'react';
import { Upload, Loader2 } from 'lucide-react';
import { supabase, saveBusinessProfile, uploadOrgLogo, removeOrgLogo } from '../../../lib/supabase';
import { KIOSK_CREAM } from '../../../lib/kioskSetupScreen';
import { identityErrors, identityForm, identitySave } from '../../../lib/orgIdentity';
import { httpUrlInput } from '../../../lib/urls';
import PasswordSettingsCard from '../../../components/admin/PasswordSettingsCard';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Textarea } from '../../../components/ui/textarea';
import { Label } from '../../../components/ui/label';
import { Card, CardTitle } from '../../../components/ui/card';
import { useFeatures } from '../../../hooks/useFeatures';
import { cn } from '../../../lib/utils';
import { toast } from 'sonner';

// Logo de la société (LAB-257) : enregistré dès l'envoi, affiché sur l'accueil de la borne
// (48 px de haut, 280 px de large au maximum) à la place de l'icône et du nom.
function OrgLogoField({ org, onChange }) {
  const [busy, setBusy] = useState(false);

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      onChange('logo_url', await uploadOrgLogo(org.id, file));
      toast.success('Logo enregistré. Les bornes le prendront à leur prochaine synchronisation.');
    } catch (err) {
      toast.error(err.message || 'Envoi du logo impossible.');
    } finally { setBusy(false); }
  }

  async function handleRemove() {
    setBusy(true);
    try {
      await removeOrgLogo(org.id);
      onChange('logo_url', null);
      toast.success("Logo supprimé. Les bornes afficheront le nom de l'entreprise.");
    } catch (err) {
      toast.error(err.message || 'Suppression du logo impossible.');
    } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label>Logo</Label>
      <div className="flex flex-wrap items-center gap-4">
        {/* Aperçu sur le fond crème de l'accueil de la borne : zone claire dans les deux thèmes. */}
        <div className="light-island flex h-16 w-[296px] max-w-full shrink-0 items-center rounded-xl border border-border px-2"
          style={{ background: KIOSK_CREAM }}>
          {org.logo_url
            ? <img src={org.logo_url} alt="Logo de la société" className="max-h-12 max-w-full object-contain"/>
            : <span className="text-xs text-muted-foreground">Aucun logo : la borne affiche le nom de l'entreprise.</span>}
        </div>
        <div className="flex flex-col items-start gap-2">
          <Button asChild className={cn('cursor-pointer', busy && 'pointer-events-none opacity-60')}>
            <label>
              <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleUpload} disabled={busy}/>
              {busy ? <Loader2 className="animate-spin"/> : <Upload/>}
              {busy ? 'Envoi…' : org.logo_url ? 'Remplacer' : 'Choisir un logo'}
            </label>
          </Button>
          {org.logo_url && (
            <Button type="button" variant="ghost" size="xs" onClick={handleRemove} disabled={busy}
              className="text-muted-foreground hover:text-destructive">
              Supprimer
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        PNG ou JPG, 2 Mo au maximum (pas de SVG). Un PNG à fond transparent est recommandé.
        Affiché en haut à gauche de l'accueil de la borne, à la place du nom de l'entreprise.
      </p>
    </div>
  );
}

// Carte « Entreprise » (open core L5) : identité de l'entreprise réunie en un seul endroit.
// Colonnes d'organizations et des clés de business_profile (src/lib/orgIdentity.js), enregistrées
// ensemble par saveBusinessProfile (fusion : les clés posées par les autres cartes sont gardées).
function CompanySection({ org, onOrgChange }) {
  const [form,   setForm]   = useState(() => identityForm(org));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  function set(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
    setErrors(prev => (prev[key] ? { ...prev, [key]: undefined } : prev));
  }

  async function handleSave() {
    const found = identityErrors(form);
    setErrors(found);
    if (Object.keys(found).length) { toast.error(Object.values(found)[0]); return; }
    setSaving(true);
    try {
      const { columns, businessPatch } = identitySave(form);
      const businessProfile = await saveBusinessProfile(org.id, businessPatch, columns);
      onOrgChange({ ...columns, business_profile: businessProfile });
      toast.success('Enregistré !');
    } catch (err) {
      toast.error(err.message);
    } finally { setSaving(false); }
  }

  const field = (key, label, { type = 'text', placeholder, help } = {}) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`company-${key}`}>{label}</Label>
      <Input
        id={`company-${key}`}
        type={type}
        value={form[key]}
        onChange={e => set(key, e.target.value)}
        placeholder={placeholder}
        aria-invalid={errors[key] ? true : undefined}
        className={errors[key] ? 'border-destructive' : undefined}
      />
      {errors[key] && <p className="text-xs text-destructive">{errors[key]}</p>}
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );

  return (
    <Card className="p-card">
      <CardTitle as="h2">Identité de l'entreprise</CardTitle>
      <p className="mb-5 mt-0.5 text-[13px] text-muted-foreground">
        L'identité de votre entreprise, reprise sur la borne, dans les galeries des invités et dans les emails.
        Un champ laissé vide garde la valeur par défaut.
      </p>
      <div className="flex flex-col gap-4">
        {field('contact_company', "Nom de l'entreprise", {
          placeholder: 'Nom de votre entreprise',
          help: "Affiché dans la barre latérale de l'admin, les galeries publiques et sur la borne.",
        })}
        <OrgLogoField org={org} onChange={(key, val) => onOrgChange({ [key]: val })}/>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {field('contact_phone', 'Téléphone', {
            type: 'tel', placeholder: '06 12 34 56 78', help: "Affiché avec un bouton d'appel sur la borne.",
          })}
          {field('contact_email', 'Email de contact', { type: 'email', placeholder: 'contact@exemple.fr' })}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="company-contact_address">Adresse postale</Label>
          <Textarea
            id="company-contact_address"
            rows={3}
            value={form.contact_address}
            onChange={e => set('contact_address', e.target.value)}
            placeholder={"12 rue de l'Exemple\n00000 Ville"}
          />
          <p className="text-xs text-muted-foreground">Plusieurs lignes possibles. Affichée en pied des emails envoyés aux clients, pas sur la borne.</p>
        </div>
        {field('google_review_url', "Lien d'avis Google", {
          type: 'url', placeholder: 'https://g.page/r/…/review',
          help: 'Ajouté aux emails de livraison pour inviter le client à laisser un avis.',
        })}
      </div>

      <div className="mt-6 flex flex-col gap-4 border-t border-border pt-5">
        <div>
          <h3 className="text-sm font-medium text-foreground">Emails</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">Expéditeur et signature des emails envoyés par l'application.</p>
        </div>
        {field('company_name', 'Nom dans le texte des emails', {
          placeholder: 'Nom de votre entreprise',
          help: 'Repris dans les emails de livraison et du bilan client.',
        })}
        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {field('email_sender_name', "Nom de l'expéditeur", { placeholder: 'Nom de votre entreprise' })}
            {field('email_sender_email', "Adresse de l'expéditeur", { type: 'email', placeholder: 'contact@exemple.fr' })}
          </div>
          <p className="text-xs text-muted-foreground">
            L'adresse doit être un expéditeur validé dans Brevo, sinon les emails partent avec l'expéditeur par défaut.
          </p>
        </div>
        <div className="pt-2">
          <h4 className="text-sm font-medium text-foreground">Marque des emails</h4>
          <p className="mt-0.5 text-xs text-muted-foreground">
            En-tête et pied de page de tous les emails. Un champ vide retire son bloc ; sans logo, le nom de l'entreprise est écrit en titre.
          </p>
        </div>
        {field('email_logo_url', "Logo des emails (adresse de l'image)", {
          type: 'url', placeholder: 'https://…/logo.png',
          help: "Image hébergée en ligne, environ 600 px de large. Vide : le logo de l'entreprise ci-dessus.",
        })}
        {field('website_url', 'Site web', {
          type: 'url', placeholder: 'https://www.exemple.fr', help: 'Lien du logo dans les emails.',
        })}
        {field('email_reviews_text', 'Phrase des avis', {
          placeholder: '**120 avis** Google · note 5/5',
          help: 'Sous les étoiles, en pied des emails clients. **texte** pour du gras.',
        })}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {field('social_facebook_url', 'Facebook', { type: 'url', placeholder: 'https://facebook.com/…' })}
          {field('social_instagram_url', 'Instagram', { type: 'url', placeholder: 'https://instagram.com/…' })}
          {field('social_linkedin_url', 'LinkedIn', { type: 'url', placeholder: 'https://linkedin.com/company/…' })}
        </div>
        {field('email_legal_footer', 'Mentions légales', {
          placeholder: 'Raison sociale – forme juridique – SIREN – adresse',
          help: "Dernière ligne de chaque email. Vide : le nom de l'entreprise.",
        })}
      </div>

      <div className="mt-5 flex items-center gap-3 border-t border-border pt-4">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>
    </Card>
  );
}

// Carte « Organisation » : nom, email de notification et webhook (ces deux derniers avec l'éditeur
// du client). Enregistrée à part, comme avant (LAB-338 : simple déplacement).
function OrganisationCard({ org, setOrg }) {
  const [saving, setSaving] = useState(false);
  const { isAvailable } = useFeatures();

  async function saveOrg(e) {
    e.preventDefault();
    const webhook = httpUrlInput(org.webhook_url);
    if (webhook.error) {
      toast.error(`URL Webhook : ${webhook.error}`);
      return;
    }
    setSaving(true);
    await supabase.from('organizations').update({
      name:                       org.name,
      webhook_url:                webhook.url,
      notify_email:               org.notify_email,
    }).eq('id', org.id);
    setSaving(false);
  }

  return (
    <Card className="p-card">
      <CardTitle as="h2" className="mb-5">Organisation</CardTitle>
      <form onSubmit={saveOrg} className="flex flex-col items-start gap-4">
        {[
          { label: 'Nom', key: 'name', type: 'text', placeholder: 'Nom de votre entreprise' },
          { label: 'Email de notification', key: 'notify_email', type: 'email', placeholder: 'admin@exemple.fr', help: 'Reçoit un email à chaque cadre photo soumis.' },
          { label: 'URL Webhook (optionnel)', key: 'webhook_url', type: 'url', placeholder: 'https://exemple.com/webhook', help: 'Reçoit un POST JSON à chaque soumission.' },
        ].filter(({ key }) => key === 'name' || isAvailable('client_design')).map(({ label, key, type, placeholder, help }) => (
          <div key={key} className="flex w-full flex-col gap-1.5">
            <Label>{label}</Label>
            <Input
              type={type}
              value={org[key] ?? ''}
              onChange={(e) => setOrg({ ...org, [key]: e.target.value })}
              placeholder={placeholder}
            />
            {help && <p className="text-xs text-muted-foreground">{help}</p>}
          </div>
        ))}
        <Button type="submit" disabled={saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </form>
    </Card>
  );
}

export default function CompanySettings({ org, setOrg, patchOrg }) {
  return (
    <div className="flex flex-col gap-5">
      {/* Entreprise : identité, logo, expéditeur des emails (open core L5) */}
      <CompanySection org={org} onOrgChange={patchOrg} />

      {/* Organisation */}
      <OrganisationCard org={org} setOrg={setOrg} />

      {/* Mot de passe de l'admin connecté (LAB-268) */}
      <PasswordSettingsCard />
    </div>
  );
}
