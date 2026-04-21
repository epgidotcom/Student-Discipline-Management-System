import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

// Frontend lint policy.
// Connected to all JS/JSX files in src/ and used by the npm lint script.
export default defineConfig([
  // Excludes generated build output from lint checks.
  globalIgnores(['dist']),
  {
    // Targets React source modules including App.jsx and main.jsx.
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    // Parser/runtime settings aligned with browser-based React code.
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    // Keeps code health strict while allowing conventional component constant names.
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
])
