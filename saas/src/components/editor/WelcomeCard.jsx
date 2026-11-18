import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import BrandLogo from '../BrandLogo';

// ─── Welcome card (première visite client) ────────────────────────────────────

// (WELCOME_KEY supprimé — la card se base désormais sur l'absence de design existant)

export default function WelcomeCard({ onClose, homeMode = false, submitWord = 'Valider' }) {
  const steps = [
    {
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 13a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1h-4a1 1 0 01-1-1v-6z" />
        </svg>
      ),
      title: 'Choisissez un modèle',
      desc: 'Le panneau Modèles est déjà ouvert — parcourez les exemples ou partez d\'une page blanche.',
    },
    {
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
      ),
      title: 'Personnalisez votre design',
      desc: 'Ajoutez du texte (police, taille, couleur), vos propres images et des décorations.',
    },
    {
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ),
      ...(homeMode
        ? {
          title: 'Restez dans la zone de sécurité',
          desc: "Sur certains écrans, les bandes hors des pointillés sont coupées. En bas, la borne affiche la pastille « Touchez l'écran » et ses boutons : n'y mettez pas votre texte.",
        }
        : {
          title: 'Les zones photo sont réservées',
          desc: 'Les cadres en pointillés seront remplis avec vos photos le jour J — ne les supprimez pas.',
        }),
    },
    {
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      title: 'Validez quand vous êtes prêt',
      desc: `Cliquez sur "${submitWord}" pour nous envoyer votre design. Vous pouvez sauvegarder et revenir autant de fois que vous voulez.`,
    },
  ];

  // Fermer la fenêtre (Échap, clic à côté, croix) revient à « C'est parti ! ».
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        aria-labelledby="welcome-title"
        aria-describedby={undefined}
        className="block w-[calc(100%-2rem)] max-w-md p-0 gap-0 border-0 rounded-[28px] sm:rounded-[28px] shadow-editor-float overflow-hidden max-h-[calc(100dvh-2rem)] overflow-y-auto font-pola"
      >

        {/* En-tête : fond crème du site, texte foncé (LAB-355) */}
        <div className="bg-pf-surface px-6 pt-6 pb-6">
          <div className="mb-4"><BrandLogo className="h-7 w-auto" textClassName="text-lg font-semibold text-pf-text" /></div>
          <DialogTitle id="welcome-title" className="font-pf-serif font-normal text-[28px] text-pf-text leading-tight tracking-normal">
            Bienvenue dans l'éditeur&nbsp;!
          </DialogTitle>
          <p className="text-pf-muted text-base mt-1">
            Créez votre design en quelques minutes.
          </p>
        </div>

        {/* Steps */}
        <div className="px-6 py-5 space-y-4">
          {steps.map((step, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-pf-noyer text-primary-foreground flex items-center justify-center shrink-0 mt-0.5" aria-hidden="true">
                {step.icon}
              </div>
              <div>
                <p className="text-[15px] font-medium text-pf-text">{step.title}</p>
                <p className="text-sm text-pf-muted mt-0.5 leading-relaxed">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="px-6 pb-6">
          <button onClick={onClose} autoFocus className="pola-pf-btn-primary w-full">
            C'est parti !
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
