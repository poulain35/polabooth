import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ChevronLeft, ChevronRight, Mail, Search, X } from 'lucide-react';
import { fetchEmailLogs } from '../../lib/supabase';
import {
  EMAIL_PAGE_SIZE, EMAIL_STATUS, EMAIL_STATUS_KEYS, EMAIL_TYPE_FILTERS,
  emailContextLink, emailTypeLabel, formatEmailDate, isProblemStatus, lastActivity,
} from '../../lib/emailTracking';
import { INSTALLED_MODULES } from '../../features/modules';
import EmailStatusBadge from '../../components/EmailStatusBadge';
import EmailDetailDialog from '../../components/EmailDetailDialog';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Checkbox } from '../../components/ui/checkbox';
import { IconCircle } from '../../components/ui/icon-circle';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../../components/ui/table';
import { cn } from '../../lib/utils';
import { Spinner } from '../../components/ui/spinner';
import { Notice } from '../../components/admin/CardParts';

const SEARCH_DELAY_MS = 300;

/**
 * Page « Emails » (LAB-124) : tous les emails envoyés, filtrés et paginés côté serveur.
 * Lecture sous RLS (client Supabase de la session) ; aucun filtre d'organisation côté client.
 * Paramètres d'URL acceptés à l'ouverture : `q` (recherche), `status`, `problemes=1`.
 */
export default function AdminEmails() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState(() => searchParams.get('status') || 'all');
  const [type, setType] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [searchInput, setSearchInput] = useState(() => searchParams.get('q') || '');
  const [search, setSearch] = useState(() => (searchParams.get('q') || '').trim());
  const [problemsOnly, setProblemsOnly] = useState(() => searchParams.get('problemes') === '1');
  const [page, setPage] = useState(0);
  const [reloadTick, setReloadTick] = useState(0);
  const [result, setResult] = useState({ key: null, rows: [], count: 0, error: '' });
  const [selected, setSelected] = useState(null);

  const filters = { status, type, from, to, search, problemsOnly, page };
  const queryKey = JSON.stringify({ ...filters, reloadTick });
  const loading = result.key !== queryKey;

  // Recherche différée : on attend la fin de la frappe avant d'interroger la base.
  useEffect(() => {
    const term = searchInput.trim();
    if (term === search) return undefined;
    const timer = setTimeout(() => { setSearch(term); setPage(0); }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchInput, search]);

  useEffect(() => {
    let cancelled = false;
    const current = JSON.parse(queryKey);
    fetchEmailLogs(current)
      .then(({ rows, count }) => { if (!cancelled) setResult({ key: queryKey, rows, count, error: '' }); })
      .catch((e) => { if (!cancelled) setResult({ key: queryKey, rows: [], count: 0, error: e.message || 'Chargement impossible.' }); });
    return () => { cancelled = true; };
  }, [queryKey]);

  // Tout changement de filtre ramène à la première page.
  const changeFilter = (setter) => (value) => { setter(value); setPage(0); };

  const hasFilters = status !== 'all' || type !== 'all' || from || to || search || problemsOnly;
  function resetFilters() {
    setStatus('all'); setType('all'); setFrom(''); setTo('');
    setSearchInput(''); setSearch(''); setProblemsOnly(false); setPage(0);
  }

  function updateRow(row) {
    setResult((prev) => ({ ...prev, rows: prev.rows.map((r) => (r.id === row.id ? row : r)) }));
  }

  const { rows, count, error } = result;
  const firstIndex = count === 0 ? 0 : page * EMAIL_PAGE_SIZE + 1;
  const lastIndex = Math.min(count, (page + 1) * EMAIL_PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(count / EMAIL_PAGE_SIZE));

  return (
    // Section Emails envoyés de la page Réglages (/admin/reglages#emails, LAB-335).
    <div>
      {/* En-tête */}
      <p className="mb-4 text-[13px] text-muted-foreground">
        {loading && result.key === null
          ? 'Chargement…'
          : `${count} email${count > 1 ? 's' : ''}${hasFilters ? ' correspondant aux filtres' : ' envoyés'}`}
      </p>

      {/* Filtres */}
      <Card className="mb-5 p-card">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2 xl:col-span-4">
            <Label htmlFor="email-search">Recherche</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                id="email-search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={INSTALLED_MODULES.has('booking') ? 'Destinataire ou n° de réservation' : 'Destinataire'}
                className="pl-9"
              />
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <Label>Statut</Label>
            <Select value={status} onValueChange={changeFilter(setStatus)}>
              <SelectTrigger aria-label="Statut"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les statuts</SelectItem>
                {EMAIL_STATUS_KEYS.map((key) => (
                  <SelectItem key={key} value={key}>{EMAIL_STATUS[key].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={changeFilter(setType)}>
              <SelectTrigger aria-label="Type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les types</SelectItem>
                {EMAIL_TYPE_FILTERS.map((option) => (
                  <SelectItem key={option.key} value={option.key}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="email-from">Du</Label>
            <Input id="email-from" type="date" value={from} max={to || undefined}
              onChange={(e) => changeFilter(setFrom)(e.target.value)} />
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="email-to">Au</Label>
            <Input id="email-to" type="date" value={to} min={from || undefined}
              onChange={(e) => changeFilter(setTo)(e.target.value)} />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Checkbox id="email-problems" checked={problemsOnly}
              onCheckedChange={(checked) => changeFilter(setProblemsOnly)(checked === true)} />
            <Label htmlFor="email-problems" className="flex cursor-pointer items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-state-red-fg" aria-hidden="true" />
              Problèmes seulement
            </Label>
          </div>
          {hasFilters && (
            <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
              <X />Effacer les filtres
            </Button>
          )}
        </div>
      </Card>

      {/* Liste : les filets du tableau sont portés par les cellules, la carte ne garde qu'une marge fine. */}
      <Card className="p-2">
        {error ? (
          <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
            <Notice tone="red" role="alert">Impossible de charger les emails : {error}</Notice>
            <Button type="button" variant="outline" size="sm" onClick={() => setReloadTick((t) => t + 1)}>
              Réessayer
            </Button>
          </div>
        ) : rows.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
            <IconCircle tone="sand" className="mb-3"><Mail /></IconCircle>
            <p className="font-medium text-foreground">
              {hasFilters ? 'Aucun email ne correspond à ces filtres' : 'Aucun email envoyé pour l\'instant'}
            </p>
            <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
              {hasFilters
                ? 'Élargissez la période ou retirez un filtre.'
                : 'Les emails envoyés aux clients (devis, codes d\'accès, factures…) apparaîtront ici.'}
            </p>
          </div>
        ) : (
          <div className={cn('relative', loading && 'opacity-60')}>
            {loading && rows.length === 0 && (
              <div className="flex justify-center py-12">
                <Spinner />
              </div>
            )}
            {rows.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Type et date d'envoi</TableHead>
                    <TableHead>Destinataire et objet</TableHead>
                    <TableHead>Statut</TableHead>
                    {/* Masquée sous 1400 px : la colonne des Réglages est étroite, le détail la redonne. */}
                    <TableHead className="hidden min-[1400px]:table-cell">Dernière activité</TableHead>
                    <TableHead>Fiche</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((log) => {
                    const problem = isProblemStatus(log.status);
                    const activity = lastActivity(log);
                    const context = emailContextLink(log, INSTALLED_MODULES);
                    return (
                      <TableRow
                        key={log.id}
                        tabIndex={0}
                        onClick={() => setSelected(log)}
                        onKeyDown={(e) => { if (e.key === 'Enter') setSelected(log); }}
                        className="cursor-pointer focus-visible:bg-muted focus-visible:outline-none"
                      >
                        <TableCell className="whitespace-nowrap">
                          <span className="block text-foreground">{emailTypeLabel(log.type)}</span>
                          <span className="block text-xs text-muted-foreground">{formatEmailDate(log.sent_at)}</span>
                        </TableCell>
                        {/* Colonne souple : prend la place restante et tronque, sans élargir le tableau. */}
                        <TableCell className="w-full min-w-[180px] max-w-0">
                          <span className="block truncate" title={log.recipient}>{log.recipient}</span>
                          <span className="block truncate text-xs text-muted-foreground" title={log.subject ?? undefined}>
                            {log.subject || '—'}
                          </span>
                        </TableCell>
                        <TableCell><EmailStatusBadge status={log.status} /></TableCell>
                        <TableCell className="hidden whitespace-nowrap text-xs min-[1400px]:table-cell">
                          <span className={problem ? 'font-medium text-state-red-fg' : 'text-foreground'}>{activity.label}</span>
                          <span className="block text-muted-foreground">{formatEmailDate(activity.at, false)}</span>
                        </TableCell>
                        <TableCell className="max-w-[140px]">
                          {context ? (
                            <Link
                              to={context.to}
                              onClick={(e) => e.stopPropagation()}
                              className="block truncate font-medium text-primary-ink hover:underline"
                              title={context.label}
                            >
                              {context.label}
                            </Link>
                          ) : '—'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        )}

        {/* Pagination */}
        {!error && count > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 pb-2 pt-3 text-[13px]">
            <p className="text-muted-foreground">
              {firstIndex}–{lastIndex} sur {count}
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={page === 0 || loading}
                onClick={() => setPage((p) => Math.max(0, p - 1))}>
                <ChevronLeft />Précédent
              </Button>
              <span className="text-xs text-muted-foreground">Page {page + 1} / {pageCount}</span>
              <Button type="button" variant="outline" size="sm" disabled={page + 1 >= pageCount || loading}
                onClick={() => setPage((p) => p + 1)}>
                Suivant<ChevronRight />
              </Button>
            </div>
          </div>
        )}
      </Card>

      <EmailDetailDialog
        emailLogId={selected?.id ?? null}
        initialLog={selected}
        open={Boolean(selected)}
        onOpenChange={(open) => { if (!open) setSelected(null); }}
        onUpdated={updateRow}
      />
    </div>
  );
}
