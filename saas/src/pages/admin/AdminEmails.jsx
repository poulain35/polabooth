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
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../../components/ui/table';

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
    <div className="p-4 sm:p-6 lg:p-8">
      {/* En-tête */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Emails</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {loading && result.key === null
            ? 'Chargement…'
            : `${count} email${count > 1 ? 's' : ''}${hasFilters ? ' correspondant aux filtres' : ' envoyés'}`}
        </p>
      </div>

      {/* Filtres */}
      <Card className="p-4 mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr),repeat(4,minmax(0,1fr))]">
          <div className="space-y-1.5">
            <Label htmlFor="email-search">Recherche</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                id="email-search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={INSTALLED_MODULES.has('booking') ? 'Destinataire ou n° POLA-XXXX' : 'Destinataire'}
                className="pl-8"
              />
            </div>
          </div>

          <div className="space-y-1.5">
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

          <div className="space-y-1.5">
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

          <div className="space-y-1.5">
            <Label htmlFor="email-from">Du</Label>
            <Input id="email-from" type="date" value={from} max={to || undefined}
              onChange={(e) => changeFilter(setFrom)(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email-to">Au</Label>
            <Input id="email-to" type="date" value={to} min={from || undefined}
              onChange={(e) => changeFilter(setTo)(e.target.value)} />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Checkbox id="email-problems" checked={problemsOnly}
              onCheckedChange={(checked) => changeFilter(setProblemsOnly)(checked === true)} />
            <Label htmlFor="email-problems" className="cursor-pointer flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
              Problèmes seulement
            </Label>
          </div>
          {hasFilters && (
            <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
              <X className="w-4 h-4" />Effacer les filtres
            </Button>
          )}
        </div>
      </Card>

      {/* Liste */}
      <Card className="overflow-hidden">
        {error ? (
          <div className="p-8 text-center">
            <p className="text-sm text-red-700">Impossible de charger les emails : {error}</p>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setReloadTick((t) => t + 1)}>
              Réessayer
            </Button>
          </div>
        ) : rows.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center text-center py-12 px-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
              <Mail className="w-6 h-6 text-primary" />
            </div>
            <p className="text-foreground font-medium">
              {hasFilters ? 'Aucun email ne correspond à ces filtres' : 'Aucun email envoyé pour l\'instant'}
            </p>
            <p className="text-muted-foreground text-sm mt-1 max-w-sm">
              {hasFilters
                ? 'Élargissez la période ou retirez un filtre.'
                : 'Les emails envoyés aux clients (devis, codes d\'accès, factures…) apparaîtront ici.'}
            </p>
          </div>
        ) : (
          <div className={`relative ${loading ? 'opacity-60' : ''}`}>
            {loading && rows.length === 0 && (
              <div className="flex justify-center py-12">
                <div className="w-6 h-6 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {rows.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="whitespace-nowrap">Date d'envoi</TableHead>
                    <TableHead>Destinataire</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Objet</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead className="whitespace-nowrap">Dernière activité</TableHead>
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
                        className={`cursor-pointer focus-visible:outline-none focus-visible:bg-muted/60 ${
                          problem ? 'bg-red-50/70 hover:bg-red-50' : ''}`}
                      >
                        <TableCell className="py-3 whitespace-nowrap text-xs text-muted-foreground">
                          {formatEmailDate(log.sent_at)}
                        </TableCell>
                        <TableCell className="py-3 max-w-[220px] truncate" title={log.recipient}>{log.recipient}</TableCell>
                        <TableCell className="py-3 whitespace-nowrap">{emailTypeLabel(log.type)}</TableCell>
                        <TableCell className="py-3 max-w-[260px] truncate text-muted-foreground" title={log.subject ?? undefined}>
                          {log.subject || '—'}
                        </TableCell>
                        <TableCell className="py-3"><EmailStatusBadge status={log.status} /></TableCell>
                        <TableCell className="py-3 whitespace-nowrap text-xs">
                          <span className={problem ? 'text-red-700 font-medium' : 'text-foreground'}>{activity.label}</span>
                          <span className="block text-muted-foreground">{formatEmailDate(activity.at, false)}</span>
                        </TableCell>
                        <TableCell className="py-3 max-w-[200px]">
                          {context ? (
                            <Link
                              to={context.to}
                              onClick={(e) => e.stopPropagation()}
                              className="block truncate text-violet-700 hover:underline"
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
          <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-sm">
            <p className="text-muted-foreground">
              {firstIndex}–{lastIndex} sur {count}
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={page === 0 || loading}
                onClick={() => setPage((p) => Math.max(0, p - 1))}>
                <ChevronLeft className="w-4 h-4" />Précédent
              </Button>
              <span className="text-muted-foreground text-xs">Page {page + 1} / {pageCount}</span>
              <Button type="button" variant="outline" size="sm" disabled={page + 1 >= pageCount || loading}
                onClick={() => setPage((p) => p + 1)}>
                Suivant<ChevronRight className="w-4 h-4" />
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
