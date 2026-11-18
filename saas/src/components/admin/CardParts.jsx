// Briques de carte de l'admin : titre avec rond d'icône et encart d'état (LAB-366, montées ici pour servir
// à toutes les pages).
import { IconCircle } from '../ui/icon-circle';
import { cn } from '../../lib/utils';

// ── Titre de carte ───────────────────────────────────────────────────────────
// `icon` : icône (nœud) posée dans un rond pastel `tone` ; `actions` : boutons ou pastille à droite.
// `titleClassName` / `descriptionClassName` : classes en plus (pastille dans le titre, résumé tronqué).
export function CardHeading({
  title, description, icon, tone, actions, as: Tag = 'h2', className, titleClassName, descriptionClassName,
}) {
  return (
    <div className={cn('flex flex-wrap items-start gap-3', className)}>
      {icon && <IconCircle tone={tone}>{icon}</IconCircle>}
      {/* Base de 144 px : sur téléphone, les actions passent à la ligne au lieu d'écraser le titre. */}
      <div className="min-w-0 grow basis-36">
        <Tag className={cn('text-card-title text-foreground', titleClassName)}>{title}</Tag>
        {description && <p className={cn('mt-0.5 text-[13px] text-muted-foreground', descriptionClassName)}>{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ── Encart d'état ────────────────────────────────────────────────────────────
// Message de succès, d'alerte ou d'information dans une carte. Le texte porte l'état, pas la couleur seule.
const NOTICE_TONES = {
  green: 'bg-state-green text-state-green-fg',
  amber: 'bg-state-amber text-state-amber-fg',
  red: 'bg-state-red text-state-red-fg',
  blue: 'bg-state-blue text-state-blue-fg',
  gray: 'bg-state-gray text-state-gray-fg',
};

export function Notice({ tone = 'gray', as: Tag = 'p', className, children, ...props }) {
  return (
    <Tag className={cn('rounded-xl px-3 py-2 text-[13px]', NOTICE_TONES[tone], className)} {...props}>
      {children}
    </Tag>
  );
}
