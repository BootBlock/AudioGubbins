/**
 * The metadata chunks of a WAV file read into the one map (ADR-0093), however
 * the chunks are reached: a WAV, RF64 or BW64 file's walk, or the `riff`
 * blocks a FLAC file carries them in, so both formats read a sampler's loops,
 * cue points and labels by the same code.
 *
 * The chunks mapped are `LIST`/`INFO` for text, `bext` for the broadcast
 * description, `cue ` with the `labl` entries of `LIST`/`adtl` for named
 * points, `smpl` for loops and the sampler's tuning, and `iXML`, kept whole;
 * each chunk's layout is read by its own module, and this one assembles the
 * map. Of `bext`, `cue `, `smpl` and `iXML` the first is read and a later one
 * ignored, as a reader of one description takes the first; `INFO` and `adtl`
 * lists are read wherever they lie. A chunk that breaks its own rules or a
 * bound is refused with `codecs.malformed`, never read in part. An `iXML`
 * chunk larger than its bound is skipped unread: it is kept for its own
 * reader, never needed to read the rest.
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';

import { fourCharacterCode } from './byte-reading.js';
import { malformed } from './codec-failures.js';
import { MAXIMUM_DOCUMENT_BYTES } from './metadata-limits.js';
import type { BroadcastDescription, ForeignMetadataField, MetadataMap } from './metadata-map.js';
import { DOCUMENT_TEXT, readText } from './metadata-text.js';
import { readBroadcast } from './riff-broadcast.js';
import { readCues, type ListedCue } from './riff-cues.js';
import { InfoText } from './riff-info.js';
import { CueLabels } from './riff-labels.js';
import { LIST_TYPE_BYTES } from './riff-list-entries.js';
import { readSampler, type SamplerReading } from './riff-sampler.js';

/** The scheme of a chunk kept whole, such as `iXML`. */
const CHUNK_SCHEME = 'riff';

const DONE = succeed(undefined);

/** Keeps what a chunk's reader read, or answers why it could not. */
function stored<T>(result: DomainResult<T>, keep: (value: T) => void): DomainResult<undefined> {
  if (!result.ok) return result;
  keep(result.value);
  return DONE;
}

/** The metadata chunks of one WAV file, read as they are met and assembled once all are. */
export class RiffChunkReading {
  private readonly info = new InfoText();
  private readonly labels = new CueLabels();
  private readonly documents: ForeignMetadataField[] = [];
  private readonly seen = new Set<string>();
  private broadcast: BroadcastDescription | undefined;
  private cues: readonly ListedCue[] | undefined;
  private sampler: SamplerReading | undefined;

  /** The readers of the chunks read once, and the size past which each is skipped rather than read. */
  private readonly single: ReadonlyMap<
    string,
    {
      readonly read: (body: Uint8Array) => DomainResult<undefined>;
      readonly skipAbove?: number;
    }
  > = new Map([
    [
      'bext',
      {
        read: (body: Uint8Array) =>
          stored(readBroadcast(body), (broadcast) => {
            this.broadcast = broadcast;
          }),
      },
    ],
    [
      'cue ',
      {
        read: (body: Uint8Array) =>
          stored(readCues(body), (cues) => {
            this.cues = cues;
          }),
      },
    ],
    [
      'smpl',
      {
        read: (body: Uint8Array) =>
          stored(readSampler(body), (sampler) => {
            this.sampler = sampler;
          }),
      },
    ],
    [
      'iXML',
      {
        read: (body: Uint8Array) => {
          const value = readText(body, 'unstated', DOCUMENT_TEXT);
          this.documents.push({ scheme: CHUNK_SCHEME, key: 'iXML', value });
          return DONE;
        },
        skipAbove: MAXIMUM_DOCUMENT_BYTES,
      },
    ],
  ]);

  /** The readers of the list types the map takes, by their type. */
  private readonly lists: ReadonlyMap<string, (list: Uint8Array) => DomainResult<undefined>> =
    new Map([
      ['INFO', (list: Uint8Array) => this.info.read(list)],
      ['adtl', (list: Uint8Array) => this.labels.read(list)],
    ]);

  /** The reader of a chunk read once, where this one is read: not met before, and within its size. */
  private singleReader(
    id: string,
    size: number,
  ): ((body: Uint8Array) => DomainResult<undefined>) | undefined {
    const single = this.single.get(id);
    if (single === undefined || this.seen.has(id)) return undefined;
    return single.skipAbove === undefined || size <= single.skipAbove ? single.read : undefined;
  }

  /** Whether a chunk other than a `LIST` is read; a `LIST` is decided by its type. */
  takesChunk(id: string, size: number): boolean {
    return this.singleReader(id, size) !== undefined;
  }

  /** Whether a `LIST` chunk of this type is read. */
  takesList(type: string): boolean {
    return this.lists.has(type);
  }

  /**
   * Reads a chunk's whole body, a `LIST`'s with its type, where the map takes
   * it; any other chunk is passed over.
   */
  read(id: string, body: Uint8Array): DomainResult<undefined> {
    if (id === 'LIST') {
      if (body.length < LIST_TYPE_BYTES) {
        return fail(malformed("A 'LIST' chunk is too short to name the type of its list."));
      }
      const list = this.lists.get(fourCharacterCode(body, 0));
      return list === undefined ? DONE : list(body.subarray(LIST_TYPE_BYTES));
    }
    const reader = this.singleReader(id, body.length);
    if (reader === undefined) return DONE;
    this.seen.add(id);
    return reader(body);
  }

  /**
   * The map of what was read. A label names the cue point, and the loop, whose
   * id is its cue id: samplers name a loop by a label of its own id, and this
   * package's writer gives cue points and loops ids apart.
   */
  toMap(): MetadataMap {
    const { info, labels, documents, broadcast, cues, sampler } = this;
    const cuePoints = (cues ?? []).map((cue) => ({
      position: cue.position,
      name: labels.names.get(cue.id) ?? '',
    }));
    const loops = (sampler?.loops ?? []).map(({ id, ...loop }) => {
      const name = labels.names.get(id);
      return name === undefined || name === '' ? loop : { ...loop, name };
    });
    const foreign = [...info.foreign, ...documents];
    return {
      ...(Object.keys(info.text).length === 0 ? {} : { text: info.text }),
      ...(foreign.length === 0 ? {} : { foreign }),
      ...(broadcast === undefined ? {} : { broadcast }),
      ...(cuePoints.length === 0 ? {} : { cues: cuePoints }),
      ...(loops.length === 0 ? {} : { loops }),
      ...(sampler === undefined ? {} : { tuning: sampler.tuning }),
    };
  }
}
