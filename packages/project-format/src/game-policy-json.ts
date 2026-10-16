/**
 * Writing and reading the value of each field of a game-audio policy
 * (`@audiogubbins/game-audio`'s `PolicyValues`, ADR-0101, ADR-0106), wherever
 * one is kept: a group's policy, a member's overrides, and a game command's
 * argument (REQ-EXEC-136.12).
 *
 * One reader and one writer per field, in tables whose types name every field,
 * so a field added to the policy fails to compile here until it is kept. The
 * reader holds each value to its shape: every member present and of its type,
 * a union's kind one it has, numbers finite. A value made by a constructor, a
 * naming template, a destination or a bus, is made by it, and refused with its
 * reasons where it refuses. Ranges and references are the game-audio state's
 * rules, which the project document's reader runs on the whole state once the
 * project is read (`game-audio-json.ts`), so a range is refused naming the
 * group or override that set it, and refused alike when a command makes it.
 * A game export profile is read and written by `game-profile-json.ts`.
 */

import type { DomainFailure, DomainResult, EffectChainId } from '@audiogubbins/domain';
import {
  busName,
  destinationPath,
  namingTemplate,
  type Attenuation,
  type DistanceFilter,
  type EmitterRules,
  type LoudnessTarget,
  type PolicyField,
  type PolicyValues,
  type SelectionRule,
  type VoiceStealing,
  type VoiceVariation,
} from '@audiogubbins/game-audio';

import type { JsonObject, JsonValue } from './canonical-json.js';
import {
  listConverter,
  objectOf,
  optional,
  pathOf,
  required,
  type Converter,
  type Reading,
} from './document-reading.js';
import { presentMembers } from './document-writing.js';
import { readGameExportProfile, writeGameExportProfile } from './game-profile-json.js';
import { asId, namedValueConverter, numberConverter, textConverter } from './scalar-reading.js';
import { kindOf, members } from './variant-reading.js';
import { MAXIMUM_NESTED_ITEMS, NAME_RULE } from './value-reading.js';

/** Any finite number: a range is the game-audio state's rule, refused with its owner. */
const asNumber = numberConverter(-Number.MAX_VALUE, Number.MAX_VALUE);

/** Text a policy holds: a template, a folder, a bus or a tag, bounded as a name is. */
const asPolicyText = textConverter(NAME_RULE);
const asTexts = listConverter(MAXIMUM_NESTED_ITEMS, asPolicyText);

/** The failures a constructor gave the value at `at`, refused there; `undefined` where it made one. */
function made<TValue>(
  reading: Reading,
  result: DomainResult<TValue>,
  at: string,
): TValue | undefined {
  if (result.ok) return result.value;
  refuseSafely(reading, result.failures, at);
  return undefined;
}

/**
 * The details of a game-audio refusal a document's refusal may carry: the
 * identifiers and the names of fields and parts, never a value the person
 * wrote, such as a group's path, a folder or a template (REQ-PRIV-165).
 */
const KEPT_DETAILS: ReadonlySet<string> = new Set([
  'owner',
  'group',
  'member',
  'field',
  'part',
  'other',
  'parent',
  'rack',
  'inherited',
  'from',
  'index',
  'segments',
]);

/**
 * Refuses each failure at `at` under its own code, in words that quote
 * nothing the document holds: a game-audio refusal names a group by its path,
 * a member by its name and a folder or a template as written, which a document
 * reader never repeats (`document-reading.ts`). What identifies the problem,
 * its owner's identifier, its field and the part of the value, is kept, so the
 * refusal still says whose setting it is and which.
 */
export function refuseSafely(
  reading: Reading,
  failures: readonly DomainFailure[],
  at: string,
): void {
  for (const failure of failures) {
    const details: Record<string, string | number> = {};
    for (const source of [failure.details, failure.cause?.details]) {
      for (const [key, value] of Object.entries(source ?? {})) {
        if (KEPT_DETAILS.has(key) && (typeof value === 'string' || typeof value === 'number')) {
          details[key] = value;
        }
      }
    }
    reading.refuse(
      failure.code,
      'The game-audio settings here break one of their rules, which the code names.',
      at,
      details,
    );
  }
}

const asProcessing: Converter<EffectChainId | 'none'> = (reading, value, parent, key) =>
  value === 'none' ? 'none' : asId<'EffectChainId'>(reading, value, parent, key);

const LOUDNESS_MEMBERS = members('integratedLufs', 'toleranceLu', 'truePeakCeilingDbtp');

const asLoudness: Converter<LoudnessTarget> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, LOUDNESS_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const integratedLufs = required(reading, object, at, 'integratedLufs', asNumber);
  const toleranceLu = required(reading, object, at, 'toleranceLu', asNumber);
  const ceiling = optional(reading, object, at, 'truePeakCeilingDbtp', asNumber);
  if (integratedLufs === undefined || toleranceLu === undefined) return undefined;
  if (object['truePeakCeilingDbtp'] !== undefined && ceiling === undefined) return undefined;
  return {
    integratedLufs,
    toleranceLu,
    ...(ceiling === undefined ? {} : { truePeakCeilingDbtp: ceiling }),
  };
};

const asNaming: Converter<PolicyValues['naming']> = (reading, value, parent, key) => {
  const source = asPolicyText(reading, value, parent, key);
  return source === undefined
    ? undefined
    : made(reading, namingTemplate(source), pathOf(parent, key));
};

const asDestination: Converter<PolicyValues['destination']> = (reading, value, parent, key) => {
  const segments = asTexts(reading, value, parent, key);
  return segments === undefined
    ? undefined
    : made(reading, destinationPath(segments), pathOf(parent, key));
};

const asBus: Converter<PolicyValues['bus']> = (reading, value, parent, key) => {
  const text = asPolicyText(reading, value, parent, key);
  return text === undefined ? undefined : made(reading, busName(text), pathOf(parent, key));
};

const asSelection: Converter<SelectionRule> = (reading, value, parent, key) => {
  const read = kindOf(reading, value, parent, key, 'kind', {
    uniform: members('kind'),
    'avoid-recent': members('kind', 'depth'),
  });
  if (read === undefined) return undefined;
  const { object, at, kind } = read;
  if (kind === 'uniform') return { kind };
  const depth = required(reading, object, at, 'depth', asNumber);
  return depth === undefined ? undefined : { kind, depth };
};

const asStealing = namedValueConverter<VoiceStealing>({
  oldest: true,
  quietest: true,
  reject: true,
});

const asVoices: Converter<EmitterRules['voices']> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, members('limit', 'stealing'));
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const limit = required(reading, object, at, 'limit', asNumber);
  const stealing = required(reading, object, at, 'stealing', asStealing);
  return limit === undefined || stealing === undefined ? undefined : { limit, stealing };
};

const asAttenuation: Converter<Attenuation> = (reading, value, parent, key) => {
  const curve = members('kind', 'unitSize', 'maxDistance', 'ceilingDecibels');
  const read = kindOf(reading, value, parent, key, 'kind', {
    none: members('kind'),
    inverse: curve,
    'inverse-square': curve,
    logarithmic: curve,
    exponent: members('kind', 'maxDistance', 'exponent'),
  });
  if (read === undefined) return undefined;
  const { object, at, kind } = read;
  if (kind === 'none') return { kind };
  const maxDistance = required(reading, object, at, 'maxDistance', asNumber);
  if (kind === 'exponent') {
    const exponent = required(reading, object, at, 'exponent', asNumber);
    return maxDistance === undefined || exponent === undefined
      ? undefined
      : { kind, maxDistance, exponent };
  }
  const unitSize = required(reading, object, at, 'unitSize', asNumber);
  const ceilingDecibels = required(reading, object, at, 'ceilingDecibels', asNumber);
  return maxDistance === undefined || unitSize === undefined || ceilingDecibels === undefined
    ? undefined
    : { kind, unitSize, maxDistance, ceilingDecibels };
};

const asFilter: Converter<DistanceFilter> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, members('cutoffHertz', 'decibels'));
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const cutoffHertz = required(reading, object, at, 'cutoffHertz', asNumber);
  const decibels = required(reading, object, at, 'decibels', asNumber);
  return cutoffHertz === undefined || decibels === undefined
    ? undefined
    : { cutoffHertz, decibels };
};

const EMITTER_MEMBERS = members(
  'selection',
  'voices',
  'cooldownMilliseconds',
  'attenuation',
  'filter',
);

const asEmitter: Converter<EmitterRules> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, EMITTER_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const selection = required(reading, object, at, 'selection', asSelection);
  const voices = required(reading, object, at, 'voices', asVoices);
  const cooldownMilliseconds = required(reading, object, at, 'cooldownMilliseconds', asNumber);
  const attenuation = required(reading, object, at, 'attenuation', asAttenuation);
  const filter = optional(reading, object, at, 'filter', asFilter);
  if (
    selection === undefined ||
    voices === undefined ||
    cooldownMilliseconds === undefined ||
    attenuation === undefined ||
    (object['filter'] !== undefined && filter === undefined)
  ) {
    return undefined;
  }
  return {
    selection,
    voices,
    cooldownMilliseconds,
    attenuation,
    ...(filter === undefined ? {} : { filter }),
  };
};

/** A range of `min` and `max`. */
const asRange: Converter<{ readonly min: number; readonly max: number }> = (
  reading,
  value,
  parent,
  key,
) => {
  const object = objectOf(reading, value, parent, key, members('min', 'max'));
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const min = required(reading, object, at, 'min', asNumber);
  const max = required(reading, object, at, 'max', asNumber);
  return min === undefined || max === undefined ? undefined : { min, max };
};

const asCeiling: Converter<{ readonly max: number }> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, members('max'));
  if (object === undefined) return undefined;
  const max = required(reading, object, pathOf(parent, key), 'max', asNumber);
  return max === undefined ? undefined : { max };
};

const VARIATION_MEMBERS = members('pitchCents', 'gainDecibels', 'startOffsetMilliseconds');

const asVariation: Converter<VoiceVariation> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, VARIATION_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const pitchCents = required(reading, object, at, 'pitchCents', asRange);
  const gainDecibels = required(reading, object, at, 'gainDecibels', asRange);
  const startOffsetMilliseconds = required(
    reading,
    object,
    at,
    'startOffsetMilliseconds',
    asCeiling,
  );
  return pitchCents === undefined ||
    gainDecibels === undefined ||
    startOffsetMilliseconds === undefined
    ? undefined
    : { pitchCents, gainDecibels, startOffsetMilliseconds };
};

/** Each field's reader. */
const POLICY_READERS: { readonly [F in PolicyField]: Converter<PolicyValues[F]> } = {
  processing: asProcessing,
  loudness: asLoudness,
  exportProfile: readGameExportProfile,
  naming: asNaming,
  destination: asDestination,
  emitter: asEmitter,
  variation: asVariation,
  bus: asBus,
  tags: asTexts,
};

/** The reader of `field`'s value: for a policy, an override, or a command's argument. */
export function readPolicyField<F extends PolicyField>(field: F): Converter<PolicyValues[F]> {
  return POLICY_READERS[field];
}

function writeLoudness(target: LoudnessTarget): JsonObject {
  return presentMembers({
    integratedLufs: target.integratedLufs,
    toleranceLu: target.toleranceLu,
    truePeakCeilingDbtp: target.truePeakCeilingDbtp,
  });
}

function writeEmitter(rules: EmitterRules): JsonObject {
  return presentMembers({
    selection: { ...rules.selection },
    voices: { limit: rules.voices.limit, stealing: rules.voices.stealing },
    cooldownMilliseconds: rules.cooldownMilliseconds,
    attenuation: { ...rules.attenuation },
    filter: rules.filter === undefined ? undefined : { ...rules.filter },
  });
}

function writeVariation(variation: VoiceVariation): JsonObject {
  return {
    pitchCents: { min: variation.pitchCents.min, max: variation.pitchCents.max },
    gainDecibels: { min: variation.gainDecibels.min, max: variation.gainDecibels.max },
    startOffsetMilliseconds: { max: variation.startOffsetMilliseconds.max },
  };
}

/** Each field's writer. */
const POLICY_WRITERS: { readonly [F in PolicyField]: (value: PolicyValues[F]) => JsonValue } = {
  processing: (chain) => chain,
  loudness: writeLoudness,
  exportProfile: writeGameExportProfile,
  naming: (template) => template.source,
  destination: (path) => [...path.segments],
  emitter: writeEmitter,
  variation: writeVariation,
  bus: (name) => name,
  tags: (tags) => [...tags],
};

/** Writes `field`'s value. */
export function writePolicyValue<F extends PolicyField>(
  field: F,
  value: PolicyValues[F],
): JsonValue {
  const write: (value: PolicyValues[F]) => JsonValue = POLICY_WRITERS[field];
  return write(value);
}
