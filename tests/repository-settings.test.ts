import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { inRepository } from './repository.js';

/**
 * The repository settings two requirements rest on.
 *
 * `REQ-REPO-033` asks for line endings that do not change with the machine, and
 * `REQ-REPO-186` for a package that can import only what it declares. The tests
 * the phase evidence cited for them check something else: one reads the
 * `license` field of each manifest, and the other reads only the
 * `@audiogubbins` entries of a manifest. Neither opens these two files, so
 * without the tests here either file could be deleted with no test failing.
 */

/** Reads a file at the repository root. */
function read(name: string): string {
  return readFileSync(inRepository(name), 'utf8');
}

/** The settings of an INI-style file, by key. */
function settingsOf(text: string): Map<string, string> {
  const settings = new Map<string, string>();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    settings.set(trimmed.slice(0, separator).trim(), trimmed.slice(separator + 1).trim());
  }
  return settings;
}

describe('.gitattributes (REQ-REPO-033)', () => {
  const attributes = read('.gitattributes');

  it('keeps LF in the working tree on every platform', () => {
    // The generated specification artefacts and the golden files are compared
    // byte for byte. A checkout that rewrote their line endings would fail the
    // reproducibility check on Windows and pass everywhere else.
    expect(attributes).toMatch(/^\*\s+text=auto\s+eol=lf$/m);
  });

  it('marks the media and font types binary, so none is normalised or diffed', () => {
    for (const extension of ['png', 'wav', 'flac', 'woff2', 'wasm', 'mp4']) {
      expect(attributes).toMatch(new RegExp(`^\\*\\.${extension}\\s+binary$`, 'm'));
    }
  });
});

describe('.npmrc (REQ-REPO-186)', () => {
  const settings = settingsOf(read('.npmrc'));

  it('disables hoisting, so nothing resolves a transitive dependency it did not declare', () => {
    // pnpm's isolated node_modules is what makes the layering rules true of the
    // installed tree rather than only of the manifests. With hoisting on, a
    // package could import a transitive dependency by accident and every
    // architecture rule would still pass. Transitive: the root declares three
    // workspace packages for its own tools, and a resolver walking up from any
    // package finds those, which the composite build stops instead.
    expect(settings.get('hoist')).toBe('false');
    expect(settings.get('shamefully-hoist')).toBe('false');
  });

  it('installs peer dependencies without letting a mismatch stop the install', () => {
    expect(settings.get('auto-install-peers')).toBe('true');
    expect(settings.get('strict-peer-dependencies')).toBe('false');
  });
});
