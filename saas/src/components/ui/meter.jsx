import * as React from 'react';
import { cn } from '../../lib/utils';

/**
 * Jauge de l'admin : part consommée d'un total (quota, avancement). `tone="brand"` pour un avancement
 * (dégradé de la marque Polabooth : mise en route, étapes, envoi), `tone="amber"` à l'approche du seuil,
 * `tone="red"` quand le seuil d'alerte est atteint. Donner un `aria-label` ; afficher le chiffre à côté, la
 * jauge seule ne suffit pas. Pour un envoi en cours, passer `role="progressbar"` (les props suivent `role`).
 */
const METER_TONES = {
  default: { track: 'bg-primary-soft', bar: 'bg-primary' },
  brand: { track: 'bg-state-amber', bar: 'pb-meter-fill' },
  amber: { track: 'bg-state-amber', bar: 'bg-state-amber-fg' },
  red: { track: 'bg-state-red', bar: 'bg-state-red-fg' },
};

const Meter = React.forwardRef(({ value = 0, max = 100, tone = 'default', className, ...props }, ref) => {
  const safeMax = Number(max) > 0 ? Number(max) : 100;
  const safeValue = Math.min(Math.max(Number(value) || 0, 0), safeMax);
  const tones = METER_TONES[tone] ?? METER_TONES.default;
  return (
    <div
      ref={ref}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={safeValue}
      className={cn("h-2 w-full overflow-hidden rounded-full", tones.track, className)}
      {...props}
    >
      <div
        className={cn("h-full rounded-full transition-[width]", tones.bar)}
        style={{ width: `${(safeValue / safeMax) * 100}%` }}
      />
    </div>
  );
});
Meter.displayName = 'Meter';

export { Meter };
