import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Loader2 } from 'lucide-react';
import { searchEvents } from '../lib/supabase';
import { Input } from './ui/input';

const STATUS_LABELS = { upcoming: 'À venir', ongoing: 'En cours', finished: 'Terminé', archived: 'Archivé' };

function fmtDate(d) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function EventSearch({ onNavigate }) {
  const navigate = useNavigate();
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive]   = useState(-1);
  const boxRef = useRef(null);

  // Debounce de la recherche (setState uniquement dans le callback asynchrone).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setLoading(true);
      searchEvents(q)
        .then((rows) => { if (!cancelled) { setResults(rows); setActive(-1); } })
        .catch(() => { if (!cancelled) setResults([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  // Fermeture au clic extérieur.
  useEffect(() => {
    function onDown(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  function goTo(ev) {
    setOpen(false);
    setQuery('');
    setResults([]);
    onNavigate?.();
    navigate(`/admin/events/${ev.id}`);
  }

  function onKeyDown(e) {
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, -1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0 && results[active]) goTo(results[active]);
      else if (query.trim()) { setOpen(false); onNavigate?.(); navigate(`/admin/events?q=${encodeURIComponent(query.trim())}`); }
    } else if (e.key === 'Escape') { setOpen(false); }
  }

  const showDropdown = open && query.trim().length >= 2;

  return (
    <div ref={boxRef} className="relative w-full max-w-sm">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
      <Input
        name="q"
        type="text"
        autoComplete="off"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Rechercher un événement…"
        className="pl-9 h-9 bg-muted/40 border-transparent focus-visible:bg-background"
      />
      {loading && query.trim().length >= 2 && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground animate-spin" />}

      {showDropdown && (
        <div className="absolute z-50 mt-1.5 w-full rounded-xl border border-border bg-popover shadow-lg overflow-hidden">
          {results.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground text-center">
              {loading ? 'Recherche…' : 'Aucun événement trouvé'}
            </p>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {results.map((ev, i) => (
                <li key={ev.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => goTo(ev)}
                    className={`w-full text-left px-3 py-2 flex items-center gap-3 transition-colors ${
                      i === active ? 'bg-accent' : 'hover:bg-accent'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">
                        {ev.name || <span className="text-muted-foreground italic">Sans nom</span>}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {[ev.client_name, fmtDate(ev.start_date)].filter(Boolean).join(' · ') || '—'}
                      </p>
                    </div>
                    {ev.access_code && (
                      <span className="shrink-0 text-[10px] font-mono font-semibold text-muted-foreground bg-muted rounded px-1.5 py-0.5">
                        {ev.access_code}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
