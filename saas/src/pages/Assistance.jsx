import { Suspense, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ChevronDown, LifeBuoy } from 'lucide-react';
import { getSupportContent, getPublicFeatures } from '../lib/supabase';
import { FEATURE_UNAVAILABLE_MESSAGE, hasPublicFeature, isFeatureDisabledError } from '../features/featureGate';
import { BRAND } from '../lib/instanceBrand';
import { cn } from '../lib/utils';
import { safeHttpUrl } from '../lib/urls';
import { Spinner } from '../components/ui/spinner';
import { usePfFonts } from '../components/public/clientEditorStyles';
import { Escalation, Linkified } from '../components/public/SupportContact';
import { moduleSlot } from '../features/modules';

// Page d'aide ouverte sans session (/aide, /aide/:code), lue par le client pendant l'événement : style du
// site (palette noyer & sauge, classes pola-pf-* de index.css), hors du thème de l'admin.
const PAGE = 'pola-client pola-pf-page min-h-screen';
const VIEWS = [
  { value: 'faq', label: 'Problèmes courants' },
  { value: 'chat', label: 'Poser ma question' },
];
const TEXT_BUTTON = 'pola-pf-link text-[15px]';

// Chat de l'assistant : module privé « assistant » (LAB-422). Sans lui, l'onglet propose le contact du loueur.
const AssistantChat = moduleSlot('help.chat')[0]?.Component ?? null;

// Regroupe les cas publiés par catégorie pour la FAQ.
function groupByCategory(articles) {
  const map = {};
  for (const a of articles) (map[a.category] ??= []).push(a);
  return map;
}

export default function Assistance() {
  usePfFonts();
  const { code } = useParams(); // optionnel : /aide ou /aide/:code

  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [articles, setArticles] = useState([]);
  const [contact, setContact]   = useState(null);

  const [openId, setOpenId]     = useState(null); // cas FAQ déplié
  const [view, setView]         = useState('faq'); // 'faq' | 'chat'
  // Fonctionnalités de l'organisation : help (la page), assistant (le chat).
  const [unavailable, setUnavailable] = useState(false);
  const [assistant, setAssistant]     = useState(true);

  useEffect(() => {
    Promise.all([getSupportContent(code), getPublicFeatures(code)])
      .then(([{ articles, contact }, features]) => {
        if (!hasPublicFeature(features, 'help')) { setUnavailable(true); return; }
        setAssistant(hasPublicFeature(features, 'assistant') && !!AssistantChat);
        setArticles(articles); setContact(contact);
      })
      .catch((e) => { if (isFeatureDisabledError(e)) setUnavailable(true); else setError(e.message); })
      .finally(() => setLoading(false));
  }, [code]);

  const grouped = useMemo(() => groupByCategory(articles), [articles]);
  const company = contact?.contact_company || BRAND.name;

  if (loading) {
    return (
      <div className={cn(PAGE, 'flex items-center justify-center')}>
        <Spinner className="h-8 w-8 border-pf-noyer" />
      </div>
    );
  }

  if (unavailable) {
    return (
      <div className={cn(PAGE, 'flex items-center justify-center px-4')}>
        <div className="pola-pf-card max-w-sm p-6 text-center">
          <p className="text-[15px] text-pf-muted">{FEATURE_UNAVAILABLE_MESSAGE}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={PAGE}>
      <div className="mx-auto flex max-w-lg flex-col gap-5 px-4 py-8">
        {/* En-tête */}
        <header className="text-center">
          <h1 className="pola-pf-title text-[32px]">Besoin d'aide ?</h1>
          <p className="mt-1 break-words text-sm text-pf-muted">{company} · assistance photobooth</p>
        </header>

        {error && (
          <p role="alert" className="pola-pf-error break-words">{error}</p>
        )}

        {/* Onglets */}
        <div role="group" aria-label="Aide" className="flex gap-1 self-center rounded-full border border-pf-line bg-white p-1">
          {VIEWS.map((v) => (
            <button
              key={v.value}
              type="button"
              aria-pressed={view === v.value}
              onClick={() => setView(v.value)}
              className={cn(
                'pola-pf-focus rounded-full px-4 py-2 text-sm font-medium transition-colors',
                view === v.value ? 'bg-pf-noyer text-white' : 'text-pf-text hover:bg-pf-surface',
              )}
            >
              {v.label}
            </button>
          ))}
        </div>

        {view === 'faq'
          ? <Faq grouped={grouped} openId={openId} setOpenId={setOpenId} onAsk={() => setView('chat')} assistant={assistant} />
          : assistant
            ? (
              <Suspense fallback={<div className="flex justify-center py-12"><Spinner className="h-8 w-8 border-pf-noyer" /></div>}>
                <AssistantChat code={code} contact={contact} />
              </Suspense>
            )
            : <ContactOnly code={code} contact={contact} />}
      </div>
    </div>
  );
}

// ── FAQ cliquable ─────────────────────────────────────────────────────────────
function Faq({ grouped, openId, setOpenId, onAsk, assistant }) {
  const categories = Object.keys(grouped);

  if (categories.length === 0) {
    return (
      <div className="pola-pf-card flex flex-col items-center px-6 py-10 text-center">
        <div className="pola-pf-icon-circle"><LifeBuoy aria-hidden="true" className="size-6" /></div>
        <p className="mb-4 mt-3 text-[15px] text-pf-muted">Aucune fiche d'aide pour le moment.</p>
        <button type="button" onClick={onAsk} className={TEXT_BUTTON}>
          Poser ma question →
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {categories.map((cat) => (
        <section key={cat}>
          <h2 className="mb-2 px-1 text-sm font-medium text-pf-muted">{cat}</h2>
          <div className="flex flex-col gap-2">
            {grouped[cat].map((a) => {
              const open = openId === a.id;
              return (
                <div key={a.id} className="pola-pf-card overflow-hidden rounded-2xl">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? null : a.id)}
                    className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-pf-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-pf-noyer"
                  >
                    <span className="min-w-0 break-words text-[15px] font-medium text-pf-text">{a.title}</span>
                    <ChevronDown aria-hidden="true" className={cn('size-5 shrink-0 text-pf-muted transition-transform', open && 'rotate-180')} />
                  </button>
                  {open && (
                    <div className="px-5 pb-4 text-[15px] leading-relaxed text-pf-text">
                      <p className="whitespace-pre-wrap break-words"><Linkified text={a.solution} /></p>
                      {safeHttpUrl(a.image_url) && (
                        <a href={safeHttpUrl(a.image_url)} target="_blank" rel="noopener noreferrer">
                          <img src={safeHttpUrl(a.image_url)} alt={a.title} className="mt-3 w-full rounded-2xl ring-1 ring-pf-line" />
                        </a>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <div className="pt-2 text-center">
        <p className="text-[15px] text-pf-muted">Vous ne trouvez pas votre problème ?</p>
        <button type="button" onClick={onAsk} className={cn(TEXT_BUTTON, 'mt-2')}>
          {assistant ? "Poser ma question à l'assistant →" : 'Contacter le loueur →'}
        </button>
      </div>
    </div>
  );
}

// ── Sans assistant (fonctionnalité désactivée ou module absent) : contact direct du loueur ──
function ContactOnly({ code, contact }) {
  return (
    <div className="pola-pf-card pt-3">
      <Escalation code={code} contact={contact} phone={contact?.contact_phone} urgency="normal" transcript={[]} />
    </div>
  );
}
