/**
 * Reading the ZIP64 extended information extra field of a header: the sizes,
 * offset and disk its plain fields hold only a sentinel for (REQ-STOR-026,
 * REQ-STOR-099).
 */

import { FailureKind, succeed, type DomainResult } from '@audiogubbins/domain';

import { FieldReader, SENTINEL_16, SENTINEL_32, ZIP64_EXTRA_TAG } from './zip-records.js';
import { refuse } from './zip-refusals.js';

/** The fields of a header the ZIP64 extra field may stand in for. */
export interface ExtendedFields {
  readonly size: number;
  readonly compressedSize: number;
  readonly offset: number;
  readonly disk: number;
}

/**
 * The fields of a header, each sentinel replaced by its value from the ZIP64
 * extra field in `extra`, which holds exactly those in the order the format
 * fixes. A local header passes an offset and a disk of zero, which it has no
 * field for.
 *
 * Refuses an extra field whose blocks overrun it, a second ZIP64 block, one
 * too short for the sentinels it answers, and a value past
 * `Number.MAX_SAFE_INTEGER`.
 */
export function resolveZip64(
  extra: Uint8Array,
  plain: ExtendedFields,
): DomainResult<ExtendedFields> {
  let block: Uint8Array | undefined;
  const fields = new FieldReader(extra);
  for (let at = 0; at < extra.length;) {
    if (at + 4 > extra.length || at + 4 + fields.u16(at + 2) > extra.length) {
      return malformed('An extra field block runs past the end of its header.');
    }
    const length = fields.u16(at + 2);
    if (fields.u16(at) === ZIP64_EXTRA_TAG) {
      if (block !== undefined) return malformed('A header has two ZIP64 extra fields.');
      block = extra.subarray(at + 4, at + 4 + length);
    }
    at += 4 + length;
  }

  const wanted = [plain.size, plain.compressedSize, plain.offset].filter(
    (value) => value === SENTINEL_32,
  ).length;
  const wantsDisk = plain.disk === SENTINEL_16;
  if (wanted === 0 && !wantsDisk) return succeed(plain);
  if (block === undefined || block.length < wanted * 8 + (wantsDisk ? 4 : 0)) {
    return malformed('A header holds a ZIP64 sentinel with no value for it.');
  }

  const values = new FieldReader(block);
  let at = 0;
  const next = (value: number): number | undefined => {
    if (value !== SENTINEL_32) return value;
    const extended = values.u64(at);
    at += 8;
    return extended;
  };
  const size = next(plain.size);
  const compressedSize = next(plain.compressedSize);
  const offset = next(plain.offset);
  const disk = wantsDisk ? values.u32(at) : plain.disk;
  if (size === undefined || compressedSize === undefined || offset === undefined) {
    return refuse(
      'zip.size-unrepresentable',
      FailureKind.Rejected,
      'An entry records a size or offset larger than any file this application can address.',
    );
  }
  return succeed({ size, compressedSize, offset, disk });
}

/** The refusal of an extra field that is not well formed. */
function malformed(summary: string): DomainResult<never> {
  return refuse('zip.extra-malformed', FailureKind.IntegrityViolation, summary);
}
