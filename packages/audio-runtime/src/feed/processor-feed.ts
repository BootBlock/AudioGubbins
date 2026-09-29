/**
 * A graph input's feed on the audio thread, as the processor watches it.
 *
 * The packet asks for underruns to be observable and diagnosable. A feed is
 * where one happens: the graph input asks it for a quantum's frames and it has
 * fewer. So each feed counts, per quantum, the frames it could not supply
 * while its audio had not ended, which is an underrun, and says when it has
 * ended and supplied its last frame, which is not. The processor reads the
 * counts after each quantum and starts them again before the next.
 */

import type { InputFeed } from '@audiogubbins/audio-engine';

/** A feed the processor binds to a graph input and watches for underruns and the end. */
export interface ProcessorFeed extends InputFeed {
  /** The frames the fills since {@link beginQuantum} could not supply before the end. */
  readonly shortFrames: number;

  /** The frames the fills since {@link beginQuantum} supplied. */
  readonly suppliedFrames: number;

  /** Whether the feed has ended and every frame of it has been supplied. */
  readonly finished: boolean;

  /** Starts the counts of a quantum again. */
  beginQuantum(): void;

  /** Discards the feed's queued audio and its end, as a reset for a seek needs. */
  clear(): void;
}

/** The counts a feed keeps of its fills, the same for every transport. */
export class FillTally {
  shortFrames = 0;
  suppliedFrames = 0;
  finished = false;

  /** Counts a fill that wanted `wanted` frames and supplied `got`, with the feed `ended` or not. */
  record(wanted: number, got: number, ended: boolean): void {
    this.suppliedFrames += got;
    if (got === wanted) return;
    if (ended) this.finished = true;
    else this.shortFrames += wanted - got;
  }

  beginQuantum(): void {
    this.shortFrames = 0;
    this.suppliedFrames = 0;
  }

  clear(): void {
    this.beginQuantum();
    this.finished = false;
  }
}
