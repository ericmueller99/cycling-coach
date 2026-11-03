import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**', '.playwright-mcp/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  /**
   * `packages/coach` is the only place the Anthropic SDK may be imported (CLAUDE.md rule 4). Every
   * Claude call then goes through one engine, so usage logging, caching layout and the
   * confirm-before-write tools can't be bypassed by a stray `new Anthropic()` in a route.
   */
  {
    files: ['**/*.{ts,tsx}'],
    ignores: ['packages/coach/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@anthropic-ai/sdk',
              message: 'Import from @cycling-coach/coach instead. See CLAUDE.md rule 4.',
            },
          ],
          patterns: [
            {
              group: ['@anthropic-ai/sdk/*'],
              message: 'Import from @cycling-coach/coach instead. See CLAUDE.md rule 4.',
            },
          ],
        },
      ],
    },
  },

  /**
   * packages/core must stay pure (CLAUDE.md rule 3). Workout maths and calendar maths are only
   * fixture-testable while they can't read a clock or open a socket.
   */
  {
    files: ['packages/core/**/*.ts'],
    ignores: ['packages/core/**/*.test.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'packages/core is pure — take data as an argument instead.' },
        { name: 'process', message: 'packages/core is pure — no env access.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message:
            'packages/core is pure — `new Date()` makes it untestable. Take the date as a parameter.',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'packages/core is pure — take the timestamp as a parameter.',
        },
      ],
    },
  },

  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
