import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Pencil, X } from 'lucide-react';
import Editor from '../../components/Editor';
import { useFeatures } from '../../hooks/useFeatures';
import { saveDbTemplate, updateDbTemplate, fetchAllTags, invalidateTemplatesCache, supabase, getFormatBleed, storeTemplatePreview } from '../../lib/supabase';
import { FORMATS } from '../../utils/formats';
import { Input } from '../../components/ui/input';
import { toast } from 'sonner';
import { BackLink } from '../../components/admin/AdminPage';
import { Spinner } from '../../components/ui/spinner';

async function generateDefaultName() {
  const { data } = await supabase
    .from('templates')
    .select('name')
    .ilike('name', 'Cadre photo sans titre%');
  const names = new Set((data ?? []).map((t) => t.name));
  if (!names.has('Cadre photo sans titre')) return 'Cadre photo sans titre';
  let i = 1;
  while (names.has(`Cadre photo sans titre (${i})`)) i++;
  return `Cadre photo sans titre (${i})`;
}

export default function AdminTemplateEditor() {
  const { id }   = useParams();
  const navigate = useNavigate();
  const isEdit   = Boolean(id);
  const { isAvailable } = useFeatures();

  const [loading,              setLoading]              = useState(true);
  const [formatBleedOverrides, setFormatBleedOverrides] = useState({});
  const [existingTpl,          setExistingTpl]          = useState(null);
  const [templateName, setTemplateName] = useState('');
  const [editingName,  setEditingName]  = useState(false);
  const [nameInput,    setNameInput]    = useState('');
  const [saving,       setSaving]       = useState(false);
  const [tags,            setTags]            = useState([]);
  const [tagInput,        setTagInput]        = useState('');
  const [allTags,         setAllTags]         = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const nameInputRef   = useRef(null);
  const tagInputRef    = useRef(null);
  const currentNameRef = useRef('');
  const currentTagsRef = useRef([]);

  useEffect(() => {
    if (isEdit) {
      supabase.from('templates').select('*').eq('id', id).single()
        .then(({ data, error }) => {
          if (error || !data) { navigate('/admin/templates'); return; }
          setExistingTpl(data);
          setTemplateName(data.name);
          currentNameRef.current = data.name;
          const loadedTags = data.tags ?? [];
          setTags(loadedTags);
          currentTagsRef.current = loadedTags;
          setLoading(false);
        });
    } else {
      generateDefaultName().then((name) => {
        setTemplateName(name);
        currentNameRef.current = name;
        setLoading(false);
      });
    }
  }, [id, isEdit, navigate]);

  useEffect(() => {
    fetchAllTags().then(setAllTags).catch(() => {});
    getFormatBleed().then(setFormatBleedOverrides).catch(() => {});
  }, []);

  useEffect(() => {
    if (editingName) nameInputRef.current?.select();
  }, [editingName]);

  function startEditName() {
    setNameInput(templateName);
    setEditingName(true);
  }

  function commitName() {
    const trimmed = nameInput.trim();
    if (trimmed) {
      setTemplateName(trimmed);
      currentNameRef.current = trimmed; // synchrone — disponible immédiatement pour handleSaveTemplate
    }
    setEditingName(false);
  }

  function addTag(raw) {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, '-');
    if (!tag || currentTagsRef.current.includes(tag)) return;
    const next = [...currentTagsRef.current, tag];
    currentTagsRef.current = next;
    setTags(next);
  }

  function removeTag(tag) {
    const next = currentTagsRef.current.filter((t) => t !== tag);
    currentTagsRef.current = next;
    setTags(next);
  }

  function handleTagKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(tagInput);
      setTagInput('');
    } else if (e.key === 'Backspace' && tagInput === '' && currentTagsRef.current.length > 0) {
      removeTag(currentTagsRef.current[currentTagsRef.current.length - 1]);
    }
  }

  async function handleSaveTemplate({ canvasJson, previewUrl, formatId }) {
    setSaving(true);
    const name = currentNameRef.current || templateName;
    const currentTags = currentTagsRef.current;
    try {
      // LAB-356 : l'aperçu est rangé dans le stockage, preview_url ne garde que son adresse https.
      // Envoi impossible : le cadre photo est enregistré sans nouvel aperçu (jamais d'image intégrée).
      let storedPreview = null;
      let previewFailed = false;
      if (previewUrl) {
        try {
          storedPreview = await storeTemplatePreview(previewUrl);
        } catch (err) {
          console.warn('Aperçu du cadre photo non enregistré :', err?.message ?? err);
          previewFailed = true;
        }
      }
      if (isEdit) {
        const updates = { name, canvas_json: canvasJson, format_id: formatId, tags: currentTags };
        if (storedPreview) updates.preview_url = storedPreview;
        await updateDbTemplate(id, updates);
      } else {
        await saveDbTemplate({
          name,
          format_id: formatId,
          canvas_json: canvasJson,
          preview_url: storedPreview,
          tags: currentTags,
        });
      }
      invalidateTemplatesCache();
      if (previewFailed) toast.warning('Cadre photo sauvegardé, mais son aperçu n’a pas pu être enregistré. Réessayez plus tard.');
      else toast.success('Cadre photo sauvegardé');
    } catch (err) {
      toast.error(err.message ?? 'Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="light-island min-h-screen flex items-center justify-center bg-background">
        <Spinner />
      </div>
    );
  }

  const initialTemplate = isEdit && existingTpl
    ? { id: existingTpl.id, name: existingTpl.name, canvas_json: existingTpl.canvas_json }
    : null;
  const initialFormat = isEdit && existingTpl
    ? (FORMATS[existingTpl.format_id] ?? FORMATS.portrait)
    : null;

  return (
    <div className="light-island flex flex-col h-full bg-background text-foreground">
      {/* ── Top bar ── */}
      <div className="flex items-center gap-2 sm:gap-3 flex-wrap px-3 sm:px-4 py-2.5 bg-card border-b border-border shrink-0 min-h-[52px]">

        {/* Back */}
        <BackLink to="/admin/templates" className="shrink-0">Cadres photo</BackLink>

        <span className="text-border shrink-0">/</span>

        {/* Inline name editor */}
        {editingName ? (
          <Input
            ref={nameInputRef}
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName();
              if (e.key === 'Escape') setEditingName(false);
            }}
            className="h-8 text-sm font-medium min-w-0 w-full max-w-[14rem]"
          />
        ) : (
          <button
            onClick={startEditName}
            className="flex items-center gap-1.5 group min-w-0 px-2 py-1 rounded-control hover:bg-muted transition-colors"
            title="Renommer le cadre photo"
          >
            <span className="text-foreground text-sm font-medium truncate max-w-[240px]">
              {templateName}
            </span>
            <Pencil className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
          </button>
        )}

        {/* Tags */}
        <div className="relative hidden sm:flex items-center gap-1.5 flex-wrap ml-2 shrink min-w-0">
          <span className="text-[11px] font-medium text-muted-foreground shrink-0">Tags</span>
          {tags.map((tag) => (
            <span key={tag} className="flex items-center gap-1 px-2 py-0.5 bg-primary-soft text-primary-ink text-[11px] font-medium rounded-full">
              {tag}
              <button onMouseDown={(e) => { e.preventDefault(); removeTag(tag); }} aria-label={`Retirer le tag ${tag}`} className="text-primary-ink hover:text-foreground leading-none">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <input
            ref={tagInputRef}
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleTagKeyDown}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => {
              setTimeout(() => setShowSuggestions(false), 150);
              if (tagInput.trim()) { addTag(tagInput); setTagInput(''); }
            }}
            placeholder="+ ajouter"
            className="text-[11px] text-muted-foreground placeholder:text-muted-foreground/60 bg-transparent outline-none w-20 min-w-0"
          />
          {/* Suggestions dropdown */}
          {showSuggestions && (() => {
            const suggestions = allTags
              .filter((t) => !currentTagsRef.current.includes(t))
              .filter((t) => !tagInput || t.includes(tagInput.toLowerCase()));
            return suggestions.length > 0 ? (
              <div className="absolute top-full left-0 mt-1.5 bg-popover border border-border rounded-control shadow-float p-1 z-50 min-w-[160px]">
                {suggestions.map((tag) => (
                  <button
                    key={tag}
                    onMouseDown={(e) => { e.preventDefault(); addTag(tag); setTagInput(''); }}
                    className="w-full text-left px-2 py-1.5 text-xs text-foreground rounded-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            ) : null;
          })()}
        </div>

        {/* Saving spinner */}
        {saving && (
          <Spinner className="ml-1 w-4 h-4 border-border border-t-primary shrink-0" />
        )}
      </div>

      {/* ── Editor ── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <Editor
          key={id ?? 'new'}
          initialFormat={initialFormat}
          initialTemplate={initialTemplate}
          onSaveTemplate={handleSaveTemplate}
          formatBleedOverrides={formatBleedOverrides}
          aiVisuals={isAvailable('ai_visuals')}
        />
      </div>
    </div>
  );
}
