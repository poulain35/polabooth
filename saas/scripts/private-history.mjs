// Tests sur l'historique du dépôt privé (open core, LAB-275).
// L'export du dépôt public remplace supabase/migrations/ par une migration de base (<horodatage>_base.sql,
// suivie des migrations plus récentes), saas/CLAUDE.md et kiosk/CLAUDE.md par des versions neutres, et retire
// src/modules/<privé>/ et les scripts de vérification supabase/tests/lab*.sql (écrits pour les migrations
// privées, LAB-273). Un test qui lit une migration antérieure à la base, la documentation privée, un module
// privé ou un de ces scripts porte { skip: PRIVATE_HISTORY } : sauté dans le dépôt public seulement.
// Dans le dépôt privé, supabase/migrations/ n'a jamais de migration de base (vérifié par
// scripts/export-open-core.test.mjs) : PRIVATE_HISTORY y vaut false, rien n'est sauté et un fichier disparu
// fait échouer le test.
import { readdirSync, readFileSync } from 'node:fs';

export const BASE_MIGRATION = /^\d{14}_base\.sql$/;
export const MIGRATIONS_DIR = new URL('../supabase/migrations/', import.meta.url);

export const IN_PUBLIC_REPO = readdirSync(MIGRATIONS_DIR).some((f) => BASE_MIGRATION.test(f));
export const PRIVATE_HISTORY = IN_PUBLIC_REPO && 'propre au dépôt privé (historique, documentation ou module absents du dépôt public)';

/** Contenu d'un fichier de l'historique privé ; '' dans le dépôt public, où les tests qui le lisent sont sautés. */
export const readPrivateHistory = (path) => (IN_PUBLIC_REPO ? '' : readFileSync(path, 'utf8'));
