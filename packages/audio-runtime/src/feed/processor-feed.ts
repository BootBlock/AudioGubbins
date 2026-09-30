/**
 * A graph input's feed on the audio thread, as the processor watches it.
 *
 * The packet asks for underruns to be observable and diagnosable, and a feed
 * is where one begins: the graph input needs a quantum's frames and the feed
 * has fewer. The processor asks every feed first whether it can supply a whole
 * quantum, and runs the graph only when all of them can, or have ended. A
 * quantum some feed cannot supply is not run at all: the device plays silence
 * for it and no feed gives up a frame, so the audio after the underrun is the
 * audio that was due, late, rather than audio with silence spliced into it,
 * the feeds stay in step with each other, and the processor's count of where
 * playback is stays true (see `processor/engine-processor-core.ts`).
 */

import type { InputFeed } from '@audiogubbins/audio-engine';

/** A feed the processor binds to a graph input and watches for underruns and the end. */
export interface ProcessorFeed extends InputFeed {
  /** Whether a fill of `frames` frames would be supplied whole, or the feed has ended. */
  ready(frames: number): boolean;

  /** The frames the fills since {@link beginQuantum} supplied. */
  readonly suppliedFrames: number;

  /** Whether the feed has ended and every frame of it has been supplied. */
  readonly finished: boolean;

  /** Starts the counts of a quantum again. */
  beginQuantum(): void;

  /** Discards the feed's queued audio and its end, as a rewind for a seek needs. */
  clear(): void;
}

/** The counts a feed keeps of its fills, the same for every transport. */
export class FillTally {
  suppliedFrames = 0;
  finished = false;

  /** Counts a fill that wanted `wanted` frames and supplied `got`, with the feed `ended` or not. */
  record(wanted: number, got: number, ended: boolean): void {
    this.suppliedFrames += got;
    if (got < wanted && ended) this.finished = true;
  }

  beginQuantum(): void {
    this.suppliedFrames = 0;
  }

  clear(): void {
    this.beginQuantum();
    this.finished = false;
  }
}
