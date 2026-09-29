/**
 * The sound of a reference picture, decoded as an asset where the browser can
 * (REQ-AUDIO-156's extraction of embedded audio "where technically
 * practical"), so it can be opened in an editor view beside the picture.
 *
 * The browser decodes it, at the rate it is asked for: a browser gives
 * decoded audio at its decoder's rate rather than the file's, so the rate is
 * stated, 48 kHz, and the asset says it was converted. Its audio is held in
 * memory for the session and copied for each thread that reads it, since a
 * description's arrays are transferred away. A file with no sound, or one the
 * browser cannot decode, is said with the reason; the picture is unaffected.
 */

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

/** The rate the browser is asked to decode a picture's sound at. */
export const PICTURE_SOUND_RATE = 48_000;

/** Decoded audio: one array per channel, at the rate asked for. */
export interface DecodedSound {
  readonly channels: readonly Float32Array[];
}

/** Decodes a file's sound, or says why it could not. */
export type DecodeSound = (bytes: ArrayBuffer) => Promise<DecodedSound | string>;

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
    markers: [],
    regions: [],
  };
}

/**
 * Decodes the sound of `file` and adds it to the catalogue, telling the
 * picture how it went. `signal` abandons it where another picture is opened.
 */
export async function decodePictureSound(options: {
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
    decoded = await decode(await file.arrayBuffer());
  } catch (error) {
    // A file removed after it was chosen, or one the browser will not read.
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

/** Decodes each picture's sound as it is opened, abandoning the one before. */
export class PictureSoundDecoder {
  readonly #options: Omit<Parameters<typeof decodePictureSound>[0], 'file' | 'signal'>;
  #current: AbortController | undefined;

  constructor(options: Omit<Parameters<typeof decodePictureSound>[0], 'file' | 'signal'>) {
    this.#options = options;
  }

  /** Decodes the sound of `file`. */
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
