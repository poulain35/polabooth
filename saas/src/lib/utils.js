import { clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Classes ajoutées dans tailwind.config.js (LAB-363) : sans cette déclaration, tailwind-merge prend
// `rounded-control`, `shadow-card` ou `text-page-title` pour des couleurs et ne les remplace pas par une
// classe passée en `className` (ni l'inverse).
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ['control', 'dialog', 'card', 'pola', 'editor-popover', 'editor-tool', 'editor-item'],
      shadow: ['card', 'float', 'editor-float', 'editor-raised', 'editor-subtle'],
      spacing: ['card'],
      text: ['page-title', 'card-title', 'figure', 'editor-2xs', 'editor-xs', 'editor-sm'],
      'font-weight': ['editor-strong', 'editor-bold', 'editor-heading'],
    },
  },
});

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
