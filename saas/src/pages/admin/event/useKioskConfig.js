// Réglages de la borne de l'événement (form_config.kiosk) et habillage (form_config.branding) :
// état, valeurs par défaut au chargement et enregistrement, déplacés tels quels d'AdminEventDetail.jsx
// (LAB-337). Partagés par les onglets Résumé (options générales), Création du client (choix du cadre)
// et Réglages de la borne : un seul brouillon, un seul enregistrement.
import { useState } from 'react';
import { saveKioskConfig, uploadKioskBackground } from '../../../lib/supabase';
import { toast } from 'sonner';
import { buildDefaultCapture, buildDefaultHome, buildDefaultResultButtons, cleanKioskFormats, validateKioskFormats, withCaptureDefaults, withHomeDefaults, withResultButtonsDefaults } from '../../../lib/kioskFormats';
import { buildDefaultQuestionnaire, withQuestionnaireDefaults, cleanQuestionnaire, validateKioskQuestionnaire } from '../../../lib/kioskQuestionnaire';
import { brandingDraftFrom, brandingErrors, normalizeColor } from '../../../lib/eventBrandingAdmin';

function buildDefaultKiosk(companyName) {
  return {
    home:    buildDefaultHome(),
    capture: buildDefaultCapture(),
    effects: { user_can_choose: false, enabled_effects: ['none'], default_effect: 'none' },
    rgpd:    {
      enabled: false,
      message: "En participant à cet événement, vous acceptez que vos photos puissent être utilisées à des fins de communication par l'organisateur.",
    },
    result:  {
      auto_print: false, max_prints_per_event: 400,
      max_prints_per_photo: 2, show_remaining_prints: true,
      auto_return_seconds: 30,
      share: { qr: true },
      buttons: buildDefaultResultButtons(),
    },
    email: {
      enabled: false,
      sender_name:  companyName,
      sender_email: '',
      subject:      'Vos photos — {event_name}',
      message:      `Bonjour,\n\nRetrouvez votre photo en cliquant sur le lien ci-dessous.\n\nBonne fête !\n${companyName}`,
    },
    printer: { default_printer: '', paper_format: '4x6' },
    questionnaire: buildDefaultQuestionnaire(),
  };
}

/**
 * `showSection(section)` : ouvre la section des Réglages de la borne où se trouve l'erreur
 * (`accueil`, `capture`, `questionnaire`, `partage`).
 */
export function useKioskConfig({ event, setEvent, companyName, isAvailable, showSection }) {
  // Kiosk config
  const [kioskCfg,    setKioskCfgState] = useState(null);
  const [kioskSaving, setKioskSaving]   = useState(false);
  const [bgUploading, setBgUploading] = useState(false);
  // Habillage de l'événement (form_config.branding, LAB-302) : couleur, logo, texte de la galerie.
  const [branding, setBranding] = useState(null);

  /** Réglages de la borne au chargement de l'événement, complétés par les valeurs par défaut. */
  function resetKiosk(ev) {
    // Couleurs de la borne fixes (LAB-250) : un ancien form_config.kiosk.theme est effacé à l'enregistrement.
    const { theme: _theme, ...raw } = ev.form_config?.kiosk ?? {};
    const DEF  = buildDefaultKiosk(companyName);
    setKioskCfgState({
      ...DEF,
      ...raw,
      capture: withCaptureDefaults(raw.capture),
      effects: { ...DEF.effects, ...(raw.effects ?? {}) },
      rgpd:    { ...DEF.rgpd,    ...(raw.rgpd    ?? {}) },
      result:  {
        ...DEF.result, ...(raw.result ?? {}),
        share:   { ...DEF.result.share,   ...(raw.result?.share   ?? {}) },
        buttons: withResultButtonsDefaults(raw.result?.buttons),
      },
      email:   { ...DEF.email,   ...(raw.email   ?? {}) },
      home:    withHomeDefaults(raw.home),
      questionnaire: withQuestionnaireDefaults(raw.questionnaire),
    });
    setBranding(brandingDraftFrom(ev.form_config));
  }

  function setKiosk(path, value) {
    setKioskCfgState(prev => {
      const next = structuredClone(prev);
      const keys = path.split('.');
      let cur = next;
      for (let i = 0; i < keys.length - 1; i++) { cur[keys[i]] ??= {}; cur = cur[keys[i]]; }
      cur[keys[keys.length - 1]] = value;
      return next;
    });
  }

  async function handleKioskSave() {
    // Questionnaire désactivé : section masquée, sa config n'est ni affichée ni bloquante.
    const questionnaireErrors = isAvailable('guest_form') ? validateKioskQuestionnaire(kioskCfg.questionnaire) : [];
    if (questionnaireErrors.length) {
      toast.error(`Questionnaire : ${questionnaireErrors[0].message}`);
      showSection('questionnaire');
      return;
    }
    const formatErrors = validateKioskFormats(kioskCfg);
    if (formatErrors.length) {
      toast.error(formatErrors[0].message);
      showSection(formatErrors[0].tab);
      return;
    }
    const brandingProblems = brandingErrors(branding, { emailEnabled: kioskCfg.email?.enabled === true, email: kioskCfg.email });
    if (brandingProblems.length) {
      toast.error(brandingProblems[0]);
      showSection('partage');
      return;
    }
    setKioskSaving(true);
    try {
      const questionnaire = cleanQuestionnaire(kioskCfg.questionnaire);
      const cleaned = { ...cleanKioskFormats(kioskCfg), questionnaire };
      const updated = await saveKioskConfig(event.id, cleaned, {
        color: normalizeColor(branding.color), gallery_text: branding.gallery_text,
      });
      setEvent(e => ({ ...e, form_config: updated }));
      setBranding(brandingDraftFrom(updated));
      setKioskCfgState(c => ({
        ...c, questionnaire, home: cleaned.home, capture: cleaned.capture, result: cleaned.result,
        ...(cleaned.frame_choice ? { frame_choice: cleaned.frame_choice } : {}),
      }));
      toast.success('Configuration enregistrée');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setKioskSaving(false);
    }
  }

  async function handleBgUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBgUploading(true);
    try {
      const url = await uploadKioskBackground(event.id, file);
      setKiosk('home.background_url', url);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBgUploading(false);
      e.target.value = '';
    }
  }

  return {
    kioskCfg, kioskSaving, bgUploading, branding, setBranding,
    resetKiosk, setKiosk, handleKioskSave, handleBgUpload,
  };
}
