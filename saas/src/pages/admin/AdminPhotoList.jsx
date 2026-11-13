import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Images, ExternalLink, MoreHorizontal } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '../../components/ui/dropdown-menu';
import DataTable, { SortHeader } from '../../components/DataTable';
import { fetchEventsWithPhotoCount } from '../../lib/supabase';

const formatDate = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
const galleryUrl = (code) => `${window.location.origin}/photos/${code}`;

export default function AdminPhotoList() {
  const navigate = useNavigate();
  const [events,  setEvents]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    fetchEventsWithPhotoCount()
      .then(setEvents)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const columns = useMemo(() => [
    {
      accessorKey: 'name',
      header: ({ column }) => <SortHeader column={column}>Événement</SortHeader>,
      enableHiding: false,
      meta: { label: 'Événement' },
      cell: ({ row }) => {
        const ev = row.original;
        return (
          <div className="font-medium text-foreground">
            {ev.name || <span className="italic text-muted-foreground">Sans nom</span>}
            <div className="text-xs text-muted-foreground font-normal mt-0.5 md:hidden">
              {ev.client_name ?? '—'} · {formatDate(ev.created_at)}
            </div>
          </div>
        );
      },
    },
    {
      id: 'client',
      accessorFn: (ev) => `${ev.client_name ?? ''} ${ev.access_code ?? ''}`,
      header: 'Client',
      meta: { label: 'Client', headClass: 'hidden md:table-cell', cellClass: 'hidden md:table-cell' },
      cell: ({ row }) => {
        const ev = row.original;
        return (
          <div className="text-muted-foreground">
            <div>{ev.client_name ?? '—'}</div>
            <div className="text-xs text-muted-foreground/70">{formatDate(ev.created_at)}</div>
          </div>
        );
      },
    },
    {
      id: 'photos',
      accessorFn: (ev) => ev.photo_count ?? 0,
      header: ({ column }) => <SortHeader column={column}>Photos</SortHeader>,
      meta: { label: 'Photos' },
      cell: ({ row }) => (
        <Badge variant={row.original.photo_count > 0 ? 'default' : 'secondary'}>
          {row.original.photo_count} photo{row.original.photo_count !== 1 ? 's' : ''}
        </Badge>
      ),
    },
    {
      id: 'actions',
      header: '',
      enableHiding: false,
      enableSorting: false,
      meta: { headClass: 'w-10', cellClass: 'text-right' },
      cell: ({ row }) => {
        const ev = row.original;
        return (
          <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
            <Button variant="outline" size="sm" className="h-8" title="Ouvrir la galerie publique"
              onClick={() => window.open(galleryUrl(ev.access_code), '_blank', 'noopener')}>
              <Images className="w-4 h-4" />Galerie
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="w-4 h-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onSelect={() => navigate(ev.id)}>
                  <ExternalLink className="w-4 h-4" />Gérer les photos
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => window.open(galleryUrl(ev.access_code), '_blank', 'noopener')}>
                  <Images className="w-4 h-4" />Galerie publique
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ], [navigate]);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Galerie photos</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {loading ? 'Chargement…' : `${events.length} événement${events.length > 1 ? 's' : ''}`}
        </p>
      </div>

      {error ? (
        <div className="bg-destructive/10 text-destructive text-sm rounded-lg px-4 py-3">{error}</div>
      ) : (
        <DataTable
          columns={columns}
          data={events}
          loading={loading}
          searchPlaceholder="Rechercher par nom, client, code…"
          onRowClick={(ev) => navigate(ev.id)}
          emptyMessage="Aucun événement trouvé."
        />
      )}
    </div>
  );
}
