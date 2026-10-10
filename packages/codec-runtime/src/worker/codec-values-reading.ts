/**
 * Reading the codec values a codec worker's message carries, field by field
 * (REQ-EXEC-136.12): a codec's and a container's identity, the environment
 * the worker reports, and a decoder's identity. A value is read against the
 * registry's own names, so a forged one cannot name a codec no descriptor
 * describes.
 */

import {
  CODEC_REGISTRY,
  type CodecEnvironment,
  type CodecId,
  type CodecImplementation,
  type ContainerId,
  type ModuleLoad,
  type ReadableContainer,
} from '@audiogubbins/codecs';
import type { DecoderIdentity } from '@audiogubbins/codecs';
import {
  Malformed,
  boundedItemsOf,
  fieldsOf,
  flagOf,
  isTagged,
  oneOfValues,
  textOf,
} from '@audiogubbins/domain';

/** Every codec the registry names. */
const CODECS: Readonly<Record<string, CodecId>> = Object.fromEntries(
  [...CODEC_REGISTRY.keys()].map((id) => [id, id]),
);

const CONTAINERS: Readonly<Record<ContainerId, ContainerId>> = {
  wav: 'wav',
  rf64: 'rf64',
  bw64: 'bw64',
  aiff: 'aiff',
  aifc: 'aifc',
  flac: 'flac',
  mp3: 'mp3',
  ogg: 'ogg',
  mp4: 'mp4',
  adts: 'adts',
  webm: 'webm',
  matroska: 'matroska',
};

const READABLE_CONTAINERS: Readonly<Record<ReadableContainer, ReadableContainer>> = {
  wav: 'wav',
  rf64: 'rf64',
  bw64: 'bw64',
  aiff: 'aiff',
  aifc: 'aifc',
};

const MODULE_LOADS: Readonly<Record<ModuleLoad, ModuleLoad>> = {
  'not-loaded': 'not-loaded',
  loaded: 'loaded',
  failed: 'failed',
};

const IMPLEMENTATIONS: Readonly<Record<CodecImplementation, CodecImplementation>> = {
  application: 'application',
  'codec-module': 'codec-module',
  'encoder-module': 'encoder-module',
  browser: 'browser',
};

/** The longest name or version a decoder's identity carries. */
const MAXIMUM_IDENTITY_CHARACTERS = 128;

export function codecOf(value: unknown, field: string): CodecId {
  return oneOfValues(value, field, CODECS);
}

export function containerOf(value: unknown, field: string): ContainerId {
  return oneOfValues(value, field, CONTAINERS);
}

export function readableContainerOf(value: unknown, field: string): ReadableContainer {
  return oneOfValues(value, field, READABLE_CONTAINERS);
}

/** The members of a set or the entries of a map, as they crossed. */
function membersOf(value: unknown, field: string, kind: 'Set' | 'Map'): unknown[] {
  if (!(value instanceof Set || value instanceof Map) || !isTagged(value, kind)) {
    throw new Malformed(field, kind === 'Set' ? 'a set' : 'a map');
  }
  const members: Iterable<unknown> = value;
  return Array.from(members);
}

/** The codecs a set names. */
function codecSetOf(value: unknown, field: string): ReadonlySet<CodecId> {
  return new Set(
    boundedItemsOf(membersOf(value, field, 'Set'), field, CODEC_REGISTRY.size, codecOf),
  );
}

/** The load of each encoder module, by the codec it encodes. */
function moduleLoadsOf(value: unknown, field: string): ReadonlyMap<CodecId, ModuleLoad> {
  const entries = membersOf(value, field, 'Map');
  return new Map(
    boundedItemsOf(entries, field, CODEC_REGISTRY.size, (entry, name) => {
      if (!Array.isArray(entry)) throw new Malformed(name, 'a codec and its load');
      const codec: unknown = entry[0];
      const load: unknown = entry[1];
      return [codecOf(codec, `${name}[0]`), oneOfValues(load, `${name}[1]`, MODULE_LOADS)] as const;
    }),
  );
}

/** What the worker reports it can do with the codecs. */
export function codecEnvironmentOf(value: unknown, field: string): CodecEnvironment {
  const fields = fieldsOf(value, field);
  return {
    webAssembly: flagOf(fields['webAssembly'], `${field}.webAssembly`),
    codecModule: oneOfValues(fields['codecModule'], `${field}.codecModule`, MODULE_LOADS),
    encoderModules: moduleLoadsOf(fields['encoderModules'], `${field}.encoderModules`),
    browserDecoders: codecSetOf(fields['browserDecoders'], `${field}.browserDecoders`),
    browserEncoders: codecSetOf(fields['browserEncoders'], `${field}.browserEncoders`),
  };
}

function identityTextOf(value: unknown, field: string): string {
  const text = textOf(value, field);
  if (text === '' || text.length > MAXIMUM_IDENTITY_CHARACTERS) {
    throw new Malformed(field, `text of 1 to ${String(MAXIMUM_IDENTITY_CHARACTERS)} characters`);
  }
  return text;
}

export function decoderIdentityOf(value: unknown, field: string): DecoderIdentity {
  const fields = fieldsOf(value, field);
  return {
    implementation: oneOfValues(
      fields['implementation'],
      `${field}.implementation`,
      IMPLEMENTATIONS,
    ),
    name: identityTextOf(fields['name'], `${field}.name`),
    version: identityTextOf(fields['version'], `${field}.version`),
  };
}
