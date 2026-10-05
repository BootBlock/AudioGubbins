import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

/**
 * AudioGubbins lint configuration.
 *
 * This file carries architectural rules that dependency-cruiser cannot express,
 * because they are about which *globals* and *syntax* a file may use rather
 * than which modules it may import (REQ-EXEC-184).
 */

/**
 * Every browser API capable of leaving the machine. REQ-PRIV-162 prohibits
 * usage analytics outright and REQ-PRIV-161 prohibits transmitting anything
 * without express permission, so AudioGubbins has no legitimate use for any of
 * these in application code. A future consented diagnostic-submission workflow
 * will need an explicit, reviewed exemption on the single module that performs
 * the upload.
 */
const NETWORK_GLOBALS = [
  {
    name: 'fetch',
    message:
      'AudioGubbins transmits nothing without express consent (REQ-PRIV-161) and ships no ' +
      'analytics (REQ-PRIV-162). A consented upload path needs its own reviewed exemption.',
  },
  {
    name: 'XMLHttpRequest',
    message: 'No network transmission in application code (REQ-PRIV-161, REQ-PRIV-162).',
  },
  {
    name: 'WebSocket',
    message: 'No network transmission in application code (REQ-PRIV-161, REQ-PRIV-162).',
  },
  {
    name: 'EventSource',
    message: 'No network transmission in application code (REQ-PRIV-161, REQ-PRIV-162).',
  },
  {
    name: 'RTCPeerConnection',
    message: 'No network transmission in application code (REQ-PRIV-161, REQ-PRIV-162).',
  },
  {
    name: 'webkitRTCPeerConnection',
    message: 'No network transmission in application code (REQ-PRIV-161, REQ-PRIV-162).',
  },
  {
    name: 'WebTransport',
    message: 'No network transmission in application code (REQ-PRIV-161, REQ-PRIV-162).',
  },
  {
    name: 'importScripts',
    message: 'A worker loads only the modules the bundler resolved (REQ-PRIV-161).',
  },
];

/**
 * Browser globals that domain and command code must never reach for. Platform
 * access is the job of the capabilities package (REQ-EXEC-136.4, REQ-EXEC-216).
 */
const BROWSER_GLOBALS_FORBIDDEN_IN_DOMAIN = ['window', 'document', 'navigator', 'localStorage'].map(
  (name) => ({
    name,
    message:
      'Domain and command code stays framework- and platform-agnostic (REQ-ARCH-151). Reach for ' +
      'a browser API through @audiogubbins/capabilities, or accept the value as a parameter.',
  }),
);

/**
 * Every browser global, which the renderer reads none of: the GPU object, the
 * canvases and the timers it waits by are handed to it (ADR-0044, ADR-0040), so
 * it can be driven by a test and only `packages/capabilities` reads the
 * browser. The language's own globals are not in the browser set.
 */
const BROWSER_GLOBALS_FORBIDDEN_IN_RENDERER = Object.keys(globals.browser).map((name) => ({
  name,
  message:
    'The renderer reads no browser global (ADR-0044). Take the object from the surface, ' +
    'the GPU object or the schedule it is handed.',
}));

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      // The GitHub Pages build the browser suite serves from a sub-path.
      '**/dist-pages/**',
      // The service worker the development server builds, beside the bundle's own.
      '**/dev-dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/target/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/.pnpm-store/**',
      'docs/spec/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      // REQ-EXEC-136.12: `any` at a trust boundary defeats the point of typing it.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',

      // REQ-EXEC-136.15: a swallowed rejection is a failure mode nobody designed.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/return-await': ['error', 'always'],

      // Type-only imports keep the runtime graph honest under verbatimModuleSyntax.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',

      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // REQ-EXEC-181: placeholder markers are a gate failure, so the linter
      // says so at the point the marker is written rather than at review time.
      'no-warning-comments': [
        'error',
        { terms: ['todo', 'fixme', 'hack', 'xxx'], location: 'anywhere' },
      ],

      // `interface` and `type` are not interchangeable here. TypeScript gives
      // an implicit index signature to a type alias and not to an interface, so
      // a token group that is iterated as a record has to be an alias. Forcing
      // one form would mean an assertion at every iteration site, which is
      // worse than letting the shape's use decide which form it takes.
      '@typescript-eslint/consistent-type-definitions': 'off',

      // A type assertion tells the checker to stop checking, and a defect can
      // ship behind one, as a stored layout asserted to be a layout or a chord
      // asserted to be non-empty would. A value is narrowed by a check instead,
      // and the few places a branded type is minted say so where they do it.
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],

      eqeqeq: ['error', 'always', { null: 'ignore' }],
      // REQ-PRIV-165 routes diagnostics through the structured logger, which
      // has bounded retention, categories and redaction. A bare console call
      // has none of those and cannot appear in an exported diagnostic bundle.
      'no-console': 'error',
      'prefer-const': 'error',
      'no-restricted-globals': ['error', ...NETWORK_GLOBALS],
      'no-restricted-properties': [
        'error',
        {
          object: 'navigator',
          property: 'sendBeacon',
          message: 'AudioGubbins ships no telemetry (REQ-PRIV-162).',
        },
      ],
    },
  },

  // Domain and command packages: framework-agnostic, platform-agnostic.
  {
    files: [
      'packages/{audio-engine,audio-graph,clipboard,codecs,domain,commands,editor-view,effect-rack,input,timeline,version,video-reference,waveform,processors,project-format,project-commands,history,media-store,storage}/**/*.ts',
    ],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-globals': [
        'error',
        ...NETWORK_GLOBALS,
        ...BROWSER_GLOBALS_FORBIDDEN_IN_DOMAIN,
      ],
    },
  },

  // Browser-facing packages and the application shell.
  {
    files: [
      'apps/web/**/*.{ts,tsx}',
      'packages/{audio-runtime,design-system,workspace,capabilities,browser-storage,storage-runtime}/**/*.{ts,tsx}',
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },

  // The renderer draws on what it is handed, and reads nothing of the browser.
  {
    files: ['packages/renderer/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-globals': [
        'error',
        ...NETWORK_GLOBALS,
        ...BROWSER_GLOBALS_FORBIDDEN_IN_RENDERER,
      ],
    },
  },

  // React component rules.
  {
    files: ['**/*.tsx'],
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
    },
  },

  // Tests may reach for test-only globals and deliberately exercise failure paths.
  {
    files: ['**/*.{test,spec,bench}.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      // A test that asserts on an error path legitimately builds malformed input.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // A test builds a value its type forbids, to hold the code to refusing it.
      '@typescript-eslint/consistent-type-assertions': 'off',
      'no-restricted-globals': 'off',
    },
  },

  // Build tooling and configuration run under Node.
  {
    files: ['tools/**/*.{js,mjs,ts}', '*.config.{js,ts,mjs}', '**/*.config.{js,ts,mjs}', '*.cjs'],
    languageOptions: { globals: globals.node },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // Plain JavaScript tooling has no type information to lint against.
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
);
