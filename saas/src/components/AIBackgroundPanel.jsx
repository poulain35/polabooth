import { useState } from 'react';

const MODELS = [
  { id: 'flux-1.1-pro',       label: 'Flux 1.1 Pro',      badge: 'Rapide' },
  { id: 'flux-1.1-pro-ultra', label: 'Flux 1.1 Pro Ultra', badge: 'Qualité' },
  { id: 'flux-2-pro',         label: 'Flux 2 Pro',         badge: 'Nouveau' },
];

const MULTI_FORMATS = [
  { id: 'portrait',  label: 'Portrait',    ratio: '2/3',  canvasW: 400, canvasH: 600, imgW: 832,  imgH: 1248 },
  { id: 'landscape', label: 'Paysage',     ratio: '3/2',  canvasW: 600, canvasH: 400, imgW: 1248, imgH: 832  },
  { id: 'stripV',    label: 'Band. V',     ratio: '1/3',  canvasW: 200, canvasH: 600, imgW: 512,  imgH: 1536 },
  { id: 'stripH',    label: 'Band. H',     ratio: '3/1',  canvasW: 600, canvasH: 200, imgW: 1536, imgH: 512  },
];

const PROMPT_CATEGORIES = [
  {
    label: 'Floral & Nature',
    items: [
      'Seamless floral watercolor pattern, soft pink roses and peonies on white background, elegant wedding style, no text, no people, flat lay illustration',
      'Delicate botanical pattern, eucalyptus branches and wildflowers, sage green and ivory tones, watercolor style, photobooth background',
      'Lush tropical leaves pattern, monstera and palm fronds, deep green on cream, flat design illustration, no faces',
      'Cherry blossom branches pattern, soft pink sakura petals falling, Japanese style, pastel background, decorative wallpaper',
    ],
  },
  {
    label: 'Mariage & Élégance',
    items: [
      'Elegant gold foil geometric pattern on white, art deco style, diamonds and lines, luxury wedding background, seamless repeat',
      'Soft blush and gold marble texture, delicate floral border elements, romantic wedding photobooth background, no text',
      'Romantic rose gold confetti and ribbon pattern on white, celebration background, flat design, elegant and festive',
    ],
  },
  {
    label: 'Anniversaire & Fête',
    items: [
      'Colorful confetti and balloon pattern on white background, birthday party celebration, flat vector style, festive and fun, no text',
      'Birthday cake and candles seamless pattern, pastel colors, cute flat illustration style, party celebration background',
      'Rainbow colored star confetti and streamers explosion, white background, joyful party atmosphere, clean flat design',
    ],
  },
  {
    label: 'Noël',
    items: [
      'Christmas holly berries and pine branches border pattern, deep red and forest green on cream, festive holiday background, no text',
      'Elegant gold snowflakes and stars pattern on deep navy blue, luxury Christmas background, seamless repeat wallpaper',
      'Cozy Christmas pattern, gingerbread cookies and candy canes on warm white, cute flat illustration, holiday photobooth',
    ],
  },
  {
    label: 'Nouvel An',
    items: [
      'Gold and silver fireworks burst pattern on dark midnight blue, new year celebration background, sparkling festive design',
      'Champagne bubbles and golden stars pattern on black background, new year eve celebration, elegant and luxurious',
      'Silver confetti and party popper explosion on white, new year party photobooth background, clean flat design',
    ],
  },
  {
    label: 'Dégradés & Géométrie',
    items: [
      'Smooth gradient background, coral to violet to deep blue, dreamy pastel sunset, minimal clean design, no elements',
      'Soft pastel geometric shapes pattern, circles and hexagons in blush pink and lavender, modern flat design wallpaper',
      'Abstract fluid art background, rose gold and marble swirls, luxury aesthetic, smooth blended colors, no text',
      'Bold colorful diagonal stripes pattern, vibrant rainbow colors, clean graphic design, photobooth background',
    ],
  },
];

async function callGenerateBackground({ prompt, model, formatId, session, supabaseUrl, supabaseAnon }) {
  const res = await fetch(`${supabaseUrl}/functions/v1/generate-background`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey:          supabaseAnon,
      Authorization:   `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ prompt, model, formatId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);
  return data.url;
}

export default function AIBackgroundPanel({ formatId, onApply, onSaveAllFormats, onClose }) {
  const [mode,    setMode]    = useState('single'); // 'single' | 'multi'
  const [model,   setModel]   = useState('flux-1.1-pro');
  const [prompt,  setPrompt]  = useState('');

  // Single mode state
  const [loadingSingle, setLoadingSingle] = useState(false);
  const [previewSingle, setPreviewSingle] = useState(null);
  const [errorSingle,   setErrorSingle]   = useState('');

  // Multi mode state
  const [loadingMulti, setLoadingMulti] = useState(false);
  const [previews,     setPreviews]     = useState({}); // { portrait: url, ... }
  const [progress,     setProgress]     = useState({}); // { portrait: 'loading'|'done'|'error' }
  const [templateName, setTemplateName] = useState('');
  const [savingMulti,  setSavingMulti]  = useState(false);
  const [errorMulti,   setErrorMulti]   = useState('');

  async function getSession() {
    const { supabase } = await import('../lib/supabase.js');
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Session expirée — reconnectez-vous');
    return session;
  }

  async function handleGenerateSingle() {
    if (!prompt.trim() || loadingSingle) return;
    setLoadingSingle(true);
    setErrorSingle('');
    setPreviewSingle(null);
    try {
      const session     = await getSession();
      const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const url = await callGenerateBackground({ prompt, model, formatId, session, supabaseUrl, supabaseAnon });
      setPreviewSingle(url);
    } catch (err) {
      setErrorSingle(err.message ?? 'Erreur inconnue');
    } finally {
      setLoadingSingle(false);
    }
  }

  async function handleGenerateMulti() {
    if (!prompt.trim() || loadingMulti) return;
    setLoadingMulti(true);
    setErrorMulti('');
    setPreviews({});
    setProgress(Object.fromEntries(MULTI_FORMATS.map((f) => [f.id, 'loading'])));
    try {
      const session      = await getSession();
      const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY;

      // Génération en parallèle
      await Promise.all(
        MULTI_FORMATS.map(async (fmt) => {
          try {
            const url = await callGenerateBackground({ prompt, model, formatId: fmt.id, session, supabaseUrl, supabaseAnon });
            setPreviews((prev) => ({ ...prev, [fmt.id]: url }));
            setProgress((prev) => ({ ...prev, [fmt.id]: 'done' }));
          } catch {
            setProgress((prev) => ({ ...prev, [fmt.id]: 'error' }));
          }
        })
      );
    } catch (err) {
      setErrorMulti(err.message ?? 'Erreur inconnue');
    } finally {
      setLoadingMulti(false);
    }
  }

  async function handleSaveAll() {
    if (!templateName.trim() || savingMulti) return;
    const allDone = MULTI_FORMATS.every((f) => previews[f.id]);
    if (!allDone) { setErrorMulti('Certains formats n\'ont pas été générés'); return; }
    setSavingMulti(true);
    setErrorMulti('');
    try {
      await onSaveAllFormats(templateName.trim(), previews);
      setTemplateName('');
      setPreviews({});
      setProgress({});
    } catch (err) {
      setErrorMulti(err.message ?? 'Erreur sauvegarde');
    } finally {
      setSavingMulti(false);
    }
  }

  const allGenerated = MULTI_FORMATS.every((f) => previews[f.id]);

  return (
    <div className="w-[240px] bg-card border-r border-[#E5E5EA] flex flex-col shrink-0 overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[#E5E5EA] shrink-0">
        <div className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-primary" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/>
          </svg>
          <span className="text-xs font-semibold text-[#1D1D1F]">Fond IA</span>
        </div>
        <button onClick={onClose} className="p-1 rounded-lg text-[#6E6E73] hover:bg-[#F2F2F7] transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Mode toggle */}
      <div className="flex p-2 gap-1 shrink-0 border-b border-[#E5E5EA]">
        {[['single', 'Format actuel'], ['multi', '4 formats']].map(([id, label]) => (
          <button key={id} onClick={() => setMode(id)}
            className={`flex-1 py-1.5 text-[10px] font-semibold rounded-lg transition-colors
              ${mode === id ? 'bg-primary text-white' : 'bg-[#F2F2F7] text-[#6E6E73] hover:bg-[#E8E8ED]'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">

        {/* Modèle */}
        <div>
          <p className="text-[10px] font-semibold text-[#6E6E73] uppercase tracking-wider mb-1.5">Modèle</p>
          <div className="flex flex-col gap-1">
            {MODELS.map((m) => (
              <button key={m.id} onClick={() => setModel(m.id)}
                className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors
                  ${model === m.id ? 'bg-primary/10 text-primary ring-1 ring-primary' : 'bg-[#F9F9FB] text-[#3C3C43] hover:bg-[#F2F2F7]'}`}>
                <span className="font-medium">{m.label}</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold
                  ${model === m.id ? 'bg-primary/20 text-primary' : 'bg-[#E5E5EA] text-[#6E6E73]'}`}>
                  {m.badge}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Prompt */}
        <div>
          <p className="text-[10px] font-semibold text-[#6E6E73] uppercase tracking-wider mb-1.5">Prompt</p>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ex: fond floral aquarelle pastel, tons roses et dorés…"
            rows={4}
            className="w-full text-xs text-[#1D1D1F] placeholder-[#AEAEB2] bg-[#F9F9FB] border border-[#E5E5EA]
              rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent" />
        </div>

        {/* Suggestions */}
        <div>
          <p className="text-[10px] font-semibold text-[#6E6E73] uppercase tracking-wider mb-1.5">Suggestions</p>
          <div className="flex flex-col gap-2">
            {PROMPT_CATEGORIES.map((cat) => (
              <div key={cat.label}>
                <p className="text-[9px] font-semibold text-[#AEAEB2] uppercase tracking-wider mb-1 px-1">{cat.label}</p>
                <div className="flex flex-col gap-0.5">
                  {cat.items.map((s, i) => (
                    <button key={i} onClick={() => setPrompt(s)}
                      className={`text-left text-[10px] leading-tight px-2 py-1.5 rounded-lg transition-colors
                        ${prompt === s ? 'bg-primary/15 text-primary' : 'text-[#6E6E73] hover:text-primary bg-[#F9F9FB] hover:bg-primary/10'}`}>
                      <span className="line-clamp-2">{s.split(',')[0]}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Mode single ── */}
        {mode === 'single' && (
          <>
            {errorSingle && (
              <p className="text-[10px] text-red-600 bg-red-50 rounded-lg px-2.5 py-2">{errorSingle}</p>
            )}
            {previewSingle && (
              <div className="flex flex-col gap-2">
                <p className="text-[10px] font-semibold text-[#6E6E73] uppercase tracking-wider">Aperçu</p>
                <div className="rounded-xl overflow-hidden border border-[#E5E5EA]">
                  <img src={previewSingle} alt="Fond généré" className="w-full object-cover" />
                </div>
                <button onClick={() => onApply(previewSingle)}
                  className="w-full py-2 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary transition-colors">
                  Appliquer comme fond
                </button>
              </div>
            )}
          </>
        )}

        {/* ── Mode multi ── */}
        {mode === 'multi' && (
          <>
            {errorMulti && (
              <p className="text-[10px] text-red-600 bg-red-50 rounded-lg px-2.5 py-2">{errorMulti}</p>
            )}

            {/* Grille 2×2 des aperçus */}
            {Object.keys(progress).length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-[#6E6E73] uppercase tracking-wider mb-1.5">Génération</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {MULTI_FORMATS.map((fmt) => (
                    <div key={fmt.id} className="flex flex-col gap-0.5">
                      <div
                        className="relative rounded-lg overflow-hidden border border-[#E5E5EA] bg-[#F9F9FB]"
                        style={{ aspectRatio: fmt.ratio }}
                      >
                        {previews[fmt.id] ? (
                          <img src={previews[fmt.id]} alt={fmt.label} className="w-full h-full object-cover" />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center">
                            {progress[fmt.id] === 'loading' ? (
                              <span className="w-4 h-4 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
                            ) : progress[fmt.id] === 'error' ? (
                              <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            ) : null}
                          </div>
                        )}
                      </div>
                      <p className="text-[9px] text-[#6E6E73] text-center font-medium">{fmt.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sauvegarde une fois les 4 générés */}
            {allGenerated && onSaveAllFormats && (
              <div className="flex flex-col gap-2">
                <p className="text-[10px] font-semibold text-[#6E6E73] uppercase tracking-wider">Nom du modèle</p>
                <input
                  type="text"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="Ex: Floral Mariage"
                  className="w-full text-xs text-[#1D1D1F] placeholder-[#AEAEB2] bg-[#F9F9FB] border border-[#E5E5EA]
                    rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                />
                <button onClick={handleSaveAll} disabled={!templateName.trim() || savingMulti}
                  className="w-full py-2 bg-green-600 text-white text-xs font-semibold rounded-lg
                    hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors
                    flex items-center justify-center gap-1.5">
                  {savingMulti ? (
                    <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />Sauvegarde…</>
                  ) : (
                    <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                      </svg>Sauvegarder 4 modèles</>
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Bouton générer */}
      <div className="p-3 border-t border-[#E5E5EA] shrink-0">
        <button
          onClick={mode === 'single' ? handleGenerateSingle : handleGenerateMulti}
          disabled={!prompt.trim() || loadingSingle || loadingMulti}
          className="w-full py-2.5 bg-primary text-white text-xs font-semibold rounded-xl
            hover:bg-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors
            flex items-center justify-center gap-2">
          {(loadingSingle || loadingMulti) ? (
            <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0" />
            {mode === 'multi' ? 'Génération en cours (×4)…' : 'Génération en cours…'}</>
          ) : (
            <><svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/>
              </svg>
              {mode === 'multi' ? 'Générer pour 4 formats' : 'Générer'}</>
          )}
        </button>
        <p className="text-[9px] text-[#AEAEB2] text-center mt-1.5">
          {mode === 'multi' ? '4 images en parallèle · ~30s' : 'Replicate · ~10–30s'}
        </p>
      </div>
    </div>
  );
}
