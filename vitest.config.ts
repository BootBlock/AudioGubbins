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

/** The files of the allocation tests, which run apart from the rest (see the `allocation` project). */
const ALLOCATION_TESTS = '**/*allocation.test.ts';

/** The machine-learning processors' pinned golden renders (see the `ml-golden` project). */
const ML_GOLDEN_TESTS = '**/*.ml-golden.test.ts';

/**
 * Whether the command names the `ml-golden` project, or asks for every golden
 * render by the filter `golden`, as the golden gate does
 * (`pnpm test:audio-golden`). Its tests read model packs from a cache outside
 * the repository (REQ-REPO-191) and run the real inference runtime, so it is
 * defined only where it is asked for (`pnpm test:ml-golden` too), and
 * `pnpm test`, which runs every project defined, never runs it.
 */
const ML_GOLDEN_NAMED = process.argv.some(
  (argument) => argument.includes('ml-golden') || argument === 'golden',
);

/**
 * The generated projects that run in a group of their own, after the rest. A
 * processor's tests run every kernel over every layout, block size and
 * signal the property harness names, which keeps every worker's core busy
 * for minutes; beside them the storage round trips, which wait on many short
 * turns, ran past their patience. Apart, each group has the cores to itself.
 */
const LATER_PROJECTS: ReadonlySet<string> = new Set(['processors']);

/** The environment a generated project names, refusing one Vitest has no runner for. */
function environmentOf(name: string): 'node' | 'jsdom' {
  if (name === 'node' || name === 'jsdom') return name;
  throw new Error(`vitest.projects.json names an unknown test environment: ${name}`);
}

export default defineConfig({
  test: {
    // A tag marks a test a root script selects across projects by what it
    // proves rather than by where it lives.
    tags: [
      {
        name: 'ml-locality',
        description:
          'No audio, project data or derived content leaves the device (REQ-AUDIO-138, ADR-0062): `pnpm test:ml-locality`.',
      },
    ],

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
        test: {
          ...project,
          environment: environmentOf(project.environment),
          exclude: [...configDefaults.exclude, ALLOCATION_TESTS, ML_GOLDEN_TESTS],
          ...(LATER_PROJECTS.has(project.name) ? { sequence: { groupOrder: 1 } } : {}),
        },
      })),

      {
        // The tests that hold the audio thread's code to allocating nothing
        // measure the optimised code V8 makes, and with every other project's
        // workers busy its optimiser can wait longer than any patience for a
        // core, leaving a function unoptimised and allocating. So they run in
        // the last group, after every other project, one file at a time.
        test: {
          name: 'allocation',
          root: '.',
          environment: 'node' as const,
          include: [`packages/*/src/${ALLOCATION_TESTS}`],
          sequence: { groupOrder: 2 },
          fileParallelism: false,
        },
      },

      ...(ML_GOLDEN_NAMED
        ? [
            {
              // Each golden renders seconds of audio through a model on one
              // thread, so the files run one at a time, as a pinned render
              // does.
              test: {
                name: 'ml-golden',
                root: '.',
                environment: 'node' as const,
                include: [`packages/*/src/${ML_GOLDEN_TESTS}`],
                fileParallelism: false,
              },
            },
          ]
        : []),

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
