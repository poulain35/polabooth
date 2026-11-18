// Polices Google dans l'onglet Polices de la Bibliothèque : chercher dans le catalogue, voir
// l'aperçu en grand (texte libre, graisses), puis ajouter la police aux polices perso en un clic.
// Règles pures : lib/googleFonts.js ; aperçu : utils/googleFontPreview.js ; import :
// importGoogleFont de lib/supabase.js (fonction google-font-file).
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Check, ExternalLink, Info, Loader2, Plus, Search } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Card, CardTitle } from '../../../components/ui/card';
import { Spinner } from '../../../components/ui/spinner';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { importGoogleFont } from '../../../lib/supabase';
import { cn } from '../../../lib/utils';
import {
  GOOGLE_FONT_CATEGORIES, WEIGHT_NAMES, defaultWeight, googleFontStatus, importedFontName, searchGoogleFonts,
} from '../../../lib/googleFonts';
import { EDITOR_FONTS } from '../../../utils/editorFonts';
import { loadPreviewFont } from '../../../utils/googleFontPreview';
import { Notice } from '../../../components/admin/CardParts';

const PAGE = 40;
const DEFAULT_SAMPLE = 'Bienvenue au mariage de Léa & Tom';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789 é è à ç ù & ! ?';

function usePreviewFont(family, weight, text = '') {
  const key = family ? `${family}|${weight}|${text}` : '';
  const [state, setState] = useState({ key: '', alias: null });
  useEffect(() => {
    if (!family) return undefined;
    let alive = true;
    const done = (alias) => { if (alive) setState({ key: `${family}|${weight}|${text}`, alias }); };
    loadPreviewFont(family, weight, text).then(done, () => done(null));
    return () => { alive = false; };
  }, [family, weight, text]);
  const ready = key !== '' && state.key === key;
  return { alias: ready ? state.alias : null, loading: key !== '' && !ready, failed: ready && !state.alias };
}

function FontRow({ entry, selected, onSelect }) {
  const { alias, failed } = usePreviewFont(entry.family, defaultWeight(entry.weights), entry.family);
  const weights = entry.weights.length;
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(entry)}
        aria-pressed={selected}
        className={cn(
          'w-full border-t border-border px-3.5 py-2.5 text-left transition-colors first:border-t-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          selected ? 'bg-primary-soft' : 'hover:bg-soft',
        )}
      >
        <span
          className={`block truncate text-2xl leading-tight ${alias ? 'text-foreground' : 'text-muted-foreground'}`}
          style={alias ? { fontFamily: `"${alias}"`, fontWeight: defaultWeight(entry.weights) } : undefined}
        >
          {entry.family}
        </span>
        {/* La coche porte le choix ; sur le fond de la ligne choisie, le texte passe à l'encre du bleu. */}
        <span className={cn('mt-0.5 flex items-center gap-1.5 text-xs', selected ? 'text-primary-ink' : 'text-muted-foreground')}>
          {failed ? 'Aperçu indisponible' : entry.categoryLabel}
          {weights > 1 && <> · {weights} graisses</>}
          {selected && <Check className="ml-auto size-3.5" aria-hidden="true" />}
        </span>
      </button>
    </li>
  );
}

function FontPreview({ entry, customNames, onImported }) {
  const [weight, setWeight] = useState(() => defaultWeight(entry.weights));
  const [name, setName] = useState(() => importedFontName(entry.family, defaultWeight(entry.weights)));
  const [sample, setSample] = useState(DEFAULT_SAMPLE);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const { alias, loading, failed } = usePreviewFont(entry.family, weight);

  const trimmed = name.trim();
  const status = googleFontStatus({ family: entry.family, name: trimmed, weight }, { customNames, editorFonts: EDITOR_FONTS });
  const fontStyle = alias ? { fontFamily: `"${alias}"`, fontWeight: weight } : undefined;
  const specimen = `https://fonts.google.com/specimen/${encodeURIComponent(entry.family).replace(/%20/g, '+')}`;

  const pickWeight = (w) => {
    setWeight(w);
    setName(importedFontName(entry.family, w));
    setError('');
  };

  async function handleImport() {
    if (!trimmed || status !== 'new') return;
    setImporting(true);
    setError('');
    try {
      const record = await importGoogleFont({ family: entry.family, weight, name: trimmed });
      await onImported(record);
      toast.success(`« ${record.name} » ajoutée à vos polices`, {
        description: 'Elle est disponible dans l’éditeur des cadres photo et des écrans de la borne.',
      });
    } catch (err) {
      setError(err?.message || 'Impossible d’ajouter cette police. Réessayez.');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle as="p" className="truncate">{entry.family}</CardTitle>
          <p className="text-xs text-muted-foreground">{entry.categoryLabel} · police libre (Google Fonts)</p>
        </div>
        <Button asChild variant="link" size="sm" className="shrink-0 px-0">
          <a href={specimen} target="_blank" rel="noreferrer">
            Voir sur Google Fonts<ExternalLink aria-hidden="true" />
          </a>
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="gf-sample">Texte de l’aperçu</Label>
        <Input id="gf-sample" value={sample} maxLength={80} onChange={(e) => setSample(e.target.value)}
          placeholder={DEFAULT_SAMPLE} />
      </div>

      <div className="relative overflow-hidden rounded-xl bg-muted p-4 sm:p-5" aria-busy={loading}>
        {failed ? (
          <p className="py-10 text-center text-[13px] text-muted-foreground">
            Aperçu indisponible : Google Fonts ne répond pas. Réessayez plus tard.
          </p>
        ) : (
          <div className={`space-y-3 text-foreground transition-opacity ${alias ? 'opacity-100' : 'opacity-30'}`} style={fontStyle}>
            <p className="break-words text-[44px] leading-tight">{sample || DEFAULT_SAMPLE}</p>
            <p className="break-words text-[26px] leading-snug">{sample || DEFAULT_SAMPLE}</p>
            <p className="break-words text-lg leading-relaxed">{ALPHABET}</p>
          </div>
        )}
        {loading && (
          <Loader2 className="absolute right-3 top-3 size-4 animate-spin text-muted-foreground" aria-label="Chargement de l’aperçu" />
        )}
      </div>

      {entry.weights.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium text-foreground">Graisse</p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Graisse">
            {entry.weights.map((w) => (
              <Button key={w} type="button" size="xs" variant={w === weight ? 'default' : 'outline'}
                aria-pressed={w === weight} onClick={() => pickWeight(w)}>
                {WEIGHT_NAMES[w] ?? w}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Une police ajoutée = une graisse. Pour le gras, ajoutez aussi la graisse Bold.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="gf-name">Nom dans l’éditeur</Label>
        <Input id="gf-name" value={name} maxLength={60}
          onChange={(e) => { setName(e.target.value); setError(''); }}
          onKeyDown={(e) => e.key === 'Enter' && handleImport()} />
      </div>

      {status === 'imported' && (
        <Notice tone="green" className="flex items-center gap-2">
          <Check className="size-4 shrink-0" aria-hidden="true" />Déjà dans vos polices.
        </Notice>
      )}
      {status === 'editor' && (
        <p className="flex items-start gap-2 rounded-xl bg-muted px-3 py-2 text-[13px] text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Déjà proposée dans l’éditeur : inutile de l’ajouter. Une autre graisse peut l’être.
        </p>
      )}
      {error && (
        <Notice tone="red" role="alert">{error}</Notice>
      )}

      <Button onClick={handleImport} disabled={!trimmed || status !== 'new' || importing} className="self-start">
        {importing
          ? <><Loader2 className="animate-spin" aria-hidden="true" />Ajout en cours…</>
          : <><Plus aria-hidden="true" />Ajouter à mes polices</>}
      </Button>
    </div>
  );
}

export default function GoogleFontsCard({ customNames, onImported }) {
  const [catalog, setCatalog] = useState(null);
  const [catalogError, setCatalogError] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState(null);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    let alive = true;
    import('../../../data/googleFonts.json')
      .then((m) => { if (alive) setCatalog(m.default); })
      .catch(() => { if (alive) setCatalogError(true); });
    return () => { alive = false; };
  }, []);

  const results = useMemo(
    () => (catalog ? searchGoogleFonts(catalog, { query: deferredQuery, category }) : []),
    [catalog, deferredQuery, category],
  );
  const shown = results.slice(0, limit);

  const select = (entry) => {
    setSelected(entry);
    if (window.matchMedia?.('(max-width: 1023px)').matches) {
      requestAnimationFrame(() => document.getElementById('gf-preview')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  };

  return (
    <Card className="p-card">
      <CardTitle as="h2">Ajouter une police Google</CardTitle>
      <p className="mb-5 mt-0.5 text-[13px] text-muted-foreground">
        {catalog ? `${catalog.length.toLocaleString('fr-FR')} polices libres` : 'Des centaines de polices libres'},
        {' '}utilisables pour l’impression et sur la borne. Cherchez, regardez l’aperçu, puis ajoutez-la en un clic :
        plus besoin de télécharger le fichier.
      </p>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          type="search"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }}
          placeholder="Rechercher une police (ex. Bodoni, Amatic, Sacramento…)"
          aria-label="Rechercher une police Google"
          className="pl-9"
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Catégorie">
        {GOOGLE_FONT_CATEGORIES.map((c) => (
          <Button key={c.id} type="button" size="xs" variant={category === c.id ? 'default' : 'outline'}
            aria-pressed={category === c.id} onClick={() => { setCategory(c.id); setLimit(PAGE); }}>
            {c.label}
          </Button>
        ))}
      </div>

      {/* grid-cols-1 : sans lui, la piste implicite s'élargit et la page déborde à 375 px. */}
      <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <div className="min-w-0">
          {catalogError ? (
            <Notice tone="red" role="alert" className="text-center">Catalogue indisponible. Rechargez la page.</Notice>
          ) : !catalog ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : results.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-muted-foreground">Aucune police ne correspond.</p>
          ) : (
            <>
              <p className="mb-2 text-xs text-muted-foreground" aria-live="polite">
                {results.length.toLocaleString('fr-FR')} {results.length > 1 ? 'polices' : 'police'}
              </p>
              <ul className="max-h-[30rem] overflow-y-auto rounded-xl border border-border">
                {shown.map((entry) => (
                  <FontRow key={entry.family} entry={entry} selected={selected?.family === entry.family} onSelect={select} />
                ))}
              </ul>
              {results.length > shown.length && (
                <Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => setLimit((n) => n + PAGE)}>
                  Afficher plus
                </Button>
              )}
            </>
          )}
        </div>

        <div id="gf-preview" className="min-w-0 scroll-mt-20">
          {selected ? (
            <FontPreview key={selected.family} entry={selected} customNames={customNames} onImported={onImported} />
          ) : (
            <div className="flex h-full min-h-48 items-center justify-center rounded-xl border border-dashed border-input p-6 text-center text-[13px] text-muted-foreground">
              Choisissez une police dans la liste pour la voir en grand avec votre texte.
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
