import * as React from 'react';
import { cn } from '../../lib/utils';

export const segmentedTrackClass = "inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-full bg-muted p-1";

export const segmentedItemClass =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[13px] text-muted-foreground ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";

export const segmentedItemActiveClass = "bg-strong font-medium text-strong-foreground";
export const segmentedItemIdleClass = "hover:text-foreground";

// Variante de l'éditeur (panneau des propriétés, LAB-396) : piste pleine largeur, cases égales, case choisie
// en carte surélevée. Mêmes classes pour les groupes à plusieurs choix et les groupes de boutons d'action.
export const editorSegmentedTrackClass = "flex w-full gap-0.5 rounded-xl bg-muted p-1";

export const editorSegmentedItemClass =
  "flex flex-1 select-none items-center justify-center gap-1 rounded-[0.5rem] px-1.5 py-1 text-[11px] font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export const editorSegmentedItemActiveClass = "bg-card text-foreground shadow-sm";
export const editorSegmentedItemIdleClass = "text-muted-foreground hover:text-foreground";

const VARIANTS = {
  pill: {
    track: segmentedTrackClass, item: segmentedItemClass,
    active: segmentedItemActiveClass, idle: segmentedItemIdleClass,
  },
  editor: {
    track: editorSegmentedTrackClass, item: editorSegmentedItemClass,
    active: editorSegmentedItemActiveClass, idle: editorSegmentedItemIdleClass,
  },
};

/**
 * Contrôle segmenté : un choix parmi quelques-uns (filtre, période, vue).
 * `options` : [{ value, label?, title?, count?, icon?, disabled? }] ; `icon` est un composant (lucide) ou un
 * élément déjà rendu. `variant` : « pill » (pages de l'admin) ou « editor » (panneau de l'éditeur).
 * `itemClassName` s'ajoute à chaque case. Donner un `aria-label` au groupe.
 */
const SegmentedControl = React.forwardRef(({
  value, onValueChange, options = [], variant = 'pill', className, itemClassName, ...props
}, ref) => {
  const styles = VARIANTS[variant] ?? VARIANTS.pill;
  return (
    <div ref={ref} role="group" className={cn(styles.track, className)} {...props}>
      {options.map((option) => {
        const active = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            title={option.title}
            disabled={option.disabled}
            onClick={() => { if (!active) onValueChange?.(option.value); }}
            className={cn(styles.item, active ? styles.active : styles.idle, itemClassName)}
          >
            {React.isValidElement(Icon) ? Icon : Icon && <Icon aria-hidden="true" />}
            {option.label}
            {option.count != null && <span className="opacity-70">{option.count}</span>}
          </button>
        );
      })}
    </div>
  );
});
SegmentedControl.displayName = 'SegmentedControl';

export { SegmentedControl };
