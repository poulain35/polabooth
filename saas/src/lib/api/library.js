// Bibliothèque de l'éditeur : modèles (admin), décorations et polices personnalisées.
import { readJson } from '../httpErrors.js';
import { importedFileName } from '../googleFonts.js';
import { supabase } from './client.js';
import { fetchFunction } from './functions.js';

// ── Templates (admin) ────────────────────────────────────────────────────────

export async function fetchAllTags() {
  const { data } = await supabase.from('templates').select('tags');
  return [...new Set((data ?? []).flatMap((t) => t.tags ?? []))].sort();
}

// Cache module-level pour les métadonnées (sans canvas_json)
let _templatesMeta = null;
let _templatesMetaPromise = null;
const _templateByIdCache = {};

/** Fetch léger (sans canvas_json) + cache en mémoire pour la sidebar. */
export async function fetchDbTemplatesMeta() {
  if (_templatesMeta) return _templatesMeta;
  if (_templatesMetaPromise) return _templatesMetaPromise;
  _templatesMetaPromise = supabase
    .from('templates')
    .select('id, name, format_id, preview_url, tags, sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })
    .then(({ data, error }) => {
      _templatesMetaPromise = null;
      if (error) throw error;
      _templatesMeta = data ?? [];
      return _templatesMeta;
    });
  return _templatesMetaPromise;
}

/** Fetch un template complet (avec canvas_json) par ID, avec cache. */
export async function fetchDbTemplateById(id) {
  if (_templateByIdCache[id]) return _templateByIdCache[id];
  const { data, error } = await supabase
    .from('templates')
    .select('id, name, format_id, canvas_json, preview_url, tags')
    .eq('id', id)
    .single();
  if (error) throw error;
  _templateByIdCache[id] = data;
  return data;
}

/** Invalide le cache (à appeler après save/delete en admin). */
export function invalidateTemplatesCache() {
  _templatesMeta = null;
  _templatesMetaPromise = null;
  Object.keys(_templateByIdCache).forEach((k) => delete _templateByIdCache[k]);
}

export async function saveDbTemplate({ name, format_id, canvas_json, preview_url, tags = [], is_active = true }) {
  const { data, error } = await supabase
    .from('templates')
    .insert({ name, format_id, canvas_json, preview_url, tags, is_active })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function uploadTemplateBackground(path, blob) {
  const { data, error } = await supabase.storage
    .from('template-backgrounds')
    .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
  if (error) throw error;
  const { data: { publicUrl } } = supabase.storage
    .from('template-backgrounds')
    .getPublicUrl(data.path);
  return publicUrl;
}

export async function activateTemplate(id) {
  const { error } = await supabase.from('templates').update({ is_active: true }).eq('id', id);
  if (error) throw error;
}

export async function fetchDraftTemplates() {
  const { data, error } = await supabase
    .from('templates')
    .select('*')
    .eq('is_active', false)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function deleteDbTemplate(id) {
  const { error } = await supabase.from('templates').delete().eq('id', id);
  if (error) throw error;
}

export async function updateDbTemplate(id, updates) {
  const { data, error } = await supabase
    .from('templates')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── Décorations / Stickers ────────────────────────────────────────────────────

let _decorations = null;
let _decorationsPromise = null;

export async function fetchDecorations() {
  if (_decorations) return _decorations;
  if (_decorationsPromise) return _decorationsPromise;
  _decorationsPromise = supabase
    .from('decorations')
    .select('id, name, url, category, thumbnail_url, storage_path')
    .order('created_at', { ascending: false })
    .then(({ data, error }) => {
      _decorationsPromise = null;
      if (error) throw error;
      _decorations = data ?? [];
      return _decorations;
    });
  return _decorationsPromise;
}

function invalidateDecorationsCache() {
  _decorations = null;
  _decorationsPromise = null;
}

export async function uploadDecoration(file, category = 'Mes stickers', name = '', thumbnailBlob = null) {
  const ext  = file.name.split('.').pop().toLowerCase();
  const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const contentType = ext === 'svg' ? 'image/svg+xml' : file.type;

  const { data: stored, error: storageErr } = await supabase.storage
    .from('decorations')
    .upload(path, file, { contentType, upsert: false });
  if (storageErr) throw storageErr;

  const { data: { publicUrl } } = supabase.storage
    .from('decorations')
    .getPublicUrl(stored.path);

  const label = name.trim() || file.name.replace(/\.[^.]+$/, '');

  // Upload thumbnail si fourni
  let thumbnailUrl = null;
  if (thumbnailBlob) {
    const thumbPath = `thumbnails/${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
    const { data: thumbStored, error: thumbErr } = await supabase.storage
      .from('decorations')
      .upload(thumbPath, thumbnailBlob, { contentType: 'image/png', upsert: false });
    if (!thumbErr) {
      const { data: { publicUrl: tUrl } } = supabase.storage
        .from('decorations')
        .getPublicUrl(thumbStored.path);
      thumbnailUrl = tUrl;
    }
  }

  const { data: record, error: dbErr } = await supabase
    .from('decorations')
    .insert({ name: label, url: publicUrl, storage_path: stored.path, category, thumbnail_url: thumbnailUrl })
    .select()
    .single();
  if (dbErr) throw dbErr;
  invalidateDecorationsCache();
  return record;
}

export async function deleteDecoration(id, storagePath) {
  await supabase.storage.from('decorations').remove([storagePath]);
  const { error } = await supabase.from('decorations').delete().eq('id', id);
  if (error) throw error;
  invalidateDecorationsCache();
}

// ── Polices personnalisées ────────────────────────────────────────────────────

let _customFonts = null;
let _customFontsPromise = null;

export async function fetchCustomFonts() {
  if (_customFonts) return _customFonts;
  if (_customFontsPromise) return _customFontsPromise;
  _customFontsPromise = supabase
    .from('custom_fonts')
    .select('id, name, url, storage_path, created_at')
    .order('created_at', { ascending: true })
    .then(({ data, error }) => {
      _customFontsPromise = null;
      if (error) throw error;
      _customFonts = data ?? [];
      return _customFonts;
    });
  return _customFontsPromise;
}

function invalidateCustomFontsCache() {
  _customFonts = null;
  _customFontsPromise = null;
}

// Familles déjà déclarées au navigateur (polices importées) : on ne les redéclare pas.
const _registeredFonts = new Set();

/**
 * Déclare les polices importées au navigateur sans les télécharger (LAB-347) : le fichier d'une
 * police n'est récupéré que lorsqu'elle sert (texte affiché dans cette police, ou
 * `document.fonts.load`). Avec 200 polices importées, l'éditeur n'attend que celles du modèle.
 * Renvoie la liste des polices importées.
 */
export async function registerCustomFonts() {
  const fonts = await fetchCustomFonts();
  if (typeof document === 'undefined' || !document.fonts || typeof FontFace === 'undefined') return fonts;
  const declared = new Set([...document.fonts].map((f) => f.family.replace(/^["']|["']$/g, '')));
  for (const font of fonts) {
    if (_registeredFonts.has(font.name) || declared.has(font.name)) continue;
    try {
      document.fonts.add(new FontFace(font.name, `url(${font.url})`));
      _registeredFonts.add(font.name);
    } catch (_) {}
  }
  return fonts;
}

export async function uploadCustomFont(file, name) {
  const ext = file.name.split('.').pop().toLowerCase();
  const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const contentType =
    ext === 'woff2' ? 'font/woff2' :
    ext === 'woff'  ? 'font/woff'  :
    ext === 'ttf'   ? 'font/ttf'   :
    ext === 'otf'   ? 'font/otf'   : 'application/octet-stream';

  const { data: stored, error: storageErr } = await supabase.storage
    .from('fonts')
    .upload(path, file, { contentType, upsert: false });
  if (storageErr) throw storageErr;

  const { data: { publicUrl } } = supabase.storage.from('fonts').getPublicUrl(stored.path);

  const { data: record, error: dbErr } = await supabase
    .from('custom_fonts')
    .insert({ name: name.trim(), url: publicUrl, storage_path: stored.path })
    .select()
    .single();
  if (dbErr) throw dbErr;

  invalidateCustomFontsCache();
  return record;
}

/**
 * Fichier TTF ou OTF d'une police Google à cette graisse, par la fonction google-font-file (admin).
 * fetchFunction : la réponse est le fichier lui-même (pas du JSON), lue par l'appelant ; partagé
 * avec la publication des écrans de la borne (fetchScreenFonts).
 */
export function fetchGoogleFontFile(family, weight) {
  return fetchFunction('google-font-file', { admin: true, json: { family, weight } });
}

/**
 * Ajoute une police Google aux polices perso (onglet Polices de la Bibliothèque) : fichier TTF de
 * cette graisse par la fonction google-font-file (le navigateur n'obtient que du WOFF2, que la
 * borne ne lit pas), puis envoi comme une police importée à la main, sous le nom `name`.
 */
export async function importGoogleFont({ family, weight, name }) {
  const res = await fetchGoogleFontFile(family, weight);
  if (!res.ok) {
    const data = await readJson(res);
    throw new Error(data?.error || 'Impossible de récupérer la police chez Google.');
  }
  const contentType = res.headers.get('Content-Type') || 'font/ttf';
  const blob = await res.blob();
  if (blob.size === 0) throw new Error('Fichier de police vide.');
  const file = new File([blob], importedFileName(name, contentType), { type: contentType });
  return uploadCustomFont(file, name);
}

export async function deleteCustomFont(id, storagePath) {
  await supabase.storage.from('fonts').remove([storagePath]);
  const { error } = await supabase.from('custom_fonts').delete().eq('id', id);
  if (error) throw error;
  invalidateCustomFontsCache();
}
