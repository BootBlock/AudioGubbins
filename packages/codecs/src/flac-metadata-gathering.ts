/**
 * FLAC's metadata blocks read into the one map (ADR-0093), however the blocks
 * are reached: a native FLAC file's walk, or the header packets an Ogg FLAC
 * stream carries them in, so both read the same blocks by the same code.
 *
 * The blocks mapped are the Vorbis comments, the pictures and the WAV chunks
 * the `APPLICATION` `riff` blocks carry, read by the WAV reader's own code and
 * refused by its rules. A walker asks which blocks the map reads before it
 * reads their bodies, so a block of another kind costs it nothing, and every
 * body read is counted against the bound on a file's metadata.
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';

import { fourCharacterCode } from './byte-reading.js';
import { decodeFlacPicture, gatherPicture } from './flac-picture.js';
import { RIFF_APPLICATION, riffChunkOfApplication } from './flac-riff-blocks.js';
import { FlacBlockType } from './flac-metadata-blocks.js';
import { metadataOverBound } from './framing-failures.js';
import { MetadataGathering } from './metadata-gathering.js';
import { MAXIMUM_TAG_METADATA_BYTES } from './metadata-limits.js';
import type { MetadataMap } from './metadata-map.js';
import { RiffChunkReading } from './riff-chunk-reading.js';
import { decodeVorbisComment } from './vorbis-comment.js';

/**
 * Whether a carried WAV chunk is one FLAC's mapping reads (ADR-0093): the
 * sampler's loops and tuning, the cue points, and the `adtl` list of their
 * labels. The comments and pictures answer for everything else.
 */
function isMapped(id: string, body: Uint8Array): boolean {
  if (id === 'LIST') return body.length >= 4 && fourCharacterCode(body, 0) === 'adtl';
  return id === 'smpl' || id === 'cue ';
}

/** The metadata of one FLAC stream, read block by block and assembled once all are. */
export class FlacMetadataGathering {
  private readonly gathering = new MetadataGathering();
  private readonly riff = new RiffChunkReading();
  private bytesRead = 0;

  /**
   * Whether the map reads the body of a block of `type`; an `APPLICATION`
   * block's by its application id. A front cover replaces any other picture,
   * so once one is kept, later pictures are not read.
   */
  reads(type: number, applicationId: string | undefined): boolean {
    switch (type) {
      case FlacBlockType.VorbisComment:
        return true;
      case FlacBlockType.Picture:
        return this.gathering.keepsCoverArt(true);
      case FlacBlockType.Application:
        return applicationId === RIFF_APPLICATION;
      default:
        return false;
    }
  }

  /** Reads the body of a block the map reads, refusing one that breaks its rules or the bound. */
  add(type: number, body: Uint8Array): DomainResult<undefined> {
    this.bytesRead += body.length;
    if (this.bytesRead > MAXIMUM_TAG_METADATA_BYTES) {
      return fail(metadataOverBound('metadata', MAXIMUM_TAG_METADATA_BYTES));
    }
    if (type === FlacBlockType.VorbisComment) {
      const taken = decodeVorbisComment(body, this.gathering);
      return taken.ok ? succeed(undefined) : taken;
    }
    if (type === FlacBlockType.Picture) {
      const picture = decodeFlacPicture(body);
      if (!picture.ok) return picture;
      gatherPicture(this.gathering, picture.value);
      return succeed(undefined);
    }
    const counted = this.gathering.countField();
    if (!counted.ok) return counted;
    const chunk = riffChunkOfApplication(body.subarray(4));
    return chunk !== undefined && isMapped(chunk.id, chunk.body)
      ? this.riff.read(chunk.id, chunk.body)
      : succeed(undefined);
  }

  /** The map of every block read, a carried `smpl` and `cue ` winning over the comments' loops. */
  toMap(): MetadataMap {
    const carried = this.riff.toMap();
    if (carried.cues !== undefined) this.gathering.setCues(carried.cues);
    if (carried.loops !== undefined) this.gathering.setLoops(carried.loops);
    if (carried.tuning !== undefined) this.gathering.setTuning(carried.tuning);
    return this.gathering.toMap();
  }
}
