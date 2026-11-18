// Onglet « Création du client » de la fiche (LAB-314) : les cadres du client (modèles photo, slot 1 à 4),
// chacun validé ou refusé à part. Un seul cadre et choix coupé : affichage d'avant, sans titre de
// cadre. La carte d'un cadre est rendue par la page (`renderFrame`), qui garde sa section design.
import { framesReviewHint, framesSectionView } from '../../lib/clientDesigns';
import { Notice } from './CardParts';

export default function ClientFramesSection({ frames, kiosk, renderFrame }) {
  const view = framesSectionView(frames, kiosk);
  if (view.mode === 'single') return renderFrame(view.items[0] ?? { frame: null, title: null, kioskNote: null });
  const hint = framesReviewHint(frames);

  return (
    <div className="space-y-5">
      {view.warnings.map(w => (
        <Notice key={w.code} tone="amber">{w.message}</Notice>
      ))}
      {hint && <Notice>{hint}</Notice>}
      {view.items.length === 0 && renderFrame({ frame: null, title: null, kioskNote: null })}
      {view.items.map(item => (
        <div key={item.frame.id}>{renderFrame(item)}</div>
      ))}
    </div>
  );
}
