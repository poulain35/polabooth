import * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const initialsVariants = cva(
  "inline-flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-full text-xs font-medium uppercase ring-2 ring-card",
  {
    variants: {
      tone: {
        peach: "bg-pastel-peach text-pastel-peach-ink",
        mint: "bg-pastel-mint text-pastel-mint-ink",
        sand: "bg-pastel-sand text-pastel-sand-ink",
        navy: "bg-pastel-navy text-pastel-navy-ink",
        lemon: "bg-pastel-lemon text-pastel-lemon-ink",
        rose: "bg-pastel-rose text-pastel-rose-ink",
        muted: "bg-muted text-muted-foreground",
      },
    },
    defaultVariants: { tone: "sand" },
  }
);

export const INITIALS_TONES = ['peach', 'mint', 'sand', 'navy', 'lemon', 'rose'];

/** Une ou deux initiales tirées d'un nom (« Prénom Nom » donne « PN »). */
function initialsOf(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2);
  return words[0][0] + words[words.length - 1][0];
}

/** Rond d'initiales. `name` : nom complet (lu par les lecteurs d'écran, sert aussi d'infobulle). */
const Initials = React.forwardRef(({ name, tone, className, children, ...props }, ref) => (
  <span ref={ref} title={name} aria-label={name} role={name ? 'img' : undefined} className={cn(initialsVariants({ tone }), className)} {...props}>
    {children ?? initialsOf(name)}
  </span>
));
Initials.displayName = 'Initials';

/**
 * Pile d'initiales qui se chevauchent. `items` : [{ name, tone? }] ; au-delà de `max`, un rond « +n ».
 * Sans `tone`, les pastels tournent dans l'ordre de INITIALS_TONES.
 */
const InitialsStack = React.forwardRef(({ items = [], max = 4, className, ...props }, ref) => {
  const shown = items.slice(0, max);
  const hidden = items.length - shown.length;
  return (
    <span ref={ref} className={cn("inline-flex items-center pl-0.5", className)} {...props}>
      {shown.map((item, i) => (
        <Initials
          key={`${item.name}-${i}`}
          name={item.name}
          tone={item.tone ?? INITIALS_TONES[i % INITIALS_TONES.length]}
          className={i > 0 ? '-ml-2' : undefined}
        />
      ))}
      {hidden > 0 && (
        <Initials tone="muted" name={`${hidden} de plus`} className={cn("normal-case", shown.length > 0 && '-ml-2')}>
          +{hidden}
        </Initials>
      )}
    </span>
  );
});
InitialsStack.displayName = 'InitialsStack';

export { Initials, InitialsStack };
