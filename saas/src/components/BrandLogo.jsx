// Logo de l'instance (open core L7, src/lib/instanceBrand.js) : l'image si la marque en fournit une,
// sinon le nom en texte (variante horizontale) ou rien (variante carrée, souvent à côté du nom).
import { BRAND } from '../lib/instanceBrand.js';

export default function BrandLogo({ variant = 'horizontal', className = '', alt, textClassName = 'text-lg font-semibold text-gray-900' }) {
  const src = variant === 'square' ? BRAND.logoSquare : BRAND.logoHorizontal;
  if (src) return <img src={src} alt={alt ?? BRAND.name} className={className} />;
  if (variant === 'square') return null;
  return <span className={textClassName}>{BRAND.name}</span>;
}
