/**
 * The converters the storage's own records share for the values they hold
 * beside the format's documents: whole numbers, state fingerprints and
 * identifiers the storage mints (REQ-EXEC-136.12).
 */

import {
  asId,
  integerConverter,
  pathOf,
  stateFingerprintFrom,
  type Converter,
  type StateFingerprint,
} from '@audiogubbins/project-format';

import type { CheckpointId } from './storage-layout.js';

/** A whole number from zero, such as a sequence number or a time. */
export const asWholeNumber = integerConverter(0, Number.MAX_SAFE_INTEGER);

/** A whole number from one, such as a generation. */
export const asCountingNumber = integerConverter(1, Number.MAX_SAFE_INTEGER);

/** Reads a state fingerprint. */
export const asFingerprint: Converter<StateFingerprint> = (reading, value, parent, key) => {
  const read = typeof value === 'string' ? stateFingerprintFrom(value) : undefined;
  if (read?.ok === true) return read.value;
  reading.refuse(
    'schema.malformed-fingerprint',
    'A state fingerprint is expected here.',
    pathOf(parent, key),
  );
  return undefined;
};

/** Reads a checkpoint's identifier. */
export const asCheckpointId: Converter<CheckpointId> = asId<'CheckpointId'>;
