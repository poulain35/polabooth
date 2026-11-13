// Aide au choix des modèles d'IA (Paramètres > Clés, open core L6).
// Les modèles et les prix changent souvent : liste à revérifier chez les fournisseurs.

export const PRICES_CHECKED_ON = '12/11/2026';

export const ASSISTANT_MODEL_LINKS = {
  models: 'https://platform.claude.com/docs/en/about-claude/models/overview',
  pricing: 'https://claude.com/pricing#api',
};

// Prix par million de jetons (entrée / sortie).
export const ASSISTANT_MODELS = [
  {
    id: 'claude-opus-5-5',
    label: 'Claude Opus 5.5',
    summary: 'Le plus capable du rapport qualité/prix, conseillé pour l\'assistant.',
    price: '4 $ / 20 $',
  },
  {
    id: 'claude-sonnet-5-5',
    label: 'Claude Sonnet 5.5',
    summary: 'Rapide, bon équilibre.',
    price: '2 $ / 10 $',
  },
  {
    id: 'claude-haiku-5-5',
    label: 'Claude Haiku 5.5',
    summary: 'Le moins cher, pour des réponses simples.',
    price: '0,10 $ / 0,50 $',
  },
];

// Modèles Replicate utilisés par generate-background (MODEL_IDS) et remove-background (MODEL_PATH).
// Liste informative : le choix du modèle de fond se fait dans l'éditeur.
export const VISUAL_MODELS = [
  {
    id: 'black-forest-labs/flux-1.1-pro',
    label: 'FLUX 1.1 Pro',
    use: 'Fond généré',
    url: 'https://replicate.com/black-forest-labs/flux-1.1-pro',
  },
  {
    id: 'black-forest-labs/flux-1.1-pro-ultra',
    label: 'FLUX 1.1 Pro Ultra',
    use: 'Fond généré',
    url: 'https://replicate.com/black-forest-labs/flux-1.1-pro-ultra',
  },
  {
    id: 'black-forest-labs/flux-2-pro',
    label: 'FLUX 2 Pro',
    use: 'Fond généré',
    url: 'https://replicate.com/black-forest-labs/flux-2-pro',
  },
  {
    id: '851-labs/background-remover',
    label: 'Background Remover',
    use: 'Détourage',
    url: 'https://replicate.com/851-labs/background-remover',
  },
];
