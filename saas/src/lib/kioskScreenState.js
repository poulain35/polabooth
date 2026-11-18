// Valeurs des textes vivants et état des boutons des écrans de la borne, pour l'aperçu (spec
// docs/specs/apercu-borne.md, D5). Module miroir pur : copie exacte des règles de la borne.
//   - partage : kiosk/PolaKiosk/ViewModels/ShareScreenState.cs, entrées lues dans ResultViewModel*.cs (classe partielle) ;
//   - accueil : kiosk/PolaKiosk/ViewModels/HomeViewModel.cs (HomeActionStates, HomeTexts, HomeSlots)
//     et HomeScreen.cs (DisplayName) ;
//   - dates : kiosk/PolaKiosk/Services/EventDateFormatter.cs ;
//   - textes affichés : kiosk/PolaKiosk/Views/DesignedScreen.xaml.cs (DisplayText, visibilité, états).
// Toute modification passe par les cas communs docs/specs/fixtures/kiosk-screen-state-cases.json,
// lus aussi par les tests de la borne. En cas d'écart, la borne fait foi.
import { clamp } from './format.js';

/** États d'un bouton (ScreenActionState) : actif, grisé (voile), masqué. */
export const ACTION_STATE = Object.freeze({ active: 'active', disabled: 'disabled', hidden: 'hidden' });

export const SHARE_ACTIONS = Object.freeze(['print', 'copies_minus', 'copies_plus', 'email', 'qr', 'retake', 'finish']);
export const SHARE_TEXTS = Object.freeze(['copies', 'prints_remaining', 'print_status', 'countdown', 'share_status']);

/** Plafonds du choix des copies (ResultViewModel.UnlimitedMaxCopies / LimitedMaxCopies). */
const UNLIMITED_MAX_COPIES = 10;
const LIMITED_MAX_COPIES = 20;
/** Délai de retour à l'accueil par défaut (ResultConfig.AutoReturnSeconds). */
const DEFAULT_AUTO_RETURN_SECONDS = 30;

/** Textes de la borne pendant le partage (ResultViewModel). */
export const SHARE_STATUS = Object.freeze({
  preparing: 'Préparation de votre photo…',
  offline: "Photo gardée sur la borne : le QR code et l'email seront disponibles au retour du réseau.",
  error: 'Envoi impossible pour le moment : la photo est gardée sur la borne et sera renvoyée automatiquement.',
});

/** Textes de la borne pendant l'impression (ResultViewModel.PrintAsync, ShareScreenState.PrintStatus). */
export const PRINT_TEXTS = Object.freeze({
  printing: 'Impression…',
  noPrints: 'Plus de tirage disponible',
  noticeOne: "C'est parti ! Votre tirage arrive.",
  noticeMany: "C'est parti ! Vos tirages arrivent.",
  errorBusy: 'Une impression est encore en cours. Patientez quelques instants.',
  errorTimeout: "L'imprimante ne répond pas. Vérifiez le papier avant de réessayer.",
  errorOther: 'Impression indisponible. Réessayez ou utilisez le QR code.',
});

// ── Partage (ShareScreenState) ──────────────────────────────────────────────

/**
 * Valeurs par défaut de ShareScreenInputs. Les noms sont ceux du record C#, pour que les cas communs
 * se lisent tels quels des deux côtés.
 */
const SHARE_INPUT_DEFAULTS = Object.freeze({
  ShowPrintBlock: false,
  CanPrint: false,
  IsPrinting: false,
  Copies: 1,
  MaxCopies: UNLIMITED_MAX_COPIES,
  ShowEmailTile: false,
  ShowQrTile: false,
  IsShareReady: false,
  ShowRetake: false,
  ShowFinish: false,
  ShowRemainingPrints: false,
  RemainingPrints: null,
  PrintStatus: '',
  ShowCountdown: false,
  SecondsLeft: 0,
  ShareStatus: '',
});

const withShareDefaults = (s) => ({ ...SHARE_INPUT_DEFAULTS, ...(s ?? {}) });

/** ShareScreenState.Actions : état de chaque bouton de l'écran de partage. */
export function shareActionStates(inputs) {
  const s = withShareDefaults(inputs);
  const printReady = s.CanPrint && !s.IsPrinting;
  const print = (ready) => (!s.ShowPrintBlock ? ACTION_STATE.hidden : ready ? ACTION_STATE.active : ACTION_STATE.disabled);
  const share = (shown) => (!shown ? ACTION_STATE.hidden : s.IsShareReady ? ACTION_STATE.active : ACTION_STATE.disabled);
  return {
    print: print(printReady),
    copies_minus: print(printReady && s.Copies > 1),
    copies_plus: print(printReady && s.Copies < s.MaxCopies),
    email: share(s.ShowEmailTile),
    qr: share(s.ShowQrTile),
    retake: s.ShowRetake ? ACTION_STATE.active : ACTION_STATE.hidden,
    finish: s.ShowFinish ? ACTION_STATE.active : ACTION_STATE.hidden,
  };
}

/** ShareScreenState.Texts : valeur de chaque texte vivant (vide : masqué par l'écran). */
export function shareTexts(inputs) {
  const s = withShareDefaults(inputs);
  const print = s.ShowPrintBlock;
  return {
    copies: print ? String(s.Copies) : '',
    prints_remaining: print && s.ShowRemainingPrints && s.CanPrint ? remainingPrintsText(s.RemainingPrints) : '',
    print_status: print ? s.PrintStatus : '',
    countdown: s.ShowCountdown ? `Retour à l'accueil dans ${s.SecondsLeft} s` : '',
    share_status: (s.ShowEmailTile || s.ShowQrTile) && !s.IsShareReady ? s.ShareStatus : '',
  };
}

/**
 * ShareScreenState.PrintBanner : bandeau d'impression écrit par la borne en haut de l'écran composé
 * quand le plan ne pose pas de texte vivant `print_status`. Vide sinon.
 */
export function printBanner(layoutShowsPrintStatus, inputs) {
  const s = withShareDefaults(inputs);
  return layoutShowsPrintStatus || !s.ShowPrintBlock ? '' : s.PrintStatus;
}

/** ShareScreenState.RemainingText : « encore N tirages possibles », vide sans plafond ou à zéro. */
export function remainingPrintsText(remaining) {
  if (remaining == null || remaining <= 0) return '';
  if (remaining === 1) return 'encore 1 tirage possible';
  return `encore ${remaining} tirages possibles`;
}

/** ShareScreenState.PrintStatus : en cours, sinon l'erreur, sinon la confirmation, sinon plus de tirage. */
export function printStatusText(isPrinting, error, notice, canPrint) {
  if (isPrinting) return PRINT_TEXTS.printing;
  if ((error ?? '').length > 0) return error;
  if ((notice ?? '').length > 0) return notice;
  if (!canPrint) return PRINT_TEXTS.noPrints;
  return '';
}

// ── Écran de partage standard (ResultView.xaml, ResultViewModel) ───────────

/** ResultViewModel.PaperLabel : papier 2x6 pour les bandelettes (PrintService.PaperFormatFromTemplateFormat). */
export function paperLabel(formatId) {
  return formatId === 'stripV' || formatId === 'stripH' ? 'bandelette 5×15' : '10×15';
}

/**
 * Textes de l'écran de partage standard de la borne, à partir des entrées de shareInputsForState :
 * sous-titre, bouton et sous-titre d'impression, « Refaire ». `formatId` : format du modèle photo ;
 * `photoCount` : nombre de photos de la séance (zones du modèle). Erreur et confirmation
 * d'impression : jamais dans l'aperçu.
 */
export function standardShareTexts(inputs, { formatId = 'portrait', photoCount = 1, printError = '', printNotice = '' } = {}) {
  const s = withShareDefaults(inputs);
  const tiles = s.ShowEmailTile || s.ShowQrTile;
  const subtitle = s.ShowPrintBlock
    ? (tiles ? 'Imprimez, envoyez ou récupérez vos photos.' : 'Imprimez votre photo en quelques secondes.')
    : (tiles ? 'Envoyez ou récupérez vos photos.' : 'Votre photo est bien enregistrée.');

  const printButton = s.IsPrinting ? PRINT_TEXTS.printing
    : !s.CanPrint ? PRINT_TEXTS.noPrints
    : s.Copies > 1 ? `Imprimer ${s.Copies} exemplaires` : 'Imprimer 1 exemplaire';

  const tirage = `Tirage ${paperLabel(formatId)}`;
  let printSubtitle;
  if (printError) printSubtitle = printError;
  else if (printNotice) printSubtitle = printNotice;
  else if (!s.CanPrint) printSubtitle = `${tirage} : limite atteinte pour cette photo`;
  else if (s.ShowRemainingPrints && s.RemainingPrints != null) {
    printSubtitle = s.RemainingPrints > 1
      ? `${tirage}, encore ${s.RemainingPrints} tirages possibles`
      : `${tirage}, encore 1 tirage possible`;
  } else printSubtitle = `${tirage}, prêt en quelques secondes`;

  return {
    subtitle,
    printButton,
    printSubtitle,
    retake: Math.max(1, photoCount) > 1 ? 'Refaire les photos' : 'Refaire la photo',
  };
}

// ── États de l'aperçu du partage (D11) ──────────────────────────────────────

/** États proposés dans le sélecteur de l'aperçu. */
export const SHARE_PREVIEW_STATES = Object.freeze([
  Object.freeze({ id: 'idle', label: 'Au repos' }),
  Object.freeze({ id: 'preparing', label: 'Photo en préparation' }),
  Object.freeze({ id: 'printing', label: 'Impression en cours' }),
  Object.freeze({ id: 'no_prints', label: 'Plus de tirage' }),
]);

/**
 * Entrées de l'écran de partage telles que ResultViewModel les calcule, pour un état de l'aperçu.
 * Les réglages sont ceux de l'événement, déjà résolus (bouton activé et fonction ouverte) :
 *   - printEnabled : buttons.print.enabled ;
 *   - remainingPrints : tirages restants (null : sans plafond) ;
 *   - showRemainingPrints, autoReturnSeconds : réglages de `result` (défauts de la borne : true, 30) ;
 *   - emailEnabled : buttons.email.enabled ET envoi par email activé ; qrEnabled : buttons.qr.enabled ;
 *   - retakeEnabled : buttons.retake.enabled (hors galerie) ; finishEnabled : buttons.home.enabled ;
 *   - copies : nombre de copies choisi.
 * « Plus de tirage » : la borne n'y arrive qu'après une impression (_hasPrinted), confirmation effacée,
 * d'où le bloc grisé et non masqué.
 */
export function shareInputsForState(stateId, options = {}) {
  const {
    printEnabled = true,
    remainingPrints: configuredRemaining = null,
    showRemainingPrints = true,
    autoReturnSeconds = DEFAULT_AUTO_RETURN_SECONDS,
    emailEnabled = true,
    qrEnabled = true,
    retakeEnabled = true,
    finishEnabled = true,
    copies: wantedCopies = 1,
  } = options;

  const isPrinting = stateId === 'printing';
  const hasPrinted = stateId === 'no_prints';
  const isShareReady = stateId !== 'preparing';
  const remaining = stateId === 'no_prints' ? 0 : configuredRemaining;

  // RefreshPrintStatusAsync
  const canPrint = remaining == null || remaining > 0;
  const maxCopies = remaining != null ? clamp(remaining, 1, LIMITED_MAX_COPIES) : UNLIMITED_MAX_COPIES;
  const copies = clamp(wantedCopies, 1, maxCopies);

  return {
    ShowPrintBlock: printEnabled && (canPrint || hasPrinted),
    CanPrint: canPrint,
    IsPrinting: isPrinting,
    Copies: copies,
    MaxCopies: maxCopies,
    ShowEmailTile: emailEnabled,
    ShowQrTile: qrEnabled,
    IsShareReady: isShareReady,
    ShowRetake: retakeEnabled,
    ShowFinish: finishEnabled,
    ShowRemainingPrints: showRemainingPrints,
    RemainingPrints: remaining,
    PrintStatus: printStatusText(isPrinting, '', '', canPrint),
    ShowCountdown: autoReturnSeconds > 0,
    SecondsLeft: Math.max(0, autoReturnSeconds),
    ShareStatus: isShareReady ? '' : SHARE_STATUS.preparing,
  };
}

/** Boutons et textes de l'écran de partage pour un état de l'aperçu. */
export function shareScreenForState(stateId, options = {}) {
  const inputs = shareInputsForState(stateId, options);
  return { inputs, actions: shareActionStates(inputs), texts: shareTexts(inputs) };
}

// ── Accueil (HomeViewModel, HomeScreen) ─────────────────────────────────────

/** HomeViewModel.HomeActionStates : « start » toujours actif, « gallery » masqué sans photo. */
export function homeActionStates({ hasPhotos = false } = {}) {
  return {
    start: ACTION_STATE.active,
    gallery: hasPhotos ? ACTION_STATE.active : ACTION_STATE.hidden,
  };
}

/** HomeScreen.DisplayName : home.display_name, sinon le nom de l'événement. */
export function homeDisplayName(displayName, eventName) {
  const name = typeof displayName === 'string' ? displayName.trim() : '';
  return name.length > 0 ? name : String(eventName ?? '').trim();
}

/** HomeViewModel.HomeTexts. */
export function homeTexts({ displayName = null, eventName = '', startDate = null, endDate = null } = {}) {
  return {
    event_name: homeDisplayName(displayName, eventName),
    event_date: formatEventDate(startDate, endDate) ?? '',
  };
}

/** HomeViewModel.HomeSlots : `last_photo` = la dernière photo, sinon le design de l'événement, sinon rien. */
export function homeLastPhoto(lastPhoto, designImage) {
  return lastPhoto ?? designImage ?? null;
}

// ── Dates (EventDateFormatter) ──────────────────────────────────────────────

// Noms fr-FR de .NET, écrits en dur pour ne pas dépendre des données ICU du navigateur.
const FR_DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const FR_MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

const parisParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

function toInstant(value) {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** EventDateFormatter.ParisDay : jour à Paris de l'instant donné (heure d'été comprise). */
function parisDay(value) {
  const instant = toInstant(value);
  if (!instant) return null;
  const parts = Object.fromEntries(parisParts.formatToParts(instant).map((p) => [p.type, p.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

const dayKey = (d) => d.year * 10000 + d.month * 100 + d.day;
const dayText = (d) => (d.day === 1 ? '1er' : String(d.day));
const monthText = (d) => FR_MONTHS[d.month - 1];
const weekdayText = (d) => FR_DAYS[new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay()];
const capitalize = (text) => (text.length === 0 ? text : text[0].toLocaleUpperCase('fr-FR') + text.slice(1));

/**
 * EventDateFormatter.Format : « Samedi 14 juin 2026 », « Du 14 au 15 juin 2026 »,
 * « Du 30 juin au 2 juillet 2026 », « Du 31 décembre 2026 au 1er janvier 2027 ».
 * null sans date de début (ou date illisible).
 */
export function formatEventDate(start, end = null) {
  const first = parisDay(start);
  if (!first) return null;
  const endDay = parisDay(end);
  // Fin absente ou pas après le début : un seul jour.
  const last = endDay && dayKey(endDay) > dayKey(first) ? endDay : first;

  if (dayKey(last) === dayKey(first)) {
    return capitalize(`${weekdayText(first)} ${dayText(first)} ${monthText(first)} ${first.year}`);
  }
  if (first.year !== last.year) {
    return `Du ${dayText(first)} ${monthText(first)} ${first.year} au ${dayText(last)} ${monthText(last)} ${last.year}`;
  }
  if (first.month !== last.month) {
    return `Du ${dayText(first)} ${monthText(first)} au ${dayText(last)} ${monthText(last)} ${last.year}`;
  }
  return `Du ${dayText(first)} au ${dayText(last)} ${monthText(last)} ${last.year}`;
}

/** EventDateFormatter.FormatShort : « 14 · 06 · 2026 », ou null sans date de début. */
export function formatEventDateShort(start) {
  const d = parisDay(start);
  if (!d) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.day)} · ${pad(d.month)} · ${d.year}`;
}

// ── Textes et boutons des écrans composés (DesignedScreen) ──────────────────

const isBlank = (value) => typeof value !== 'string' || value.trim().length === 0;

/** Arrondi « loin de zéro » (MidpointRounding.AwayFromZero de .NET). */
const roundHalfAwayFromZero = (x) => Math.sign(x) * Math.round(Math.abs(x));

/** Espace fine (U+2009) posée entre les lettres pour l'espacement du dessin. */
const LETTER_SPACER = '\u2009';

/**
 * DesignedScreen : un texte vivant s'affiche s'il n'est pas vide et, en mode neutre, s'il n'est pas
 * réservé à l'accueil personnalisé (`personalized_only`).
 */
export function isTextVisible(value, spec, personalized) {
  return !isBlank(value) && (personalized || spec?.personalized_only !== true);
}

/**
 * DesignedScreen.DisplayText : texte tel qu'affiché. Majuscules du dessin, puis espacement des
 * lettres : `char_spacing` en millièmes de cadratin (Fabric), une espace fine vaut environ 1/5 de
 * cadratin, soit round(char_spacing / 200) espaces fines entre deux caractères.
 */
export function displayText(value, spec = {}) {
  let text = String(value ?? '').trim();
  if (spec.uppercase === true) text = text.toLocaleUpperCase('fr-FR');
  const charSpacing = Number.isFinite(spec.char_spacing) ? spec.char_spacing : 0;
  const spaces = roundHalfAwayFromZero(charSpacing / 200);
  return spaces > 0 ? Array.from(text).join(LETTER_SPACER.repeat(spaces)) : text;
}

/** DesignedScreen.ApplyStates : un bouton sans état connu est actif. */
export function actionStateOf(states, action) {
  const state = states?.[action];
  return state === ACTION_STATE.disabled || state === ACTION_STATE.hidden ? state : ACTION_STATE.active;
}
