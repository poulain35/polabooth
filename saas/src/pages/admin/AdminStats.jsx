import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, Download, MessageSquareText, ListChecks, X, ChevronRight } from 'lucide-react';
import { getAllFormResponses, getGlobalFormConfig } from '../../lib/supabase';
import { latestResponsePerEvent } from '../../lib/formResponses';
import { downloadCsv, toCsv } from '../../lib/csv';
import { isStatQuestion, isChoiceType, normalizeAnswer, hasAnswer, canonicalizeAnswer } from '../../utils/formQuestions';
import { Card, CardTitle } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { Button } from '../../components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../../components/ui/select';
import { IconCircle } from '../../components/ui/icon-circle';
import { PageContainer, PageHeader } from '../../components/admin/AdminPage';
import { formatShortDate } from '../../lib/dates';
import { formatAnswer } from '../../lib/guestResponsesExport';
import { Notice } from '../../components/admin/CardParts';


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
    const txt = canonicalizeAnswer(formatAnswer(a, { separator: ', ' }).trim());
    raw.push(txt);
    const key = normalizeAnswer(txt);
    if (!counts.has(key)) counts.set(key, { name: txt, value: 0 });
    counts.get(key).value++;
  }
  const rows = [...counts.values()].sort((a, b) => b.value - a.value);
  return { answered: raw.length, rows };
}

function DistributionBars({ rows, answered, onSelect, activeValue }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">Aucune donnée.</p>;
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
            aria-pressed={clickable ? isActive : undefined}
            className={`-mx-2 w-full rounded-control px-2 py-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              isActive ? 'bg-primary-soft' : clickable ? 'hover:bg-muted' : ''
            } ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-sm text-foreground truncate">{r.name || <span className="italic text-muted-foreground">(vide)</span>}</span>
              <span className="text-xs text-muted-foreground shrink-0 tabular-nums">{r.value} · {pct}%</span>
            </div>
            <div className={`h-2 overflow-hidden rounded-full ${isActive ? 'bg-card' : 'bg-muted'}`}>
              <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
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
    <Card className="p-card">
      <div className="mb-4 flex items-start gap-3">
        <IconCircle size="sm" tone="lilac"><MessageSquareText /></IconCircle>
        <div className="min-w-0">
          <CardTitle as="h3">{q.label}</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">Texte libre · {answered} réponse{answered > 1 ? 's' : ''}</p>
        </div>
      </div>

      {answered === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">Aucune réponse pour le moment.</p>
      ) : hasDuplicates ? (
        <>
          <DistributionBars rows={visible} answered={answered} onSelect={onSelect} activeValue={activeValue} />
          {rows.length > 8 && (
            <button onClick={() => setExpanded((v) => !v)} className="mt-3 text-xs font-medium text-primary-ink hover:underline">
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
                aria-pressed={activeValue === r.name}
                className={`w-full rounded-r-sm border-l-2 py-0.5 pl-3 text-left text-sm text-foreground ${
                  activeValue === r.name ? 'border-primary bg-primary-soft' : 'border-border hover:bg-muted'
                }`}
              >
                {r.name}
              </button>
            </li>
          ))}
          {rows.length > 8 && (
            <button onClick={() => setExpanded((v) => !v)} className="mt-1 text-xs font-medium text-primary-ink hover:underline">
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
    <Card className="p-card">
      <div className="mb-4 flex items-start gap-3">
        <IconCircle size="sm" tone="sky"><ListChecks /></IconCircle>
        <div className="min-w-0">
          <CardTitle as="h3">{q.label}</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            {q.type === 'multi' ? 'Choix multiple' : 'Choix unique'} · {answered} réponse{answered > 1 ? 's' : ''}
          </p>
        </div>
      </div>
      {answered === 0
        ? <p className="text-sm text-muted-foreground text-center py-4">Aucune réponse pour le moment.</p>
        : <DistributionBars rows={rows} answered={answered} onSelect={onSelect} activeValue={activeValue} />}
    </Card>
  );
}

function KpiCard({ label, value, icon, tone }) {
  return (
    <Card className="flex items-center gap-4 p-card">
      <IconCircle tone={tone}>{icon}</IconCircle>
      <div className="min-w-0">
        <p className="text-figure text-foreground">{value}</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{label}</p>
      </div>
    </Card>
  );
}

function statsCsv(questions, responses) {
  return toCsv({
    header: ['Date', 'Événement', ...questions.map((q) => q.label)],
    rows: responses.map((r) => [
      new Date(r.submitted_at).toLocaleString('fr-FR'),
      r.events?.name ?? '',
      ...questions.map((q) => formatAnswer(canonicalizeAnswer(r.answers?.[q.id]), { separator: ', ' })),
    ]),
  });
}

// `embedded` : affichée dans l'onglet « Photos et livraison » de la fiche (LAB-337), limitée à
// l'événement `eventId`, sans marges ni choix de l'événement.
export default function AdminStats({ eventId, embedded = false } = {}) {
  const [questions, setQuestions] = useState(null);
  const [raw, setRaw]             = useState(null);
  const [error, setError]         = useState('');
  const [eventFilter, setEventFilter] = useState(eventId ?? 'all'); // eventId : Photos et livraison d'un événement
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
    downloadCsv(statsCsv(questions ?? [], filtered), `statistiques-questionnaire-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  const title = 'Statistiques du questionnaire';
  const description = 'Dernière réponse par événement. Clique une valeur pour filtrer les événements concernés.';
  const actions = (
    <>
      {!embedded && <Select value={eventFilter} onValueChange={setEventFilter}>
        <SelectTrigger className="w-auto min-w-[180px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Tous les événements</SelectItem>
          {events.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
        </SelectContent>
      </Select>}
      <Button variant="outline" onClick={handleExport} disabled={loading || filtered.length === 0}>
        <Download />Exporter CSV
      </Button>
    </>
  );
  const Wrapper = embedded ? 'div' : PageContainer;

  return (
    <Wrapper className={embedded ? 'flex flex-col gap-5' : undefined}>

      {/* En-tête */}
      {embedded ? (
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <CardTitle as="h2">{title}</CardTitle>
            <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        </div>
      ) : <PageHeader title={title} description={description} actions={actions} />}

      {/* Filtre actif */}
      {crossFilter && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Filtre :</span>
          <button
            onClick={() => setCrossFilter(null)}
            title="Retirer le filtre"
            className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1 text-left text-[13px] font-medium text-primary-ink transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="font-normal">{crossQuestion?.label ?? crossFilter.qId} :</span>
            {crossFilter.value}
            <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          </button>
        </div>
      )}

      {error && (
        <Notice tone="red">{error}</Notice>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-48 rounded-card" />)}
        </div>
      ) : (questions ?? []).length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-muted-foreground">Aucune question configurée. Ajoutez des questions dans <a href="/admin/reglages#editeur" className="font-medium text-primary-ink hover:underline">Réglages → Formulaire pré-édition</a>.</p>
        </Card>
      ) : (
        <>
          {/* Chiffres */}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <KpiCard tone="sky" label={crossFilter ? 'Événements correspondants' : 'Événements'} value={filtered.length} icon={<BarChart3 />} />
            <KpiCard tone="lilac" label="Événements au total" value={events.length} icon={<ListChecks />} />
            <KpiCard tone="mint" label="Questions analysées" value={statQuestions.length} icon={<MessageSquareText />} />
          </div>

          {filtered.length === 0 ? (
            <Card className="p-10 text-center">
              <p className="text-sm text-muted-foreground">Aucune réponse pour ce filtre.</p>
            </Card>
          ) : statQuestions.length === 0 ? (
            <Card className="p-10 text-center">
              <p className="text-sm text-muted-foreground">Aucune question analysable. Les champs de contact (téléphone, email) sont exclus des statistiques.</p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              {statQuestions.map((q) => (
                isChoiceType(q.type)
                  ? <ChoiceQuestionCard key={q.id} q={q} responses={filtered} onSelect={(v) => onSelectValue(q.id, v)} activeValue={crossFilter?.qId === q.id ? crossFilter.value : null} />
                  : <TextQuestionCard key={q.id} q={q} responses={filtered} onSelect={(v) => onSelectValue(q.id, v)} activeValue={crossFilter?.qId === q.id ? crossFilter.value : null} />
              ))}
            </div>
          )}

          {/* Liste des événements filtrés */}
          {crossFilter && filtered.length > 0 && (
            <Card className="p-card">
              <CardTitle as="h3" className="mb-3">Événements correspondants ({filtered.length})</CardTitle>
              <ul className="divide-y divide-border">
                {filtered.map((r) => (
                  <li key={r.event_id}>
                    <Link
                      to={`/admin/events/${r.event_id}`}
                      className="group flex items-center justify-between gap-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground transition-colors group-hover:text-primary-ink">
                          {r.events?.name || <span className="italic text-muted-foreground">Sans nom</span>}
                        </p>
                        {formatShortDate(r.submitted_at) && <p className="text-xs text-muted-foreground">Répondu le {formatShortDate(r.submitted_at)}</p>}
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary-ink" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </Wrapper>
  );
}
