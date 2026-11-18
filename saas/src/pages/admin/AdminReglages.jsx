// Réglages (/admin/reglages#<section>, LAB-335 puis LAB-338) : une seule page, un sommaire collant qui
// suit la section visible (à gauche sur ordinateur, en haut sur téléphone). Sections dans l'ordre de
// SETTINGS_SECTIONS ; « offres » et « galerie » cachées sans les fonctionnalités qui les remplissent.
// Les liens /admin/reglages#… vers une section sont vérifiés par adminRoutes.test.js.
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { SETTINGS_SECTIONS } from '../../features/adminRoutes';
import { activeSectionId, hashSectionId, visibleSections } from '../../lib/settingsToc';
import { useFeatures } from '../../hooks/useFeatures';
import { PageContainer, PageHeader } from '../../components/admin/AdminPage';
import { cn } from '../../lib/utils';
import { useOwnOrganization } from './reglages/useOwnOrganization';
import { galleryCardFlags, hasOfferSettings } from './reglages/sectionFlags';
import CompanySettings from './reglages/CompanySettings';
import OffersSettings from './reglages/OffersSettings';
import ClientEmailsSettings from './reglages/ClientEmailsSettings';
import EditorSettings from './reglages/EditorSettings';
import GallerySettings from './reglages/GallerySettings';
import { Spinner } from '../../components/ui/spinner';

const AdminFeatures = lazy(() => import('./AdminFeatures'));
const AdminKeys = lazy(() => import('./AdminKeys'));

/** Contenu de chaque section ; `needsOrg` : rien à régler sans organisation. Toutes en pleine largeur. */
const SECTIONS = {
  entreprise: { Component: CompanySettings, needsOrg: true },
  offres: { Component: OffersSettings, needsOrg: true },
  emails: { Component: ClientEmailsSettings, needsOrg: false },
  editeur: { Component: EditorSettings, needsOrg: true },
  galerie: { Component: GallerySettings, needsOrg: true },
  fonctionnalites: { Component: AdminFeatures, needsOrg: false },
  services: { Component: AdminKeys, needsOrg: false },
};

// Réalignements après un saut vers une section : le contenu au-dessus se charge à la demande et
// peut la décaler. Arrêtés dès que la personne fait défiler elle-même.
const ALIGN_TRIES = 12;
const ALIGN_DELAY_MS = 150;
const USER_SCROLL_EVENTS = ['wheel', 'touchstart', 'keydown', 'mousedown'];

const spinner = (
  <div className="flex justify-center py-12">
    <Spinner />
  </div>
);

/** Saut vers une section, réaligné quelques instants (sections chargées à la demande). */
function useSectionJump() {
  const stopRef = useRef(null);
  const stop = useCallback(() => { stopRef.current?.(); stopRef.current = null; }, []);

  const jump = useCallback((id) => {
    stop();
    let tries = 0;
    const tick = () => {
      document.getElementById(id)?.scrollIntoView({ block: 'start' });
      tries += 1;
      if (tries >= ALIGN_TRIES) stop();
    };
    const timer = setInterval(tick, ALIGN_DELAY_MS);
    const onUser = () => stop();
    for (const name of USER_SCROLL_EVENTS) window.addEventListener(name, onUser, { passive: true });
    stopRef.current = () => {
      clearInterval(timer);
      for (const name of USER_SCROLL_EVENTS) window.removeEventListener(name, onUser);
    };
    tick();
  }, [stop]);

  useEffect(() => stop, [stop]);
  return jump;
}

export default function AdminReglages() {
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const { isAvailable, loading: featuresLoading } = useFeatures();
  const { org, setOrg, patchOrg, loading: orgLoading } = useOwnOrganization();
  const ready = !featuresLoading && !orgLoading;

  const gallery = galleryCardFlags(isAvailable);
  const sections = visibleSections(SETTINGS_SECTIONS, [
    !hasOfferSettings(isAvailable) && 'offres',
    !(gallery.showBanner || gallery.showReport) && 'galerie',
  ].filter(Boolean));
  const idsKey = sections.map((s) => s.id).join(',');

  const [active, setActive] = useState(() => hashSectionId(hash) ?? SETTINGS_SECTIONS[0].id);
  const preferredRef = useRef(hashSectionId(hash));
  const navRef = useRef(null);
  const rootRef = useRef(null);
  const jump = useSectionJump();

  // Fragment de l'adresse (lien, redirection, sommaire) : saut vers la section une fois tout rendu.
  useEffect(() => {
    const id = hashSectionId(hash);
    if (!ready || !id) return;
    preferredRef.current = id;
    jump(id);
  }, [hash, ready, jump]);

  // Section suivie : relue au défilement de la zone principale de l'admin (<main>).
  useEffect(() => {
    if (!ready) return undefined;
    const ids = idsKey.split(',');
    const scroller = rootRef.current?.closest('main') ?? null;
    const target = scroller ?? window;
    let frame = 0;
    function update() {
      frame = 0;
      const box = scroller ? scroller.getBoundingClientRect() : { top: 0, height: window.innerHeight };
      const desktop = window.matchMedia('(min-width: 1024px)').matches;
      const offset = (desktop ? 0 : navRef.current?.offsetHeight ?? 0) + 32;
      const positions = ids
        .map((id) => {
          const el = document.getElementById(id);
          return el ? { id, top: el.getBoundingClientRect().top - box.top } : null;
        })
        .filter(Boolean);
      const el = scroller ?? document.documentElement;
      const atBottom = el.scrollTop > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
      const next = activeSectionId(positions, { offset, atBottom, preferred: preferredRef.current, viewHeight: box.height });
      if (next) setActive(next);
    }
    function onScroll() { if (!frame) frame = requestAnimationFrame(update); }
    onScroll();
    target.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      target.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ready, idsKey]);

  // Sur téléphone, le sommaire défile de côté : on garde l'entrée suivie visible.
  useEffect(() => {
    const list = navRef.current?.querySelector('ul');
    const item = list?.querySelector('[aria-current="location"]');
    if (!list || !item || list.scrollWidth <= list.clientWidth) return;
    list.scrollTo({ left: item.offsetLeft - (list.clientWidth - item.offsetWidth) / 2, behavior: 'smooth' });
  }, [active]);

  function handleTocClick(e, id) {
    e.preventDefault();
    preferredRef.current = id;
    setActive(id);
    jump(id);
    if (hashSectionId(hash) !== id) navigate({ pathname, search, hash: `#${id}` }, { replace: true });
  }

  return (
    <div ref={rootRef}>
      <PageContainer>
        <PageHeader title="Réglages" />

        {/* Sous lg : bloc simple, pas de grille (le sommaire collant doit pouvoir suivre toute la page). */}
        <div className="min-w-0 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
          <nav ref={navRef} aria-label="Sommaire des réglages"
            className="sticky top-0 z-20 -mx-4 mb-5 border-b border-border bg-background px-4 py-2 sm:-mx-6 sm:px-6
              lg:top-6 lg:mx-0 lg:mb-0 lg:self-start lg:rounded-card lg:border-0 lg:bg-card lg:p-2 lg:shadow-card">
            <ul className="relative flex gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:flex-col lg:overflow-visible">
              {sections.map((section) => {
                const current = section.id === active;
                return (
                  <li key={section.id} className="shrink-0">
                    <a href={`#${section.id}`} onClick={(e) => handleTocClick(e, section.id)}
                      aria-current={current ? 'location' : undefined}
                      className={cn(
                        'block whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:rounded-control lg:px-3 lg:py-2',
                        current ? 'bg-primary-soft font-medium text-primary-ink' : 'text-muted-foreground hover:bg-soft hover:text-foreground',
                      )}>
                      {section.label}
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="min-w-0 space-y-10">
            {!ready ? spinner : sections.map((section) => {
              const { Component, needsOrg } = SECTIONS[section.id];
              return (
                <section key={section.id} id={section.id} aria-labelledby={`${section.id}-titre`}
                  className="scroll-mt-16 lg:scroll-mt-6">
                  <h2 id={`${section.id}-titre`} className="mb-3 text-xl tracking-[-0.01em] text-foreground">
                    {section.label}
                  </h2>
                  {needsOrg && !org ? (
                    <p className="text-[13px] text-muted-foreground">Aucune organisation n'est rattachée à ce compte.</p>
                  ) : (
                    <Suspense fallback={spinner}>
                      <Component org={org} setOrg={setOrg} patchOrg={patchOrg} {...(section.id === 'galerie' ? gallery : {})} />
                    </Suspense>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      </PageContainer>
    </div>
  );
}
