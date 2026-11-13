import { Card } from '../ui/card';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { Textarea } from '../ui/textarea';
import QuestionListEditor from '../QuestionListEditor';
import { KIOSK_QUESTION_TYPES } from '../../utils/formQuestions';
import {
  QUESTIONNAIRE_LIMITS, DEFAULT_HOME_NOTICE, DEFAULT_NOTICE, validateKioskQuestionnaire,
} from '../../lib/kioskQuestionnaire';

const rowCls   = 'flex items-center justify-between gap-4 py-3 border-b border-gray-50 last:border-0';
const labelCls = 'text-sm text-gray-700';
const fieldLabelCls = 'block text-xs font-medium text-gray-600 mb-1';

function CardTitle({ children }) {
  return <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">{children}</h2>;
}

// Onglet « Questionnaire » de la fiche événement (form_config.kiosk.questionnaire, LAB-220).
// `set(champ, valeur)` écrit un champ relatif au questionnaire (ex. 'controller.name').
export default function KioskQuestionnaireSettings({ questionnaire: q, set }) {
  const maxLen = QUESTIONNAIRE_LIMITS.label;
  const required = q.required_for_photo !== false;
  const errors = validateKioskQuestionnaire(q);
  const exitKey = required ? 'cancel_label' : 'skip_label';

  return (
    <>
      <Card className="p-5 rounded-2xl shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-gray-800">Questionnaire des invités</h2>
            <p className="text-xs text-gray-400">
              {q.enabled
                ? 'Posé après la prise de vue, avant l’aperçu et l’impression.'
                : 'Désactivé : la borne ne pose aucune question.'}
            </p>
          </div>
          <Switch checked={!!q.enabled} onCheckedChange={v => set('enabled', v)} />
        </div>
      </Card>

      {q.enabled && (
        <>
          <Card className="p-5 rounded-2xl shadow-sm">
            <CardTitle>Accès à la photo</CardTitle>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className={labelCls}>La photo dépend du questionnaire</p>
                <p className="text-xs text-gray-400">
                  {required
                    ? 'L’invité répond aux questions obligatoires, ou annule et n’a pas de photo.'
                    : 'Bouton « Passer » toujours visible : l’invité a sa photo dans tous les cas.'}
                </p>
              </div>
              <Switch checked={required} onCheckedChange={v => set('required_for_photo', v)} />
            </div>
            {required && (
              <p className="text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2 mt-3">
                Sans réponse, l'invité n'a pas de photo. Option à faire valider juridiquement avant de la vendre.
              </p>
            )}

            <div className="mt-4 space-y-4">
              {required && (
                <div>
                  <label className={fieldLabelCls}>Mention à l'accueil</label>
                  <Input value={q.home_notice ?? ''} maxLength={maxLen}
                    onChange={e => set('home_notice', e.target.value)}
                    placeholder={DEFAULT_HOME_NOTICE} />
                  {!String(q.home_notice ?? '').trim() ? (
                    <button type="button" onClick={() => set('home_notice', DEFAULT_HOME_NOTICE)}
                      className="text-xs text-primary font-medium mt-1.5">
                      Utiliser le texte par défaut
                    </button>
                  ) : (
                    <p className="text-xs text-gray-400 mt-1">Affichée sur l'écran d'accueil de la borne, avant la photo.</p>
                  )}
                </div>
              )}
              <div>
                <label className={fieldLabelCls}>Bouton de sortie sans répondre</label>
                <Input value={q[exitKey] ?? ''} maxLength={maxLen} className="max-w-xs"
                  onChange={e => set(exitKey, e.target.value)}
                  placeholder={required ? 'Annuler' : 'Passer'} />
                <p className="text-xs text-gray-400 mt-1">
                  {required ? 'Demande une confirmation, puis la photo est supprimée de la borne.' : 'Mène directement à la photo.'}
                </p>
              </div>
            </div>
          </Card>

          <Card className="p-5 rounded-2xl shadow-sm">
            <CardTitle>Écran du questionnaire</CardTitle>
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

          <Card className="p-5 rounded-2xl shadow-sm">
            <CardTitle>Questions</CardTitle>
            <p className="text-xs text-gray-400 mb-3">
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
            <div className={`${rowCls} border-t border-gray-100`}>
              <div>
                <p className={labelCls}>Proposer l'e-mail saisi pour l'envoi de la photo</p>
                <p className="text-xs text-gray-400">L'invité n'a pas à le retaper sur l'écran de partage</p>
              </div>
              <Switch checked={q.prefill_share_email !== false} onCheckedChange={v => set('prefill_share_email', v)} />
            </div>
          </Card>

          <Card className="p-5 rounded-2xl shadow-sm">
            <CardTitle>Responsable des données</CardTitle>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className={fieldLabelCls}>Nom du client responsable <span className="text-red-500">*</span></label>
                <Input value={q.controller?.name ?? ''} maxLength={maxLen}
                  onChange={e => set('controller.name', e.target.value)} placeholder="Ex. Société Durand" />
              </div>
              <div>
                <label className={fieldLabelCls}>E-mail de contact du client</label>
                <Input type="email" value={q.controller?.contact_email ?? ''}
                  onChange={e => set('controller.contact_email', e.target.value)} placeholder="contact@client.fr" />
                <p className="text-xs text-gray-400 mt-1">Fortement conseillé. À défaut : l'email de contact de l'entreprise (Paramètres → Entreprise).</p>
              </div>
            </div>
            <div className="mt-4">
              <label className={fieldLabelCls}>Information affichée aux invités</label>
              <Textarea value={q.notice ?? ''} rows={3} className="resize-none"
                onChange={e => set('notice', e.target.value)} placeholder={DEFAULT_NOTICE} />
              <p className="text-xs text-gray-400 mt-1">
                Variables : <code className="bg-gray-100 px-1 rounded">{'{controller_name}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{controller_contact}'}</code>. Réponses supprimées 1 mois après l'événement.
              </p>
            </div>
          </Card>

          <Card className="p-5 rounded-2xl shadow-sm">
            <CardTitle>Case de prospection</CardTitle>
            <div className={rowCls}>
              <div>
                <p className={labelCls}>Proposer la case « être recontacté »</p>
                <p className="text-xs text-gray-400">Toujours facultative et décochée sur la borne, jamais une condition de la photo</p>
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
            <div className="bg-red-50 text-red-700 rounded-xl px-4 py-3 text-sm">
              <p className="font-medium mb-1">À corriger avant d'enregistrer :</p>
              <ul className="list-disc pl-5 space-y-0.5">
                {errors.map((e, i) => <li key={i}>{e.message}</li>)}
              </ul>
            </div>
          )}
        </>
      )}
    </>
  );
}
