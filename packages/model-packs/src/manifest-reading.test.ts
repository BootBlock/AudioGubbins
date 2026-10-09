import { describe, expect, it } from 'vitest';

import type { DomainResult } from '@audiogubbins/domain';
import type { JsonValue } from '@audiogubbins/project-format';

import { readPackCatalogue } from './catalogue-reading.js';
import { readModelPackManifest } from './manifest-reading.js';
import { manifestJson } from './manifest-writing.js';

/** The most files a pack may name, and the longest file: 2 GiB. */
const MOST_FILES = 64;
const LONGEST_FILE_BYTES = 2 ** 31;
import { sampleManifest } from './testing/sample-packs.js';

const VALID = manifestJson(sampleManifest());

/** A manifest's document, every member open to a test's change. */
interface Editable {
  format?: JsonValue;
  id?: JsonValue;
  name?: JsonValue;
  purpose?: JsonValue;
  version?: JsonValue;
  downloadBytes?: JsonValue;
  installedBytes?: JsonValue;
  files: { path: JsonValue; bytes: JsonValue; sha256: JsonValue }[];
  licence?: JsonValue;
  runtime: { name: JsonValue; minimum: JsonValue; below: JsonValue; capabilities: JsonValue };
  tier?: JsonValue;
  serves?: JsonValue;
  uploadTo?: JsonValue;
}

/** The sample manifest's document, with `change` made to it, as text. */
function edited(change: (document: Editable) => void): string {
  const manifest = sampleManifest();
  const document: Editable = {
    format: 1,
    id: manifest.id,
    name: manifest.name,
    purpose: manifest.purpose,
    version: manifest.version,
    downloadBytes: manifest.downloadBytes,
    installedBytes: manifest.installedBytes,
    files: manifest.files.map((file) => ({ ...file })),
    licence: { ...manifest.licence },
    runtime: { ...manifest.runtime, capabilities: [...manifest.runtime.capabilities] },
    tier: manifest.tier,
    serves: {
      processors: [...manifest.serves.processors],
      detectors: [...manifest.serves.detectors],
    },
  };
  change(document);
  return JSON.stringify(document);
}

function codes<TValue>(result: DomainResult<TValue>): readonly string[] {
  return result.ok ? [] : result.failures.map((failure) => failure.code);
}

function places<TValue>(result: DomainResult<TValue>): readonly unknown[] {
  return result.ok ? [] : result.failures.map((failure) => failure.details?.['at']);
}

describe('reading a manifest', () => {
  it('reads what it writes, every member', () => {
    expect(readModelPackManifest(JSON.stringify(VALID))).toEqual({
      ok: true,
      value: sampleManifest(),
    });
    expect(readModelPackManifest(edited(() => undefined))).toEqual({
      ok: true,
      value: sampleManifest(),
    });
  });

  it.each([
    ['not JSON', '{"id": '],
    ['an array', '[]'],
    ['a string', '"manifest"'],
    ['null', 'null'],
  ])('refuses %s', (_case, text) => {
    expect(readModelPackManifest(text).ok).toBe(false);
  });

  it('refuses text past its bound before parsing it', () => {
    const long = `{"pad": "${'x'.repeat(256 * 1024)}"}`;
    expect(codes(readModelPackManifest(long))).toEqual(['json.too-long']);
  });

  it('refuses nesting past its bound', () => {
    const deep = `${'['.repeat(40)}${']'.repeat(40)}`;
    expect(readModelPackManifest(deep).ok).toBe(false);
  });

  it('refuses a member it does not know rather than ignoring it', () => {
    const read = readModelPackManifest(edited((document) => (document.uploadTo = 'x')));
    expect(codes(read)).toEqual(['schema.unknown-member']);
  });

  it('refuses another format', () => {
    expect(codes(readModelPackManifest(edited((document) => (document.format = 2))))).toEqual([
      'model-pack.format-unknown',
    ]);
  });

  it('reports every problem at once, each where it is', () => {
    const read = readModelPackManifest(
      edited((document) => {
        delete document.name;
        document.version = '1.0';
        const [first] = document.files;
        if (first !== undefined) first.sha256 = 'A'.repeat(64);
      }),
    );
    expect(codes(read)).toEqual([
      'schema.missing-member',
      'schema.text-malformed',
      'model-pack.hash-malformed',
    ]);
    expect(places(read)).toEqual(['manifest.name', 'manifest.version', 'manifest.files[0].sha256']);
  });

  it.each([
    ['upper-case hexadecimal', 'A'.repeat(64)],
    ['too short', 'a'.repeat(63)],
    ['too long', 'a'.repeat(65)],
    ['not hexadecimal', 'g'.repeat(64)],
    ['a number', 7],
  ])('refuses a hash that is %s', (_case, hash) => {
    const read = readModelPackManifest(
      edited((document) => {
        const [first] = document.files;
        if (first !== undefined) first.sha256 = hash;
      }),
    );
    expect(codes(read)).toEqual(['model-pack.hash-malformed']);
  });

  it.each([
    ['climbs out with ..', '../escape.onnx', /never climbs out/],
    ['climbs out part way', 'models/../../escape.onnx', /never climbs out/],
    ['is absolute', '/etc/passwd', /never absolute/],
    ['names a drive', 'C:/models/a.onnx', /never absolute/],
    ['uses a backslash', 'models\\a.onnx', /never a backslash/],
    ['has an empty segment', 'models//a.onnx', /no empty or `.` segment/],
    ['ends in a slash', 'models/', /no empty or `.` segment/],
    ['has a . segment', './a.onnx', /no empty or `.` segment/],
    ['is hidden', '.a.onnx', /not starting with a dot/],
    ['holds a space', 'a b.onnx', /not starting with a dot/],
    ['is empty', '', /no empty or `.` segment/],
    ['is too long', 'a'.repeat(256), /at most 255/],
    ['is too deep', 'a/b/c/d/e/f/g/h/i.onnx', /at most 8 segments/],
  ])('refuses a file path that %s', (_case, path, why) => {
    const read = readModelPackManifest(
      edited((document) => {
        const [first] = document.files;
        if (first !== undefined) first.path = path;
      }),
    );
    expect(codes(read)).toEqual(['model-pack.path-unsafe']);
    expect(read.ok ? '' : read.failures[0].summary).toMatch(why);
  });

  it('admits a path of several segments', () => {
    const read = readModelPackManifest(
      edited((document) => {
        const [first] = document.files;
        if (first !== undefined) first.path = 'models/v1/decoder_2.onnx';
      }),
    );
    expect(read.ok).toBe(true);
  });

  it('refuses a path another file has in another case, or lies inside', () => {
    const repeated = readModelPackManifest(
      edited((document) => {
        const { files } = document;
        document.files = [...files, { path: 'ENCODER.onnx', bytes: 1, sha256: 'a'.repeat(64) }];
        document.downloadBytes = 9;
        document.installedBytes = 9;
      }),
    );
    expect(codes(repeated)).toEqual(['model-pack.path-collides']);

    const nested = readModelPackManifest(
      edited((document) => {
        const { files } = document;
        document.files = [
          ...files,
          { path: 'encoder.onnx/inner', bytes: 1, sha256: 'a'.repeat(64) },
        ];
        document.downloadBytes = 9;
        document.installedBytes = 9;
      }),
    );
    expect(codes(nested)).toEqual(['model-pack.path-collides']);
  });

  it('bounds the files a pack names, their lengths and their count', () => {
    const none = readModelPackManifest(edited((document) => (document.files = [])));
    expect(codes(none)).toEqual(['model-pack.list-empty']);

    const many = readModelPackManifest(
      edited((document) => {
        document.files = Array.from({ length: MOST_FILES + 1 }, (_, index) => ({
          path: `f${String(index)}`,
          bytes: 1,
          sha256: 'a'.repeat(64),
        }));
      }),
    );
    expect(codes(many)).toEqual(['schema.too-many-items']);

    for (const bytes of [0, -1, 1.5, LONGEST_FILE_BYTES + 1, Number.MAX_SAFE_INTEGER]) {
      const read = readModelPackManifest(
        edited((document) => {
          const [first] = document.files;
          if (first !== undefined) first.bytes = bytes;
        }),
      );
      expect(read.ok).toBe(false);
    }
  });

  it('refuses a download size that is not the sum of the files', () => {
    const read = readModelPackManifest(edited((document) => (document.downloadBytes = 9)));
    expect(codes(read)).toEqual(['model-pack.download-size-mismatch']);
  });

  it('refuses an installed size smaller than the download', () => {
    const read = readModelPackManifest(edited((document) => (document.installedBytes = 7)));
    expect(codes(read)).toEqual(['model-pack.installed-size-short']);
  });

  it('refuses a runtime range that holds no version', () => {
    for (const below of ['1.30.0', '1.29.9']) {
      const read = readModelPackManifest(edited((document) => (document.runtime.below = below)));
      expect(codes(read)).toEqual(['model-pack.runtime-range-empty']);
    }
  });

  it('refuses a capability it does not know, and more than there are', () => {
    const unknown = readModelPackManifest(
      edited((document) => (document.runtime.capabilities = ['quantum-cores'])),
    );
    expect(codes(unknown)).toEqual(['schema.unknown-value']);
    const twice = readModelPackManifest(
      edited(
        (document) => (document.runtime.capabilities = ['webassembly-simd', 'webassembly-simd']),
      ),
    );
    // One capability is all there is, so a second, the same named again, is
    // one too many.
    expect(codes(twice)).toEqual(['schema.too-many-items']);
  });

  it('refuses a capability no build of the runtime uses: WebGPU and shared memory', () => {
    // The runtime runs one build on one thread, so a pack listing either
    // would claim a need nothing here meets.
    for (const capability of ['webgpu', 'shared-array-buffer']) {
      const read = readModelPackManifest(
        edited((document) => (document.runtime.capabilities = [capability])),
      );
      expect(codes(read), capability).toEqual(['schema.unknown-value']);
    }
  });

  it('reads the model’s own tier, one of the pack tiers', () => {
    for (const tier of ['light', 'balanced', 'thorough']) {
      const read = readModelPackManifest(edited((document) => (document.tier = tier)));
      expect(read.ok && read.value.tier).toBe(tier);
    }
  });

  it('refuses a render quality level for a tier, a list of tiers, another word, or none', () => {
    // A tier describes the model, not a render mode: the quality levels the
    // manifest once listed as the tiers a pack served are no tier.
    for (const tier of ['high', 'standard', ['light'], 'custom']) {
      const read = readModelPackManifest(edited((document) => (document.tier = tier)));
      expect(codes(read), JSON.stringify(tier)).toEqual(['schema.unknown-value']);
    }
    const none = readModelPackManifest(edited((document) => delete document.tier));
    expect(none.ok).toBe(false);
    const listed = readModelPackManifest(
      edited((document) => {
        delete document.tier;
        Object.assign(document, { tiers: ['standard', 'high'] });
      }),
    );
    expect(listed.ok).toBe(false);
  });

  it('refuses a pack that serves nothing, or a type key of another shape', () => {
    const nothing = readModelPackManifest(
      edited((document) => (document.serves = { processors: [], detectors: [] })),
    );
    expect(codes(nothing)).toEqual(['model-pack.serves-nothing']);
    const shaped = readModelPackManifest(
      edited((document) => (document.serves = { processors: ['Denoise!'], detectors: [] })),
    );
    expect(codes(shaped)).toEqual(['schema.text-malformed']);
  });

  it('refuses an id that is not a lower-case name, and prose with a control character', () => {
    for (const id of ['Sample', '-sample', 'sample-', 'sa mple', '', 'a'.repeat(65)]) {
      expect(readModelPackManifest(edited((document) => (document.id = id))).ok).toBe(false);
    }
    expect(
      readModelPackManifest(edited((document) => (document.purpose = 'Removes\u0007noise.'))).ok,
    ).toBe(false);
  });

  it('never quotes a value it refuses', () => {
    const secret = 'C:/Users/someone/secret.onnx';
    const read = readModelPackManifest(
      edited((document) => {
        const [first] = document.files;
        if (first !== undefined) first.path = secret;
      }),
    );
    expect(JSON.stringify(read)).not.toContain('someone');
  });
});

describe('reading a catalogue', () => {
  it('reads every manifest it lists', () => {
    const later = sampleManifest({ version: '1.1.0' });
    const read = readPackCatalogue(
      JSON.stringify({ format: 1, packs: [VALID, manifestJson(later)] }),
    );
    expect(read).toEqual({ ok: true, value: [sampleManifest(), later] });
  });

  it('refuses the whole catalogue where one manifest is not one', () => {
    const broken = edited((document) => (document.downloadBytes = 1));
    const read = readPackCatalogue(`{"format": 1, "packs": [${JSON.stringify(VALID)}, ${broken}]}`);
    expect(codes(read)).toEqual(['model-pack.download-size-mismatch']);
    expect(places(read)).toEqual(['catalogue.packs[1].downloadBytes']);
  });

  it('refuses a version listed twice', () => {
    const read = readPackCatalogue(JSON.stringify({ format: 1, packs: [VALID, VALID] }));
    expect(codes(read)).toEqual(['model-pack.repeated']);
  });

  it('refuses another format, and a catalogue that is not an object', () => {
    expect(codes(readPackCatalogue(JSON.stringify({ format: 3, packs: [] })))).toEqual([
      'model-pack.format-unknown',
    ]);
    expect(codes(readPackCatalogue('[]'))).toEqual(['schema.not-an-object']);
  });
});
