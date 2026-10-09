/**
 * The recording time the storage leaves, watched while a recording is made
 * (ADR-0071, REQ-REC-096, REQ-STOR-106).
 *
 * The browser's estimate is read again each few seconds of audio committed,
 * never more often, since a read is a call to the browser and the estimate
 * moves no faster than the chunks it counts. One read waits at a time. The
 * time left counts the chunks committed so far, which finishing the recording
 * takes again for its file. The estimate only warns: the recording stops when
 * a write is refused, which the storage itself decides.
 */

import type { SampleRate } from '@audiogubbins/domain';
import {
  recordingBytesPerSecond,
  storageTimeLeft,
  type StorageEstimate,
  type StorageTimeLeft,
} from '@audiogubbins/recording';

/** Seconds of audio committed between reads of the estimate. */
const READ_EVERY_SECONDS = 5;

/** The time left to record, read again as the recording commits audio. */
export class QuotaWatch {
  readonly #estimate: () => Promise<StorageEstimate | undefined>;
  readonly #rate: SampleRate;
  readonly #channels: number;
  readonly #heard: (timeLeft: StorageTimeLeft) => void;
  #timeLeft: StorageTimeLeft = { kind: 'unknown' };

  /** The frames committed at which the estimate is next read. */
  #due = 0;
  #reading = false;

  /**
   * Watches a recording at `rate` over `channels` channels, telling `heard`
   * the time left each time the estimate is read.
   */
  constructor(
    estimate: () => Promise<StorageEstimate | undefined>,
    rate: SampleRate,
    channels: number,
    heard: (timeLeft: StorageTimeLeft) => void,
  ) {
    this.#estimate = estimate;
    this.#rate = rate;
    this.#channels = channels;
    this.#heard = heard;
  }

  /** The time left, as last read. */
  get timeLeft(): StorageTimeLeft {
    return this.#timeLeft;
  }

  /** Hears that `committed` frames are committed, reading the estimate again where it is due. */
  committed(committed: number): void {
    if (this.#reading || committed < this.#due) return;
    void this.read(committed);
  }

  /** Reads the estimate now, with `committed` frames committed. */
  async read(committed: number): Promise<StorageTimeLeft> {
    this.#reading = true;
    this.#due = committed + READ_EVERY_SECONDS * this.#rate;
    const estimate = await this.#estimate();
    const recorded = (committed / this.#rate) * recordingBytesPerSecond(this.#rate, this.#channels);
    this.#timeLeft = storageTimeLeft(estimate, this.#rate, this.#channels, recorded);
    this.#reading = false;
    this.#heard(this.#timeLeft);
    return this.#timeLeft;
  }
}
