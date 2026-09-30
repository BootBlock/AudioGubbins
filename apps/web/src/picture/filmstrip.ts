/**
 * Thumbnails of the reference picture for an editor view's picture strip
 * (REQ-AUDIO-156's filmstrip), made from an element of their own so the
 * picture shown in the Picture panel is never moved to make one.
 *
 * A thumbnail is made on demand, one at a time: the element seeks to the
 * frame and the frame is captured small. The ones asked for most recently are
 * made first and a request for frames no longer shown is dropped, so a view
 * scrolled past many frames asks for the frames it shows, not every one it
 * passed. The latest few hundred are kept.
 */

/** How many thumbnails are kept. */
const KEPT = 240;

/** What making thumbnails needs of the browser. */
export interface FilmstripPlatform {
  readonly createVideo: () => HTMLVideoElement;
  /** The frame `video` shows, captured at `height` CSS pixels high. */
  readonly capture: (video: HTMLVideoElement, height: number) => Promise<CanvasImageSource>;
}

/** Keys a thumbnail by its media time, to the microsecond. */
function keyOf(time: number): number {
  return Math.round(time * 1_000_000);
}

/** The thumbnails of one picture file. */
export class Filmstrip {
  readonly #platform: FilmstripPlatform;
  readonly #video: HTMLVideoElement;
  readonly #height: number;
  readonly #fault: (reason: string) => void;
  readonly #kept = new Map<number, CanvasImageSource>();
  readonly #listeners = new Set<() => void>();
  #wanted: readonly number[] = [];
  #making = false;
  #closed = false;

  constructor(
    platform: FilmstripPlatform,
    url: string,
    height: number,
    fault: (reason: string) => void,
  ) {
    this.#platform = platform;
    this.#height = height;
    this.#fault = fault;
    this.#video = platform.createVideo();
    this.#video.muted = true;
    this.#video.preload = 'auto';
    this.#video.src = url;
  }

  /** Hears each thumbnail made. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * The thumbnails of the frames at `times`, where they are made, in order;
   * the rest are made, the first asked for first.
   */
  images(times: readonly number[]): readonly (CanvasImageSource | undefined)[] {
    const found = times.map((time) => this.#kept.get(keyOf(time)));
    this.#wanted = times.filter((_, index) => found[index] === undefined);
    void this.#make();
    return found;
  }

  close(): void {
    this.#closed = true;
    this.#wanted = [];
    this.#video.removeAttribute('src');
    this.#video.load();
    this.#listeners.clear();
  }

  async #make(): Promise<void> {
    if (this.#making) return;
    this.#making = true;
    try {
      for (
        let time = this.#wanted[0];
        time !== undefined && !this.#closed;
        time = this.#wanted[0]
      ) {
        this.#wanted = this.#wanted.slice(1);
        if (this.#kept.has(keyOf(time))) continue;
        await this.#seek(time);
        // Closed while the element sought, by a picture closed or replaced.
        if (this.#isClosed()) return;
        this.#keep(time, await this.#platform.capture(this.#video, this.#height));
        for (const listener of [...this.#listeners]) listener();
      }
    } catch (error) {
      // The strip stops rather than asking again for what failed; the picture
      // itself is unaffected, and the reason is recorded.
      this.close();
      this.#fault(error instanceof Error ? error.message : String(error));
    } finally {
      this.#making = false;
    }
  }

  #isClosed(): boolean {
    return this.#closed;
  }

  #seek(time: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const done = (): void => {
        this.#video.removeEventListener('seeked', done);
        this.#video.removeEventListener('error', failed);
        resolve();
      };
      const failed = (): void => {
        this.#video.removeEventListener('seeked', done);
        this.#video.removeEventListener('error', failed);
        reject(new Error('The picture could not be read for a thumbnail.'));
      };
      this.#video.addEventListener('seeked', done);
      this.#video.addEventListener('error', failed);
      this.#video.currentTime = time;
    });
  }

  #keep(time: number, image: CanvasImageSource): void {
    this.#kept.set(keyOf(time), image);
    // A map keeps the order things were added in, so the first is the oldest.
    if (this.#kept.size > KEPT) {
      const [oldest] = this.#kept.keys();
      if (oldest !== undefined) this.#kept.delete(oldest);
    }
  }
}
