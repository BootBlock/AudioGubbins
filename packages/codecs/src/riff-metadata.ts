/**
 * The metadata of a WAV, RF64 or BW64 file, read into the one map (ADR-0093).
 *
 * The chunks mapped are `LIST`/`INFO` for text, `bext` for the broadcast
 * description, `cue ` with the `labl` entries of `LIST`/`adtl` for named
 * points, `smpl` for loops and the sampler's tuning, and `iXML`, kept whole;
 * each chunk's layout is read by its own module, and this one walks the file
 * and assembles the map. The walk is the audio reader's own, so RF64's ds64
 * sizes mean the same to both, and it never reads the sample data. Of `bext`,
 * `cue `, `smpl` and `iXML` the first in the file is read and a later one
 * ignored, as a reader of one description takes the first; `INFO` and `adtl`
 * lists are read wherever they lie.
 *
 * Every count is bounded, and a chunk that breaks its own rules or a bound is
 * refused with `codecs.malformed`, never read in part. An `iXML` chunk larger
 * than its bound is skipped unread: it is kept for its own reader, never
 * needed to read the rest.
 */

import { fail, succeed, type CancellationSignal, type DomainResult } from '@audiogubbins/domain';

import type { AudioBytes } from './audio-bytes.js';
import { fourCharacterCode, type HeaderSource } from './byte-reading.js';
import { readHeaderChunk, type ChunkSpan } from './chunk-walk.js';
import { malformed } from './codec-failures.js';
import type { BroadcastDescription, ForeignMetadataField, MetadataMap } from './metadata-map.js';
import { MetadataChunkReader, openForm, type MetadataReader } from './metadata-reading.js';
import { DOCUMENT_TEXT, decodeText } from './metadata-text.js';
import { readBroadcast } from './riff-broadcast.js';
import { firstWalk } from './riff-container.js';
import { readCues, type ListedCue } from './riff-cues.js';
import { InfoText } from './riff-info.js';
import { CueLabels } from './riff-labels.js';
import { LIST_TYPE_BYTES } from './riff-list-entries.js';
import { readSampler, type SamplerReading } from './riff-sampler.js';

/** The RIFF forms by the id a file opens with. */
const FORMS: ReadonlyMap<string, 'wav' | 'rf64' | 'bw64'> = new Map([
  ['RIFF', 'wav'],
  ['RF64', 'rf64'],
  ['BW64', 'bw64'],
]);

/** The scheme of a chunk kept whole, such as `iXML`. */
export const CHUNK_SCHEME = 'riff';

/** The largest `iXML` chunk kept; a larger one is skipped. */
const MAXIMUM_IXML_BYTES = 262_144;

/** What the walk has found so far. */
interface RiffFindings {
  readonly info: InfoText;
  readonly labels: CueLabels;
  readonly documents: ForeignMetadataField[];
  readonly seen: Set<string>;
  broadcast?: BroadcastDescription;
  cues?: readonly ListedCue[];
  sampler?: SamplerReading;
}

const DONE = succeed(undefined);

/** Keeps what a chunk's reader read, or answers why it could not. */
function stored<T>(result: DomainResult<T>, keep: (value: T) => void): DomainResult<undefined> {
  if (!result.ok) return result;
  keep(result.value);
  return DONE;
}

/** A chunk read once, and the size past which it is skipped rather than read. */
interface SingleChunk {
  readonly read: (body: Uint8Array, findings: RiffFindings) => DomainResult<undefined>;
  readonly skipAbove?: number;
}

const SINGLE_CHUNKS: ReadonlyMap<string, SingleChunk> = new Map<string, SingleChunk>([
  [
    'bext',
    {
      read: (body, findings) =>
        stored(readBroadcast(body), (broadcast) => {
          findings.broadcast = broadcast;
        }),
    },
  ],
  [
    'cue ',
    {
      read: (body, findings) =>
        stored(readCues(body), (cues) => {
          findings.cues = cues;
        }),
    },
  ],
  [
    'smpl',
    {
      read: (body, findings) =>
        stored(readSampler(body), (sampler) => {
          findings.sampler = sampler;
        }),
    },
  ],
  [
    'iXML',
    {
      read: (body, findings) => {
        const value = decodeText(body, DOCUMENT_TEXT);
        findings.documents.push({ scheme: CHUNK_SCHEME, key: 'iXML', value });
        return DONE;
      },
      skipAbove: MAXIMUM_IXML_BYTES,
    },
  ],
]);

/** The list types read, by their type. */
const LIST_READERS: ReadonlyMap<
  string,
  (list: Uint8Array, findings: RiffFindings) => DomainResult<undefined>
> = new Map([
  ['INFO', (list: Uint8Array, findings: RiffFindings) => findings.info.read(list)],
  ['adtl', (list: Uint8Array, findings: RiffFindings) => findings.labels.read(list)],
]);

/** Reads a `LIST` chunk whose type is one the map takes, reading only the type of any other. */
async function readList(
  source: HeaderSource,
  chunks: MetadataChunkReader,
  span: ChunkSpan,
  findings: RiffFindings,
  signal: CancellationSignal | undefined,
): Promise<DomainResult<undefined>> {
  if (span.size < LIST_TYPE_BYTES) {
    return fail(malformed("A 'LIST' chunk is too short to name the type of its list."));
  }
  const type = await readHeaderChunk(source, span, LIST_TYPE_BYTES, signal);
  if (!type.ok) return type;
  const reader = LIST_READERS.get(fourCharacterCode(type.value, 0));
  if (reader === undefined) return DONE;
  const body = await chunks.body(span, signal);
  if (!body.ok) return body;
  return reader(body.value.subarray(LIST_TYPE_BYTES), findings);
}

/** Reads one chunk the walk met, if the map takes it. */
async function readChunk(
  source: HeaderSource,
  chunks: MetadataChunkReader,
  span: ChunkSpan,
  findings: RiffFindings,
  signal: CancellationSignal | undefined,
): Promise<DomainResult<undefined>> {
  if (span.id === 'LIST') return await readList(source, chunks, span, findings, signal);
  const single = SINGLE_CHUNKS.get(span.id);
  if (single === undefined || findings.seen.has(span.id)) return DONE;
  if (single.skipAbove !== undefined && span.size > single.skipAbove) return DONE;
  findings.seen.add(span.id);
  const body = await chunks.body(span, signal);
  if (!body.ok) return body;
  return single.read(body.value, findings);
}

/**
 * The map of what was found. A label names the cue point, and the loop, whose
 * id is its cue id: samplers name a loop by a label of its own id, and this
 * package's writer gives cue points and loops ids apart.
 */
function foundMap(findings: RiffFindings): MetadataMap {
  const { info, labels, documents, broadcast, cues, sampler } = findings;
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

/** Reads a WAV, RF64 or BW64 file's metadata. */
export const readRiffMetadata: MetadataReader = async (
  bytes: AudioBytes,
  signal?: CancellationSignal,
): Promise<DomainResult<MetadataMap>> => {
  const opened = await openForm(bytes, signal);
  if (!opened.ok) return opened;
  const { head, source } = opened.value;
  const form = FORMS.get(fourCharacterCode(head, 0));
  if (form === undefined || fourCharacterCode(head, 8) !== 'WAVE') {
    return fail(malformed('The file is not a WAV, RF64 or BW64 file.'));
  }
  const walked = await firstWalk(source, form, signal);
  if (!walked.ok) return walked;
  const chunks = new MetadataChunkReader(source);
  const findings: RiffFindings = {
    info: new InfoText(),
    labels: new CueLabels(),
    documents: [],
    seen: new Set(),
  };
  for (;;) {
    const next = await walked.value.next(signal);
    if (!next.ok) return next;
    if (next.value === undefined) return succeed(foundMap(findings));
    const read = await readChunk(source, chunks, next.value, findings, signal);
    if (!read.ok) return read;
  }
};
