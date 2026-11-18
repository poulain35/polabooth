// Aperçu de l'email envoyé par la borne (LAB-302, spec email-galerie-couleurs D10) : HTML calculé par
// kiosk-email-preview avec le brouillon non enregistré, le même code que l'envoi réel. Rafraîchi
// 800 ms après la dernière frappe, un seul appel à la fois. Bouton « M'envoyer un test ».
import { useEffect, useRef, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { previewKioskEmail, sendKioskEmailTest } from '../../lib/supabase';
import { Button } from '../ui/button';
import { Notice } from './CardParts';

const PREVIEW_DELAY_MS = 800;
const MEDIA = [
  { id: 'photo', label: 'Photo' },
  { id: 'animation', label: 'Animation' },
];

export default function KioskEmailPreview({ eventId, draft }) {
  const [media, setMedia] = useState('photo');
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const latest = useRef({ draft, media });
  const busy = useRef(false);
  const queued = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  async function refresh() {
    if (busy.current) { queued.current = true; return; }
    busy.current = true;
    setLoading(true);
    try {
      const data = await previewKioskEmail(eventId, latest.current);
      if (mounted.current) { setPreview(data); setError(''); }
    } catch (e) {
      if (mounted.current) setError(e.message);
    } finally {
      busy.current = false;
      if (queued.current) { queued.current = false; refresh(); }
      else if (mounted.current) setLoading(false);
    }
  }

  const key = JSON.stringify({ draft, media });
  useEffect(() => {
    latest.current = { draft, media };
    const timer = setTimeout(refresh, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, eventId]);

  async function sendTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const data = await sendKioskEmailTest(eventId, latest.current);
      setTestResult(data.sent
        ? { ok: true, text: `Email de test envoyé à ${data.to}` }
        : { ok: false, text: data.message || 'Aucun email envoyé' });
    } catch (e) {
      setTestResult({ ok: false, text: e.message });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[13px] font-medium text-foreground">Aperçu</p>
        <div className="inline-flex rounded-full bg-muted p-0.5" role="group" aria-label="Média de l'aperçu">
          {MEDIA.map((m) => (
            <button key={m.id} type="button" onClick={() => setMedia(m.id)} aria-pressed={media === m.id}
              className={`rounded-full px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${media === m.id ? 'bg-strong font-medium text-strong-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="text-xs text-muted-foreground flex items-center gap-2 min-h-[1rem]">
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}
        {preview?.subject && <span className="truncate"><span className="text-muted-foreground">Objet :</span> {preview.subject}</span>}
      </div>

      {error && <Notice tone="red">{error}</Notice>}

      <div className="light-island rounded-xl border border-border overflow-hidden bg-background">
        {preview?.html
          ? <iframe title="Aperçu de l'email" sandbox="" srcDoc={preview.html} className="w-full h-[600px] block" />
          : <div className="h-[600px] flex items-center justify-center text-xs text-muted-foreground">{loading ? 'Chargement de l\'aperçu…' : 'Aperçu indisponible'}</div>}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Button type="button" variant="outline" onClick={sendTest} disabled={testing} >
          {testing ? <Loader2 className="animate-spin" /> : <Send />}
          {testing ? 'Envoi…' : 'M\'envoyer un test'}
        </Button>
        {testResult && (
          <Notice role="status" tone={testResult.ok ? 'green' : 'red'}>
            {testResult.text}
          </Notice>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Le test part à l'adresse de votre compte, avec les réglages affichés, même non enregistrés.</p>
    </div>
  );
}
