import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { supabase, getGlobalFormConfig } from '../../lib/supabase';
import DateTimePicker from '../../components/DateTimePicker';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Badge } from '../../components/ui/badge';
import { Card } from '../../components/ui/card';

const FORMATS = [
  { id: 'portrait',  label: 'Portrait (10×15 cm)' },
  { id: 'landscape', label: 'Paysage (15×10 cm)' },
  { id: 'stripV',    label: 'Bandelette verticale (5×15 cm)' },
  { id: 'stripH',    label: 'Bandelette horizontale (15×5 cm)' },
];

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateCode() {
  return Array.from({ length: 6 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('');
}

// Décale une valeur "YYYY-MM-DD[THH:MM]" de `days` jours (heure conservée).
function addDays(iso, days) {
  if (!iso) return iso;
  const [datePart, timePart] = iso.split('T');
  const [y, mo, d] = datePart.split('-').map(Number);
  const dt = new Date(y, mo - 1, d);
  dt.setDate(dt.getDate() + days);
  const pad = (n) => String(n).padStart(2, '0');
  const base = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  return timePart ? `${base}T${timePart}` : base;
}

// Expiration par défaut des liens photos & audio : fin d'événement + 2 mois (date seule).
function mediaExpiryDefault(endIso) {
  if (!endIso) return '';
  const [y, mo, d] = endIso.split('T')[0].split('-').map(Number);
  const dt = new Date(y, mo - 1, d);
  dt.setMonth(dt.getMonth() + 2);
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

export default function AdminNewEvent() {
  const navigate = useNavigate();
  const [saving,         setSaving]         = useState(false);
  const [error,          setError]          = useState('');
  const [globalFormEnabled, setGlobalFormEnabled] = useState(false);

  // Charge l'état du formulaire global pour pré-remplir form_config à la création
  useEffect(() => {
    getGlobalFormConfig()
      .then((cfg) => setGlobalFormEnabled(cfg?.enabled ?? false))
      .catch(() => {});
  }, []);

  const [form, setForm] = useState({
    client_name:     '',
    client_email:    '',
    start_date:      '',
    end_date:        '',
    expires_at:      '',
    allowed_formats: ['portrait', 'landscape', 'stripV', 'stripH'],
  });

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toggleFormat(id) {
    setForm((f) => ({
      ...f,
      allowed_formats: f.allowed_formats.includes(id)
        ? f.allowed_formats.filter((x) => x !== id)
        : [...f.allowed_formats, id],
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (form.allowed_formats.length === 0) { setError('Sélectionnez au moins un format.'); return; }

    setSaving(true);

    // Récupérer l'org de l'admin
    const { data: session } = await supabase.auth.getSession();
    const { data: org } = await supabase
      .from('organizations')
      .select('id')
      .eq('owner_id', session.session.user.id)
      .maybeSingle();

    if (!org) { setError('Organisation introuvable.'); setSaving(false); return; }

    // Générer un code unique (retry si collision)
    let access_code = generateCode();
    for (let i = 0; i < 5; i++) {
      const { data: existing } = await supabase
        .from('events')
        .select('id')
        .eq('access_code', access_code)
        .maybeSingle();
      if (!existing) break;
      access_code = generateCode();
    }

    const { data: event, error: insertError } = await supabase
      .from('events')
      .insert({
        org_id:          org.id,
        name:            '',
        client_name:     form.client_name.trim() || null,
        client_email:    form.client_email.trim() || null,
        start_date:      form.start_date || null,
        end_date:        form.end_date   || form.start_date || null,
        expires_at:      form.expires_at || null,
        allowed_formats: form.allowed_formats,
        access_code,
        status:          'active',
        form_config:     { enabled: globalFormEnabled },
      })
      .select('id')
      .single();

    if (insertError) { setError('Erreur lors de la création : ' + insertError.message); setSaving(false); return; }

    navigate(`/admin/events/${event.id}`);
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-xl">

      {/* Breadcrumb */}
      <button
        onClick={() => navigate('/admin/events')}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        Événements
      </button>

      <h1 className="text-2xl font-bold text-foreground mb-8">Nouvel événement</h1>

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Événement */}
        <Card className="p-6 space-y-4">
          <h2 className="font-semibold text-gray-800">Événement</h2>
          <p className="text-xs text-gray-400 -mt-2">
            Le client choisira le nom de l'événement lors de sa première connexion.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <DateTimePicker
              label="Date et heure de début"
              value={form.start_date}
              onChange={(v) => {
                set('start_date', v);
                if (v) {
                  const end = addDays(v, 2);
                  set('end_date', end);
                  set('expires_at', mediaExpiryDefault(end));
                }
              }}
              placeholder="Choisir une date de début"
            />
            <DateTimePicker
              label="Date et heure de fin"
              value={form.end_date}
              min={form.start_date || undefined}
              onChange={(v) => {
                set('end_date', v);
                set('expires_at', mediaExpiryDefault(v));
              }}
              placeholder="Choisir une date de fin"
            />
          </div>
        </Card>

        {/* Client */}
        <Card className="p-6 space-y-4">
          <h2 className="font-semibold text-gray-800">Client</h2>

          <div className="space-y-1.5">
            <Label htmlFor="client_name">Nom du client</Label>
            <Input
              id="client_name"
              type="text"
              value={form.client_name}
              onChange={(e) => set('client_name', e.target.value)}
              placeholder="Marie & Pierre"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="client_email">Email du client</Label>
            <Input
              id="client_email"
              type="email"
              value={form.client_email}
              onChange={(e) => set('client_email', e.target.value)}
              placeholder="client@example.com"
            />
            <p className="text-xs text-gray-400">L'email d'accès sera envoyé manuellement depuis le détail de l'événement.</p>
          </div>
        </Card>

        {/* Formats */}
        <Card className="p-6">
          <h2 className="font-semibold text-gray-800 mb-4">Formats autorisés</h2>
          <div className="space-y-2.5">
            {FORMATS.map(({ id, label }) => (
              <label key={id} className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.allowed_formats.includes(id)}
                  onChange={() => toggleFormat(id)}
                  className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <span className="text-sm text-gray-700">{label}</span>
              </label>
            ))}
          </div>
        </Card>

        {/* Expiration */}
        <Card className="p-6">
          <h2 className="font-semibold text-gray-800 mb-1">Expiration des liens photos &amp; audio</h2>
          <p className="text-xs text-gray-400 mb-4">
            Par défaut, 2 mois après la fin de l'événement. Passé cette date, la galerie photos et le
            livre d'or audio ne sont plus accessibles. Le lien du modèle, lui, expire automatiquement à
            la fin de l'événement. Laissez vide pour un accès illimité.
          </p>
          <DateTimePicker
            showTime={false}
            value={form.expires_at}
            onChange={(v) => set('expires_at', v)}
            placeholder="Choisir une date d'expiration"
          />
        </Card>

        {/* Info formulaire pré-édition */}
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-gray-800">Formulaire pré-édition</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {globalFormEnabled
                  ? 'Activé — hérité des paramètres globaux.'
                  : 'Désactivé — hérité des paramètres globaux.'}
                {' '}
                <a href="/admin/settings" className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
                  Modifier dans Paramètres →
                </a>
              </p>
            </div>
            <Badge variant={globalFormEnabled ? 'default' : 'secondary'}>
              {globalFormEnabled ? 'Activé' : 'Désactivé'}
            </Badge>
          </div>
        </Card>

        {error && (
          <p className="text-sm text-destructive bg-destructive/10 px-4 py-3 rounded-lg">{error}</p>
        )}

        <div className="flex gap-3">
          <Button type="submit" disabled={saving} className="flex-1">
            {saving ? 'Création…' : 'Créer l\'événement'}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate('/admin/events')}>
            Annuler
          </Button>
        </div>
      </form>
    </div>
  );
}
