import { Card } from '../ui/card';
import { CardHeading, Notice } from './CardParts';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { Textarea } from '../ui/textarea';
import QuestionListEditor from '../QuestionListEditor';
import { KIOSK_QUESTION_TYPES } from '../../utils/formQuestions';
import {
  QUESTIONNAIRE_LIMITS, DEFAULT_NOTICE, validateKioskQuestionnaire,
} from '../../lib/kioskQuestionnaire';

const rowCls   = 'flex items-center justify-between gap-4 py-3 border-b border-border last:border-0';
const labelCls = 'text-sm text-foreground';
const fieldLabelCls = 'block text-xs font-medium text-muted-foreground mb-1';


// Onglet « Questionnaire » de la fiche événement (form_config.kiosk.questionnaire, LAB-220).
// `set(champ, valeur)` écrit un champ relatif au questionnaire (ex. 'controller.name').
export default function KioskQuestionnaireSettings({ questionnaire: q, set }) {
  const maxLen = QUESTIONNAIRE_LIMITS.label;
  const required = q.required_for_photo !== false;
  const errors = validateKioskQuestionnaire(q);
  const exitKey = required ? 'cancel_label' : 'skip_label';

  return (
    <>
      <Card className="p-card">
        <CardHeading
          className="flex-nowrap items-center"
          tone="navy"
          icon={(
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          )}
          title="Questionnaire des invités"
          description={q.enabled
            ? 'Posé après la prise de vue, avant l’aperçu et l’impression.'
            : 'Désactivé : la borne ne pose aucune question.'}
          actions={<Switch checked={!!q.enabled} onCheckedChange={v => set('enabled', v)} />}
        />
      </Card>

      {q.enabled && (
        <>
          <Card className="p-card">
            <CardHeading className="mb-4" title="Accès à la photo" />
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className={labelCls}>La photo dépend du questionnaire</p>
                <p className="text-xs text-muted-foreground">
                  {required
                    ? 'L’invité répond aux questions obligatoires, ou annule et n’a pas de photo.'
                    : 'Bouton « Passer » toujours visible : l’invité a sa photo dans tous les cas.'}
                </p>
              </div>
              <Switch checked={required} onCheckedChange={v => set('required_for_photo', v)} />
            </div>
            {required && (
              <Notice tone="amber" className="mt-3">
                Sans réponse, l'invité n'a pas de photo. Option à faire valider juridiquement avant de la vendre.
              </Notice>
            )}

            <div className="mt-4 space-y-4">
              <div>
                <label className={fieldLabelCls}>Bouton de sortie sans répondre</label>
                <Input value={q[exitKey] ?? ''} maxLength={maxLen} className="max-w-xs"
                  onChange={e => set(exitKey, e.target.value)}
                  placeholder={required ? 'Annuler' : 'Passer'} />
                <p className="text-xs text-muted-foreground mt-1">
                  {required ? 'Demande une confirmation, puis la photo est supprimée de la borne.' : 'Mène directement à la photo.'}
                </p>
              </div>
            </div>
          </Card>

          <Card className="p-card">
            <CardHeading className="mb-4" title="Écran du questionnaire" />
            <div className="space-y-4">
              <div>
                <label className={fieldLabelCls}>Titre</label>
                <Input value={q.title ?? ''} maxLength={maxLen} onChange={e => set('title', e.target.value)} />
              </div>
              <div>
                <label className={fieldLabelCls}>Introduction</label>
                <Input value={q.intro ?? ''} maxLength={maxLen} onChange={e => set('intro', e.target.value)} />
              </div>
            </div>
          </Card>

          <Card className="p-card">
            <CardHeading className="mb-4" title="Questions" />
            <p className="text-xs text-muted-foreground mb-3">
              {QUESTIONNAIRE_LIMITS.questions} questions maximum, {QUESTIONNAIRE_LIMITS.options} options par choix, {maxLen} caractères par libellé.
              {' '}Au moins une question obligatoire ; une case à cocher ne peut pas l’être.
            </p>
            <QuestionListEditor
              questions={q.questions ?? []}
              onChange={list => set('questions', list)}
              types={KIOSK_QUESTION_TYPES}
              showAnalytics={false}
              maxQuestions={QUESTIONNAIRE_LIMITS.questions}
              maxOptions={QUESTIONNAIRE_LIMITS.options}
              maxLength={maxLen}
            />
            <div className="mt-3 flex items-center justify-between gap-4 border-t border-border pt-3">
              <div>
                <p className={labelCls}>Proposer l'e-mail saisi pour l'envoi de la photo</p>
                <p className="text-xs text-muted-foreground">L'invité n'a pas à le retaper sur l'écran de partage</p>
              </div>
              <Switch checked={q.prefill_share_email !== false} onCheckedChange={v => set('prefill_share_email', v)} />
            </div>
          </Card>

          <Card className="p-card">
            <CardHeading className="mb-4" title="Responsable des données" />
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className={fieldLabelCls}>Nom du client responsable <span className="text-destructive">*</span></label>
                <Input value={q.controller?.name ?? ''} maxLength={maxLen}
                  onChange={e => set('controller.name', e.target.value)} placeholder="Ex. Société Durand" />
              </div>
              <div>
                <label className={fieldLabelCls}>E-mail de contact du client</label>
                <Input type="email" value={q.controller?.contact_email ?? ''}
                  onChange={e => set('controller.contact_email', e.target.value)} placeholder="contact@client.fr" />
                <p className="text-xs text-muted-foreground mt-1">Fortement conseillé. À défaut : l'email de contact de l'entreprise (Réglages → Entreprise).</p>
              </div>
            </div>
            <div className="mt-4">
              <label className={fieldLabelCls}>Information affichée aux invités</label>
              <Textarea value={q.notice ?? ''} rows={3} className="resize-none"
                onChange={e => set('notice', e.target.value)} placeholder={DEFAULT_NOTICE} />
              <p className="text-xs text-muted-foreground mt-1">
                Variables : <code className="rounded-sm bg-muted px-1">{'{controller_name}'}</code>, <code className="rounded-sm bg-muted px-1">{'{controller_contact}'}</code>. Réponses supprimées 1 mois après l'événement.
              </p>
            </div>
          </Card>

          <Card className="p-card">
            <CardHeading className="mb-4" title="Case de prospection" />
            <div className={rowCls}>
              <div>
                <p className={labelCls}>Proposer la case « être recontacté »</p>
                <p className="text-xs text-muted-foreground">Toujours facultative et décochée sur la borne, jamais une condition de la photo</p>
              </div>
              <Switch checked={q.marketing_consent?.enabled !== false} onCheckedChange={v => set('marketing_consent.enabled', v)} />
            </div>
            {q.marketing_consent?.enabled !== false && (
              <div className="mt-3">
                <label className={fieldLabelCls}>Libellé de la case</label>
                <Input value={q.marketing_consent?.label ?? ''} maxLength={maxLen}
                  onChange={e => set('marketing_consent.label', e.target.value)} />
              </div>
            )}
          </Card>

          {errors.length > 0 && (
            <Notice as="div" tone="red" className="px-4 py-3">
              <p className="font-medium mb-1">À corriger avant d'enregistrer :</p>
              <ul className="list-disc pl-5 space-y-0.5">
                {errors.map((e, i) => <li key={i}>{e.message}</li>)}
              </ul>
            </Notice>
          )}
        </>
      )}
    </>
  );
}
