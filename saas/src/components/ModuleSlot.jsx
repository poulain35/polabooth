import { Suspense } from 'react';
import { useFeatures } from '../hooks/useFeatures';
import { moduleSlot } from '../features/modules';

/**
 * Emplacement d'écran rempli par les modules privés installés (open core L2b), un composant par
 * contribution dont la fonctionnalité est disponible. Les autres props sont passées aux composants.
 * Rien sans module installé (construction ouverte).
 */
export default function ModuleSlot({ name, fallback = null, ...props }) {
  const { isAvailable } = useFeatures();
  const items = moduleSlot(name).filter((item) => isAvailable(item.feature));
  if (!items.length) return null;
  return (
    <Suspense fallback={fallback}>
      {items.map(({ Component, feature }, i) => <Component key={`${feature}-${i}`} {...props} />)}
    </Suspense>
  );
}
