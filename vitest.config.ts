/**
 * Test projects for the AudioGubbins workspace.
 *
 * One project per workspace package, generated from the same declaration that
 * owns the dependency graph and written to `vitest.projects.json` by
 * `pnpm graph:sync`. Each runs in the environment its package actually targets:
 * the framework-agnostic packages run under Node with no DOM at all, so a test
 * cannot accidentally prove that domain code works by leaning on a browser
 * global the package is forbidden to use (REQ-ARCH-151, REQ-EXEC-184).
 *
 * Generated because a list written out by hand beside the declaration drifts
 * from it: a package that belonged to no project would have its tests collected
 * by nothing and reported missing by nothing. `pnpm graph:check` fails when the
 * two disagree, and an architecture rule holds the file to one project per
 * package.
 *
 * The two projects below are not about any one package. The `architecture`
 * project is separate because `pnpm test:architecture` runs it on its own,
 * beside the cruise of the import graph, as the phase specifications name it.
 * `pnpm verify:commit`, the fast commit tier of REQ-REPO-188.1, runs it once,
 * within `pnpm test`, and the cruise on its own as `pnpm test:dependencies`.
 */

import { configDefaults, defineConfig } from 'vitest/config';

import generated from './vitest.projects.json' with { type: 'json' };

/** The environment a generated project names, refusing one Vitest has no runner for. */
function environmentOf(name: string): 'node' | 'jsdom' {
  if (name === 'node' || name === 'jsdom') return name;
  throw new Error(`vitest.projects.json names an unknown test environment: ${name}`);
}

export default defineConfig({
  test: {
    // Builds the canonical DSP module from the crates before any test runs,
    // so no test reads a module older than its source (ADR-0031).
    globalSetup: ['./tests/setup/dsp-module.ts'],

    // No test imports the crates, so an edit to one is not a change Vitest
    // follows; naming them reruns every test in watch mode, and the global
    // setup builds the module again before the rerun.
    forceRerunTriggers: [
      ...configDefaults.forceRerunTriggers,
      '**/crates/**/*.rs',
      '**/Cargo.{toml,lock}',
    ],

    projects: [
      ...generated.projects.map((project) => ({
        test: { ...project, environment: environmentOf(project.environment) },
      })),

      {
        test: {
          name: 'architecture',
          root: '.',
          environment: 'node' as const,
          include: ['tests/architecture/**/*.test.ts'],
        },
      },

      {
        // Repository-level rules that are not about any one package: the agent
        // guide budgets, licence and attribution files, British-English usage.
        test: {
          name: 'repository',
          root: '.',
          environment: 'node' as const,
          include: ['tests/*.test.ts'],
        },
      },
    ],

    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['apps/*/src/**', 'packages/*/src/**'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/index.ts',
        '**/generated-*.ts',
        'packages/test-fixtures/**',
      ],
    },
  },
});
