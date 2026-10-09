/**
 * Every processor type the catalogue lists is held to the properties every
 * processor is held to (REQ-AUDIO-146), those that run a model among them, so
 * a type added without its properties fails here rather than going unheld.
 *
 * Each type's properties are registered by its own `<name>.properties.test.ts`,
 * which registers nothing else; `pnpm test:dsp-property` runs those files by
 * that name. This file loads every one of them with the harness replaced by a
 * recorder, so what is counted is the calls they make, not their text: a type
 * named in a comment, or a registration that names no layout and so registers
 * no test, is not counted as held.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import { PROCESSOR_CATALOGUE } from './catalogue.js';
import type { ProcessorType } from './framework/processor-type.js';
import type { PropertyCases } from './testing/processor-properties.js';

/** The layouts each type key's registrations name, across all of them. */
const registered = vi.hoisted(() => new Map<string, number>());

vi.mock('./testing/processor-properties.js', () => ({
  processorProperties: (type: ProcessorType, cases: PropertyCases) => {
    const key = type.descriptor.typeKey;
    registered.set(key, (registered.get(key) ?? 0) + cases.layouts.length);
  },
}));

/** The suffix of a file that registers one processor type's properties. */
const PROPERTIES_FILE = '.properties.test.ts';

const PROPERTIES_FILES: readonly string[] = readdirSync(import.meta.dirname, {
  recursive: true,
  encoding: 'utf8',
})
  .filter((path) => path.endsWith(PROPERTIES_FILE))
  .toSorted();

// Loaded as this file is collected, as each is when it runs on its own: a
// registration is a call made while a test file is collected.
for (const path of PROPERTIES_FILES) {
  await import(pathToFileURL(join(import.meta.dirname, path)).href);
}

describe('the processor catalogue, held to every processor’s properties', () => {
  it('reads the properties files, so a census of none does not pass in silence', () => {
    expect(PROPERTIES_FILES).toContain(join('level', 'gain-processor.properties.test.ts'));
  });

  it('runs every catalogued type, those that run a model among them, over some layout', () => {
    const unheld = [...PROCESSOR_CATALOGUE.keys()].filter(
      (key) => (registered.get(key) ?? 0) === 0,
    );
    expect(unheld).toEqual([]);
  });
});
