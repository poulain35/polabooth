// Section « Éditeur du client » de la page Réglages (/admin/reglages#editeur, LAB-338) : formulaire
// pré-édition et zones perdues de l'éditeur, déplacés d'AdminSettings sans changer l'enregistrement.
import { useState } from 'react';
import { updateGlobalFormConfig, updateFormatBleed } from '../../../lib/supabase';
import { FORMAT_LIST } from '../../../utils/formats';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Switch } from '../../../components/ui/switch';
import { Card, CardTitle } from '../../../components/ui/card';
import { isChoiceType } from '../../../utils/formQuestions';
import QuestionListEditor from '../../../components/QuestionListEditor';
import { useFeatures } from '../../../hooks/useFeatures';
import { toast } from 'sonner';
import { BRAND } from '../../../lib/instanceBrand';

const DEFAULT_QUESTIONS = [
  { id: 'q1', label: `Comment avez-vous connu ${BRAND.name} ?`, type: 'select', required: false, options: [
    'Instagram',
    'Facebook',
    'Google / recherche web',
    'Bouche-à-oreille',
    'Recommandation d\'un professionnel (traiteur, wedding planner…)',
    'Déjà vu à un événement',
    'Autre',
  ] },
  { id: 'q_event_type', label: 'Quel type d\'événement ?', type: 'select', required: false, options: [
    'Mariage',
    'Anniversaire',
    'Baptême / communion',
    'Soirée entreprise / séminaire',
    'Soirée privée',
    'Autre',
  ] },
  { id: 'q2', label: 'Qui est votre photographe ? (Cela nous permet d\'avoir des photos de nos photobooth pour notre communication.)',        type: 'text', required: false },
  { id: 'q3', label: 'Merci de préciser le lieu exact de l\'évènement',                                                                       type: 'text', required: true  },
  { id: 'q4', label: 'Un numéro de téléphone pour vous joindre le jour J',                                                                    type: 'tel',  required: false },
];

function FormConfigSection({ org }) {
  const initCfg   = org.form_config ?? { enabled: false, questions: DEFAULT_QUESTIONS };
  const [enabled,   setEnabled]   = useState(initCfg.enabled ?? false);
  const [questions, setQuestions] = useState(
    initCfg.questions?.length ? initCfg.questions : DEFAULT_QUESTIONS
  );
  const [saving,   setSaving]   = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const cleaned = questions.map((q) =>
        isChoiceType(q.type)
          ? { ...q, options: (q.options ?? []).map((o) => o.trim()).filter(Boolean) }
          : q
      );
      await updateGlobalFormConfig(org.id, { enabled, questions: cleaned });
      toast.success('Sauvegardé !');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-card">
      <div className="flex items-center justify-between gap-3">
        <CardTitle as="h2">Formulaire pré-édition</CardTitle>
        <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Formulaire pré-édition" />
      </div>
      <p className="mb-5 mt-0.5 text-[13px] text-muted-foreground">
        {enabled
          ? 'Le formulaire sera affiché au client avant d\'accéder à l\'éditeur.'
          : 'Désactivé — le client accède directement à l\'éditeur sans questions.'}
      </p>

      {enabled && <QuestionListEditor questions={questions} onChange={setQuestions} />}

      <div className="flex items-center gap-3 border-t border-border pt-4">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>
    </Card>
  );
}

function BleedSection({ org }) {
  const initBleed = org.format_bleed ?? {};
  const [bleed,    setBleed]    = useState(
    () => Object.fromEntries(FORMAT_LIST.map((f) => [f.id, initBleed[f.id] ?? f.bleedMm ?? 3]))
  );
  const [saving,   setSaving]   = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await updateFormatBleed(org.id, bleed);
      toast.success('Sauvegardé !');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-card">
      <CardTitle as="h2">Zones perdues (fond de coupe)</CardTitle>
      <p className="mb-5 mt-0.5 text-[13px] text-muted-foreground">
        Définissez la largeur de la zone perdue en mm pour chaque format.
        Un guide rouge délimite cette zone dans l'éditeur — le contenu important doit rester à l'intérieur.
      </p>

      <div className="mb-4 flex flex-col gap-2">
        {FORMAT_LIST.map((fmt) => (
          <div key={fmt.id} className="flex items-center justify-between gap-4 rounded-xl bg-muted px-3.5 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{fmt.label}</p>
              <p className="text-xs text-muted-foreground">{fmt.subtitle}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Input
                type="number"
                min={0}
                max={10}
                step={0.5}
                value={bleed[fmt.id] ?? fmt.bleedMm ?? 3}
                onChange={(e) => setBleed((prev) => ({ ...prev, [fmt.id]: parseFloat(e.target.value) || 0 }))}
                className="w-20 text-center"
                aria-label={`Zone perdue du format ${fmt.label}, en mm`}
              />
              <span className="text-sm text-muted-foreground">mm</span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 border-t border-border pt-4">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>
    </Card>
  );
}

export default function EditorSettings({ org }) {
  const { isAvailable } = useFeatures();
  return (
    <div className="flex flex-col gap-5">
      {/* Formulaire pré-édition */}
      {isAvailable('client_design') && <FormConfigSection org={org} />}

      {/* Zones perdues */}
      <BleedSection org={org} />
    </div>
  );
}
