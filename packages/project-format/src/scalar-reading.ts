/**
 * The converters for the scalar values of a document: booleans, bounded text,
 * bounded numbers, a value from a fixed set, identifiers, content identifiers
 * and state fingerprints (REQ-EXEC-136.12).
 *
 * Each refuses in the one way `document-reading.ts` describes: a stable code,
 * the path of the value, and never the value itself.
 */

import {
  isWellFormedId,
  unsafeBrandId,
  type Branded,
  type DomainResult,
} from '@audiogubbins/domain';

import type { JsonValue } from './canonical-json.js';
import {
  contentIdFrom,
  stateFingerprintFrom,
  type ContentId,
  type StateFingerprint,
} from './content-identity.js';
import { pathOf, type Converter, type Reading } from './document-reading.js';

/** How a text value is bounded. */
export interface TextRule {
  readonly maximumLength: number;

  /** The shape the text must have, where it has one. */
  readonly pattern?: RegExp;

  /** What `pattern` requires, said for the refusal. */
  readonly shape?: string;
}

/** Reads a boolean. */
export const asBoolean: Converter<boolean> = (reading, value, parent, key) => {
  if (typeof value === 'boolean') return value;
  reading.refuse('schema.not-a-boolean', 'true or false is expected here.', pathOf(parent, key));
  return undefined;
};

/** A converter reading text held to `rule`. */
export function textConverter(rule: TextRule): Converter<string> {
  return (reading, value, parent, key) => {
    if (typeof value !== 'string') {
      reading.refuse('schema.not-a-string', 'Text is expected here.', pathOf(parent, key));
      return undefined;
    }
    if (value.length > rule.maximumLength) {
      reading.refuse(
        'schema.text-too-long',
        'The text is longer than this member may be.',
        pathOf(parent, key),
        {
          length: value.length,
          maximum: rule.maximumLength,
        },
      );
      return undefined;
    }
    if (rule.pattern !== undefined && !rule.pattern.test(value)) {
      reading.refuse(
        'schema.text-malformed',
        `The text is not ${rule.shape ?? 'of the shape this member takes'}.`,
        pathOf(parent, key),
      );
      return undefined;
    }
    return value;
  };
}

/** A converter reading a finite number from `minimum` to `maximum`. */
export function numberConverter(minimum: number, maximum: number): Converter<number> {
  return (reading, value, parent, key) =>
    readNumber(reading, value, parent, key, minimum, maximum, false);
}

/** A converter reading a whole number from `minimum` to `maximum`. */
export function integerConverter(minimum: number, maximum: number): Converter<number> {
  return (reading, value, parent, key) =>
    readNumber(reading, value, parent, key, minimum, maximum, true);
}

function readNumber(
  reading: Reading,
  value: JsonValue,
  parent: string,
  key: string | number,
  minimum: number,
  maximum: number,
  whole: boolean,
): number | undefined {
  if (typeof value !== 'number') {
    reading.refuse('schema.not-a-number', 'A number is expected here.', pathOf(parent, key));
    return undefined;
  }
  if (whole && !Number.isInteger(value)) {
    reading.refuse(
      'schema.not-an-integer',
      'A whole number is expected here.',
      pathOf(parent, key),
    );
    return undefined;
  }
  if (value < minimum || value > maximum) {
    reading.refuse(
      'schema.number-out-of-range',
      'The number is outside the range this member takes.',
      pathOf(parent, key),
      {
        value,
        minimum,
        maximum,
      },
    );
    return undefined;
  }
  return value;
}

/** A converter reading one of a fixed set of strings. */
export function oneOfConverter<TValue extends string>(
  values: readonly TValue[],
): Converter<TValue> {
  return (reading, value, parent, key) => {
    const found = values.find((candidate) => candidate === value);
    if (found === undefined) {
      reading.refuse(
        'schema.unknown-value',
        `One of ${values.join(', ')} is expected here.`,
        pathOf(parent, key),
      );
    }
    return found;
  };
}

/** A converter reading a number with a domain constructor, keeping its refusals. */
export function domainNumberConverter<TValue>(
  construct: (value: number) => DomainResult<TValue>,
): Converter<TValue> {
  return (reading, value, parent, key) => {
    if (typeof value !== 'number') {
      reading.refuse('schema.not-a-number', 'A number is expected here.', pathOf(parent, key));
      return undefined;
    }
    const built = construct(value);
    if (built.ok) return built.value;
    reading.refuseAll(built.failures, pathOf(parent, key));
    return undefined;
  };
}

/** Reads an identifier of the shape `isWellFormedId` accepts. */
export function asId<TBrand extends string>(
  reading: Reading,
  value: JsonValue,
  parent: string,
  key: string | number,
): Branded<TBrand> | undefined {
  if (typeof value !== 'string' || !isWellFormedId(value)) {
    reading.refuse(
      'schema.malformed-id',
      'An identifier of 8 to 64 lower-case hexadecimal digits and hyphens is expected here.',
      pathOf(parent, key),
    );
    return undefined;
  }
  return unsafeBrandId<TBrand>(value);
}

/** Reads a content identifier. */
export const asContentId: Converter<ContentId> = (reading, value, parent, key) => {
  const read = typeof value === 'string' ? contentIdFrom(value) : undefined;
  if (read?.ok === true) return read.value;
  reading.refuse(
    'schema.malformed-content-id',
    'A content identifier is expected here.',
    pathOf(parent, key),
  );
  return undefined;
};

/** Reads a state fingerprint. */
export const asStateFingerprint: Converter<StateFingerprint> = (reading, value, parent, key) => {
  const read = typeof value === 'string' ? stateFingerprintFrom(value) : undefined;
  if (read?.ok === true) return read.value;
  reading.refuse(
    'schema.malformed-fingerprint',
    'A state fingerprint is expected here.',
    pathOf(parent, key),
  );
  return undefined;
};
