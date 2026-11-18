import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, ChevronDown, LifeBuoy, Mail, MessageSquare, Phone } from 'lucide-react';
import { getSupportContent, assistantChat, submitSupportMessage, getPublicFeatures } from '../lib/supabase';
import { FEATURE_UNAVAILABLE_MESSAGE, hasPublicFeature, isFeatureDisabledError } from '../features/featureGate';
import { BRAND } from '../lib/instanceBrand';
import { cn } from '../lib/utils';
import { safeHttpUrl } from '../lib/urls';
import { Spinner } from '../components/ui/spinner';
import { usePfFonts } from '../components/public/clientEditorStyles';

// Page d'aide ouverte sans session (/aide, /aide/:code), lue par le client pendant l'événement : style du
// site (palette noyer & sauge, classes pola-pf-* de index.css), hors du thème de l'admin.
const PAGE = 'pola-client pola-pf-page min-h-screen';
const VIEWS = [
  { value: 'faq', label: 'Problèmes courants' },
  { value: 'chat', label: 'Poser ma question' },
];
const TEXT_BUTTON = 'pola-pf-link text-[15px]';

// Regroupe les cas publiés par catégorie pour la FAQ.
function groupByCategory(articles) {
  const map = {};
  for (const a of articles) (map[a.category] ??= []).push(a);
  return map;
}

// Rend un texte en transformant les URLs en liens cliquables. `linkClassName` : couleur du lien
// (vide dans une bulle noyer, où le lien garde la couleur du texte).
function Linkified({ text, linkClassName = 'text-pf-noyer' }) {
  const parts = String(text).split(/(https?:\/\/[^\s]+)/g);
  return parts.map((part, i) =>
    /^https?:\/\//.test(part)
      ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" className={cn('break-all underline underline-offset-2', linkClassName)}>{part}</a>
      : part
  );
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
        setAssistant(hasPublicFeature(features, 'assistant'));
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
            ? <Chat code={code} contact={contact} />
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

// ── Chat IA + escalade ─────────────────────────────────────────────────────────
function Chat({ code, contact }) {
  const [messages, setMessages] = useState([]); // { role, content }
  const [input, setInput]       = useState('');
  const [sending, setSending]   = useState('');
  const [escalate, setEscalate] = useState({ needed: false, urgency: 'none' });
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, sending]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    const next = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setSending('…');
    try {
      const { reply, escalate } = await assistantChat({ code, messages: next });
      setMessages((m) => [...m, { role: 'assistant', content: reply }]);
      setEscalate(escalate);
    } catch (e) {
      const content = isFeatureDisabledError(e)
        ? "L'assistant n'est pas disponible. Vous pouvez contacter directement le loueur ci-dessous."
        : e.rateLimited
        ? `Vous avez envoyé beaucoup de messages en peu de temps. ${e.message} En cas d'urgence, contactez directement le loueur ci-dessous.`
        : `Désolé, une erreur est survenue (${e.message}). Vous pouvez contacter directement le loueur ci-dessous.`;
      setMessages((m) => [...m, { role: 'assistant', content }]);
      setEscalate({ needed: true, urgency: 'normal' });
    } finally {
      setSending('');
    }
  }

  const phone = contact?.contact_phone;

  return (
    <div className="pola-pf-card flex min-h-[60vh] flex-col overflow-hidden">
      {/* Fil de discussion */}
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="py-8 text-center text-[15px] text-pf-muted">
            Décrivez votre problème (ex. « l'imprimante n'imprime plus », « la photo est toute noire »).
          </p>
        )}
        {messages.map((m, i) => {
          const mine = m.role === 'user';
          return (
            <div key={i} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
              <div className={cn(
                'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed',
                mine ? 'bg-pf-noyer text-white' : 'bg-pf-surface text-pf-text',
              )}>
                <Linkified text={m.content} linkClassName={mine ? '' : undefined} />
              </div>
            </div>
          );
        })}
        {sending && (
          <div className="flex justify-start">
            <div role="status" className="rounded-2xl bg-pf-surface px-4 py-2.5 text-[15px] text-pf-muted">L'assistant réfléchit…</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Escalade vers le loueur */}
      {escalate.needed && (
        <Escalation code={code} contact={contact} phone={phone} urgency={escalate.urgency} transcript={messages} />
      )}

      {/* Saisie */}
      <div className="flex items-end gap-2 border-t border-pf-line p-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          rows={1}
          placeholder="Votre message…"
          aria-label="Votre message"
          className="pola-pf-input min-w-0 flex-1 resize-none"
        />
        <button type="button" onClick={send} disabled={!input.trim() || !!sending} className="pola-pf-btn-primary px-5">
          Envoyer
        </button>
      </div>
    </div>
  );
}

// ── Sans assistant (fonctionnalité assistant désactivée) : contact direct du loueur ──
function ContactOnly({ code, contact }) {
  return (
    <div className="pola-pf-card pt-3">
      <Escalation code={code} contact={contact} phone={contact?.contact_phone} urgency="normal" transcript={[]} />
    </div>
  );
}

// ── Boutons d'escalade + formulaire « laisser un message » ──────────────────────
function Escalation({ code, contact, phone, urgency, transcript }) {
  const [showForm, setShowForm]   = useState(false);
  const [name, setName]           = useState('');
  const [msgPhone, setMsgPhone]   = useState('');
  const [text, setText]           = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent]           = useState(false);
  const [err, setErr]             = useState('');

  const blocking = urgency === 'blocking';

  async function submit() {
    if (!text.trim() || submitting) return;
    setSubmitting(true); setErr('');
    try {
      await submitSupportMessage({
        code, name, phone: msgPhone, message: text,
        urgency: blocking ? 'blocking' : 'normal', transcript,
      });
      setSent(true);
    } catch (e) {
      setErr(isFeatureDisabledError(e) ? "L'envoi de message n'est pas disponible." : e.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <p role="status" className="mx-3 mb-3 flex items-start gap-2 rounded-2xl bg-pf-sage-soft p-3 text-[15px] text-pf-sage">
        <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span className="min-w-0 break-words">Message envoyé. {contact?.contact_company || 'Le loueur'} vous recontactera dès que possible.</span>
      </p>
    );
  }

  return (
    <div className={cn('mx-3 mb-3 rounded-2xl p-3', blocking ? 'bg-pola-error-soft' : 'bg-pf-surface')}>
      <p className={cn('mb-2 text-[15px] font-medium', blocking ? 'text-pola-error' : 'text-pf-text')}>
        {blocking
          ? 'Problème bloquant — contactez le loueur directement :'
          : 'Besoin de contacter le loueur ?'}
      </p>

      {/* flex-wrap : sur un petit téléphone, le troisième bouton passe à la ligne au lieu de déborder. */}
      <div className="flex flex-wrap gap-2">
        {phone && (
          <a href={`tel:${phone}`} className={cn(blocking ? 'pola-btn-destructive' : 'pola-pf-btn-primary', 'flex-1 px-4 py-3 text-base')}>
            <Phone aria-hidden="true" className="size-4" />Appeler
          </a>
        )}
        {phone && (
          <a href={`sms:${phone}`} className="pola-pf-btn-secondary flex-1 bg-white px-4">
            <MessageSquare aria-hidden="true" className="size-4" />SMS
          </a>
        )}
        <button type="button" className="pola-pf-btn-secondary flex-1 bg-white px-4" aria-expanded={showForm} onClick={() => setShowForm((s) => !s)}>
          <Mail aria-hidden="true" className="size-4" />Message
        </button>
      </div>

      {showForm && (
        <div className="mt-3 flex flex-col gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Votre prénom" aria-label="Votre prénom" className="pola-pf-input" />
          <input value={msgPhone} onChange={(e) => setMsgPhone(e.target.value)} type="tel"
            placeholder="Votre numéro (pour être rappelé)" aria-label="Votre numéro (pour être rappelé)" className="pola-pf-input" />
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3}
            placeholder="Décrivez votre problème…" aria-label="Décrivez votre problème" className="pola-pf-input resize-none" />
          {err && <p role="alert" className="pola-pf-error break-words">{err}</p>}
          <button type="button" onClick={submit} disabled={!text.trim() || submitting} className="pola-pf-btn-primary w-full">
            {submitting ? 'Envoi…' : 'Envoyer le message'}
          </button>
        </div>
      )}
    </div>
  );
}
