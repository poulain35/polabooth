/**
 * Affichage du bilan client (LAB-236, spec LAB-209 SAAS-3) à partir d'un payload : celui de
 * get_event_report (page publique /rapport/:token) ou `report` de build_event_report (aperçu dans
 * l'admin, LAB-238). Aucun chargement ici. Palette F « noyer & sauge » ; feuille d'impression A4
 * (2 pages au plus, cartes jamais coupées, URL des boutons écrites en clair).
 */
import { useEffect } from 'react';
import { buildReportView, UNAVAILABLE_MESSAGE } from '../../lib/eventReport.js';
import { ensurePolaFonts } from '../public/polaHead.js';
import { ORG, POLA_F_FONTS_HREF } from '../public/polaStyles.js';
import { BRAND, siteLabel } from '../../lib/instanceBrand.js';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pf-noyer focus-visible:ring-offset-2 focus-visible:ring-offset-pf-bg';
const BTN_PRIMARY = `inline-flex items-center justify-center rounded-full bg-pf-noyer text-white text-[17px] font-medium leading-tight px-7 py-4 hover:bg-pf-noyer-h transition-colors ${FOCUS}`;
const BTN_SECONDARY = `inline-flex items-center justify-center rounded-full border-2 border-pf-noyer text-pf-noyer text-base font-medium leading-tight px-6 py-3 hover:bg-pf-noyer hover:text-white transition-colors ${FOCUS}`;
const H2 = 'font-pf-serif font-normal text-[26px] md:text-[32px] leading-tight text-pf-text print:text-[21px]';
const CARD = 'rounded-pola bg-pf-surface px-6 py-5 print:bg-white print:border print:border-pf-line print:rounded-2xl print:px-4 print:py-3';
const DAY_GRID = { 2: 'md:grid-cols-2 print:grid-cols-2', 3: 'md:grid-cols-3 print:grid-cols-3' };

// @page ne peut pas être limité à une page de l'application : la règle n'existe que tant que le bilan est affiché.
export const REPORT_PRINT_CSS = `@media print {
  @page { size: A4 portrait; margin: 12mm 13mm; }
  html, body { background: #fff !important; }
  .pola-report .print-exact { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}`;

const SITE_LABEL = siteLabel(ORG.site);

/** Bouton à l'écran ; à l'impression, son libellé suivi de l'URL en clair. */
function ActionLink({ href, primary = false, children }) {
  return (
    <>
      <a href={href} target="_blank" rel="noopener noreferrer" className={`${primary ? BTN_PRIMARY : BTN_SECONDARY} print:hidden`}>
        {children}
      </a>
      <p className="hidden print:block text-[13px] leading-snug">
        <span className="font-medium">{children} : </span><span className="break-all">{href}</span>
      </p>
    </>
  );
}

/** Fond et typographie communs (bilan, chargement, bilan indisponible). */
export function ReportShell({ children }) {
  useEffect(() => { ensurePolaFonts(POLA_F_FONTS_HREF); }, []);
  return (
    <div className="pola-report min-h-screen bg-pf-bg text-pf-text font-pola antialiased print:min-h-0 print:bg-white">
      <style>{REPORT_PRINT_CSS}</style>
      <main className="max-w-[720px] mx-auto px-4 sm:px-6 py-8 md:py-14 print:max-w-none print:p-0">{children}</main>
    </div>
  );
}

/** Même page quelle que soit la cause (jeton inconnu, révoqué, expiré) : rien n'est révélé. */
export function ReportUnavailable() {
  return (
    <ReportShell>
      <h1 className="mt-10 font-pf-serif font-normal text-[34px] md:text-[44px] leading-tight">{UNAVAILABLE_MESSAGE}</h1>
      {ORG.site && (
        <p className="mt-6 text-base text-pf-muted">
          <a href={ORG.site} className={`underline underline-offset-4 decoration-pf-noyer/50 hover:decoration-pf-noyer rounded-sm ${FOCUS}`}>{SITE_LABEL}</a>
        </p>
      )}
    </ReportShell>
  );
}

function Hours({ hours }) {
  const multi = hours.days.length > 1;
  return (
    <section aria-labelledby="report-hours" className="mt-10 break-inside-avoid print:mt-6">
      <h2 id="report-hours" className={H2}>
        {multi ? 'Les moments les plus animés' : `Le moment le plus animé : ${hours.days[0].peak}`}
      </h2>
      <div className={`mt-4 grid grid-cols-1 gap-6 print:gap-4 ${DAY_GRID[hours.days.length] ?? ''}`}>
        {hours.days.map((d) => (
          <div key={d.day} className="break-inside-avoid">
            {multi && (
              <>
                <p className="font-medium text-pf-text">{d.dayLabel}</p>
                <p className="text-sm text-pf-muted">Le plus animé : <span className="whitespace-nowrap">{d.peak}</span></p>
              </>
            )}
            <ul className="mt-2 space-y-1 print:space-y-0.5">
              {d.rows.map((r) => (
                <li key={r.hour} className="grid grid-cols-[2.75rem_1fr_2.5rem] items-center gap-2 text-sm tabular-nums print:text-[12px]">
                  <span className="text-pf-muted">{r.label}</span>
                  <span className="print-exact h-3 rounded-full bg-pf-surface overflow-hidden print:h-2.5">
                    <span className="print-exact block h-full rounded-full bg-pf-sage" style={{ width: `${r.sessions ? Math.max(r.ratio * 100, 2) : 0}%` }} />
                  </span>
                  <span className="text-right">{r.sessions}<span className="sr-only"> {r.sessions > 1 ? 'séances' : 'séance'}</span></span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {hours.note && <p className="mt-3 text-sm text-pf-muted">{hours.note}</p>}
    </section>
  );
}

function Photos({ photos, galleryUrl }) {
  return (
    <section aria-labelledby="report-photos" className="mt-10 break-inside-avoid print:mt-6">
      <h2 id="report-photos" className={H2}>{photos.length ? 'Quelques photos de l’événement' : 'La galerie en ligne'}</h2>
      {photos.length > 0 && (
        <ul className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2 print:grid-cols-3">
          {photos.map((p, i) => (
            <li key={p.id} className="break-inside-avoid">
              <img src={p.src} alt={`Photo ${i + 1} de l’événement`} className="w-full aspect-[4/3] object-cover rounded-2xl bg-pf-surface print:rounded-lg" />
            </li>
          ))}
        </ul>
      )}
      {galleryUrl && <div className="mt-4"><ActionLink href={galleryUrl}>Voir toute la galerie</ActionLink></div>}
    </section>
  );
}

/** Le bilan lui-même. `report` : payload de get_event_report ; `appUrl` : base des liens de galerie. */
export default function EventReportView({ report, appUrl = '', site = ORG.site }) {
  const view = buildReportView(report, { appUrl, site });
  if (!view) return null;
  return (
    <ReportShell>
      <header className="break-inside-avoid">
        <p className="text-[13px] uppercase tracking-[0.22em] font-medium text-pf-noyer">{view.company}</p>
        <h1 className="mt-3 font-pf-serif font-normal text-[38px] md:text-[52px] leading-[1.05] text-pf-text print:text-[32px]">{view.title}</h1>
        {view.date && <p className="mt-3 text-lg print:text-base">{view.date}</p>}
        {view.frozen && <p className="mt-1 text-base text-pf-muted print:text-sm">{view.frozen}</p>}
      </header>

      {/* Chiffres */}
      {view.figures.length > 0 && (
        <section aria-label="Les chiffres de l’événement" className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3 print:mt-5 print:grid-cols-3 print:gap-2">
          {view.figures.map((f) => (
            <div key={f.key} className={`break-inside-avoid flex items-baseline gap-3 sm:block ${CARD}`}>
              <p className="font-pf-serif text-[34px] sm:text-[44px] leading-none text-pf-noyer tabular-nums print:text-[30px]">{f.value}</p>
              <p className="sm:mt-2 text-base leading-snug print:text-[13px]">{f.label}</p>
            </div>
          ))}
        </section>
      )}

      {view.hours && <Hours hours={view.hours} />}

      {(view.photos.length > 0 || view.galleryUrl) && <Photos photos={view.photos} galleryUrl={view.galleryUrl} />}

      {/* Livre d'or audio */}
      {view.audio && (
        <section aria-labelledby="report-audio" className={`mt-10 break-inside-avoid print:mt-6 ${CARD}`}>
          <h2 id="report-audio" className={H2}>Livre d’or audio</h2>
          <p className="mt-1 text-lg print:text-base">{view.audio.text}</p>
          {view.audio.url && <div className="mt-4 print:mt-2"><ActionLink href={view.audio.url}>Écouter les messages</ActionLink></div>}
        </section>
      )}

      {/* Questionnaire de la borne (nombres seulement) */}
      {view.questionnaire && (
        <section aria-labelledby="report-questionnaire" className={`mt-6 break-inside-avoid print:mt-4 ${CARD}`}>
          <h2 id="report-questionnaire" className={H2}>Questionnaire de la borne</h2>
          <p className="mt-1 text-lg print:text-base">{view.questionnaire.text}</p>
          <p className="mt-2 text-sm text-pf-muted">Aucun nom ni contact n’apparaît dans ce bilan.</p>
        </section>
      )}

      {/* Remerciement et actions */}
      <section aria-label="Et la prochaine fois" className="mt-12 break-inside-avoid border-t border-pf-line pt-8 print:mt-6 print:pt-4">
        <p className="font-pf-serif text-[28px] leading-tight print:text-[21px]">Merci de nous avoir fait confiance.</p>
        <div className="mt-5 flex flex-col sm:flex-row gap-3 print:mt-3 print:flex-col print:gap-1">
          {view.rebookUrl && <ActionLink href={view.rebookUrl} primary>Réserver à nouveau</ActionLink>}
          {view.reviewUrl && <ActionLink href={view.reviewUrl}>Laisser un avis</ActionLink>}
        </div>
        <div className="mt-8 print:hidden">
          <button type="button" onClick={() => window.print()} className={BTN_SECONDARY}>Télécharger en PDF</button>
          <p className="mt-2 text-sm text-pf-muted">Dans la fenêtre d’impression, choisissez « Enregistrer au format PDF ».</p>
        </div>
      </section>

      <footer className="mt-10 text-sm text-pf-muted print:mt-5 print:text-[12px]">
        {[BRAND.name, BRAND.city].filter(Boolean).join(' · ')}{ORG.site && <> · <a href={ORG.site} className={`underline underline-offset-4 decoration-pf-noyer/50 rounded-sm ${FOCUS}`}>{SITE_LABEL}</a></>}
      </footer>
    </ReportShell>
  );
}
