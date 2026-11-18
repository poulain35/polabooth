import * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils';

// Rond d'icône de l'admin : fond pastel et icône dans l'encre du même pastel. `white` se pose sur une carte pastel.
const iconCircleVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-full [&_svg]:shrink-0",
  {
    variants: {
      tone: {
        peach: "bg-pastel-peach text-pastel-peach-ink",
        mint: "bg-pastel-mint text-pastel-mint-ink",
        sky: "bg-pastel-sky text-pastel-sky-ink",
        lilac: "bg-pastel-lilac text-pastel-lilac-ink",
        lemon: "bg-pastel-lemon text-pastel-lemon-ink",
        rose: "bg-pastel-rose text-pastel-rose-ink",
        white: "bg-card text-foreground",
        muted: "bg-muted text-muted-foreground",
      },
      size: {
        sm: "h-8 w-8 [&_svg]:size-4",
        default: "h-[42px] w-[42px] [&_svg]:size-5",
      },
    },
    defaultVariants: { tone: "sky", size: "default" },
  }
);

const IconCircle = React.forwardRef(({ className, tone, size, ...props }, ref) => (
  <span ref={ref} aria-hidden="true" className={cn(iconCircleVariants({ tone, size }), className)} {...props} />
));
IconCircle.displayName = 'IconCircle';

export { IconCircle };
