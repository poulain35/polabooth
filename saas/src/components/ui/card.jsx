import * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils';

// Carte de l'admin : blanche avec ombre douce, ou pastel (`tone`) pour une carte mise en avant. Sans bordure.
// Sur un pastel, le gris atténué manque de contraste en clair (4,3:1) : dans la carte, `text-muted-foreground`
// prend la valeur de l'encre (`--ink`).
const ON_PASTEL = "text-foreground [--muted-foreground:var(--ink)]";
const cardVariants = cva("rounded-card", {
  variants: {
    tone: {
      default: "bg-card text-card-foreground shadow-card",
      peach: `bg-pastel-peach ${ON_PASTEL}`,
      mint: `bg-pastel-mint ${ON_PASTEL}`,
      sky: `bg-pastel-sky ${ON_PASTEL}`,
      lilac: `bg-pastel-lilac ${ON_PASTEL}`,
      lemon: `bg-pastel-lemon ${ON_PASTEL}`,
      rose: `bg-pastel-rose ${ON_PASTEL}`,
    },
  },
  defaultVariants: { tone: "default" },
});

const Card = React.forwardRef(({ className, tone, ...props }, ref) => (
  <div ref={ref} className={cn(cardVariants({ tone }), className)} {...props} />
));
Card.displayName = 'Card';

// `as` : balise du titre (`h2`, `h3`…) pour garder le plan de la page.
const CardTitle = React.forwardRef(({ as: Tag = 'div', className, ...props }, ref) => (
  <Tag ref={ref} className={cn("text-card-title font-medium", className)} {...props} />
));
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("text-[13px] text-muted-foreground", className)} {...props} />
));
CardDescription.displayName = 'CardDescription';

export { Card, CardTitle, CardDescription, cardVariants };
