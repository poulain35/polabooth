import { X, Plus, ChevronUp, ChevronDown } from 'lucide-react';
import { Input } from './ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from './ui/select';
import { QUESTION_TYPES, isChoiceType, isContactType, newQuestionId } from '../utils/formQuestions';

// Éditeur de liste de questions ({id, label, type, required, options}), contrôlé.
// Utilisé par le formulaire pré-édition (AdminSettings) et le questionnaire de la borne.
export default function QuestionListEditor({
  questions,
  onChange,
  types = QUESTION_TYPES,
  showAnalytics = true,
  maxQuestions = Infinity,
  maxOptions = Infinity,
  maxLength,
}) {
  function update(id, fn) {
    onChange(questions.map((q) => (q.id === id ? fn(q) : q)));
  }
  function addQuestion() {
    onChange([...questions, { id: newQuestionId(), label: '', type: 'text', required: false }]);
  }
  function removeQuestion(id) {
    onChange(questions.filter((q) => q.id !== id));
  }
  function move(idx, delta) {
    const target = idx + delta;
    if (target < 0 || target >= questions.length) return;
    const next = [...questions];
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  }
  function updateQuestion(id, field, value) {
    update(id, (q) => {
      const next = { ...q, [field]: value };
      // Passage vers un type à choix : initialiser deux options vides.
      if (field === 'type' && isChoiceType(value) && !next.options?.length) {
        next.options = ['', ''];
      }
      return next;
    });
  }
  function addOption(id) {
    update(id, (q) => ({ ...q, options: [...(q.options ?? []), ''] }));
  }
  function updateOption(id, idx, value) {
    update(id, (q) => ({ ...q, options: (q.options ?? []).map((o, i) => (i === idx ? value : o)) }));
  }
  function removeOption(id, idx) {
    update(id, (q) => ({ ...q, options: (q.options ?? []).filter((_, i) => i !== idx) }));
  }

  const arrowCls = 'p-0.5 text-muted-foreground/60 hover:text-muted-foreground disabled:opacity-30 disabled:hover:text-muted-foreground/60 transition-colors';

  return (
    <>
      <div className="space-y-2 mb-4">
        {questions.map((q, idx) => (
          <div key={q.id} className="flex items-start gap-2 bg-soft rounded-control p-3">
            <div className="flex flex-col items-center shrink-0 w-5 pt-0.5">
              <button type="button" onClick={() => move(idx, -1)} disabled={idx === 0}
                aria-label="Monter la question" title="Monter" className={arrowCls}>
                <ChevronUp className="w-4 h-4" />
              </button>
              <span className="text-muted-foreground text-sm font-medium leading-none">{idx + 1}</span>
              <button type="button" onClick={() => move(idx, 1)} disabled={idx === questions.length - 1}
                aria-label="Descendre la question" title="Descendre" className={arrowCls}>
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 min-w-0 space-y-1.5">
              <Input
                type="text"
                value={q.label}
                onChange={(e) => updateQuestion(q.id, 'label', e.target.value)}
                placeholder="Libellé de la question…"
                maxLength={maxLength}
                className="h-9"
              />
              <div className="flex items-center gap-3 flex-wrap">
                <Select value={q.type} onValueChange={(v) => updateQuestion(q.id, 'type', v)}>
                  <SelectTrigger className="h-8 w-auto text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {types.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!q.required}
                    onChange={(e) => updateQuestion(q.id, 'required', e.target.checked)}
                    className="rounded accent-primary"
                  />
                  Obligatoire
                </label>
                {showAnalytics && (isContactType(q.type) ? (
                  <span className="text-xs text-muted-foreground/60">Exclu des statistiques</span>
                ) : (
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={q.analytics !== false}
                      onChange={(e) => updateQuestion(q.id, 'analytics', e.target.checked)}
                      className="rounded accent-primary"
                    />
                    Inclure dans les stats
                  </label>
                ))}
              </div>

              {isChoiceType(q.type) && (
                <div className="pl-1 pt-1 space-y-1.5">
                  {(q.options ?? []).map((opt, optIdx) => (
                    <div key={optIdx} className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30 shrink-0" />
                      <Input
                        type="text"
                        value={opt}
                        onChange={(e) => updateOption(q.id, optIdx, e.target.value)}
                        placeholder={`Option ${optIdx + 1}`}
                        maxLength={maxLength}
                        className="h-8 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => removeOption(q.id, optIdx)}
                        aria-label="Supprimer l'option"
                        className="p-1 text-muted-foreground/60 hover:text-destructive transition-colors shrink-0"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  {(q.options ?? []).length < maxOptions && (
                    <button
                      type="button"
                      onClick={() => addOption(q.id)}
                      className="flex items-center gap-1 text-xs text-primary hover:text-primary font-medium ml-3.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Ajouter une option
                    </button>
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => removeQuestion(q.id)}
              aria-label="Supprimer la question"
              className="p-1.5 text-muted-foreground/60 hover:text-destructive transition-colors mt-1 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      {questions.length < maxQuestions ? (
        <button
          type="button"
          onClick={addQuestion}
          className="flex items-center gap-1.5 text-sm text-primary hover:text-primary font-medium mb-4"
        >
          <Plus className="w-4 h-4" />
          Ajouter une question
        </button>
      ) : (
        <p className="text-xs text-muted-foreground mb-4">{maxQuestions} questions maximum.</p>
      )}
    </>
  );
}
