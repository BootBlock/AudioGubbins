/**
 * The map a metadata reader fills as it reads, field by field.
 *
 * Every compressed format's reader meets the same questions: what a repeated
 * field becomes, how many fields a file may hold, and how the loop tags, which
 * arrive as separate fields in any order, become one loop. They are answered
 * once here. A repeated text field, such as the several `ARTIST` comments a
 * Vorbis file may hold, is kept as one value joined by `; `, so nothing read is
 * lost and the value stays legible.
 */

import { fail, sampleCount, succeed, type DomainResult } from '@audiogubbins/domain';

import { metadataOverBound } from './framing-failures.js';
import { frameCountTag, type LoopTagPart } from './loop-tags.js';
import type {
  CoverArt,
  CuePoint,
  ForeignMetadataField,
  MetadataLoop,
  MetadataMap,
  MetadataTextKey,
  SamplerTuning,
} from './metadata-map.js';
import { MAXIMUM_METADATA_FIELDS } from './metadata-limits.js';

/** What joins the values of a text field a file repeats. */
const REPEAT_SEPARATOR = '; ';

/** A loop tag as read, kept whole so a tag that makes no loop is still kept as a field. */
interface LoopTag {
  readonly frames: number;
  readonly field: ForeignMetadataField;
}

/** The parts a reader has read so far. */
export class MetadataGathering {
  private readonly text: Partial<Record<MetadataTextKey, string>> = {};
  private readonly foreign: ForeignMetadataField[] = [];
  private readonly loopTags: Partial<Record<LoopTagPart, LoopTag>> = {};
  private loops: readonly MetadataLoop[] | undefined;
  private cues: readonly CuePoint[] | undefined;
  private tuning: SamplerTuning | undefined;
  private coverArt: CoverArt | undefined;
  private frontCover = false;
  private fields = 0;

  /** Counts one field of the file, refusing a file of more than the bound. */
  countField(): DomainResult<undefined> {
    this.fields += 1;
    return this.fields > MAXIMUM_METADATA_FIELDS
      ? fail(metadataOverBound('count of metadata fields', MAXIMUM_METADATA_FIELDS))
      : succeed(undefined);
  }

  addText(key: MetadataTextKey, value: string): void {
    const before = this.text[key];
    this.text[key] = before === undefined ? value : `${before}${REPEAT_SEPARATOR}${value}`;
  }

  addForeign(scheme: string, key: string, value: string): void {
    this.foreign.push({ scheme, key, value });
  }

  /** A loop tag's value: a tag that states no count of frames is kept as a foreign field. */
  addLoopTag(part: LoopTagPart, scheme: string, key: string, value: string): void {
    const frames = frameCountTag(value);
    if (frames === undefined || this.loopTags[part] !== undefined) {
      this.addForeign(scheme, key, value);
      return;
    }
    this.loopTags[part] = { frames, field: { scheme, key, value } };
  }

  /** Loops a format states fully, as a sampler chunk does, which take the place of loop tags. */
  setLoops(loops: readonly MetadataLoop[]): void {
    this.loops = loops;
  }

  setCues(cues: readonly CuePoint[]): void {
    this.cues = cues;
  }

  setTuning(tuning: SamplerTuning): void {
    this.tuning = tuning;
  }

  /**
   * A picture of the file. A map holds one: the first front cover, or the first
   * picture where the file states no front cover.
   */
  addCoverArt(coverArt: CoverArt, frontCover: boolean): void {
    if (this.coverArt === undefined || (frontCover && !this.frontCover)) {
      this.coverArt = coverArt;
      this.frontCover = frontCover;
    }
  }

  /** Whether a picture of this kind would be kept, so a reader can skip the bytes of one that would not. */
  keepsCoverArt(frontCover: boolean): boolean {
    return this.coverArt === undefined || (frontCover && !this.frontCover);
  }

  /** The map read, holding only the parts the file had. */
  toMap(): MetadataMap {
    const tagged = this.taggedLoops();
    const loops = this.loops ?? tagged;
    // Tags that state no loop are kept as the fields they are. Where a sampler
    // chunk states the loops, the tags are the same loop told more briefly, as
    // the writers write both.
    const foreign =
      tagged !== undefined || this.loops !== undefined
        ? this.foreign
        : [...this.foreign, ...Object.values(this.loopTags).map((tag) => tag.field)];
    return {
      ...(Object.keys(this.text).length === 0 ? {} : { text: { ...this.text } }),
      ...(foreign.length === 0 ? {} : { foreign: [...foreign] }),
      ...(this.cues === undefined || this.cues.length === 0 ? {} : { cues: this.cues }),
      ...(loops === undefined || loops.length === 0 ? {} : { loops }),
      ...(this.tuning === undefined ? {} : { tuning: this.tuning }),
      ...(this.coverArt === undefined ? {} : { coverArt: this.coverArt }),
    };
  }

  /** The loop the tags state: a start with a length, or with an end after it. */
  private taggedLoops(): readonly MetadataLoop[] | undefined {
    const start = this.loopTags.start?.frames;
    const length = this.loopTags.length?.frames;
    const end = this.loopTags.end?.frames;
    if (start === undefined) return undefined;
    const frames = length ?? (end !== undefined && end > start ? end - start : undefined);
    if (frames === undefined || frames === 0) return undefined;
    const first = sampleCount(start);
    const span = sampleCount(frames);
    if (!first.ok || !span.ok) return undefined;
    return [{ start: first.value, length: span.value, playCount: 'endless', direction: 'forward' }];
  }
}
