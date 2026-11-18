// Logo du logiciel (Polabooth), affiché dans l'admin, la connexion et /associer.
// Les pages vues par les clients et les invités gardent la marque de l'instance (BrandLogo).
const SOURCES = {
  icon: '/polabooth/icon.svg',
  horizontal: '/polabooth/logo-horizontal.svg',
  // Version pour fond sombre : nom en crème et jaune
  'horizontal-dark': '/polabooth/logo-horizontal-blanc.svg',
};

export default function ProductLogo({ variant = 'horizontal', className = '' }) {
  if (variant === 'horizontal-auto') {
    return (
      <>
        <img src={SOURCES.horizontal} alt="Polabooth" className={`${className} dark:hidden`} />
        <img src={SOURCES['horizontal-dark']} alt="Polabooth" className={`${className} hidden dark:block`} />
      </>
    );
  }
  return <img src={SOURCES[variant] || SOURCES.horizontal} alt="Polabooth" className={className} />;
}
