import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, Download, MessageSquareText, ListChecks, X, ChevronRight } from 'lucide-react';
import { getAllFormResponses, getGlobalFormConfig } from '../../lib/supabase';
import { latestResponsePerEvent } from '../../lib/formResponses';
import { isStatQuestion, isChoiceType, normalizeAnswer, hasAnswer, canonicalizeAnswer } from '../../utils/formQuestions';
import { Card } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { Button } from '../../components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../../components/ui/select';

const PALETTE = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#0ea5e9', '#f43f5e', '#14b8a6', '#a855f7', '#84cc16'];

function fmtAnswer(value) {
  return Array.isArray(value) ? value.join(', ') : String(value ?? '');
}

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
}

// Une réponse correspond-elle à la valeur cliquée ? Comparaison normalisée
// (casse + espaces) pour rester cohérente avec le regroupement de l'agrégation.
function answerMatches(answer, value) {
  const c = canonicalizeAnswer(answer);
  const target = normalizeAnswer(value);
  return Array.isArray(c) ? c.some((x) => normalizeAnswer(x) === target) : normalizeAnswer(c) === target;
}

// Répartition pour une question à choix (select / multi), variantes regroupées.
function aggregateChoice(q, responses) {
  const counts = new Map();
  (q.options ?? []).forEach((o) => counts.set(o, 0));
  let answered = 0;
  for (const r of responses) {
    const a = r.answers?.[q.id];
    if (!hasAnswer(a)) continue;
    answered++;
    const vals = canonicalizeAnswer(Array.isArray(a) ? a : [a]);
    for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const rows = [...counts.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
  return { answered, rows };
}

// Regroupement des réponses texte identiques (normalisées + variantes canoniques).
function aggregateText(q, responses) {
  const counts = new Map();
  const raw = [];
  for (const r of responses) {
    const a = r.answers?.[q.id];
    if (!hasAnswer(a)) continue;
    const txt = canonicalizeAnswer(fmtAnswer(a).trim());
    raw.push(txt);
    const key = normalizeAnswer(txt);
    if (!counts.has(key)) counts.set(key, { name: txt, value: 0 });
    counts.get(key).value++;
  }
  const rows = [...counts.values()].sort((a, b) => b.value - a.value);
  return { answered: raw.length, rows };
}

function DistributionBars({ rows, answered, onSelect, activeValue }) {
  if (!rows.length) return <p className="text-sm text-gray-400">Aucune donnée.</p>;
  return (
    <div className="space-y-2.5">
      {rows.map((r, i) => {
        const pct = answered ? Math.round((r.value / answered) * 100) : 0;
        const isActive = activeValue === r.name;
        const clickable = onSelect && r.value > 0;
        return (
          <button
            key={r.name || `row-${i}`}
            type="button"
            disabled={!clickable}
            onClick={() => clickable && onSelect(r.name)}
            className={`w-full text-left rounded-lg px-2 py-1 -mx-2 transition-colors ${
              clickable ? 'cursor-pointer hover:bg-gray-50' : 'cursor-default'
            } ${isActive ? 'bg-primary/5 ring-1 ring-primary/30' : ''}`}
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-sm text-gray-700 truncate">{r.name || <span className="italic text-gray-400">(vide)</span>}</span>
              <span className="text-xs text-gray-400 shrink-0 tabular-nums">{r.value} · {pct}%</span>
            </div>
            <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: PALETTE[i % PALETTE.length] }} />
            </div>
          </button>
        );
      })}
    </div>
  );
}

function TextQuestionCard({ q, responses, onSelect, activeValue }) {
  const { answered, rows } = useMemo(() => aggregateText(q, responses), [q, responses]);
  const [expanded, setExpanded] = useState(false);
  const hasDuplicates = rows.some((r) => r.value > 1);
  const visible = expanded ? rows : rows.slice(0, 8);

  return (
    <Card className="rounded-2xl p-5 shadow-sm">
      <div className="flex items-start gap-2.5 mb-4">
        <div className="w-8 h-8 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
          <MessageSquareText className="w-[18px] h-[18px]" />
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-800 leading-snug">{q.label}</h3>
          <p className="text-xs text-gray-400 mt-0.5">Texte libre · {answered} réponse{answered > 1 ? 's' : ''}</p>
        </div>
      </div>

      {answered === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">Aucune réponse pour le moment.</p>
      ) : hasDuplicates ? (
        <>
          <DistributionBars rows={visible} answered={answered} onSelect={onSelect} activeValue={activeValue} />
          {rows.length > 8 && (
            <button onClick={() => setExpanded((v) => !v)} className="text-xs text-primary font-medium mt-3">
              {expanded ? 'Réduire' : `Voir les ${rows.length} réponses`}
            </button>
          )}
        </>
      ) : (
        <ul className="space-y-1 max-h-60 overflow-y-auto">
          {visible.map((r, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => onSelect?.(r.name)}
                className={`w-full text-left text-sm text-gray-700 border-l-2 pl-3 py-0.5 rounded-r hover:bg-gray-50 ${
                  activeValue === r.name ? 'border-primary bg-primary/5' : 'border-gray-100'
                }`}
              >
                {r.name}
              </button>
            </li>
          ))}
          {rows.length > 8 && (
            <button onClick={() => setExpanded((v) => !v)} className="text-xs text-primary font-medium mt-1">
              {expanded ? 'Réduire' : `Voir les ${rows.length} réponses`}
            </button>
          )}
        </ul>
      )}
    </Card>
  );
}

function ChoiceQuestionCard({ q, responses, onSelect, activeValue }) {
  const { answered, rows } = useMemo(() => aggregateChoice(q, responses), [q, responses]);
  return (
    <Card className="rounded-2xl p-5 shadow-sm">
      <div className="flex items-start gap-2.5 mb-4">
        <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
          <ListChecks className="w-[18px] h-[18px]" />
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-800 leading-snug">{q.label}</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {q.type === 'multi' ? 'Choix multiple' : 'Choix unique'} · {answered} réponse{answered > 1 ? 's' : ''}
          </p>
        </div>
      </div>
      {answered === 0
        ? <p className="text-sm text-gray-400 text-center py-4">Aucune réponse pour le moment.</p>
        : <DistributionBars rows={rows} answered={answered} onSelect={onSelect} activeValue={activeValue} />}
    </Card>
  );
}

function KpiCard({ label, value, icon }) {
  return (
    <Card className="rounded-2xl p-5 flex items-center gap-4">
      <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900 leading-tight">{value}</p>
        <p className="text-xs text-gray-400">{label}</p>
      </div>
    </Card>
  );
}

function toCsv(questions, responses) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['Date', 'Événement', ...questions.map((q) => q.label)];
  const lines = responses.map((r) => [
    new Date(r.submitted_at).toLocaleString('fr-FR'),
    r.events?.name ?? '',
    ...questions.map((q) => fmtAnswer(canonicalizeAnswer(r.answers?.[q.id]))),
  ].map(esc).join(','));
  return [header.map(esc).join(','), ...lines].join('\r\n');
}

export default function AdminStats() {
  const [questions, setQuestions] = useState(null);
  const [raw, setRaw]             = useState(null);
  const [error, setError]         = useState('');
  const [eventFilter, setEventFilter] = useState('all');
  const [crossFilter, setCrossFilter] = useState(null); // { qId, value } | null

  useEffect(() => {
    Promise.all([getGlobalFormConfig(), getAllFormResponses()])
      .then(([cfg, resp]) => {
        setQuestions(cfg?.questions ?? []);
        setRaw(resp);
      })
      .catch((e) => { setError(e.message); setQuestions([]); setRaw([]); });
  }, []);

  const loading = questions === null || raw === null;

  // Une seule réponse client par événement : la plus récente, consentements de la borne exclus.
  const latest = useMemo(() => latestResponsePerEvent(raw), [raw]);

  const events = useMemo(() => {
    const map = new Map();
    for (const r of latest) {
      if (!map.has(r.event_id)) map.set(r.event_id, r.events?.name || 'Événement sans nom');
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [latest]);

  const filtered = useMemo(() => {
    let rows = eventFilter === 'all' ? latest : latest.filter((r) => r.event_id === eventFilter);
    if (crossFilter) rows = rows.filter((r) => answerMatches(r.answers?.[crossFilter.qId], crossFilter.value));
    return rows;
  }, [latest, eventFilter, crossFilter]);

  const statQuestions = (questions ?? []).filter(isStatQuestion);
  const crossQuestion = crossFilter ? (questions ?? []).find((q) => q.id === crossFilter.qId) : null;

  function onSelectValue(qId, value) {
    setCrossFilter((cur) => (cur && cur.qId === qId && cur.value === value) ? null : { qId, value });
  }

  function handleExport() {
    const csv = toCsv(questions ?? [], filtered);
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `statistiques-questionnaire-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-full bg-background p-4 sm:p-6 lg:p-8">

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Statistiques du questionnaire</h1>
          <p className="text-sm text-gray-400 mt-1">
            Dernière réponse par événement. Clique une valeur pour filtrer les événements concernés.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={eventFilter} onValueChange={setEventFilter}>
            <SelectTrigger className="h-9 w-auto min-w-[180px] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les événements</SelectItem>
              {events.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={handleExport} disabled={loading || filtered.length === 0} className="h-9">
            <Download className="w-4 h-4" />Exporter CSV
          </Button>
        </div>
      </div>

      {/* Filtre actif */}
      {crossFilter && (
        <div className="flex items-center gap-2 mb-6">
          <span className="text-xs text-gray-400">Filtre :</span>
          <button
            onClick={() => setCrossFilter(null)}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium hover:bg-primary/15 transition-colors"
          >
            <span className="text-gray-500 font-normal">{crossQuestion?.label ?? crossFilter.qId} :</span>
            {crossFilter.value}
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {error && (
        <div className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-2xl text-sm text-destructive">{error}</div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-48 rounded-2xl" />)}
        </div>
      ) : (questions ?? []).length === 0 ? (
        <Card className="rounded-2xl p-10 text-center">
          <p className="text-sm text-gray-500">Aucune question configurée. Ajoutez des questions dans <span className="font-medium">Paramètres → Formulaire pré-édition</span>.</p>
        </Card>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <KpiCard label={crossFilter ? 'Événements correspondants' : 'Événements'} value={filtered.length} icon={<BarChart3 className="w-5 h-5" />} />
            <KpiCard label="Événements au total" value={events.length} icon={<ListChecks className="w-5 h-5" />} />
            <KpiCard label="Questions analysées" value={statQuestions.length} icon={<MessageSquareText className="w-5 h-5" />} />
          </div>

          {filtered.length === 0 ? (
            <Card className="rounded-2xl p-10 text-center">
              <p className="text-sm text-gray-500">Aucune réponse pour ce filtre.</p>
            </Card>
          ) : statQuestions.length === 0 ? (
            <Card className="rounded-2xl p-10 text-center">
              <p className="text-sm text-gray-500">Aucune question analysable. Les champs de contact (téléphone, email) sont exclus des statistiques.</p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {statQuestions.map((q) => (
                isChoiceType(q.type)
                  ? <ChoiceQuestionCard key={q.id} q={q} responses={filtered} onSelect={(v) => onSelectValue(q.id, v)} activeValue={crossFilter?.qId === q.id ? crossFilter.value : null} />
                  : <TextQuestionCard key={q.id} q={q} responses={filtered} onSelect={(v) => onSelectValue(q.id, v)} activeValue={crossFilter?.qId === q.id ? crossFilter.value : null} />
              ))}
            </div>
          )}

          {/* Liste des événements filtrés */}
          {crossFilter && filtered.length > 0 && (
            <Card className="rounded-2xl p-5 shadow-sm mt-6">
              <h3 className="font-semibold text-gray-800 mb-3">Événements correspondants ({filtered.length})</h3>
              <ul className="divide-y divide-gray-100">
                {filtered.map((r) => (
                  <li key={r.event_id}>
                    <Link
                      to={`/admin/events/${r.event_id}`}
                      className="flex items-center justify-between gap-3 py-2.5 group"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate group-hover:text-primary transition-colors">
                          {r.events?.name || <span className="italic text-gray-400">Sans nom</span>}
                        </p>
                        {fmtDate(r.submitted_at) && <p className="text-xs text-gray-400">Répondu le {fmtDate(r.submitted_at)}</p>}
                      </div>
                      <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-primary shrink-0 transition-colors" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
