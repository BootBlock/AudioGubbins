/**
 * The bounds a project document is read within, and the converters for the
 * domain values its parts share: names, keys, sample time, channel layouts and
 * media types.
 *
 * Each converter builds its value with the domain's own constructor where the
 * domain has one, so a document is held to exactly the rules an edit is held to
 * (REQ-EXEC-136.11), and each is bounded so a hostile document cannot make the
 * reader hold more than the bounds allow (REQ-EXEC-136.12). Where a value is
 * recorded before any document holds it, the same rule is offered as a check,
 * so what is recorded is never what the reader refuses.
 */

import {
  AmbisonicNormalisation,
  AmbisonicOrdering,
  ChannelRole,
  MAXIMUM_CHANNEL_COUNT,
  ambisonicLayout,
  channelLayout,
  sampleCount,
  sampleRate,
  type AmbisonicConvention,
  type ChannelLayout,
} from '@audiogubbins/domain';

import {
  listConverter,
  objectOf,
  optional,
  pathOf,
  required,
  type Converter,
} from './document-reading.js';
import {
  domainNumberConverter,
  fitsTextRule,
  fitsWholeRange,
  integerConverter,
  numberConverter,
  oneOfConverter,
  textConverter,
} from './scalar-reading.js';

/**
 * The most entities of one kind a project holds: assets, tracks, buses, clips,
 * regions, markers, effect chains, sources. Far past any project a person
 * edits, and small enough that a reader bounded by it cannot be made to
 * allocate without limit.
 */
export const MAXIMUM_ENTITIES = 1_000_000;

/**
 * The longest project document, in UTF-16 code units: 2^28, a quarter of a
 * gibibyte and below the longest string every engine builds. A list whose
 * items no count of edits bounds is bounded by what this can hold.
 */
export const LONGEST_PROJECT_DOCUMENT = 2 ** 28;

/**
 * The most items a list inside one entity holds: a region's tags, a chain's
 * processors, a processor's values, an export's settings and problems.
 */
export const MAXIMUM_NESTED_ITEMS = 10_000;

/**
 * The longest name a person gives or sees, such as a track's or a file's, in
 * UTF-16 code units. A name is any text up to it.
 */
export const LONGEST_NAME = 1_024;

/** A name a person gives or sees, such as a track's or a file's. */
export const NAME_RULE = { maximumLength: LONGEST_NAME } as const;

/**
 * A machine-readable key, such as a processor type or a palette entry: a letter
 * or digit, then letters, digits and `.`, `_`, `:`, `+`, `-`.
 */
const KEY_RULE = {
  maximumLength: 128,
  pattern: /^[A-Za-z0-9][A-Za-z0-9._:+-]*$/u,
  shape: 'a key of letters, digits and . _ : + -',
} as const;

/** A media type such as `audio/wav`, in lower case and without parameters. */
const MEDIA_TYPE_RULE = {
  maximumLength: 255,
  pattern: /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u,
  shape: 'a media type such as audio/wav',
} as const;

export const asName = textConverter(NAME_RULE);
export const asKey = textConverter(KEY_RULE);
export const asMediaType = textConverter(MEDIA_TYPE_RULE);

/** Whether text is a media type the document holds, by the rule it reads one by. */
export function isMediaType(text: string): boolean {
  return fitsTextRule(MEDIA_TYPE_RULE, text);
}

/** The range of a count of bytes, or of a time in milliseconds since the epoch. */
const QUANTITY = { minimum: 0, maximum: Number.MAX_SAFE_INTEGER } as const;

/** A count of bytes, or a time in milliseconds since the epoch. */
export const asWholeQuantity = integerConverter(QUANTITY.minimum, QUANTITY.maximum);

/**
 * Whether a number is a count of bytes or a time the document holds, by the
 * rule it reads one by.
 */
export function isWholeQuantity(value: number): boolean {
  return fitsWholeRange(value, QUANTITY.minimum, QUANTITY.maximum);
}

export const asSampleRate = domainNumberConverter(sampleRate);
export const asSampleCount = domainNumberConverter(sampleCount);

/**
 * A linear gain, where 1 leaves the signal unchanged. Never negative: a gain
 * scales a level, and inverting polarity would be a setting of its own.
 */
export const asGain = numberConverter(0, Number.MAX_VALUE);

/** A stereo position, from -1 (fully left) to 1 (fully right). */
export const asPan = numberConverter(-1, 1);

const asRoles = listConverter(MAXIMUM_CHANNEL_COUNT, oneOfConverter(Object.values(ChannelRole)));

const LAYOUT_MEMBERS: ReadonlySet<string> = new Set(['roles', 'labels', 'ambisonic']);
const CONVENTION_MEMBERS: ReadonlySet<string> = new Set(['order', 'ordering', 'normalisation']);

/**
 * A channel's label is held to the domain's rule once read; this bound only
 * keeps a hostile document from making the reader hold more.
 */
const asLabels = listConverter(MAXIMUM_CHANNEL_COUNT, asName);

/** The highest order whose set fits in the most channels a layout has. */
const HIGHEST_ORDER = Math.floor(Math.sqrt(MAXIMUM_CHANNEL_COUNT)) - 1;

const asConvention: Converter<AmbisonicConvention> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, CONVENTION_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const order = required(reading, object, at, 'order', integerConverter(0, HIGHEST_ORDER));
  const ordering = required(
    reading,
    object,
    at,
    'ordering',
    oneOfConverter(Object.values(AmbisonicOrdering)),
  );
  const normalisation = required(
    reading,
    object,
    at,
    'normalisation',
    oneOfConverter(Object.values(AmbisonicNormalisation)),
  );
  return order === undefined || ordering === undefined || normalisation === undefined
    ? undefined
    : { order, ordering, normalisation };
};

/**
 * A channel layout: its roles in channel order, the label of each channel of
 * a custom map, and the convention of an ambisonic set (ADR-0033), each built
 * by the domain's own constructor. An ambisonic layout's roles are the ones
 * its convention gives, so a document whose roles say otherwise is refused
 * rather than one of the two believed.
 */
export const asChannelLayout: Converter<ChannelLayout> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, LAYOUT_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const roles = required(reading, object, at, 'roles', asRoles);
  const labels = optional(reading, object, at, 'labels', asLabels);
  const convention = optional(reading, object, at, 'ambisonic', asConvention);
  if (roles === undefined) return undefined;
  if (convention === undefined) {
    const built = channelLayout(roles, labels);
    if (built.ok) return built.value;
    reading.refuseAll(built.failures, at);
    return undefined;
  }
  const built = ambisonicLayout(convention);
  if (!built.ok) {
    reading.refuseAll(built.failures, pathOf(at, 'ambisonic'));
    return undefined;
  }
  const setRoles =
    roles.length === built.value.roles.length &&
    roles.every((role) => role === ChannelRole.Ambisonic);
  if (labels !== undefined || !setRoles) {
    reading.refuse(
      'channel.layout-ambisonic-mismatch',
      'An ambisonic layout has one ambisonic role for each component of its set, and no labels.',
      at,
    );
    return undefined;
  }
  return built.value;
};
