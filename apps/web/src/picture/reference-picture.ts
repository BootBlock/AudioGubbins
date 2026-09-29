/**
 * The reference picture: a video file opened beside the audio, shown in the
 * Picture panel and kept on the transport's clock (REQ-AUDIO-156, ADR-0046).
 *
 * Video is reference media. The project holds no video model; this holds the
 * file's element, what the browser made of it, and the binding of its time to
 * one asset's timeline, whose offset and frame-rate interpretation the person
 * calibrates through the picture commands. It is made once by the composition
 * root and lives as long as the page, so the element and its decoded state
 * outlast the panel that shows it, which the dock may remount.
 *
 * The picture follows the audio, never the reverse: each display frame, or
 * each presented video frame where the browser says when that is, the Picture
 * panel hands `follow` the audible position, and the binding's policy says
 * whether to seek. Playing, the element plays muted beside the transport and
 * is corrected when it drifts by more than a frame; parked, it shows exactly
 * the frame that holds the position. A file the browser cannot decode is
 * reported with the reason, and nothing about the audio changes.
 */

import type { Logger } from '@audiogubbins/diagnostics';
import {
  bindingAtStart,
  calibratedTo,
  nudgedByFrames,
  pictureCorrection,
  pictureFrameAt,
  type PresentedPicture,
  type ReferenceMediaClockBinding,
  type TransportMotion,
} from '@audiogubbins/video-reference';
import { StandardFrameRates, type FrameRate } from '@audiogubbins/timeline';

import type { EditorAsset } from '../assets/editor-asset.js';
import { observable, type Observable } from '../state/observable.js';
import { Filmstrip, type FilmstripPlatform } from './filmstrip.js';

/** How high a thumbnail is made, in CSS pixels: twice an editor's picture strip, for dense screens. */
const THUMBNAIL_HEIGHT = 96;

/** What the browser made of the picture file. */
export type PictureMedia =
  | { readonly kind: 'none' }
  | { readonly kind: 'loading'; readonly name: string }
  | {
      readonly kind: 'ready';
      readonly name: string;
      readonly duration: number;
      readonly width: number;
      readonly height: number;
    }
  | { readonly kind: 'undecodable'; readonly name: string; readonly reason: string };

/** What became of the picture's own sound. */
export type PictureSound =
  | { readonly kind: 'none' }
  | { readonly kind: 'decoding' }
  | { readonly kind: 'decoded'; readonly asset: string }
  | { readonly kind: 'unavailable'; readonly reason: string };

/** The reference picture as the interface reads it. */
export interface PictureState {
  readonly media: PictureMedia;
  readonly sound: PictureSound;
  /** The asset whose timeline the picture is bound to, and the binding. */
  readonly asset: string | undefined;
  readonly binding: ReferenceMediaClockBinding | undefined;
}

/** The frame rate a picture is counted at until the person says otherwise. */
const DEFAULT_FRAME_RATE: FrameRate = StandardFrameRates.pal;

const NOTHING: PictureState = {
  media: { kind: 'none' },
  sound: { kind: 'none' },
  asset: undefined,
  binding: undefined,
};

/** The browser's part in showing a picture, handed in by the composition root. */
export interface PicturePlatform extends FilmstripPlatform {
  /** A new video element, muted, not yet in the page. */
  readonly createVideo: () => HTMLVideoElement;
  readonly createUrl: (file: Blob) => string;
  readonly revokeUrl: (url: string) => void;
  /** Whether the browser says when each video frame is presented. */
  readonly framesAnnounced: boolean;
}

/** The media error codes, in words a reader is shown. */
const MEDIA_ERRORS: Readonly<Record<number, string>> = {
  1: 'Loading the file was stopped.',
  2: 'The file could not be read.',
  3: 'The browser could not decode this video.',
  4: 'This browser cannot play this kind of video.',
};

/** The reference picture. */
export class ReferencePicture implements Observable<PictureState> {
  readonly #platform: PicturePlatform;
  readonly #logger: Logger;
  readonly #state = observable<PictureState>(NOTHING);
  readonly #video: HTMLVideoElement;
  #url: string | undefined;
  #filmstrip: Filmstrip | undefined;
  /** The media time of the frame the browser last said it presented. */
  #presented: number | undefined;
  /** Where the element was last sent, so a seek on its way is not asked for again. */
  #seekingTo: number | undefined;

  constructor(options: { readonly platform: PicturePlatform; readonly logger: Logger }) {
    this.#platform = options.platform;
    this.#logger = options.logger;
    this.#video = options.platform.createVideo();
    this.#video.muted = true;
    this.#video.preload = 'auto';
    this.#video.playsInline = true;
    this.#video.addEventListener('loadedmetadata', this.#loaded);
    this.#video.addEventListener('error', this.#failed);
    this.#video.addEventListener('seeked', () => {
      this.#seekingTo = undefined;
    });
  }

  readonly get = (): PictureState => this.#state.get();
  readonly subscribe = (listener: () => void): (() => void) => this.#state.subscribe(listener);

  /** The element the Picture panel shows. */
  get element(): HTMLVideoElement {
    return this.#video;
  }

  /** The thumbnails of the picture open, for an editor view's picture strip. */
  get filmstrip(): Filmstrip | undefined {
    return this.#filmstrip;
  }

  /** Opens `file`, bound to `asset`'s timeline from its start, replacing any picture open. */
  open(file: File, asset: EditorAsset | undefined): void {
    this.#release();
    const url = this.#platform.createUrl(file);
    this.#url = url;
    this.#presented = undefined;
    this.#seekingTo = undefined;
    this.#state.set({
      media: { kind: 'loading', name: file.name },
      sound: { kind: 'none' },
      asset: asset?.id,
      binding:
        asset === undefined ? undefined : bindingAtStart(asset.sampleRate, DEFAULT_FRAME_RATE),
    });
    this.#video.src = url;
    this.#video.load();
    this.#filmstrip = new Filmstrip(this.#platform, url, THUMBNAIL_HEIGHT, (reason) => {
      this.#logger.warning('The picture strip could not be made.', { reason });
    });
    if (this.#platform.framesAnnounced) this.#watchFrames();
  }

  /** Closes the picture. */
  close(): void {
    this.#release();
    this.#state.set(NOTHING);
  }

  /**
   * Binds the picture to `asset`'s timeline. The offset is kept in time, so a
   * picture calibrated against one asset lines up the same against another;
   * at another rate it is rounded to the nearest of its boundaries.
   */
  bind(asset: EditorAsset): void {
    const { binding } = this.#state.get();
    const offset =
      binding === undefined
        ? 0
        : Math.round((binding.offset * asset.sampleRate) / binding.timelineRate);
    const frames = binding?.frames ?? DEFAULT_FRAME_RATE;
    this.#state.update((current) => ({
      ...current,
      asset: asset.id,
      binding: {
        ...bindingAtStart(asset.sampleRate, frames),
        offset,
        firstFrameLabel: binding?.firstFrameLabel ?? 0,
      },
    }));
  }

  /** Counts the picture at `frames`. */
  interpretAt(frames: FrameRate): void {
    this.#changeBinding((binding) => ({ ...binding, frames }));
  }

  /** Moves the picture later on the timeline by `count` frames, earlier where negative. */
  nudge(count: number): void {
    this.#changeBinding((binding) => nudgedByFrames(binding, count));
  }

  /** Lines the frame the picture shows at `position` up so that it starts there. */
  alignWith(position: number): void {
    this.#changeBinding((binding) =>
      calibratedTo(binding, pictureFrameAt(binding, position), position),
    );
  }

  /** What the element presents now: its frame's media time, and the file's length. */
  presented(): PresentedPicture | undefined {
    const { media } = this.#state.get();
    if (media.kind !== 'ready') return undefined;
    return { mediaTime: this.#presented ?? this.#video.currentTime, duration: media.duration };
  }

  /**
   * Keeps the picture on the audio at `position`, moving or parked, by the
   * binding's policy: a seek where it has drifted, or the frame that holds
   * the position, and the element playing only while the transport moves.
   */
  follow(position: number, motion: TransportMotion): void {
    const { binding } = this.#state.get();
    const presented = this.presented();
    if (binding === undefined || presented === undefined) return;
    const correction = pictureCorrection(binding, position, presented, motion);
    const shouldPlay = motion === 'playing' && correction.kind !== 'no-picture';
    if (shouldPlay && this.#video.paused) void this.#play();
    if (!shouldPlay && !this.#video.paused) this.#video.pause();
    if (correction.kind === 'seek' && this.#seekingTo !== correction.to) {
      this.#seekingTo = correction.to;
      this.#presented = undefined;
      this.#video.currentTime = correction.to;
    }
  }

  /**
   * Shows the picture across the whole screen, or says why it cannot. Asked
   * from the person's gesture, as a browser requires.
   */
  async enlarge(): Promise<string | undefined> {
    try {
      await this.#video.requestFullscreen();
      return undefined;
    } catch (error) {
      return `The picture could not be shown full screen: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /** Lets go of the element's file, as the page closes. */
  dispose(): void {
    this.#release();
  }

  #changeBinding(
    change: (binding: ReferenceMediaClockBinding) => ReferenceMediaClockBinding,
  ): void {
    this.#state.update((current) =>
      current.binding === undefined ? current : { ...current, binding: change(current.binding) },
    );
  }

  async #play(): Promise<void> {
    try {
      await this.#video.play();
    } catch (error) {
      // A muted element may play without a gesture, but a browser can still
      // refuse; the picture then shows parked frames, which is said.
      this.#logger.warning('The reference picture would not play.', {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  #watchFrames(): void {
    const watch = (): void => {
      this.#video.requestVideoFrameCallback((_now, metadata) => {
        this.#presented = metadata.mediaTime;
        if (this.#url !== undefined) watch();
      });
    };
    watch();
  }

  readonly #loaded = (): void => {
    this.#state.update((current) =>
      current.media.kind === 'loading'
        ? {
            ...current,
            media: {
              kind: 'ready',
              name: current.media.name,
              duration: this.#video.duration,
              width: this.#video.videoWidth,
              height: this.#video.videoHeight,
            },
          }
        : current,
    );
  };

  readonly #failed = (): void => {
    const { media } = this.#state.get();
    if (media.kind !== 'loading' && media.kind !== 'ready') return;
    const code = this.#video.error?.code;
    const reason =
      (code === undefined ? undefined : MEDIA_ERRORS[code]) ??
      'The browser could not open this video.';
    this.#logger.warning('A reference picture could not be decoded.', { reason });
    this.#release();
    this.#state.update((current) => ({
      ...current,
      media: { kind: 'undecodable', name: media.name, reason },
      binding: undefined,
    }));
  };

  #release(): void {
    this.#filmstrip?.close();
    this.#filmstrip = undefined;
    if (this.#url === undefined) return;
    this.#video.pause();
    this.#video.removeAttribute('src');
    this.#video.load();
    this.#platform.revokeUrl(this.#url);
    this.#url = undefined;
  }

  /** Records what became of the picture's own sound. */
  soundIs(sound: PictureSound): void {
    this.#state.update((current) => ({ ...current, sound }));
  }
}
