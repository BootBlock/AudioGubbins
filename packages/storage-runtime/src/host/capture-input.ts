/**
 * A take's capture channel, read in the storage worker as the storage's
 * `CaptureStream` (ADR-0070, ADR-0071): the capture worklet's port, read by
 * the audio runtime's `CaptureReader`, its frames counted from the
 * recording's first.
 *
 * The channel opens with the frame, rate and channels the take is captured
 * at, which must be the recording's as it was set up: one that is not ends the
 * recording as failed before a frame is kept. The channel's end is mapped to
 * the recording's: stopped as stopped, an input let go of as the device lost,
 * and a failure as failed, with what the reader said. Cutting the input ends
 * it where it has reached, for an audio thread that will send nothing more.
 *
 * A channel stops or lets its input go only because the page told it to, so
 * the page knows better than the channel why such a capture ended, as a timed
 * stop, a permission taken away, a page suspended or a device unplugged; the
 * input says whether its end is one the page names (`pageNames`). An end the
 * channel or the storage met on its own, a failure, stands as it is.
 */

import { CaptureReader, type CaptureEvent } from '@audiogubbins/audio-runtime/capture-channel';
import { RecordingEnding } from '@audiogubbins/project-format';
import type { CaptureStream, CapturedEvent, RecordingSetUp } from '@audiogubbins/storage';

type End = Extract<CaptureEvent, { readonly kind: 'end' }>;

/** The recording's ending a channel's end says. */
function endingOf(end: End): RecordingEnding {
  switch (end.reason) {
    case 'stopped':
      return RecordingEnding.Stopped;
    case 'released':
      return RecordingEnding.DeviceLost;
    case 'failed':
      return RecordingEnding.Failed;
  }
}

/** A capture channel read as a recording's stream (see the module comment). */
export class CaptureInput implements CaptureStream {
  readonly #reader: CaptureReader;
  readonly #setUp: RecordingSetUp;

  /** The context frame of the recording's first frame, once the channel has begun. */
  #first: number | undefined;

  /** The end the input was cut with, where it was, and whether the page named it. */
  #cut: { readonly event: CapturedEvent; readonly byPage: boolean } | undefined;
  #ended = false;
  #pageNames = false;

  constructor(port: MessagePort, setUp: RecordingSetUp) {
    this.#reader = new CaptureReader(port);
    this.#setUp = setUp;
  }

  /** Whether capture ended as the page told it to, so the page's word is its ending. */
  get pageNames(): boolean {
    return this.#pageNames;
  }

  async next(): Promise<CapturedEvent | undefined> {
    if (this.#ended) return undefined;
    for (;;) {
      const event = await this.#reader.next();
      if (event === undefined) {
        const cut = this.#cut;
        if (cut === undefined) return undefined;
        this.#ended = true;
        this.#pageNames = cut.byPage;
        return cut.event;
      }
      const read = this.#read(event);
      if (read !== undefined) return read;
    }
  }

  close(): void {
    this.#ended = true;
    this.#reader.close();
  }

  /** Ends the recording where it has reached, as the page says, hearing nothing more of the channel. */
  cut(ending: RecordingEnding): void {
    this.#cut = { event: { kind: 'end', ending }, byPage: true };
    this.#reader.close();
  }

  /** Ends the recording where it has reached, as failed for `problem`, which the worker met. */
  abandon(problem: string): void {
    this.#cut = { event: { kind: 'end', ending: RecordingEnding.Failed, problem }, byPage: false };
    this.#reader.close();
  }

  /** The recording's event a channel's event is, or none for its begin. */
  #read(event: CaptureEvent): CapturedEvent | undefined {
    if (event.kind === 'begin') {
      const { sampleRate, layout } = this.#setUp.start;
      if (event.sampleRate !== sampleRate || event.channels !== layout.roles.length) {
        this.#reader.close();
        return this.#end(RecordingEnding.Failed, MISMATCHED);
      }
      this.#first = event.frame;
      return undefined;
    }
    if (event.kind === 'end') {
      this.#pageNames = event.reason !== 'failed';
      return this.#end(endingOf(event), event.reason === 'failed' ? event.summary : undefined);
    }
    const first = this.#first;
    if (first === undefined) throw new Error('A capture channel’s audio comes after its begin.');
    return event.kind === 'block'
      ? { kind: 'block', frame: event.frame - first, channels: event.channels }
      : { kind: 'gap', frame: event.frame - first, frames: event.frames };
  }

  #end(ending: RecordingEnding, problem?: string): CapturedEvent {
    this.#ended = true;
    return { kind: 'end', ending, ...(problem === undefined ? {} : { problem }) };
  }
}

const MISMATCHED =
  'The audio arrived at another rate or with other channels than the recording was set up with.';
