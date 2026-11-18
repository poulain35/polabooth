import { useEffect, useRef, useState } from 'react';

/**
 * Texte écrit dans la police `font`, seulement une fois visible (LAB-347) : le navigateur ne
 * télécharge que les polices réellement affichées, même dans une liste de 200 polices importées.
 * `rootRef` : conteneur qui défile (sinon la fenêtre).
 */
export default function LazyFontText({ font, rootRef, className, children }) {
  const ref = useRef(null);
  // Sans IntersectionObserver (vieux navigateur), la police s'applique tout de suite.
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (visible || !el) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { root: rootRef?.current ?? null, rootMargin: '120px 0px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible, rootRef]);
  return (
    <span ref={ref} style={visible ? { fontFamily: font } : undefined} className={className}>
      {children ?? font}
    </span>
  );
}
