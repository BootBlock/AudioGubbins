import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { manifestJson, readModelPackManifest, readPackCatalogue } from '@audiogubbins/model-packs';

import { packFilePathProblem } from '../packages/model-packs/src/pack-path.js';
import { PACK_CAPABILITIES } from '../packages/model-packs/src/pack-capability.js';
import { LONGEST_FILE_BYTES } from '../packages/model-packs/src/pack-limits.js';
import { PACK_TIERS } from '../packages/model-packs/src/pack-tier.js';

import {
  catalogueText,
  loadPackDefinitions,
  manifestText,
  readPackDefinition,
  type PackDefinition,
} from '../tools/model-packs/pack-definitions.mjs';
import { makePack } from '../tools/model-packs/pack-making.mjs';
import {
  outputProblems,
  packFolder,
  packsPresent,
  publishPack,
  writeCatalogue,
} from '../tools/model-packs/pack-output.mjs';
import { decideLicence } from '../tools/sync-third-party-notices.mjs';
import { inRepository } from './repository.js';

/**
 * The model-pack build (ADR-0062, REQ-REPO-191), asked without the network:
 * whether every committed definition publishes the manifest and catalogue
 * `packages/model-packs` reads, and whether the build refuses what it must.
 * The packs themselves are built from sources made here, served through the
 * build's download port, so each case says what it asserts and fetches
 * nothing; the real sources are the build's own run's to fetch and check.
 */

const DEFINITIONS = loadPackDefinitions();

/** The packs ADR-0062 names as the first. */
const FIRST_PACKS = [
  'deepfilternet-3',
  'mossformer2-se-48k',
  'spleeter-2-stems',
  'spleeter-4-stems',
];

function sha256Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** A committed definition, as a document a case can change before it is read. */
function definitionDocument(id: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(inRepository('tools', 'model-packs', 'packs', `${id}.json`), 'utf8'),
  ) as Record<string, unknown>;
}

/** A definition document with its first file's path replaced. */
function withFirstPath(path: string): Record<string, unknown> {
  const document = definitionDocument('deepfilternet-3');
  const files = document['files'] as Record<string, unknown>[];
  files[0] = { ...files[0], path };
  return document;
}

/** A manifest the package's reader accepts, with its first file's path replaced. */
function manifestWithPath(path: string): string {
  const definition = DEFINITIONS.find((one) => one.id === 'deepfilternet-3')!;
  const manifest = JSON.parse(manifestText(definition)) as { files: { path: string }[] };
  manifest.files[0]!.path = path;
  return JSON.stringify(manifest);
}

describe('the committed pack definitions', () => {
  it('define the first packs', () => {
    expect(DEFINITIONS.map((one) => one.id)).toEqual(FIRST_PACKS);
  });

  it.each(DEFINITIONS.map((one) => [one.id, one] as const))(
    "publish %s's manifest as the package reads and writes it, member for member",
    (_id, definition) => {
      const text = manifestText(definition);
      const read = readModelPackManifest(text);
      expect(read.ok, JSON.stringify(read)).toBe(true);
      if (!read.ok) return;
      // Written back by the package, the document is the one the build wrote,
      // so no member is dropped, renamed or reordered on the way.
      expect(manifestJson(read.value)).toEqual(JSON.parse(text));
      expect(`${JSON.stringify(manifestJson(read.value), null, 2)}\n`).toBe(text);
    },
  );

  it("publish a catalogue the package's reader accepts whole", () => {
    const read = readPackCatalogue(catalogueText(DEFINITIONS));
    expect(read.ok, JSON.stringify(read)).toBe(true);
    if (read.ok) expect(read.value.map((pack) => pack.id)).toEqual(FIRST_PACKS);
  });

  it.each(DEFINITIONS.map((one) => [one.id, one] as const))(
    'state %s as large as its files, which add up to its download',
    (_id, definition) => {
      const read = readModelPackManifest(manifestText(definition));
      if (!read.ok) throw new Error(JSON.stringify(read));
      const sum = definition.files.reduce((total, file) => total + file.bytes, 0);
      expect(read.value.downloadBytes).toBe(sum);
      expect(read.value.installedBytes).toBeGreaterThanOrEqual(sum);
    },
  );

  it.each(DEFINITIONS.map((one) => [one.id, one] as const))(
    "state %s's licences as ones the repository allows",
    (_id, definition) => {
      expect(decideLicence(definition.licence.code)).toMatchObject({ allowed: true });
      expect(decideLicence(definition.licence.weights)).toMatchObject({ allowed: true });
      expect(definition.licence.evidence.length).toBeGreaterThan(0);
    },
  );

  it.each(DEFINITIONS.map((one) => [one.id, one] as const))(
    'run %s on the runtime version the inference package pins',
    (_id, definition) => {
      // A runtime upgraded without the packs checked against it again would
      // leave every pack incompatible with the build that carries it.
      const pinned = (
        JSON.parse(
          readFileSync(inRepository('packages', 'ml-runtime', 'package.json'), 'utf8'),
        ) as {
          dependencies: Record<string, string>;
        }
      ).dependencies[definition.runtime.name];
      expect(pinned).toBeDefined();
      const parts = (version: string) => version.split('.').map(Number);
      const compare = (one: string, other: string) => {
        const [a, b] = [parts(one), parts(other)];
        return (a[0]! - b[0]!) * 1e12 + (a[1]! - b[1]!) * 1e6 + (a[2]! - b[2]!);
      };
      expect(compare(pinned!, definition.runtime.minimum)).toBeGreaterThanOrEqual(0);
      expect(compare(pinned!, definition.runtime.below)).toBeLessThan(0);
    },
  );
});

describe('a pack definition is refused', () => {
  it('where it is read as committed, accepted', () => {
    // The cases below change one value of this document; it is accepted as is.
    expect(readPackDefinition(definitionDocument('deepfilternet-3'))).toMatchObject({ ok: true });
  });

  it.each([
    ['a climb out of the pack', '../enc.onnx'],
    ['a climb part way', 'models/../../enc.onnx'],
    ['an absolute path', '/enc.onnx'],
    ['a drive', 'C:/enc.onnx'],
    ['a backslash', 'models\\enc.onnx'],
    ['the extended-length form', '\\\\?\\C:\\enc.onnx'],
    ['a share', '\\\\example.test\\share\\enc.onnx'],
    ['a share written with slashes', '//example.test/share/enc.onnx'],
    ['an empty segment', 'models//enc.onnx'],
    ['a dot segment', './enc.onnx'],
    ['a hidden file', '.enc.onnx'],
    ['a space', 'enc model.onnx'],
  ])('where a file path is %s, as the package refuses it', (_case, path) => {
    const reading = readPackDefinition(withFirstPath(path));
    expect(reading.ok).toBe(false);
    // Refused by the package's own grammar, so for its reason, not a copy's.
    const reason = packFilePathProblem(path);
    expect(reason).toBeDefined();
    if (!reading.ok) expect(reading.problems).toContain(`files[0].path: ${String(reason)}`);
    // The two readers agree: a path the build would write is one the
    // application would install, and the other way about.
    expect(readModelPackManifest(manifestWithPath(path)).ok).toBe(false);
  });

  it.each([
    ['a render quality level', 'high'],
    ['the render quality levels it once listed', ['draft', 'standard']],
    ['a word no tier is', 'fastest'],
  ])('where its tier is %s, not the model’s own tier', (_case, tier) => {
    const document = definitionDocument('deepfilternet-3');
    document['tier'] = tier;
    const reading = readPackDefinition(document);
    expect(reading).toEqual({
      ok: false,
      problems: [`tier: is not one of ${PACK_TIERS.join(', ')}`],
    });
  });

  it("where a file would take the pack's manifest's name", () => {
    const reading = readPackDefinition(withFirstPath('Manifest.json'));
    expect(reading.ok).toBe(false);
    if (!reading.ok) expect(reading.problems.join('\n')).toContain('manifest');
  });

  it('where a file is the folder of a later one, at the file the package names', () => {
    // The package's one rule: the file another lies inside is refused, not
    // the one inside it, whichever comes first.
    const document = definitionDocument('deepfilternet-3');
    const files = document['files'] as Record<string, unknown>[];
    files[0] = { ...files[0], path: 'models' };
    files[1] = { ...files[1], path: 'models/erb_dec.onnx' };
    const reading = readPackDefinition(document);
    expect(reading.ok).toBe(false);
    if (!reading.ok) {
      expect(reading.problems.filter((problem) => problem.startsWith('files['))).toEqual([
        'files[0].path: is the path of a file before it, in any case, or holds another file',
      ]);
    }
  });

  it.each(['webgpu', 'shared-array-buffer'])(
    'where its runtime needs %s, a capability no build of the runtime uses',
    (capability) => {
      const document = definitionDocument('deepfilternet-3');
      document['runtime'] = { ...(document['runtime'] as object), capabilities: [capability] };
      expect(readPackDefinition(document)).toEqual({
        ok: false,
        problems: [`runtime.capabilities[0]: is not one of ${PACK_CAPABILITIES.join(', ')}`],
      });
    },
  );

  it('where a file is longer than the package lets a pack file be', () => {
    const document = definitionDocument('deepfilternet-3');
    const files = document['files'] as Record<string, unknown>[];
    files[0] = { ...files[0], bytes: LONGEST_FILE_BYTES + 1 };
    const reading = readPackDefinition(document);
    expect(reading.ok).toBe(false);
    if (!reading.ok) expect(reading.problems.join(' ')).toContain(String(LONGEST_FILE_BYTES));
  });

  it('where two files collide in a case-insensitive file system', () => {
    const document = definitionDocument('deepfilternet-3');
    const files = document['files'] as Record<string, unknown>[];
    files[1] = { ...files[1], path: 'ENC.onnx' };
    expect(readPackDefinition(document).ok).toBe(false);
  });

  it.each([
    ['code', 'GPL-3.0-only'],
    ['weights', 'CC-BY-NC-4.0'],
    ['weights', 'LicenseRef-research-only'],
  ])('where its %s licence is %s, which is not allowed', (part, licence) => {
    const document = definitionDocument('spleeter-2-stems');
    document['licence'] = { ...(document['licence'] as object), [part]: licence };
    const reading = readPackDefinition(document);
    expect(reading.ok).toBe(false);
    if (!reading.ok) expect(reading.problems.join('\n')).toContain(`licence.${part}`);
  });

  it('where a hash is not a SHA-256', () => {
    const document = definitionDocument('deepfilternet-3');
    const sources = document['sources'] as Record<string, unknown>[];
    sources[0] = { ...sources[0], sha256: 'C94D91F7' };
    expect(readPackDefinition(document).ok).toBe(false);
  });

  it('where a source is not fetched over https', () => {
    const document = definitionDocument('deepfilternet-3');
    const sources = document['sources'] as Record<string, unknown>[];
    sources[0] = { ...sources[0], url: 'http://example.com/models.tar.gz' };
    expect(readPackDefinition(document).ok).toBe(false);
  });

  it('where an export names a placeholder that is no path', () => {
    const document = definitionDocument('spleeter-2-stems');
    const files = document['files'] as { make: { export: { arguments: string[] } } }[];
    files[0]!.make.export.arguments.push('{source:elsewhere}');
    const reading = readPackDefinition(document);
    expect(reading.ok).toBe(false);
    if (!reading.ok) expect(reading.problems.join('\n')).toContain('{source:elsewhere}');
  });
});

/** One member of a ustar archive. */
interface Member {
  readonly name: string;
  readonly data: Buffer;
}

/** A gzipped ustar archive of `members`, as the sources' archives are written. */
function tarGz(members: readonly Member[]): Buffer {
  const blocks: Buffer[] = [];
  for (const { name, data } of members) {
    const header = Buffer.alloc(512);
    header.write(name, 0, 'utf8');
    header.write('0000644\0', 100);
    header.write('0000000\0', 108);
    header.write('0000000\0', 116);
    header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
    header.write('00000000000\0', 136);
    header.write('        ', 148);
    header.write('0', 156);
    header.write('ustar\0', 257);
    header.write('00', 263);
    const sum = header.reduce((total, byte) => total + byte, 0);
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

describe('the pack build', () => {
  const MODEL = Buffer.from('a model of a few bytes, standing in for its weights');
  const LICENCE = Buffer.from('MIT License, as a source states it\n');
  const ARCHIVE = tarGz([
    { name: './._model.bin', data: Buffer.from('a resource fork') },
    { name: 'export/model.bin', data: MODEL },
  ]);
  const NOTICE = readFileSync(
    inRepository('tools', 'model-packs', 'notices', 'deepfilternet-3.txt'),
  );

  /** What the fake download serves, by URL. */
  const SERVED = new Map<string, Buffer>([
    ['https://example.com/model.tar.gz', ARCHIVE],
    ['https://example.com/LICENSE', LICENCE],
  ]);

  let folder: string;
  let downloads: string[];

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'audiogubbins-packs-'));
    downloads = [];
  });

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  /** A definition of a pack made from the served sources. */
  function definitionOf(modelSha256 = sha256Of(MODEL)): PackDefinition {
    const reading = readPackDefinition({
      id: 'test-pack',
      version: '1.2.3',
      name: 'Test pack',
      purpose: 'Stands in for a model pack.',
      licence: {
        code: 'MIT',
        weights: 'MIT',
        evidence: [{ url: 'https://example.com/licence', says: 'Licensed under MIT.' }],
      },
      runtime: {
        name: 'onnxruntime-web',
        minimum: '1.30.0',
        below: '1.31.0',
        capabilities: ['webassembly-simd'],
      },
      tier: 'light',
      serves: { processors: ['test-denoise'], detectors: [] },
      sources: [
        {
          id: 'archive',
          url: 'https://example.com/model.tar.gz',
          bytes: ARCHIVE.length,
          sha256: sha256Of(ARCHIVE),
          archive: 'tar.gz',
        },
        {
          id: 'licence',
          url: 'https://example.com/LICENSE',
          bytes: LICENCE.length,
          sha256: sha256Of(LICENCE),
        },
      ],
      files: [
        {
          path: 'models/model.bin',
          bytes: MODEL.length,
          sha256: modelSha256,
          make: { extract: { source: 'archive', member: 'export/model.bin' } },
        },
        {
          path: 'LICENSE',
          bytes: LICENCE.length,
          sha256: sha256Of(LICENCE),
          make: { copy: 'licence' },
        },
        {
          path: 'NOTICE',
          bytes: NOTICE.length,
          sha256: sha256Of(NOTICE),
          make: { notice: 'deepfilternet-3.txt' },
        },
      ],
    });
    if (!reading.ok) throw new Error(reading.problems.join('\n'));
    return reading.definition;
  }

  /** Builds `definition` into the output, through a download serving `served`. */
  async function build(definition: PackDefinition, served = SERVED): Promise<string> {
    const out = join(folder, 'out');
    const services = {
      cache: join(folder, 'cache'),
      download: (url: string, path: string): Promise<void> => {
        downloads.push(url);
        const bytes = served.get(url);
        if (bytes === undefined) return Promise.reject(new Error(`${url} is not served`));
        writeFileSync(path, bytes);
        return Promise.resolve();
      },
      python: () => Promise.reject(new Error('No export runs in this pack.')),
      report: () => undefined,
    };
    await publishPack(out, definition, (staging) => makePack(definition, staging, services));
    await writeCatalogue(out, await packsPresent(out, [definition]));
    return out;
  }

  it('writes the pack, its manifest and the catalogue as the application reads them', async () => {
    const definition = definitionOf();
    const out = await build(definition);
    const pack = packFolder(out, definition);

    expect(readFileSync(join(pack, 'models', 'model.bin'))).toEqual(MODEL);
    expect(readFileSync(join(pack, 'LICENSE'))).toEqual(LICENCE);
    expect(readModelPackManifest(readFileSync(join(pack, 'manifest.json'), 'utf8')).ok).toBe(true);
    const catalogue = readPackCatalogue(readFileSync(join(out, 'catalogue.json'), 'utf8'));
    expect(catalogue.ok && catalogue.value.map((one) => `${one.id}@${one.version}`)).toEqual([
      'test-pack@1.2.3',
    ]);
    expect(await outputProblems(out, [definition], [definition])).toEqual([]);
  });

  it('fetches no source the cache already holds with its hash', async () => {
    const definition = definitionOf();
    await build(definition);
    expect(downloads).toHaveLength(2);
    await build(definition);
    expect(downloads).toHaveLength(2);
  });

  it('refuses a made file whose hash is not the one its definition records, naming both', async () => {
    const recorded = 'a'.repeat(64);
    const definition = definitionOf(recorded);
    const failure = build(definition);
    await expect(failure).rejects.toThrow('models/model.bin');
    await expect(failure).rejects.toThrow(recorded);
    await expect(failure).rejects.toThrow(sha256Of(MODEL));
    // Nothing of the refused pack is left where the catalogue would serve it.
    expect(existsSync(packFolder(join(folder, 'out'), definition))).toBe(false);
  });

  it('refuses a source that is not the file its definition names, and keeps none of it', async () => {
    const forged = Buffer.from(LICENCE);
    forged[0] = 0x6e;
    const served = new Map(SERVED).set('https://example.com/LICENSE', forged);
    const failure = build(definitionOf(), served);
    await expect(failure).rejects.toThrow(sha256Of(LICENCE));
    await expect(failure).rejects.toThrow(sha256Of(forged));
    // The forgery is not kept, so the next build fetches the source again.
    await build(definitionOf());
    expect(downloads.filter((url) => url.endsWith('/LICENSE'))).toHaveLength(2);
  });

  it('refuses an archive that does not hold a member the definition takes', async () => {
    const served = new Map(SERVED);
    const other = tarGz([{ name: 'export/other.bin', data: MODEL }]);
    served.set('https://example.com/model.tar.gz', other);
    const document = definitionOf();
    const definition: PackDefinition = {
      ...document,
      sources: document.sources.map((source) =>
        source.id === 'archive'
          ? { ...source, bytes: other.length, sha256: sha256Of(other) }
          : source,
      ),
    };
    await expect(build(definition, served)).rejects.toThrow('export/model.bin');
  });

  it('finds, in its check of an output, a file changed after it was built', async () => {
    const definition = definitionOf();
    const out = await build(definition);
    const model = join(packFolder(out, definition), 'models', 'model.bin');
    const changed = Buffer.from(MODEL);
    changed[0] = 0x41;
    writeFileSync(model, changed);
    const problems = await outputProblems(out, [definition], [definition]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('models/model.bin');
    expect(problems[0]).toContain(sha256Of(changed));
  });
});
