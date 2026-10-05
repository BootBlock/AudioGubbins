import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { SCHEMA_VERSIONS } from '@audiogubbins/version';
import { sampleProject } from '@audiogubbins/test-fixtures';

import {
  canonicalJson,
  isJsonArray,
  isJsonObject,
  memberOf,
  type JsonValue,
} from './canonical-json.js';
import { parseJson } from './json-parsing.js';
import {
  PROJECT_DOCUMENT_FORMAT,
  parseProjectDocument,
  readProjectDocument,
  compactProjectDocument,
  stateFingerprintOf,
  writeProjectDocument,
} from './project-json.js';
import type { ProjectState } from './project-state.js';
import { edited, valueAt, withValue, without, type Step } from './testing/json-editing.js';
import { nodeDigest } from './testing/node-digest.js';
import { referenceState } from './testing/project-states.js';
import { randomState } from './testing/random-states.js';
import { seededRandom } from './testing/random-values.js';

const LIMITS = { maximumLength: 2 ** 28, maximumDepth: 32 };

/** The written reference state, the document every refusal edits. */
const REFERENCE = referenceState(sampleProject());
const DOCUMENT = writeProjectDocument(REFERENCE);

/** A well-formed identifier that names nothing in the reference state. */
const UNKNOWN_ID = 'ffffffff-ffffffff-ffffffff-ffffffff';

/** The index in the written sources of the one kept by the given kind. */
function sourceIndex(kind: 'managed' | 'external'): number {
  const sources = valueAt(DOCUMENT, ['sources']);
  const index = isJsonArray(sources)
    ? sources.findIndex((source) => valueAt(source, ['media', 'kind']) === kind)
    : -1;
  if (index < 0) throw new Error(`The reference state has no ${kind} source.`);
  return index;
}
const MANAGED = sourceIndex('managed');
const EXTERNAL = sourceIndex('external');

/** A number read from the reference document. */
function numberAt(path: readonly Step[]): number {
  const value = valueAt(DOCUMENT, path);
  if (typeof value !== 'number') throw new Error(`No number at ${path.join('.')}.`);
  return value;
}

/** Each failure's code and where it was found. */
function problemsOf(value: JsonValue): readonly (readonly [string, unknown])[] {
  const result = readProjectDocument(value);
  return result.ok
    ? []
    : result.failures.map((problem) => [problem.code, problem.details?.['at']] as const);
}

/** The same value with every object's members inserted in reverse order. */
function reversedMembers(value: JsonValue): JsonValue {
  if (isJsonArray(value)) return value.map(reversedMembers);
  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .reverse()
        .map((key) => [key, reversedMembers(memberOf(value, key) ?? null)]),
    );
  }
  return value;
}

/** The same document with every entity list reversed. */
function reversedLists(document: JsonValue): JsonValue {
  let changed = edited(document, ['sources'], (list) =>
    Array.isArray(list) ? [...list].reverse() : list,
  );
  for (const kind of ['assets', 'tracks', 'buses', 'clips', 'regions', 'markers', 'effectChains']) {
    changed = edited(changed, ['project', kind], (list) =>
      Array.isArray(list) ? [...list].reverse() : list,
    );
  }
  return changed;
}

describe('the project document', () => {
  it('opens with its format and this build’s schema version', () => {
    expect(memberOf(DOCUMENT, 'format')).toBe(PROJECT_DOCUMENT_FORMAT);
    expect(memberOf(DOCUMENT, 'schemaVersion')).toBe(SCHEMA_VERSIONS.projectDocument);
    expect(Object.keys(DOCUMENT).sort()).toEqual(['format', 'project', 'schemaVersion', 'sources']);
  });

  it('reads back as the state it was written from', () => {
    expect(expectSuccess(readProjectDocument(DOCUMENT))).toEqual(REFERENCE);
    expect(
      expectSuccess(parseProjectDocument(expectSuccess(compactProjectDocument(REFERENCE)))),
    ).toEqual(REFERENCE);
  });

  it('writes the same text again from what it read, byte for byte', () => {
    const text = expectSuccess(compactProjectDocument(REFERENCE));
    expect(expectSuccess(compactProjectDocument(expectSuccess(parseProjectDocument(text))))).toBe(
      text,
    );
  });

  it('reads the same state whatever order members and entities are written in', () => {
    const shuffled = reversedLists(reversedMembers(DOCUMENT));
    expect(canonicalJson(shuffled)).not.toBe(canonicalJson(DOCUMENT));
    const read = expectSuccess(readProjectDocument(shuffled));
    expect(read).toEqual(REFERENCE);
    expect(expectSuccess(compactProjectDocument(read))).toBe(
      expectSuccess(compactProjectDocument(REFERENCE)),
    );
  });

  it('writes the same document whatever order the state’s maps were built in', () => {
    const { project, sources } = REFERENCE;
    const reversed = <TKey, TValue>(map: ReadonlyMap<TKey, TValue>): Map<TKey, TValue> =>
      new Map([...map].reverse());
    const rebuilt: ProjectState = {
      project: {
        ...project,
        assets: reversed(project.assets),
        tracks: reversed(project.tracks),
        clips: reversed(project.clips),
      },
      sources: reversed(sources),
    };
    expect(canonicalJson(writeProjectDocument(rebuilt))).toBe(canonicalJson(DOCUMENT));
  });
});

describe('a seeded property: every valid state survives the document', () => {
  it.each(Array.from({ length: 40 }, (_, block) => block))(
    'holds for seeds of block %i',
    (block) => {
      for (let seed = block * 10 + 1; seed <= block * 10 + 10; seed += 1) {
        const state = randomState(seed);
        const compact = canonicalJson(writeProjectDocument(state));
        const read = expectSuccess(readProjectDocument(expectSuccess(parseJson(compact, LIMITS))));
        expect(read, `seed ${String(seed)}`).toEqual(state);
        expect(canonicalJson(writeProjectDocument(read)), `seed ${String(seed)}`).toBe(compact);

        const text = expectSuccess(compactProjectDocument(state));
        expect(
          expectSuccess(compactProjectDocument(expectSuccess(parseProjectDocument(text)))),
          `seed ${String(seed)}`,
        ).toBe(text);
      }
    },
  );

  it('generates states with every kind of entity, so the property is not vacuous', () => {
    const totals = {
      assets: 0,
      tracks: 0,
      buses: 0,
      clips: 0,
      regions: 0,
      markers: 0,
      chains: 0,
      external: 0,
      managed: 0,
      loops: 0,
      busSends: 0,
      edits: 0,
      pastes: 0,
      conversions: 0,
      regionProcessing: 0,
      audioShapes: 0,
    };
    for (let seed = 1; seed <= 400; seed += 1) {
      const { project, sources } = randomState(seed);
      totals.assets += project.assets.size;
      totals.tracks += project.tracks.size;
      totals.buses += project.buses.size;
      totals.clips += project.clips.size;
      totals.regions += project.regions.size;
      totals.markers += project.markers.size;
      totals.chains += project.effectChains.size;
      totals.loops += [...project.regions.values()].filter(
        (region) => region.loop !== undefined,
      ).length;
      totals.busSends += [...project.buses.values()].filter(
        (bus) => bus.output?.kind === 'bus',
      ).length;
      for (const source of sources.values()) {
        totals[source.media.kind] += 1;
        if (source.provenance?.audio !== undefined) totals.audioShapes += 1;
      }
      for (const asset of project.assets.values()) {
        totals.edits += asset.edits.length;
        totals.pastes += asset.edits.filter((edit) => edit.kind === 'insert').length;
        totals.conversions += asset.edits.filter((edit) => edit.kind === 'convert-layout').length;
      }
      for (const region of project.regions.values()) {
        totals.regionProcessing += region.operations.length;
      }
    }
    for (const [kind, total] of Object.entries(totals)) expect(total, kind).toBeGreaterThan(50);
  });
});

describe('stateFingerprintOf', () => {
  it('is the SHA-256 of the compact canonical document, prefixed s1-', async () => {
    const text = canonicalJson(DOCUMENT);
    const expected = createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
    expect(await stateFingerprintOf(REFERENCE, nodeDigest)).toBe(`s1-${expected}`);
  });

  it('is stable across rebuilding the state and different for any change', async () => {
    const first = await stateFingerprintOf(REFERENCE, nodeDigest);
    expect(await stateFingerprintOf(referenceState(sampleProject()), nodeDigest)).toBe(first);

    const renamed: ProjectState = {
      ...REFERENCE,
      project: { ...REFERENCE.project, displayName: `${REFERENCE.project.displayName} ` },
    };
    expect(await stateFingerprintOf(renamed, nodeDigest)).not.toBe(first);
  });

  it('is different for every one of many random states', async () => {
    const fingerprints = new Set<string>();
    for (let seed = 1; seed <= 60; seed += 1) {
      fingerprints.add(await stateFingerprintOf(randomState(seed), nodeDigest));
    }
    expect(fingerprints.size).toBe(60);
  });
});

/** One edit of the reference document, and the refusal it must meet. */
interface Refusal {
  readonly edit: (document: JsonValue) => JsonValue;
  readonly code: string;
  readonly at: string;
}

const clipLength = numberAt(['project', 'clips', 0, 'timelineLength']);
const loopStart = numberAt(['project', 'regions', 0, 'loop', 'start']);
const loopEnd = numberAt(['project', 'regions', 0, 'loop', 'end']);
const clipAssetIndex = (() => {
  const assets = valueAt(DOCUMENT, ['project', 'assets']);
  const assetId = valueAt(DOCUMENT, ['project', 'clips', 0, 'source', 'assetId']);
  return isJsonArray(assets) ? assets.findIndex((asset) => valueAt(asset, ['id']) === assetId) : -1;
})();
const routedTrack = (() => {
  const tracks = valueAt(DOCUMENT, ['project', 'tracks']);
  return isJsonArray(tracks)
    ? tracks.findIndex((track) => valueAt(track, ['output', 'kind']) === 'bus')
    : -1;
})();
const trackIds = (() => {
  const order = valueAt(DOCUMENT, ['project', 'trackOrder']);
  return isJsonArray(order) ? order : [];
})();
const busId = valueAt(DOCUMENT, ['project', 'buses', 0, 'id']);
const externalAt = ['sources', EXTERNAL, 'media'] as const;
const managedAt = ['sources', MANAGED, 'media'] as const;
const managedAudioAt = ['sources', MANAGED, 'provenance', 'audio'] as const;

/** The length of the asset the document's thing at `path` names by its `assetId`. */
function lengthOfAssetAt(path: readonly Step[]): number {
  const assetId = valueAt(DOCUMENT, [...path, 'assetId']);
  const assets = valueAt(DOCUMENT, ['project', 'assets']);
  const index = isJsonArray(assets)
    ? assets.findIndex((asset) => valueAt(asset, ['id']) === assetId)
    : -1;
  return numberAt(['project', 'assets', index, 'length']);
}
const regionAssetLength = lengthOfAssetAt(['project', 'regions', 0]);
const markerAssetLength = lengthOfAssetAt(['project', 'markers', 0]);
const managedAssetLength = lengthOfAssetAt(['sources', MANAGED]);

const REFUSALS: Readonly<Record<string, Refusal>> = {
  'a member that should be an object': {
    edit: (document) => withValue(document, ['project', 'settings'], 5),
    code: 'schema.not-an-object',
    at: 'project.settings',
  },
  'a list that is not an array': {
    edit: (document) => withValue(document, ['project', 'tracks'], {}),
    code: 'schema.not-an-array',
    at: 'project.tracks',
  },
  'a name that is not text': {
    edit: (document) => withValue(document, ['project', 'displayName'], 1),
    code: 'schema.not-a-string',
    at: 'project.displayName',
  },
  'a gain that is not a number': {
    edit: (document) => withValue(document, ['project', 'clips', 0, 'gain'], 'loud'),
    code: 'schema.not-a-number',
    at: 'project.clips[0].gain',
  },
  'a fractional byte length': {
    edit: (document) => withValue(document, [...managedAt, 'byteLength'], 1.5),
    code: 'schema.not-an-integer',
    at: `sources[${String(MANAGED)}].media.byteLength`,
  },
  'a mute that is not a boolean': {
    edit: (document) => withValue(document, ['project', 'tracks', 0, 'muted'], 'no'),
    code: 'schema.not-a-boolean',
    at: 'project.tracks[0].muted',
  },
  'a missing member': {
    edit: (document) => without(document, ['project', 'clips', 0, 'muted']),
    code: 'schema.missing-member',
    at: 'project.clips[0].muted',
  },
  'an external identity with no fast fingerprint (REQ-STOR-104)': {
    edit: (document) => without(document, [...externalAt, 'identity', 'fastFingerprint']),
    code: 'schema.missing-member',
    at: `sources[${String(EXTERNAL)}].media.identity.fastFingerprint`,
  },
  'an external identity with no size (REQ-STOR-104)': {
    edit: (document) => without(document, [...externalAt, 'identity', 'byteLength']),
    code: 'schema.missing-member',
    at: `sources[${String(EXTERNAL)}].media.identity.byteLength`,
  },
  'a member the schema does not define': {
    edit: (document) => withValue(document, ['project', 'markers', 0, 'colour'], 'red'),
    code: 'schema.unknown-member',
    at: 'project.markers[0]',
  },
  'a member of the other kind of media': {
    edit: (document) => withValue(document, [...managedAt, 'policy'], 'prompt'),
    code: 'schema.unknown-member',
    at: `sources[${String(MANAGED)}].media`,
  },
  'a name past its bound': {
    edit: (document) => withValue(document, ['project', 'displayName'], 'x'.repeat(1_025)),
    code: 'project.name-too-long',
    at: 'project.displayName',
  },
  'a project name of nothing a reader sees': {
    edit: (document) => withValue(document, ['project', 'displayName'], ' \u200B '),
    code: 'project.name-blank',
    at: 'project.displayName',
  },
  'a blank asset name': {
    edit: (document) => withValue(document, ['project', 'assets', 0, 'displayName'], '\u2060'),
    code: 'asset.name-blank',
    at: 'project.assets[0].displayName',
  },
  'a media type of another shape': {
    edit: (document) => withValue(document, [...managedAt, 'mediaType'], 'Audio WAV'),
    code: 'schema.text-malformed',
    at: `sources[${String(MANAGED)}].media.mediaType`,
  },
  'a relative path that climbs out of its directory': {
    edit: (document) =>
      withValue(document, [...externalAt, 'identity', 'relativePath'], 'Sounds/../../secret.wav'),
    code: 'schema.text-malformed',
    at: `sources[${String(EXTERNAL)}].media.identity.relativePath`,
  },
  'an absolute path given as a relative one': {
    edit: (document) =>
      withValue(document, [...externalAt, 'identity', 'relativePath'], 'C:/Users/someone/take.wav'),
    code: 'schema.text-malformed',
    at: `sources[${String(EXTERNAL)}].media.identity.relativePath`,
  },
  'a file name that is a path': {
    edit: (document) =>
      withValue(document, [...externalAt, 'identity', 'fileName'], 'Sounds/take.wav'),
    code: 'schema.text-malformed',
    at: `sources[${String(EXTERNAL)}].media.identity.fileName`,
  },
  'a handle key that is a path': {
    edit: (document) =>
      withValue(document, [...externalAt, 'identity', 'handleKey'], 'C:\\take.wav'),
    code: 'schema.text-malformed',
    at: `sources[${String(EXTERNAL)}].media.identity.handleKey`,
  },
  'a pan past fully right': {
    edit: (document) => withValue(document, ['project', 'tracks', 0, 'pan'], 2),
    code: 'schema.number-out-of-range',
    at: 'project.tracks[0].pan',
  },
  'a negative gain': {
    edit: (document) => withValue(document, ['project', 'buses', 0, 'gain'], -1),
    code: 'schema.number-out-of-range',
    at: 'project.buses[0].gain',
  },
  'more tags than a region holds': {
    edit: (document) =>
      withValue(
        document,
        ['project', 'regions', 0, 'tags'],
        Array.from({ length: 10_001 }, (_, index) => `t${String(index).padStart(5, '0')}`),
      ),
    code: 'schema.too-many-items',
    at: 'project.regions[0].tags',
  },
  'an origin the domain does not name': {
    edit: (document) => withValue(document, ['project', 'assets', 0, 'origin'], 'stolen'),
    code: 'schema.unknown-value',
    at: 'project.assets[0].origin',
  },
  'a channel role the domain does not name': {
    edit: (document) =>
      withValue(document, ['project', 'tracks', 0, 'channelLayout', 'roles'], ['left', 'middle']),
    code: 'schema.unknown-value',
    at: 'project.tracks[0].channelLayout.roles[1]',
  },
  'a change policy the format does not name': {
    edit: (document) => withValue(document, [...externalAt, 'policy'], 'ignore'),
    code: 'schema.unknown-value',
    at: `sources[${String(EXTERNAL)}].media.policy`,
  },
  'a parameter value that is an object': {
    edit: (document) =>
      withValue(document, ['project', 'effectChains', 0, 'slots', 0, 'values', 0, 'value'], {}),
    code: 'schema.unknown-value',
    at: 'project.effectChains[0].slots[0].values[0].value',
  },
  'an identifier of another shape': {
    edit: (document) => withValue(document, ['project', 'clips', 0, 'trackId'], 'Track 1'),
    code: 'schema.malformed-id',
    at: 'project.clips[0].trackId',
  },
  'a content identifier of another shape': {
    edit: (document) => withValue(document, [...managedAt, 'contentId'], 'c1-xyz'),
    code: 'schema.malformed-content-id',
    at: `sources[${String(MANAGED)}].media.contentId`,
  },
  'a second marker with one identifier': {
    edit: (document) =>
      edited(document, ['project', 'markers'], (list) =>
        Array.isArray(list) ? [...list, ...list] : list,
      ),
    code: 'schema.duplicate-id',
    at: 'project.markers[1]',
  },
  'a second source for one asset': {
    edit: (document) =>
      edited(document, ['sources'], (list) =>
        Array.isArray(list) ? [...list, list[0] ?? null] : list,
      ),
    code: 'schema.duplicate-id',
    at: 'sources[2].assetId',
  },
  'another format': {
    edit: (document) => withValue(document, ['format'], 'audiogubbins.bundle'),
    code: 'format.unexpected-format',
    at: 'format',
  },
  'a sample rate the domain refuses': {
    edit: (document) => withValue(document, ['project', 'settings', 'sampleRate'], 1_000_000),
    code: 'time.sample-rate-out-of-range',
    at: 'project.settings.sampleRate',
  },
  'a negative sample count': {
    edit: (document) => withValue(document, ['project', 'markers', 0, 'position'], -1),
    code: 'time.sample-count-negative',
    at: 'project.markers[0].position',
  },
  'a clip that ends past the representable timeline': {
    edit: (document) => withValue(document, ['project', 'clips', 0, 'timelineStart'], 2 ** 53 - 1),
    code: 'time.sample-count-too-large',
    at: 'project.clips[0].timelineLength',
  },
  'a layout the domain refuses': {
    edit: (document) =>
      withValue(document, ['project', 'tracks', 0, 'channelLayout', 'roles'], ['left', 'left']),
    code: 'channel.layout-duplicate-role',
    at: 'project.tracks[0].channelLayout',
  },
  'a layout written as its roles alone': {
    edit: (document) =>
      withValue(document, ['project', 'tracks', 0, 'channelLayout'], ['left', 'right']),
    code: 'schema.not-an-object',
    at: 'project.tracks[0].channelLayout',
  },
  'a custom map with two channels of one label': {
    edit: (document) =>
      withValue(document, ['project', 'tracks', 0, 'channelLayout'], {
        roles: ['discrete', 'discrete'],
        labels: ['Dialogue', 'Dialogue'],
      }),
    code: 'channel.label-duplicate',
    at: 'project.tracks[0].channelLayout',
  },
  'ambisonic roles with no convention': {
    edit: (document) =>
      withValue(document, ['project', 'tracks', 0, 'channelLayout'], {
        roles: ['ambisonic', 'ambisonic', 'ambisonic', 'ambisonic'],
      }),
    code: 'channel.layout-ambisonic-without-convention',
    at: 'project.tracks[0].channelLayout',
  },
  'an ambisonic convention over roles of another width': {
    edit: (document) =>
      withValue(document, ['project', 'tracks', 0, 'channelLayout'], {
        roles: ['ambisonic', 'ambisonic'],
        ambisonic: { order: 1, ordering: 'acn', normalisation: 'sn3d' },
      }),
    code: 'channel.layout-ambisonic-mismatch',
    at: 'project.tracks[0].channelLayout',
  },
  'an ambisonic set whose channels carry labels': {
    edit: (document) =>
      withValue(document, ['project', 'tracks', 0, 'channelLayout'], {
        roles: ['ambisonic'],
        labels: ['W'],
        ambisonic: { order: 0, ordering: 'acn', normalisation: 'sn3d' },
      }),
    code: 'channel.layout-ambisonic-mismatch',
    at: 'project.tracks[0].channelLayout',
  },
  'a Furse-Malham set above the third order': {
    edit: (document) =>
      withValue(document, ['project', 'tracks', 0, 'channelLayout'], {
        roles: Array.from({ length: 25 }, () => 'ambisonic'),
        ambisonic: { order: 4, ordering: 'fuma', normalisation: 'fuma' },
      }),
    code: 'channel.ambisonic-fuma-order-too-high',
    at: 'project.tracks[0].channelLayout.ambisonic',
  },
  'a clip on a track the project does not have': {
    edit: (document) => withValue(document, ['project', 'clips', 0, 'trackId'], UNKNOWN_ID),
    code: 'project.unknown-track',
    at: 'project.clips[0].trackId',
  },
  'a track order naming a track the project does not have': {
    edit: (document) => withValue(document, ['project', 'trackOrder'], [...trackIds, UNKNOWN_ID]),
    code: 'project.unknown-track',
    at: `project.trackOrder[${String(trackIds.length)}]`,
  },
  'a clip of an asset the project does not have': {
    edit: (document) =>
      withValue(document, ['project', 'clips', 0, 'source', 'assetId'], UNKNOWN_ID),
    code: 'project.unknown-asset',
    at: 'project.clips[0].source.assetId',
  },
  'a clip that plays past its asset': {
    edit: (document) =>
      withValue(
        document,
        ['project', 'clips', 0, 'source', 'start'],
        numberAt(['project', 'assets', clipAssetIndex, 'length']),
      ),
    code: 'project.clip-outside-asset',
    at: 'project.clips[0].source',
  },
  'a clip that occupies more timeline than it plays': {
    edit: (document) =>
      withValue(document, ['project', 'clips', 0, 'timelineLength'], clipLength + 1),
    code: 'project.clip-length-mismatch',
    at: 'project.clips[0].timelineLength',
  },
  'a clip that fades for longer than it lasts': {
    edit: (document) => withValue(document, ['project', 'clips', 0, 'fadeInLength'], clipLength),
    code: 'project.clip-fades-exceed-length',
    at: 'project.clips[0].fadeOutLength',
  },
  'a loop that ends past its asset': {
    edit: (document) =>
      withValue(document, ['project', 'regions', 0, 'loop', 'end'], regionAssetLength + 1),
    code: 'project.region-off-asset',
    at: 'project.regions[0]',
  },
  'a loop that ends where it starts': {
    edit: (document) => withValue(document, ['project', 'regions', 0, 'loop', 'end'], loopStart),
    code: 'project.region-off-asset',
    at: 'project.regions[0]',
  },
  'a crossfade longer than its loop': {
    edit: (document) =>
      withValue(
        document,
        ['project', 'regions', 0, 'loop', 'crossfadeLength'],
        loopEnd - loopStart + 1,
      ),
    code: 'project.region-off-asset',
    at: 'project.regions[0]',
  },
  'a region that ends past its asset': {
    edit: (document) =>
      withValue(document, ['project', 'regions', 0, 'end'], regionAssetLength + 1),
    code: 'project.region-off-asset',
    at: 'project.regions[0]',
  },
  'a region placed on edits its asset does not have': {
    edit: (document) => withValue(document, ['project', 'regions', 0, 'basis'], 1),
    code: 'project.region-off-asset',
    at: 'project.regions[0]',
  },
  'a region of an asset the project does not have': {
    edit: (document) => withValue(document, ['project', 'regions', 0, 'assetId'], UNKNOWN_ID),
    code: 'project.unknown-asset',
    at: 'project.regions[0].assetId',
  },
  'a marker past the end of its asset': {
    edit: (document) =>
      withValue(document, ['project', 'markers', 0, 'position'], markerAssetLength + 1),
    code: 'project.marker-off-asset',
    at: 'project.markers[0]',
  },
  'a marker of an asset the project does not have': {
    edit: (document) => withValue(document, ['project', 'markers', 0, 'assetId'], UNKNOWN_ID),
    code: 'project.unknown-asset',
    at: 'project.markers[0].assetId',
  },
  'a basis no chain could reach': {
    edit: (document) => withValue(document, ['project', 'markers', 0, 'basis'], 1_000_001),
    code: 'schema.number-out-of-range',
    at: 'project.markers[0].basis',
  },
  'an asset with no edits member': {
    edit: (document) => without(document, ['project', 'assets', 0, 'edits']),
    code: 'schema.missing-member',
    at: 'project.assets[0].edits',
  },
  'a region with no processing member': {
    edit: (document) => without(document, ['project', 'regions', 0, 'operations']),
    code: 'schema.missing-member',
    at: 'project.regions[0].operations',
  },
  'provenance whose file is at another rate than its asset': {
    edit: (document) => withValue(document, [...managedAudioAt, 'sampleRate'], 44_100),
    code: 'source.audio-rate-mismatch',
    at: `sources[${String(MANAGED)}].provenance.audio.sampleRate`,
  },
  'provenance whose file read more frames than its asset holds': {
    edit: (document) =>
      withValue(
        withValue(document, [...managedAudioAt, 'frames'], managedAssetLength + 1),
        [...managedAudioAt, 'declaredFrames'],
        managedAssetLength + 1,
      ),
    code: 'source.audio-length-mismatch',
    at: `sources[${String(MANAGED)}].provenance.audio.frames`,
  },
  'provenance that read more frames than its file declared': {
    edit: (document) =>
      withValue(document, [...managedAudioAt, 'declaredFrames'], managedAssetLength - 1),
    code: 'source.audio-frames-past-declared',
    at: `sources[${String(MANAGED)}].provenance.audio.frames`,
  },
  'provenance naming a container the format does not read': {
    edit: (document) => withValue(document, [...managedAudioAt, 'container'], 'flac'),
    code: 'schema.unknown-value',
    at: `sources[${String(MANAGED)}].provenance.audio.container`,
  },
  'provenance with a member its audio shape does not define': {
    edit: (document) => withValue(document, [...managedAudioAt, 'bitsPerSample'], 16),
    code: 'schema.unknown-member',
    at: `sources[${String(MANAGED)}].provenance.audio`,
  },
  'tags out of order': {
    edit: (document) =>
      withValue(document, ['project', 'regions', 0, 'tags'], ['gravel', 'footstep']),
    code: 'project.region-tags-not-canonical',
    at: 'project.regions[0].tags',
  },
  'repeated tags': {
    edit: (document) =>
      withValue(document, ['project', 'regions', 0, 'tags'], ['gravel', 'gravel']),
    code: 'project.region-tags-not-canonical',
    at: 'project.regions[0].tags',
  },
  'two processors with one identifier': {
    edit: (document) =>
      edited(document, ['project', 'effectChains', 0, 'slots'], (list) =>
        Array.isArray(list) ? [...list, ...list] : list,
      ),
    code: 'project.duplicate-processor',
    at: 'project.effectChains[0].slots[2].id',
  },
  'two values for one parameter': {
    edit: (document) =>
      edited(document, ['project', 'effectChains', 0, 'slots', 0, 'values'], (list) =>
        Array.isArray(list) ? [...list, withValue(list[0] ?? null, ['value'], 0.75)] : list,
      ),
    code: 'project.duplicate-parameter',
    at: 'project.effectChains[0].slots[0].values[3].parameter',
  },
  'a track naming an effect chain the project does not have': {
    edit: (document) => withValue(document, ['project', 'tracks', 0, 'effectChainId'], UNKNOWN_ID),
    code: 'project.unknown-effect-chain',
    at: 'project.tracks[0].effectChainId',
  },
  'a track sending to a bus the project does not have': {
    edit: (document) =>
      withValue(document, ['project', 'tracks', routedTrack, 'output', 'busId'], UNKNOWN_ID),
    code: 'project.unknown-bus',
    at: `project.tracks[${String(routedTrack)}].output.busId`,
  },
  'a bus sending to a bus the project does not have': {
    edit: (document) =>
      withValue(document, ['project', 'buses', 0, 'output'], { kind: 'bus', busId: UNKNOWN_ID }),
    code: 'project.unknown-bus',
    at: 'project.buses[0].output.busId',
  },
  'a bus sending to itself': {
    edit: (document) =>
      withValue(document, ['project', 'buses', 0, 'output'], { kind: 'bus', busId }),
    code: 'project.routing-cycle',
    at: 'project.buses[0].output',
  },
  'a track order naming a track twice': {
    edit: (document) =>
      withValue(document, ['project', 'trackOrder'], [...trackIds, trackIds[0] ?? null]),
    code: 'project.track-order-duplicate',
    at: `project.trackOrder[${String(trackIds.length)}]`,
  },
  'a track order leaving a track out': {
    edit: (document) => withValue(document, ['project', 'trackOrder'], trackIds.slice(1)),
    code: 'project.track-order-missing-track',
    at: 'project.trackOrder',
  },
  'an asset with no source': {
    edit: (document) => without(document, ['sources', 0]),
    code: 'source.missing',
    at: 'sources',
  },
  'a source for an asset the project does not have': {
    edit: (document) => withValue(document, ['sources', 0, 'assetId'], UNKNOWN_ID),
    code: 'source.unknown-asset',
    at: 'sources[0].assetId',
  },
  'an asset whose storage key its source does not give': {
    edit: (document) =>
      withValue(document, ['project', 'assets', 0, 'storageKey'], 'fixture:gravel-footstep'),
    code: 'source.storage-key-mismatch',
    at: 'sources[0].media',
  },
  'a frozen source with no retained copy': {
    edit: (document) => without(document, [...externalAt, 'retainedCopy']),
    code: 'source.freeze-without-retained-copy',
    at: `sources[${String(EXTERNAL)}].media.policy`,
  },
};

describe('readProjectDocument refuses', () => {
  it.each(Object.entries(REFUSALS))('%s', (_case, { edit, code, at }) => {
    const problems = problemsOf(edit(DOCUMENT));
    expect(problems).toContainEqual([code, at]);
  });

  it('a document of another schema version, before reading anything else', () => {
    const result = readProjectDocument(
      withValue(
        withValue(DOCUMENT, ['schemaVersion'], SCHEMA_VERSIONS.projectDocument + 1),
        ['project'],
        7,
      ),
    );
    expect(result.ok ? [] : result.failures.map((problem) => problem.code)).toEqual([
      'format.schema-incompatible',
    ]);
  });

  it('every problem at once, up to the bound, as integrity violations', () => {
    const broken = withValue(
      withValue(
        DOCUMENT,
        ['project', 'trackOrder'],
        Array.from({ length: 150 }, () => 'bad id'),
      ),
      ['project', 'displayName'],
      false,
    );
    const result = readProjectDocument(broken);
    const failures = result.ok ? [] : result.failures;
    expect(failures).toHaveLength(101);
    expect(failures[0]).toMatchObject({
      code: 'schema.not-a-string',
      kind: 'integrity-violation',
    });
    expect(failures.at(-1)).toMatchObject({ code: 'schema.further-problems' });
    expect(failures.every((problem) => problem.kind === 'integrity-violation')).toBe(true);
  });

  it('a damaged document without quoting the names or paths it holds', () => {
    const broken = withValue(
      withValue(
        DOCUMENT,
        [...externalAt, 'identity', 'relativePath'],
        '../Users/private-person/secret.wav',
      ),
      ['project', 'displayName'],
      'private-person'.repeat(100),
    );
    const result = readProjectDocument(broken);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('private-person');
  });

  it('text that is not JSON, through parseProjectDocument', () => {
    const result = parseProjectDocument('{"format":"audiogubbins.project","format":1}');
    expect(result.ok ? undefined : result.failures[0].code).toBe('json.duplicate-key');
  });

  it('nothing it should accept: the reference state and its edits that stay valid', () => {
    expect(problemsOf(DOCUMENT)).toEqual([]);
    expect(problemsOf(without(DOCUMENT, [...externalAt, 'identity', 'relativePath']))).toEqual([]);
    expect(problemsOf(without(DOCUMENT, ['sources', 0, 'provenance']))).toEqual([]);
    expect(problemsOf(withValue(DOCUMENT, ['project', 'regions', 0, 'tags'], []))).toEqual([]);
  });
});

describe('the generator of random states', () => {
  it('is deterministic by seed', () => {
    expect(expectSuccess(compactProjectDocument(randomState(77)))).toBe(
      expectSuccess(compactProjectDocument(randomState(77))),
    );
    expect(seededRandom(3).next()).toBe(seededRandom(3).next());
  });
});
