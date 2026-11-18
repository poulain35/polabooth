import * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils';

// Pastille d'état de l'admin. Sens des tons : amber = à préparer, green = fait / prêt, violet = en cours,
// blue = à livrer, red = alerte, gray = neutre. Le libellé porte toujours l'état : la couleur seule ne suffit pas.
const statusPillVariants = cva(
  "inline-flex h-[26px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      tone: {
        gray: "bg-state-gray text-state-gray-fg",
        amber: "bg-state-amber text-state-amber-fg",
        green: "bg-state-green text-state-green-fg",
        violet: "bg-state-violet text-state-violet-fg",
        blue: "bg-state-blue text-state-blue-fg",
        red: "bg-state-red text-state-red-fg",
        white: "bg-card text-foreground",
        dashed: "border border-dashed border-input bg-transparent text-muted-foreground",
      },
    },
    defaultVariants: { tone: "gray" },
  }
);

const StatusPill = React.forwardRef(({ className, tone, dot = true, children, ...props }, ref) => (
  <span ref={ref} className={cn(statusPillVariants({ tone }), className)} {...props}>
    {dot && <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />}
    {children}
  </span>
));
StatusPill.displayName = 'StatusPill';

export { StatusPill, statusPillVariants };
