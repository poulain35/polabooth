// Onglet « Résumé » de la fiche de l'événement (LAB-337) : liste « Avant le jour J », mise à
// disposition, liens d'accès, matériel (LAB-358), email de création du cadre, logistique, facturation, options
// générales et historique des emails.
import { useState } from 'react';
import { useFeatures } from '../../../hooks/useFeatures';
import { supabase, updateEventFormConfig, resendAccessEmail, getEmailLogs, syncEventToGoogleCalendar } from '../../../lib/supabase';
import DateTimePicker from '../../../components/DateTimePicker';
import ModuleSlot from '../../../components/ModuleSlot';
import EmailLogList from '../../../components/EmailLogList';
import { Check, Copy, ExternalLink, Image, Camera, Loader2, Mail, Music, Pencil, Send } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { IconCircle } from '../../../components/ui/icon-circle';
import { Meter } from '../../../components/ui/meter';
import { StatusPill } from '../../../components/ui/status-pill';
import { toast } from 'sonner';
import { mediaPurgeInfo } from '../../../lib/mediaExpiry';
import { httpUrlInput, safeHttpUrl } from '../../../lib/urls';
import { APP_URL, mediaExpiryDefault, useHashScroll } from './eventTabUtils';
import { CardHeading, CheckMark, FeatureCard, KioskSaveBar, Notice } from './shared';
import EquipmentNeedsCard from './EquipmentNeedsCard';
import { formatShortDate } from '../../../lib/dates';
import { useCopy } from '../../../hooks/useCopy';
import { Input } from '../../../components/ui/input';

// ── Avant le jour J : étapes d'avant l'événement (eventStages.js) ─────────────

function BeforeDayList({ steps }) {
  const items = steps.filter((step) => step.beforeDay);
  if (!items.length) return null;
  const doneCount = items.filter((step) => step.done).length;
  const current = items.findIndex((step) => !step.done);
  return (
    <Card className="p-card">
      <CardHeading
        title="Avant le jour J"
        actions={(
          <StatusPill tone={doneCount === items.length ? 'green' : 'amber'} dot={false}>
            {doneCount} sur {items.length}
          </StatusPill>
        )}
      />
      <Meter tone="brand" value={doneCount} max={items.length} aria-label="Étapes faites avant le jour J" className="mt-3" />
      <ul className="mt-4 space-y-2.5">
        {items.map((step, i) => (
          <li key={step.id} className="flex items-center gap-3 text-sm">
            <CheckMark state={step.done ? 'done' : i === current ? 'current' : 'todo'} />
            <span className={step.done ? 'text-muted-foreground' : 'text-foreground'}>{step.label}</span>
            <span className="sr-only">{step.done ? '(fait)' : '(à faire)'}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ── Onglet Résumé ─────────────────────────────────────────────────────────────

export default function ResumeTab({ event, setEvent, steps, emailLogs, setEmailLogs, kiosk }) {
  const id = event.id;
  const { isAvailable } = useFeatures();
  const { kioskCfg, kioskSaving, setKiosk, handleKioskSave } = kiosk;
  useHashScroll(true);

  // Info edit
  const [editingInfo, setEditingInfo] = useState(false);
  const [infoForm,    setInfoForm]    = useState({});
  const [savingInfo,  setSavingInfo]  = useState(false);

  const { copied: copiedLink, copy } = useCopy();
  const [resending, setResending] = useState(false);

  async function handleResend() {
    setResending(true);
    try {
      await resendAccessEmail(event.id);
      toast.success(`Envoyé à ${event.client_email}`);
    } catch (err) {
      toast.error(err.message ?? 'Erreur');
    } finally {
      setResending(false);
      // Un refus Brevo écrit aussi une ligne (statut « error ») dans « Emails envoyés ».
      getEmailLogs(id).then(setEmailLogs).catch(() => {});
    }
  }

  function startEditInfo() {
    setInfoForm({
      name:         event.name         ?? '',
      client_name:  event.client_name  ?? '',
      client_email: event.client_email ?? '',
      start_date:   event.start_date ? new Date(event.start_date).toISOString().slice(0, 16) : '',
      end_date:     event.end_date   ? new Date(event.end_date).toISOString().slice(0, 16)   : '',
      expires_at:   event.expires_at ? new Date(event.expires_at).toISOString().slice(0, 10) : '',
      photo_gallery_url: event.photo_gallery_url ?? '',
      delivery_attachment_url: event.delivery_attachment_url ?? '',
    });
    setEditingInfo(true);
  }

  async function saveEventInfo() {
    const gallery = httpUrlInput(infoForm.photo_gallery_url);
    const attachment = httpUrlInput(infoForm.delivery_attachment_url);
    if (gallery.error || attachment.error) {
      toast.error(`${gallery.error ? 'Galerie photos' : 'Pièce jointe'} : ${gallery.error ?? attachment.error}`);
      return;
    }
    setSavingInfo(true);
    try {
      const updates = {
        name:         infoForm.name.trim(),
        client_name:  infoForm.client_name.trim()  || null,
        client_email: infoForm.client_email.trim() || null,
        start_date:   infoForm.start_date          || null,
        end_date:     infoForm.end_date            || infoForm.start_date || null,
        expires_at:   infoForm.expires_at          || null,
        photo_gallery_url: gallery.url,
        delivery_attachment_url: attachment.url,
      };
      const { error } = await supabase.from('events').update(updates).eq('id', id);
      if (error) throw error;
      setEvent(e => ({ ...e, ...updates }));
      setEditingInfo(false);
      if (isAvailable('google_calendar')) syncEventToGoogleCalendar(id);
      toast.success('Informations enregistrées');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingInfo(false);
    }
  }

  const mediaPurge = mediaPurgeInfo(event);
  const galleryHref = safeHttpUrl(event.photo_gallery_url);
  const attachmentHref = safeHttpUrl(event.delivery_attachment_url);
  const invalidLink = (value) => <span className="break-all text-state-red-fg">Lien invalide : {value}</span>;

  const accessLinks = [
    ...(isAvailable('client_design') ? [{
      key: 'template', label: 'Cadre photo', url: `${APP_URL}/e/${event.access_code}`, Icon: Image, tone: 'sky',
    }] : []),
    ...(isAvailable('gallery') ? [{
      key: 'photos', label: 'Photos', url: `${APP_URL}/photos/${event.access_code}`, Icon: Camera, tone: 'mint',
    }] : []),
    ...(event.form_config?.audio_enabled && isAvailable('audio_guestbook') ? [{
      key: 'audio', label: 'Livre d\'or', url: `${APP_URL}/audio/${event.access_code}`, Icon: Music, tone: 'lemon',
    }] : []),
  ];

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:items-start">

      {/* ── Colonne latérale (en premier sur téléphone) : avant le jour J, liens, matériel, email de création ── */}
      <div className="min-w-0 space-y-5 lg:order-2">
        <BeforeDayList steps={steps} />

        {/* Liens d'accès */}
        <Card className="p-card">
          <CardHeading title="Liens d'accès" />
          <ul className="mt-3 space-y-2">
            {accessLinks.map(({ key, label, url, Icon, tone }) => (
              <li key={key} className="flex items-center gap-3">
                <IconCircle tone={tone} size="sm"><Icon /></IconCircle>
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{label}</span>
                <Button variant="ghost" size="icon-sm" onClick={() => copy(url, key)}
                  title="Copier le lien" aria-label={`Copier le lien ${label}`}>
                  {copiedLink === key ? <Check className="text-state-green-fg" /> : <Copy />}
                </Button>
                <Button variant="ghost" size="icon-sm" asChild>
                  <a href={url} target="_blank" rel="noopener noreferrer" title="Ouvrir le lien" aria-label={`Ouvrir le lien ${label}`}>
                    <ExternalLink />
                  </a>
                </Button>
              </li>
            ))}
          </ul>
        </Card>

        {/* Matériel mobilisé (LAB-358) : caché tant qu'aucun type n'existe */}
        <EquipmentNeedsCard event={event} setEvent={setEvent} />

        {/* Email de création du cadre photo — invitation client */}
        {isAvailable('client_design') && (
          <Card className="p-card">
            <CardHeading
              as="h3"
              icon={<Mail />}
              tone="lilac"
              title="Email de création du cadre photo"
              description={<span className="block truncate">{event.client_email ?? 'Aucun email renseigné'}</span>}
            />
            <Button variant="outline" onClick={handleResend} disabled={resending || !event.client_email} className="mt-4">
              {resending ? <Loader2 className="animate-spin" /> : <Send />}
              {resending ? 'Envoi…' : 'Envoyer le lien au client'}
            </Button>

            {!event.client_email && (
              <Notice tone="amber" className="mt-3">Renseigne l'email du client dans Mise à disposition pour pouvoir envoyer le lien.</Notice>
            )}
          </Card>
        )}
      </div>

      {/* ── Colonne principale : mise à disposition, logistique, facturation, options, emails ── */}
      <div className="min-w-0 space-y-5 lg:order-1">

        {/* Mise à disposition */}
        <Card id="mise-a-disposition" className="scroll-mt-4">
          <CardHeading
            className="p-card"
            title="Mise à disposition"
            description="Informations de l'événement"
            actions={!editingInfo ? (
              <Button variant="outline" size="sm" onClick={startEditInfo}>
                <Pencil />
                Modifier
              </Button>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={() => setEditingInfo(false)} disabled={savingInfo}>Annuler</Button>
                <Button size="sm" onClick={saveEventInfo} disabled={savingInfo}>
                  {savingInfo && <Loader2 className="animate-spin" />}
                  {savingInfo ? 'Enregistrement…' : 'Enregistrer'}
                </Button>
              </>
            )}
          />

          {editingInfo ? (
            <div className="grid grid-cols-1 gap-4 px-card pb-card sm:grid-cols-2">
              {[
                { key: 'name',         label: "Nom de l'événement", type: 'text',  placeholder: 'Ex : Mariage Marie & Pierre' },
                { key: 'client_name',  label: 'Nom du client',      type: 'text',  placeholder: 'Marie & Pierre' },
                { key: 'client_email', label: 'Email',              type: 'email', placeholder: 'client@example.com' },
              ].map(({ key, label, type, placeholder }) => (
                <div key={key}>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
                  <Input type={type} value={infoForm[key] ?? ''} onChange={e => setInfoForm(f => ({ ...f, [key]: e.target.value }))}
                    placeholder={placeholder} onKeyDown={e => e.key === 'Enter' && saveEventInfo()} />
                </div>
              ))}
              <DateTimePicker label="Début de l'événement" value={infoForm.start_date ?? ''}
                onChange={v => setInfoForm(f => {
                  const end = f.end_date && f.end_date < v ? v : f.end_date;
                  return { ...f, start_date: v, end_date: end, expires_at: f.expires_at || mediaExpiryDefault(end) };
                })}
                placeholder="Choisir une date de début" />
              <DateTimePicker label="Fin de l'événement" value={infoForm.end_date ?? ''}
                min={infoForm.start_date || undefined}
                onChange={v => setInfoForm(f => ({ ...f, end_date: v, expires_at: f.expires_at || mediaExpiryDefault(v) }))}
                placeholder="Choisir une date de fin" />
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Expiration des liens photos &amp; audio</label>
                <DateTimePicker showTime={false} value={infoForm.expires_at ?? ''}
                  onChange={v => setInfoForm(f => ({ ...f, expires_at: v }))}
                  placeholder="Choisir une date d'expiration" />
                <p className="mt-1 text-xs text-muted-foreground">
                  Défaut : fin d'événement + 2 mois. Le lien de l'éditeur du cadre photo expire, lui, à la fin de l'événement.
                  Les photos et messages audio sont supprimés 30 jours après cette date.
                </p>
                {mediaPurge.purgedAt && (
                  <Notice tone="amber" className="mt-1.5">
                    Les photos et messages audio ont été supprimés le {formatShortDate(mediaPurge.purgedAt)}.
                    Prolonger le lien ne les restaure pas : les galeries resteront vides.
                  </Notice>
                )}
              </div>
              {isAvailable('delivery_email') && <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Galerie photos (livraison)</label>
                <Input type="url" value={infoForm.photo_gallery_url ?? ''} onChange={e => setInfoForm(f => ({ ...f, photo_gallery_url: e.target.value }))}
                  placeholder="https://…/galerie" onKeyDown={e => e.key === 'Enter' && saveEventInfo()} />
              </div>}
              {isAvailable('delivery_email') && <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Pièce jointe de la livraison (PDF, ex. facture)</label>
                <Input type="url" value={infoForm.delivery_attachment_url ?? ''} onChange={e => setInfoForm(f => ({ ...f, delivery_attachment_url: e.target.value }))}
                  placeholder="https://…/facture.pdf" onKeyDown={e => e.key === 'Enter' && saveEventInfo()} />
              </div>}
            </div>
          ) : (
            <dl className="divide-y divide-border border-t border-border">
              {[
                { label: "Nom", value: event.name || <StatusPill tone="amber" dot={false}>Non défini</StatusPill>, icon: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z' },
                { label: "Client", value: event.client_name ?? '—', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
                // Sur une ligne, avec « … » si la place manque (jamais coupé au milieu) ; l'adresse entière au survol.
                { label: "Email", value: event.client_email
                    ? <span className="block truncate" title={event.client_email}>{event.client_email}</span>
                    : '—', icon: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
                { label: "Période", value: event.start_date
                    ? (event.end_date && event.end_date !== event.start_date
                        ? `${formatShortDate(event.start_date)} → ${formatShortDate(event.end_date)}`
                        : formatShortDate(event.start_date))
                    : '—',
                  icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
                { label: "Formats", value: (event.allowed_formats ?? []).join(', ') || '—', icon: 'M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 13a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1h-4a1 1 0 01-1-1v-6z' },
                { label: "Lien du cadre photo", value: event.end_date ? `Expire le ${formatShortDate(event.end_date)} (fin d'événement)` : 'Sans expiration', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
                { label: "Liens photos & audio",
                  value: (
                    <>
                      {event.expires_at ? `Expire le ${formatShortDate(event.expires_at)}` : 'Aucune'}
                      {mediaPurge.purgedAt && (
                        <span className="mt-0.5 block text-xs font-normal text-state-amber-fg">
                          Fichiers supprimés le {formatShortDate(mediaPurge.purgedAt)}
                          {mediaPurge.extendedAfterPurge && ' · lien prolongé après la suppression : les fichiers supprimés ne sont pas restaurés'}
                        </span>
                      )}
                    </>
                  ),
                  icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
                isAvailable('delivery_email') && { label: "Galerie photos",
                  value: galleryHref
                    ? <a href={galleryHref} target="_blank" rel="noopener noreferrer" className="break-all text-primary-ink hover:underline">Ouvrir la galerie</a>
                    : event.photo_gallery_url ? invalidLink(event.photo_gallery_url) : '—',
                  icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
                isAvailable('delivery_email') && { label: "Pièce jointe",
                  value: attachmentHref
                    ? <a href={attachmentHref} target="_blank" rel="noopener noreferrer" className="break-all text-primary-ink hover:underline">Ouvrir le document</a>
                    : event.delivery_attachment_url ? invalidLink(event.delivery_attachment_url) : '—',
                  icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
              ].filter(Boolean).map(({ label, value, icon }) => (
                <div key={label} className="flex items-center gap-3 px-card py-3">
                  <svg className="h-4 w-4 shrink-0 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
                  </svg>
                  <dt className="w-32 shrink-0 text-[13px] leading-tight text-muted-foreground sm:w-36">{label}</dt>
                  <dd className="min-w-0 break-words text-sm font-medium text-foreground">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </Card>

        {/* Retrait / retour de la borne (LAB-72) */}
        <ModuleSlot name="event.logistics" eventId={event.id} />

        {/* Facturation (module « invoicing ») */}
        <ModuleSlot
          name="event.billing"
          event={event}
          onSynced={amounts => setEvent(e => ({ ...e, ...amounts }))}
        />

        {/* Options générales */}
        <Card className="p-card">
          <CardHeading title="Options générales" />
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FeatureCard
              iconPath="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z M15 13a3 3 0 11-6 0 3 3 0 016 0z"
              label="Photo" descOn="Capture photo active" tone="sky"
              checked={true} onChange={() => {}} locked={false}
            />
            <FeatureCard
              iconPath="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              label="Email" descOn="Envoi par email activé" descOff="Envoi par email désactivé"
              tone="lilac"
              checked={kioskCfg?.email?.enabled ?? false}
              onChange={v => setKiosk('email.enabled', v)}
            />
            <FeatureCard
              iconPath="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
              label="QR Code" descOn="Partage QR activé" descOff="Partage QR désactivé"
              tone="peach"
              checked={kioskCfg?.result?.share?.qr ?? true}
              onChange={v => setKiosk('result.share.qr', v)}
            />
            {isAvailable('audio_guestbook') && <FeatureCard
              iconPath="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
              label="Livre d'or" descOn="Livre d'or audio activé" descOff="Livre d'or désactivé"
              tone="lemon"
              checked={event.form_config?.audio_enabled === true}
              onChange={async v => {
                try {
                  await updateEventFormConfig(event.id, { ...event.form_config, audio_enabled: v });
                  setEvent(e => ({ ...e, form_config: { ...e.form_config, audio_enabled: v } }));
                } catch {}
              }}
            />}
            <FeatureCard
              iconPath="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              label="RGPD" descOn="Consentement demandé" descOff="Pas de consentement"
              tone="mint"
              checked={kioskCfg?.rgpd?.enabled ?? false}
              onChange={v => setKiosk('rgpd.enabled', v)}
            />
          </div>
          {(kioskCfg?.email?.enabled !== (event.form_config?.kiosk?.email?.enabled ?? false)
            || kioskCfg?.result?.share?.qr !== (event.form_config?.kiosk?.result?.share?.qr ?? true)
            || kioskCfg?.rgpd?.enabled !== (event.form_config?.kiosk?.rgpd?.enabled ?? false)) && (
            <KioskSaveBar saving={kioskSaving} onSave={handleKioskSave} />
          )}
        </Card>

        {/* Emails envoyés — suivi Brevo de tous les emails de l'événement */}
        {emailLogs.length > 0 && (
          <Card className="p-card">
            <CardHeading
              as="h3"
              title={<>Emails envoyés <span className="font-normal text-muted-foreground">({emailLogs.length})</span></>}
              className="mb-3"
            />
            <EmailLogList
              logs={emailLogs}
              onUpdated={(row) => setEmailLogs((prev) => prev.map((l) => (l.id === row.id ? row : l)))}
            />
          </Card>
        )}
      </div>
    </div>
  );
}
