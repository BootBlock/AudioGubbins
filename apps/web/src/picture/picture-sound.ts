/**
 * The sound of a reference picture, decoded as an asset (REQ-AUDIO-156's
 * extraction of embedded audio "where technically practical"), so it can be
 * opened in an editor view beside the picture.
 *
 * Extracted only when the person asks, and only within the memory the page can
 * spare ({@link soundRefusal}), since the sound is held whole, so opening a
 * picture never costs it. The file is analysed by the codec worker first, as
 * an import is: a file whose sound the codecs here cannot decode is refused
 * with the reason an import gives, and the rest are weighed at the rate,
 * channels and length the analysis read from the file's headers, and refused
 * with the reason before a block of the sound is decoded.
 *
 * The codec worker decodes it (`codec-picture-sound.ts`), reading the file
 * where it lies, at the sound's own rate, never resampled, and in its own
 * channels, so the asset is the sound the file holds. Its audio is held in
 * memory for the session as the blocks it arrived in, and copied into one
 * array per channel for each thread that reads it, since a description's
 * arrays are transferred away. A file with no sound, or one the codecs here
 * cannot decode, is said with the reason; the picture is unaffected.
 */

import type { ResourceFigures } from '@audiogubbins/capabilities';
import type { AnalysedStream, ImportAnalysis } from '@audiogubbins/codec-runtime';
import type { DecoderIdentity } from '@audiogubbins/codecs';
import type { Logger } from '@audiogubbins/diagnostics';
import {
  sampleCount,
  type ChannelLayout,
  type DomainResult,
  type SampleRate,
} from '@audiogubbins/domain';
import { PcmDescriptionKind } from '@audiogubbins/audio-engine';

import { revisionOf, type EditorAsset } from '../assets/editor-asset.js';
import type { AssetCatalogue } from '../state/asset-catalogue.js';
import type { ReferencePicture } from './reference-picture.js';
import { soundBound, soundFrameLimit, soundRefusal } from './sound-bound.js';

/** A picture's sound, decoded at its own rate, in the blocks it arrived in. */
export interface DecodedSound {
  readonly sampleRate: SampleRate;
  readonly layout: ChannelLayout;
  /** Each block: one array per channel, in the layout's order, all of one length. */
  readonly blocks: readonly (readonly Float32Array[])[];
  /** The frames of every block together. */
  readonly frames: number;
  readonly decoder: DecoderIdentity;
}

/**
 * Decodes the sound of `file`, which its analysis described as `expected`,
 * keeping at most `limit` frames, or says why it could not; reading no
 * further once `signal` abandons it.
 */
export type DecodeSound = (
  file: Blob,
  expected: AnalysedStream,
  limit: number,
  signal: AbortSignal,
) => Promise<DecodedSound | string>;

/** One array per channel of `sound`'s blocks joined, fresh for each thread it is handed to. */
function joined(sound: DecodedSound): Float32Array[] {
  const channels = sound.layout.roles.map(() => new Float32Array(sound.frames));
  let at = 0;
  for (const block of sound.blocks) {
    channels.forEach((channel, index) => {
      const plane = block[index];
      if (plane !== undefined) channel.set(plane, at);
    });
    at += block[0]?.length ?? 0;
  }
  return channels;
}

const KILOHERTZ = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 3 });

/** The asset the sound of `file` makes, or why it makes none. */
export function pictureSoundAsset(file: File, sound: DecodedSound): EditorAsset | string {
  if (sound.frames === 0) return 'The picture has no sound.';
  const length = sampleCount(sound.frames);
  if (!length.ok) return 'The picture’s sound has a shape AudioGubbins cannot hold.';
  const channels = sound.layout.roles.length;
  const id = `picture-sound:${file.name}:${String(file.size)}:${String(file.lastModified)}`;
  const content = `${id}:${String(sound.frames)}:${String(channels)}:${String(sound.sampleRate)}`;
  const { decoder } = sound;
  return {
    id,
    name: `Sound of ${file.name}`,
    description: `The sound of the reference picture, decoded by ${decoder.name} ${decoder.version} at its own rate of ${KILOHERTZ.format(sound.sampleRate / 1000)} kHz.`,
    sampleRate: sound.sampleRate,
    layout: sound.layout,
    length: length.value,
    content,
    revision: revisionOf(content),
    // Joined afresh each time: a description's arrays are transferred to the
    // thread that reads them, and the session keeps its own.
    describe: () => ({
      kind: PcmDescriptionKind.Pcm,
      sampleRate: sound.sampleRate,
      channels: joined(sound),
    }),
    // A picture's sound has no chain to run.
    unracked: undefined,
    original: undefined,
    owner: {
      kind: 'session',
      reason:
        'The sound of a reference picture is not part of a project, so it cannot be marked or edited. Import the file as audio to mark and edit it.',
    },
    markers: [],
    regions: [],
  };
}

/** Analyses a file before anything of it is decoded, as the codecs do (`CodecServices.analyse`). */
type AnalyseFile = (file: Blob, signal: AbortSignal) => Promise<DomainResult<ImportAnalysis>>;

/** Why a file read in place is not extracted: it is audio, not a picture's sound. */
const READ_IN_PLACE =
  'The file is audio that AudioGubbins reads where it lies rather than decoding, so it has no picture’s sound to extract. Import it as audio instead.';

/**
 * The sound stream the analysis of a picture's file found, or why there is
 * none to decode: the refusal an import would give, with the reason.
 */
function soundStreamOf(analysis: DomainResult<ImportAnalysis>): AnalysedStream | string {
  if (!analysis.ok) return analysis.failures[0].summary;
  const analysed = analysis.value;
  switch (analysed.kind) {
    case 'decode':
      return analysed.stream;
    case 'read-in-place':
      return READ_IN_PLACE;
    case 'refused':
      return analysed.failure.summary;
  }
}

/** What the decoder of pictures' sound is made with. */
interface DecoderOptions {
  /** Reads the file's sound stream from its headers, before any of it is decoded. */
  readonly analyse: AnalyseFile;
  readonly decode: DecodeSound;
  readonly picture: ReferencePicture;
  readonly catalogue: AssetCatalogue;
  readonly logger: Logger;
  /** What the page has left, measured when each extraction is weighed, since it moves. */
  readonly resources: () => ResourceFigures;
}

/**
 * Analyses the sound of `file`, lasting `duration` seconds, weighs it against
 * the memory the page can spare, then decodes it and adds it to the catalogue,
 * telling the picture how it went. `signal` abandons it where the picture is
 * closed or another is opened.
 */
async function decodePictureSound(
  options: DecoderOptions,
  file: File,
  duration: number,
  signal: AbortSignal,
): Promise<void> {
  const { analyse, decode, picture, catalogue, logger, resources } = options;
  // Read afresh after each wait, since the picture may be closed during it.
  const abandoned = (): boolean => signal.aborted;
  const unavailable = (reason: string): void => {
    logger.info('A reference picture’s sound was not decoded.', { reason });
    picture.soundIs({ kind: 'unavailable', reason });
  };
  picture.soundIs({ kind: 'decoding' });
  const stream = soundStreamOf(await analyse(file, signal));
  if (abandoned()) return;
  if (typeof stream === 'string') {
    unavailable(stream);
    return;
  }
  const bound = soundBound(resources());
  const refused = soundRefusal(stream, duration, bound);
  if (refused !== undefined) {
    unavailable(refused);
    return;
  }
  const decoded = await decode(
    file,
    stream,
    soundFrameLimit(stream.layout.roles.length, bound),
    signal,
  );
  if (abandoned()) return;
  const asset = typeof decoded === 'string' ? decoded : pictureSoundAsset(file, decoded);
  if (typeof asset === 'string') {
    unavailable(asset);
    return;
  }
  catalogue.add(asset);
  picture.soundIs({ kind: 'decoded', asset: asset.id });
}

/** Decodes a picture's sound when asked, within the page's memory, one at a time. */
export class PictureSoundDecoder {
  readonly #options: DecoderOptions;
  #current: AbortController | undefined;

  constructor(options: DecoderOptions) {
    this.#options = options;
  }

  /**
   * Analyses, weighs, then decodes the sound of `file`, lasting `duration`
   * seconds, abandoning any decoding before.
   */
  decode(file: File, duration: number): void {
    this.#current?.abort();
    const controller = new AbortController();
    this.#current = controller;
    void decodePictureSound(this.#options, file, duration, controller.signal);
  }

  /** Abandons the sound being decoded. */
  abandon(): void {
    this.#current?.abort();
    this.#current = undefined;
  }
}
