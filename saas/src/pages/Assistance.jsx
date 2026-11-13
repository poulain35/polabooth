import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getSupportContent, assistantChat, submitSupportMessage, getPublicFeatures } from '../lib/supabase';
import { FEATURE_UNAVAILABLE_MESSAGE, hasPublicFeature, isFeatureDisabledError } from '../features/featureGate';
import { BRAND } from '../lib/instanceBrand';

// Regroupe les cas publiés par catégorie pour la FAQ.
function groupByCategory(articles) {
  const map = {};
  for (const a of articles) (map[a.category] ??= []).push(a);
  return map;
}

// Rend un texte en transformant les URLs en liens cliquables.
function Linkified({ text }) {
  const parts = String(text).split(/(https?:\/\/[^\s]+)/g);
  return parts.map((part, i) =>
    /^https?:\/\//.test(part)
      ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-primary underline break-all">{part}</a>
      : part
  );
}

export default function Assistance() {
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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (unavailable) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-6">
        <p className="text-gray-500 text-sm text-center">{FEATURE_UNAVAILABLE_MESSAGE}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-lg mx-auto px-4 py-6">
        {/* En-tête */}
        <header className="text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Besoin d'aide ?</h1>
          <p className="text-gray-500 mt-1 text-sm">{company} · assistance photobooth</p>
        </header>

        {error && (
          <div className="bg-red-50 text-red-700 text-sm rounded-xl p-3 mb-4">{error}</div>
        )}

        {/* Onglets */}
        <div className="flex gap-2 mb-5">
          <button
            onClick={() => setView('faq')}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold ${
              view === 'faq' ? 'bg-primary text-white' : 'bg-card text-gray-600 border border-gray-200'
            }`}
          >
            Problèmes courants
          </button>
          <button
            onClick={() => setView('chat')}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold ${
              view === 'chat' ? 'bg-primary text-white' : 'bg-card text-gray-600 border border-gray-200'
            }`}
          >
            Poser ma question
          </button>
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
      <div className="text-center text-gray-500 text-sm py-10">
        <p>Aucune fiche d'aide pour le moment.</p>
        <button onClick={onAsk} className="mt-4 text-primary font-semibold">
          Poser ma question →
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {categories.map((cat) => (
        <div key={cat}>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">{cat}</h2>
          <div className="space-y-2">
            {grouped[cat].map((a) => {
              const open = openId === a.id;
              return (
                <div key={a.id} className="bg-card rounded-xl border border-gray-200 overflow-hidden">
                  <button
                    onClick={() => setOpenId(open ? null : a.id)}
                    className="w-full flex items-center justify-between gap-3 p-4 text-left"
                  >
                    <span className="text-sm font-medium text-gray-900">{a.title}</span>
                    <svg className={`w-5 h-5 text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {open && (
                    <div className="px-4 pb-4 text-sm text-gray-700 leading-relaxed">
                      <p className="whitespace-pre-wrap"><Linkified text={a.solution} /></p>
                      {a.image_url && (
                        <a href={a.image_url} target="_blank" rel="noopener noreferrer">
                          <img src={a.image_url} alt={a.title}
                            className="mt-3 w-full rounded-lg border border-gray-200" />
                        </a>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="text-center pt-2">
        <p className="text-sm text-gray-500">Vous ne trouvez pas votre problème ?</p>
        <button onClick={onAsk} className="mt-2 text-primary font-semibold text-sm">
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
    <div className="bg-card rounded-2xl border border-gray-200 flex flex-col" style={{ minHeight: '60vh' }}>
      {/* Fil de discussion */}
      <div className="flex-1 p-4 space-y-3 overflow-y-auto">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 text-sm py-8">
            Décrivez votre problème (ex. « l'imprimante n'imprime plus », « la photo est toute noire »).
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${
              m.role === 'user' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-800'
            }`}>
              <Linkified text={m.content} />
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-gray-100 text-gray-400 rounded-2xl px-4 py-2.5 text-sm">L'assistant réfléchit…</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Escalade vers le loueur */}
      {escalate.needed && (
        <Escalation code={code} contact={contact} phone={phone} urgency={escalate.urgency} transcript={messages} />
      )}

      {/* Saisie */}
      <div className="border-t border-gray-100 p-3 flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          rows={1}
          placeholder="Votre message…"
          className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <button
          onClick={send}
          disabled={!input.trim() || !!sending}
          className="px-4 rounded-xl bg-primary text-white text-sm font-semibold disabled:opacity-40"
        >
          Envoyer
        </button>
      </div>
    </div>
  );
}

// ── Sans assistant (fonctionnalité assistant désactivée) : contact direct du loueur ──
function ContactOnly({ code, contact }) {
  return (
    <div className="bg-card rounded-2xl border border-gray-200 py-3">
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
      <div className="mx-3 mb-1 bg-emerald-50 text-emerald-700 text-sm rounded-xl p-3 text-center">
        ✅ Message envoyé. {contact?.contact_company || 'Le loueur'} vous recontactera dès que possible.
      </div>
    );
  }

  return (
    <div className={`mx-3 mb-1 rounded-xl p-3 ${blocking ? 'bg-red-50' : 'bg-amber-50'}`}>
      <p className={`text-sm font-medium mb-2 ${blocking ? 'text-red-800' : 'text-amber-800'}`}>
        {blocking
          ? 'Problème bloquant — contactez le loueur directement :'
          : 'Besoin de contacter le loueur ?'}
      </p>

      <div className="flex gap-2">
        {phone && (
          <a href={`tel:${phone}`}
            className={`flex-1 text-center py-2.5 rounded-xl text-sm font-semibold text-white ${blocking ? 'bg-red-600' : 'bg-primary'}`}>
            📞 Appeler
          </a>
        )}
        {phone && (
          <a href={`sms:${phone}`}
            className="flex-1 text-center py-2.5 rounded-xl text-sm font-semibold bg-card border border-gray-200 text-gray-700">
            💬 SMS
          </a>
        )}
        <button
          onClick={() => setShowForm((s) => !s)}
          className="flex-1 text-center py-2.5 rounded-xl text-sm font-semibold bg-card border border-gray-200 text-gray-700"
        >
          ✉️ Message
        </button>
      </div>

      {showForm && (
        <div className="mt-3 space-y-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Votre prénom"
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
          <input value={msgPhone} onChange={(e) => setMsgPhone(e.target.value)} placeholder="Votre numéro (pour être rappelé)" type="tel"
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Décrivez votre problème…"
            className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
          {err && <p className="text-red-600 text-xs">{err}</p>}
          <button onClick={submit} disabled={!text.trim() || submitting}
            className="w-full py-2.5 rounded-xl bg-primary text-white text-sm font-semibold disabled:opacity-40">
            {submitting ? 'Envoi…' : 'Envoyer le message'}
          </button>
        </div>
      )}
    </div>
  );
}
