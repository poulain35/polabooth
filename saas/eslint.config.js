import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // `_` (jetable) toléré ; args PascalCase = props composant rendus en JSX
      // (non détectés comme utilisés sans eslint-plugin-react) ; catch vides tolérés.
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^[A-Z_]', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Règles react-hooks v7 / react-refresh très strictes sur ce code existant :
      // gardées en `warn` (visibles, non bloquantes en CI) — à promouvoir en `error`
      // au fil des nettoyages plutôt qu'en big-bang.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      'react-refresh/only-export-components': 'warn',
    },
  },
  // Open core (L2b) : le code ouvert n'importe jamais un module privé (src/modules/<id>/).
  // Seul src/features/modules.js lit le registre src/modules/index.js (src/lib/instanceBrand.js la marque
  // privée src/modules/brand.js, open core L7 ; src/features/catalog.js et serviceKeys.js les catalogues
  // de données src/modules/catalog.js, LAB-403).
  {
    files: ['src/**/*.{js,jsx}'],
    ignores: ['src/modules/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/modules/*/**', '**/modules/*', '!**/modules/index.js', '!**/modules/brand.js', '!**/modules/catalog.js'],
          message: 'Module privé : passez par le registre (src/features/modules.js, <ModuleSlot>, moduleHook).',
        }],
      }],
      'no-restricted-syntax': ['error', {
        selector: 'ImportExpression[source.value=/(^|\\x2F)modules\\x2F[^\\x2F]+\\x2F/]',
        message: 'Module privé : passez par le registre (src/features/modules.js, <ModuleSlot>, moduleHook).',
      }],
    },
  },
])
