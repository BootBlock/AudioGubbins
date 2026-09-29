import { describe, expect, it } from 'vitest';

import { dspModuleBytes } from '@audiogubbins/audio-engine/testing';

import { read } from './source-reading.js';

/**
 * The WebAssembly features the canonical DSP module uses, held to the browser
 * floor (REQ-EXEC-184, ADR-0031).
 *
 * `tools/build-wasm.mjs` names the features it builds with, but the standard
 * library is compiled by the toolchain with its own, and the toolchain follows
 * the stable channel. The module the run's global setup built from the crates
 * lists every feature its code uses in its `target_features` section, so this
 * reads that list and holds each feature to the first version of each engine
 * at the floor the build declares.
 */

/** The floor as the build declares it: each engine, and its first version. */
const FLOOR: ReadonlyMap<string, string> = new Map(
  [
    ...(
      /const BROWSER_TARGETS = \[([^\]]*)\]/u.exec(read('apps/web/vite.config.ts'))?.[1] ?? ''
    ).matchAll(/'([a-z]+)([\d.]+)'/gu),
  ].map((one) => [one[1] ?? '', one[2] ?? '']),
);

/** Where a feature first shipped in Chrome, Firefox and Safari. */
interface FirstVersions {
  readonly chrome: string;
  readonly firefox: string;
  readonly safari: string;
}

/**
 * Every feature the module may list, and where each first shipped. Edge ships
 * Chrome's engine, and Safari on an iPhone or iPad shares the Mac's version
 * numbers. `bulk-memory-opt` and `call-indirect-overlong` are LLVM's names for
 * parts of bulk memory and of reference types, and shipped with them.
 */
const FEATURES: ReadonlyMap<string, FirstVersions> = new Map([
  ['bulk-memory', { chrome: '75', firefox: '79', safari: '15' }],
  ['bulk-memory-opt', { chrome: '75', firefox: '79', safari: '15' }],
  ['call-indirect-overlong', { chrome: '96', firefox: '79', safari: '15' }],
  ['multivalue', { chrome: '85', firefox: '78', safari: '13.1' }],
  ['mutable-globals', { chrome: '74', firefox: '61', safari: '13.1' }],
  ['nontrapping-fptoint', { chrome: '75', firefox: '64', safari: '15' }],
  ['reference-types', { chrome: '96', firefox: '79', safari: '15' }],
  ['sign-ext', { chrome: '74', firefox: '62', safari: '14.1' }],
  ['simd128', { chrome: '91', firefox: '89', safari: '16.4' }],
]);

/** Where a feature first shipped in the engine the floor names. */
function firstIn(versions: FirstVersions, engine: string): string | undefined {
  if (engine === 'chrome' || engine === 'edge') return versions.chrome;
  if (engine === 'firefox') return versions.firefox;
  if (engine === 'safari' || engine === 'ios') return versions.safari;
  return undefined;
}

/** Whether version `left` is at or before `right`, compared part by part. */
function atOrBefore(left: string, right: string): boolean {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference < 0;
  }
  return true;
}

/**
 * The features a module's `target_features` section says it uses: a count,
 * then for each a prefix byte and a name, each length a LEB128 number. A
 * prefix of `+` or `=` marks a feature used; `-` one the module must not be
 * linked with, which it does not use.
 */
function featuresUsed(section: ArrayBuffer): string[] {
  const bytes = new Uint8Array(section);
  let at = 0;
  const unsigned = (): number => {
    let value = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = bytes[at] ?? 0;
      at += 1;
      value += (byte & 0x7f) * 2 ** shift;
      shift += 7;
    } while ((byte & 0x80) !== 0);
    return value;
  };
  const used: string[] = [];
  const count = unsigned();
  for (let index = 0; index < count; index += 1) {
    const prefix = String.fromCharCode(bytes[at] ?? 0);
    at += 1;
    const length = unsigned();
    const name = new TextDecoder().decode(bytes.subarray(at, at + length));
    at += length;
    if (prefix === '+' || prefix === '=') used.push(name);
  }
  return used;
}

describe('the canonical DSP module', () => {
  const module = new WebAssembly.Module(dspModuleBytes());
  const sections = WebAssembly.Module.customSections(module, 'target_features');

  it('says which WebAssembly features it uses', () => {
    expect(sections).toHaveLength(1);
    expect(FLOOR.size).toBeGreaterThan(0);
  });

  it('uses only features every browser at the floor compiles', () => {
    const [section] = sections;
    const used = section === undefined ? [] : featuresUsed(section);
    expect(used.length).toBeGreaterThan(0);

    const aboveTheFloor = used.flatMap((feature) => {
      const versions = FEATURES.get(feature);
      if (versions === undefined)
        return [`${feature}, whose first versions this rule does not list`];
      return [...FLOOR].flatMap(([engine, floor]) => {
        const first = firstIn(versions, engine);
        if (first === undefined)
          return [`${feature} in ${engine}, an engine this rule does not know`];
        return atOrBefore(first, floor) ? [] : [`${feature}, first in ${engine} ${first}`];
      });
    });
    expect(aboveTheFloor).toEqual([]);
  });
});
