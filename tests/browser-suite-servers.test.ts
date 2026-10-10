import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { inRepository } from './repository.js';

/**
 * The servers the browser suite starts, as Playwright is given them.
 *
 * Read by loading `playwright.config.ts` itself, as Playwright does, rather
 * than by matching its text: a server entry is an object whose properties can
 * be written in any order and across any number of lines, and a pattern over
 * the text would pass or fail on the layout rather than on what the entry says.
 */

/** What this file reads of one server entry. */
interface ServerEntry {
  readonly command: string;
  readonly name: unknown;
  readonly stdout: unknown;
  readonly stderr: unknown;
  readonly env: unknown;
}

/** Whether a value is an object with the members {@link ServerEntry} names. */
function isServerEntry(value: unknown): value is ServerEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    'command' in value &&
    typeof value.command === 'string'
  );
}

/** The suite's configuration, as Playwright is given it. */
async function suiteConfig(): Promise<{
  readonly outputDir: unknown;
  readonly servers: readonly ServerEntry[];
}> {
  // The specifier is a URL built at run time, so the compiler leaves the
  // configuration out of this project, whose root is `tests/`, and the value is
  // narrowed here rather than typed by the import.
  const loaded: unknown = await import(pathToFileURL(inRepository('playwright.config.ts')).href);
  const config =
    typeof loaded === 'object' && loaded !== null && 'default' in loaded
      ? loaded.default
      : undefined;
  const servers =
    typeof config === 'object' && config !== null && 'webServer' in config
      ? config.webServer
      : undefined;
  if (!Array.isArray(servers) || !servers.every(isServerEntry)) {
    throw new Error('playwright.config.ts no longer gives webServer as a list of servers.');
  }
  const outputDir =
    typeof config === 'object' && config !== null && 'outputDir' in config
      ? config.outputDir
      : undefined;
  return { outputDir, servers };
}

describe('the browser suite', () => {
  it("prints every server's output with the run's, each under its name", async () => {
    // Playwright drops a server's standard output unless the entry asks for it,
    // and prints each piped line under the server's name, so the log of a run
    // that fails keeps what each server said while it failed.
    const { servers } = await suiteConfig();
    expect(servers).toHaveLength(4);
    expect(servers.map(({ name, stdout, stderr }) => ({ name, stdout, stderr }))).toEqual([
      { name: 'preview', stdout: 'pipe', stderr: 'pipe' },
      { name: 'pages preview', stdout: 'pipe', stderr: 'pipe' },
      { name: 'ml golden harness', stdout: 'pipe', stderr: 'pipe' },
      { name: 'renderer harness', stdout: 'pipe', stderr: 'pipe' },
    ]);
  });

  it("gives each preview server a request log of its own beside the run's traces", async () => {
    // Playwright empties its output folder before it starts the servers, so
    // a log there describes the run it sits in, beside that run's traces.
    // Named after the port each server is started on, read from its command.
    const { outputDir, servers } = await suiteConfig();
    const output = inRepository('test-results');
    expect(outputDir).toBe(output);

    const ports = servers.map(({ command }) => /--port (\d+)/.exec(command)?.[1]);
    expect(ports).toEqual(['4173', '4174', '4175', '4176']);
    // The two harnesses are development servers, which keep no request log:
    // the log is the preview server's, and the goldens' harness takes its
    // packs' cache from the suite's own environment, which it is given whole.
    expect(servers.map(({ env }) => env)).toEqual([
      { AUDIOGUBBINS_PREVIEW_REQUEST_LOG: join(output, 'preview-4173-requests.log') },
      {
        AUDIOGUBBINS_BASE: '/AudioGubbins/',
        AUDIOGUBBINS_PREVIEW_REQUEST_LOG: join(output, 'preview-4174-requests.log'),
      },
      undefined,
      undefined,
    ]);
  });
});
