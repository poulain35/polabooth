import { useEffect, useRef, useState } from 'react';
import { drawComposite } from './drawComposite';

/**
 * Vue « Cadre photo » : le tirage seul, centré sur le fond crème de la borne. `surface` : taille
 * de la surface en px de la borne ; `photos` : images déjà chargées (HTMLImageElement).
 */
export default function PrintPreview({ surface, formatId, zones, pngUrl, photos, onRendered, onError }) {
  const canvasRef = useRef(null);
  const [aspect, setAspect] = useState(null);

  useEffect(() => {
    if (!canvasRef.current || !photos?.length) return undefined;
    let active = true;
    drawComposite(canvasRef.current, { formatId, zones, pngUrl, photos })
      .then((result) => {
        if (!active) return;
        setAspect(canvasRef.current.width / canvasRef.current.height);
        onRendered?.(result);
      })
      .catch((err) => {
        console.error('Aperçu du tirage :', err);
        if (active) onError?.();
      });
    return () => { active = false; };
  }, [formatId, zones, pngUrl, photos, onRendered, onError]);

  // Le tirage tient dans la surface avec une marge, comme une photo posée sur l'écran.
  const margin = 56;
  const maxW = surface.width - margin * 2;
  const maxH = surface.height - margin * 2;
  const ratio = aspect ?? 1;
  const width = Math.min(maxW, maxH * ratio);
  const height = width / ratio;

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ background: '#F7F1E7' }}>
      <canvas
        ref={canvasRef}
        style={{
          width, height,
          visibility: aspect ? 'visible' : 'hidden',
          boxShadow: '0 4px 28px rgba(36,65,47,0.18)',
          background: '#FFFFFF',
        }}
      />
    </div>
  );
}
