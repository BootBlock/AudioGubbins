/**
 * The sound of a reference picture, decoded as an asset where the browser can
 * (REQ-AUDIO-156's extraction of embedded audio "where technically
 * practical"), so it can be opened in an editor view beside the picture.
 *
 * Extracted only when the person asks, and only within the memory the page can
 * spare ({@link soundRefusal}): the file is read whole and its sound held
 * whole, so opening a picture never costs either.
 *
 * The browser decodes it, at the rate it is asked for: a browser gives
 * decoded audio at its decoder's rate rather than the file's, so the rate is
 * stated, 48 kHz, and the asset says it was converted. Its audio is held in
 * memory for the session and copied for each thread that reads it, since a
 * description's arrays are transferred away. A file with no sound, or one the
 * browser cannot decode, is said with the reason; the picture is unaffected.
 */

import type { ResourceFigures } from '@audiogubbins/capabilities';
import type { Logger } from '@audiogubbins/diagnostics';
import {
  StandardLayouts,
  discreteLayout,
  sampleCount,
  sampleRate,
  succeed,
  type ChannelLayout,
  type DomainResult,
} from '@audiogubbins/domain';
import { PcmDescriptionKind } from '@audiogubbins/audio-engine';

import { revisionOf, type EditorAsset } from '../assets/editor-asset.js';
import type { AssetCatalogue } from '../state/asset-catalogue.js';
import type { ReferencePicture } from './reference-picture.js';
import { soundBound, soundRefusal } from './sound-bound.js';

/** The rate the browser is asked to decode a picture's sound at. */
export const PICTURE_SOUND_RATE = 48_000;

/** Decoded audio: one array per channel, at the rate asked for. */
export interface DecodedSound {
  readonly channels: readonly Float32Array[];
}

/**
 * Decodes a file's sound, or says why it could not, reading no further once
 * `signal` abandons it.
 */
export type DecodeSound = (file: Blob, signal: AbortSignal) => Promise<DecodedSound | string>;

/**
 * Reads `stream`, of `size` bytes, into one buffer of that size, cancelling the
 * read as soon as `signal` abandons it rather than reading the rest of a file
 * nobody wants. Throws the signal's reason once abandoned.
 */
export async function readWhole(
  stream: ReadableStream<Uint8Array>,
  size: number,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  signal.throwIfAborted();
  const bytes = new Uint8Array(size);
  const reader = stream.getReader();
  const stop = (): void => {
    void reader.cancel(signal.reason);
  };
  signal.addEventListener('abort', stop, { once: true });
  try {
    let at = 0;
    for (;;) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      if (at + value.length > size) throw new Error('The file grew while it was read.');
      bytes.set(value, at);
      at += value.length;
    }
    if (at !== size) throw new Error('The file shrank while it was read.');
    return bytes.buffer;
  } finally {
    signal.removeEventListener('abort', stop);
  }
}

function layoutFor(channels: number): DomainResult<ChannelLayout> {
  if (channels === 1) return succeed(StandardLayouts.mono);
  if (channels === 2) return succeed(StandardLayouts.stereo);
  return discreteLayout(channels);
}

/** The asset the sound of `file` makes, or why it makes none. */
export function pictureSoundAsset(file: File, sound: DecodedSound): EditorAsset | string {
  const frames = sound.channels[0]?.length ?? 0;
  if (sound.channels.length === 0 || frames === 0) return 'The picture has no sound.';
  const layout = layoutFor(sound.channels.length);
  const rate = sampleRate(PICTURE_SOUND_RATE);
  const length = sampleCount(frames);
  if (!layout.ok || !rate.ok || !length.ok)
    return 'The picture’s sound has a shape AudioGubbins cannot hold.';
  const id = `picture-sound:${file.name}:${String(file.size)}:${String(file.lastModified)}`;
  return {
    id,
    name: `Sound of ${file.name}`,
    description: `The sound of the reference picture, decoded by the browser at ${String(PICTURE_SOUND_RATE / 1000)} kHz.`,
    sampleRate: rate.value,
    layout: layout.value,
    length: length.value,
    revision: revisionOf(`${id}:${String(frames)}:${String(sound.channels.length)}`),
    // Copied each time: a description's arrays are transferred to the thread
    // that reads them, and the session keeps its own.
    describe: () => ({
      kind: PcmDescriptionKind.Pcm,
      sampleRate: rate.value,
      channels: sound.channels.map((channel) => channel.slice()),
    }),
    owner: {
      kind: 'session',
      reason:
        'The sound of a reference picture is not part of a project, so it cannot be marked or edited. Import the file as audio to mark and edit it.',
    },
    markers: [],
    regions: [],
  };
}

/**
 * Decodes the sound of `file` and adds it to the catalogue, telling the picture
 * how it went. `signal` abandons it where the picture is closed or another is
 * opened.
 */
async function decodePictureSound(options: {
  readonly file: File;
  readonly decode: DecodeSound;
  readonly picture: ReferencePicture;
  readonly catalogue: AssetCatalogue;
  readonly logger: Logger;
  readonly signal: AbortSignal;
}): Promise<void> {
  const { file, decode, picture, catalogue, logger, signal } = options;
  picture.soundIs({ kind: 'decoding' });
  let decoded: DecodedSound | string;
  try {
    decoded = await decode(file, signal);
  } catch (error) {
    // A file removed after it was chosen, or one the browser will not read; or
    // the read abandoned, which the signal says below.
    decoded = `The picture’s sound could not be read: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (signal.aborted) return;
  const asset = typeof decoded === 'string' ? decoded : pictureSoundAsset(file, decoded);
  if (typeof asset === 'string') {
    logger.info('A reference picture’s sound was not decoded.', { reason: asset });
    picture.soundIs({ kind: 'unavailable', reason: asset });
    return;
  }
  catalogue.add(asset);
  picture.soundIs({ kind: 'decoded', asset: asset.id });
}

/** What the decoder of pictures' sound is made with. */
type DecoderOptions = Omit<Parameters<typeof decodePictureSound>[0], 'file' | 'signal'> & {
  /** What the page has left, measured when each extraction is weighed, since it moves. */
  readonly resources: () => ResourceFigures;
};

/** Decodes a picture's sound when asked, within the page's memory, one at a time. */
export class PictureSoundDecoder {
  readonly #options: DecoderOptions;
  #current: AbortController | undefined;

  constructor(options: DecoderOptions) {
    this.#options = options;
  }

  /**
   * Why the sound of `file`, lasting `duration` seconds, cannot be extracted in
   * the memory the page can spare now, or `undefined` when it can.
   */
  refusal(file: Blob, duration: number): string | undefined {
    return soundRefusal(
      file.size,
      duration,
      PICTURE_SOUND_RATE,
      soundBound(this.#options.resources()),
    );
  }

  /** Decodes the sound of `file`, abandoning any decoding before. */
  decode(file: File): void {
    this.#current?.abort();
    const controller = new AbortController();
    this.#current = controller;
    void decodePictureSound({ ...this.#options, file, signal: controller.signal });
  }

  /** Abandons the sound being decoded. */
  abandon(): void {
    this.#current?.abort();
    this.#current = undefined;
  }
}
