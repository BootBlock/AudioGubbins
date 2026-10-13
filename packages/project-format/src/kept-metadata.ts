/**
 * A file's metadata as an asset's provenance keeps it (ADR-0093,
 * REQ-STOR-166): the codecs' one map, in the file's own frames, with its
 * embedded picture described rather than held.
 *
 * Every value is the file's, read as untrusted text (REQ-EXEC-136), and the
 * readers in the codecs bound each part. A picture is bytes up to a mebibyte,
 * which every state of the history would carry again were it kept here, so
 * provenance keeps what it is (its type, its description and its size) and
 * the bytes stay in the file, kept as the person chose. The foreign fields
 * are kept up to the most a document's list holds, in the order the file
 * gives them; a file of more names no field the map types.
 */

import type { MetadataMap } from '@audiogubbins/codecs';

import { MAXIMUM_NESTED_ITEMS } from './value-reading.js';

/** An embedded picture, as provenance describes it. */
export interface KeptCoverArt {
  readonly mediaType: string;
  readonly description: string;
  readonly byteLength: number;
}

/** A file's metadata, as provenance keeps it. */
export type KeptMetadata = Omit<MetadataMap, 'coverArt'> & {
  readonly coverArt?: KeptCoverArt;
};

/** The most foreign fields provenance keeps of one file. */
export const MAXIMUM_KEPT_FOREIGN_FIELDS = MAXIMUM_NESTED_ITEMS;

/** The metadata `map` as provenance keeps it (see the module comment). */
export function keptMetadata(map: MetadataMap): KeptMetadata {
  const { coverArt, foreign, ...rest } = map;
  return {
    ...rest,
    ...(foreign === undefined ? {} : { foreign: foreign.slice(0, MAXIMUM_KEPT_FOREIGN_FIELDS) }),
    ...(coverArt === undefined
      ? {}
      : {
          coverArt: {
            mediaType: coverArt.mediaType,
            description: coverArt.description,
            byteLength: coverArt.bytes.length,
          },
        }),
  };
}
