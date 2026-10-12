/**
 * Reading the codec values a codec worker's message carries, field by field
 * (REQ-EXEC-136.12): a codec's and a container's identity, the environment the
 * worker reports, each module's load with why one failed, and a decoder's
 * identity. A value is read against the registry's own names, so a forged one
 * cannot name a codec no descriptor describes.
 */

import {
  CODEC_REGISTRY,
  type BitRateBand,
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
  countOf,
  fieldsOf,
  flagOf,
  isTagged,
  numberOf,
  oneOfValues,
  textOf,
} from '@audiogubbins/domain';

import type { EncoderIdentity } from '../encoding/encoder-identity.js';

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

const LOAD_KINDS: Readonly<Record<ModuleLoad['kind'], ModuleLoad['kind']>> = {
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

/** The longest name or version a decoder's or an encoder's identity carries. */
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

/** How far a module's load has gone, and why it failed where it did. */
function moduleLoadOf(value: unknown, field: string): ModuleLoad {
  const fields = fieldsOf(value, field);
  const kind = oneOfValues(fields['kind'], `${field}.kind`, LOAD_KINDS);
  return kind === 'failed'
    ? { kind, reason: textOf(fields['reason'], `${field}.reason`) }
    : { kind };
}

/** The load of each encoder module, by the codec it encodes. */
function moduleLoadsOf(value: unknown, field: string): ReadonlyMap<CodecId, ModuleLoad> {
  const entries = membersOf(value, field, 'Map');
  return new Map(
    boundedItemsOf(entries, field, CODEC_REGISTRY.size, (entry, name) => {
      if (!Array.isArray(entry)) throw new Malformed(name, 'a codec and its load');
      const codec: unknown = entry[0];
      const load: unknown = entry[1];
      return [codecOf(codec, `${name}[0]`), moduleLoadOf(load, `${name}[1]`)] as const;
    }),
  );
}

/** The most bands, and constant bit rates in each, a codec's probed bit rates may hold. */
const MAXIMUM_BANDS = 1_024;
const MAXIMUM_CONSTANT_RATES = 4_096;

const AVERAGE_PER: Readonly<Record<string, 'stream' | 'channel'>> = {
  stream: 'stream',
  channel: 'channel',
};

/** A field that is a range of numbers, both ends finite. */
function rangeOf(value: unknown, field: string): { minimum: number; maximum: number } {
  const fields = fieldsOf(value, field);
  return {
    minimum: numberOf(fields['minimum'], `${field}.minimum`),
    maximum: numberOf(fields['maximum'], `${field}.maximum`),
  };
}

/** The band of bit rates an encoder takes for a band of streams. */
function bitRateBandOf(value: unknown, field: string): BitRateBand {
  const fields = fieldsOf(value, field);
  const channels = fields['channels'];
  const constant = fields['constant'];
  const average = fields['average'];
  return {
    ...(channels === undefined ? {} : { channels: countOf(channels, `${field}.channels`) }),
    sampleRates: rangeOf(fields['sampleRates'], `${field}.sampleRates`),
    ...(constant === undefined
      ? {}
      : {
          constant: boundedItemsOf(constant, `${field}.constant`, MAXIMUM_CONSTANT_RATES, numberOf),
        }),
    ...(average === undefined
      ? {}
      : {
          average: {
            ...rangeOf(average, `${field}.average`),
            per: oneOfValues(
              fieldsOf(average, `${field}.average`)['per'],
              `${field}.average.per`,
              AVERAGE_PER,
            ),
          },
        }),
  };
}

/** The bit rates the browser's encoder was probed to take, by codec. */
function bitRatesOf(value: unknown, field: string): ReadonlyMap<CodecId, readonly BitRateBand[]> {
  const entries = membersOf(value, field, 'Map');
  return new Map(
    boundedItemsOf(entries, field, CODEC_REGISTRY.size, (entry, name) => {
      if (!Array.isArray(entry)) throw new Malformed(name, 'a codec and its bands');
      const codec: unknown = entry[0];
      const bands: unknown = entry[1];
      return [
        codecOf(codec, `${name}[0]`),
        boundedItemsOf(bands, `${name}[1]`, MAXIMUM_BANDS, bitRateBandOf),
      ] as const;
    }),
  );
}

/** What the worker reports it can do with the codecs. */
export function codecEnvironmentOf(value: unknown, field: string): CodecEnvironment {
  const fields = fieldsOf(value, field);
  return {
    webAssembly: flagOf(fields['webAssembly'], `${field}.webAssembly`),
    codecModule: moduleLoadOf(fields['codecModule'], `${field}.codecModule`),
    encoderModules: moduleLoadsOf(fields['encoderModules'], `${field}.encoderModules`),
    browserDecoders: codecSetOf(fields['browserDecoders'], `${field}.browserDecoders`),
    browserEncoders: codecSetOf(fields['browserEncoders'], `${field}.browserEncoders`),
    browserBitRates: bitRatesOf(fields['browserBitRates'], `${field}.browserBitRates`),
  };
}

function identityTextOf(value: unknown, field: string): string {
  const text = textOf(value, field);
  if (text === '' || text.length > MAXIMUM_IDENTITY_CHARACTERS) {
    throw new Malformed(field, `text of 1 to ${String(MAXIMUM_IDENTITY_CHARACTERS)} characters`);
  }
  return text;
}

export function encoderIdentityOf(value: unknown, field: string): EncoderIdentity {
  const fields = fieldsOf(value, field);
  return {
    implementation: oneOfValues(
      fields['implementation'],
      `${field}.implementation`,
      IMPLEMENTATIONS,
    ),
    version: identityTextOf(fields['version'], `${field}.version`),
  };
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
