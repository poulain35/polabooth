import { Link } from 'react-router-dom';
import { ChevronLeft, Plus } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { PolaboothMark } from '../PolaboothBrand';

/*
 * Briques communes des écrans de l'admin, pour ne pas réécrire les mêmes classes sur chaque page.
 * Les boutons prennent une taille de `Button` (xs, sm, default, lg, xl, icon, icon-sm) : pas de h-* en className.
 */

export const PAGE_TITLE_CLASS = 'break-words text-[1.625rem] leading-tight tracking-[-0.02em] text-foreground sm:text-page-title';

/** Lien de retour en haut d'un écran (« ‹ Devis »). `className` : placement seulement (marge, shrink-0). */
export function BackLink({ to, children, className }) {
  return (
    <Link
      to={to}
      className={cn('inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors', className)}
    >
      <ChevronLeft className="w-4 h-4" />{children}
    </Link>
  );
}

/** Bouton « Nouveau … » des listes : même taille et même icône partout. `to` (lien) ou `onClick`. */
export function CreateButton({ to, onClick, children, className }) {
  if (to) {
    return (
      <Button asChild className={className}>
        <Link to={to}><Plus />{children}</Link>
      </Button>
    );
  }
  return <Button onClick={onClick} className={className}><Plus />{children}</Button>;
}

/** Largeur des pages de l'admin, la même partout (liste, fiche, onglets, calendrier). */
export const PAGE_WIDTH_CLASS = 'mx-auto w-full max-w-[1240px]';

/**
 * Conteneur d'une page de l'admin : largeur, marges et espace régulier entre les blocs (en-tête, onglets,
 * cartes). Toutes les pages ont la même largeur : ni la page ni ses onglets ne la réduisent (`max-w-*`).
 * Seule exception, la colonne de saisie de `FormPage`.
 */
export function PageContainer({ children }) {
  return (
    <div className={cn(PAGE_WIDTH_CLASS, 'flex flex-col gap-5 px-4 pb-10 pt-5 sm:px-6 lg:px-8 lg:pb-12 lg:pt-7')}>
      {children}
    </div>
  );
}

/**
 * En-tête d'une page de l'admin : titre, texte d'aide, actions à droite (boutons), lien de retour facultatif.
 * `children` : ligne sous le titre (pastilles d'état, dates…).
 */
export function PageHeader({ title, description, actions, back, backLabel, className, children }) {
  return (
    <header className={cn('flex flex-wrap items-end justify-between gap-x-4 gap-y-3', className)}>
      <div className="min-w-0">
        {back && <BackLink to={back} className="mb-3">{backLabel}</BackLink>}
        <h1 className={PAGE_TITLE_CLASS}>{title}</h1>
        {/* Repère de la marque Polabooth sous le titre. */}
        <PolaboothMark className="mt-2.5" />
        {description && <p className="mt-2.5 text-[13px] text-muted-foreground">{description}</p>}
        {children && <div className="mt-3 flex flex-wrap items-center gap-2">{children}</div>}
      </div>
      {/* max-w-full sans shrink-0 : sur téléphone les actions passent sous le titre et se replient sans déborder. */}
      {actions && <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * Écran de saisie (« Nouvel événement », « Nouveau devis », « Nouveau prospect ») : marges de page, retour,
 * titre et texte d'aide, puis le formulaire. Même bord gauche que les autres pages (`PageContainer`), colonne étroite.
 */
export function FormPage({ back, backLabel, title, description, children }) {
  return (
    <PageContainer>
      <div className="w-full max-w-2xl">
        <BackLink to={back} className="mb-4">{backLabel}</BackLink>
        <h1 className={PAGE_TITLE_CLASS}>{title}</h1>
        <PolaboothMark className="mt-2.5" />
        {description && <p className="mt-2.5 text-[13px] text-muted-foreground">{description}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </PageContainer>
  );
}
