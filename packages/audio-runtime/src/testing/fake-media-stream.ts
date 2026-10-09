/**
 * An opened input, and its source in a fake context, for testing capture
 * without a browser or a microphone (ADR-0070).
 *
 * The stream says what the input captures: a sample for each channel at each
 * context frame, which a test writes as a function, so what a take should
 * hold is known exactly, frame by frame. Its source hands a fake capture node
 * a quantum of it at a time, and gives no channels at all while the test says
 * the input is absent, as a browser gives a node whose source has stopped.
 */

import type { MediaStreamSourcePort, WorkletNodePort } from '../context/audio-context-port.js';

/** A channel's sample at a context frame. */
export type InputSignal = (channel: number, frame: number) => number;

/** A stream the application opened, as far as capture reads it: its channels and what they carry. */
export class FakeMediaStream extends EventTarget implements MediaStream {
  readonly id = 'fake-input';
  readonly active = true;
  onaddtrack: MediaStream['onaddtrack'] = null;
  onremovetrack: MediaStream['onremovetrack'] = null;
  readonly channels: number;
  readonly signal: InputSignal;

  constructor(channels: number, signal: InputSignal) {
    super();
    this.channels = channels;
    this.signal = signal;
  }

  // A capture reads a stream only through its source node, so it has no tracks to give.
  getTracks(): MediaStreamTrack[] {
    return [];
  }

  getAudioTracks(): MediaStreamTrack[] {
    return [];
  }

  getVideoTracks(): MediaStreamTrack[] {
    return [];
  }

  getTrackById(): MediaStreamTrack | null {
    return null;
  }

  addTrack(): void {
    throw new Error('A fake input takes no tracks.');
  }

  removeTrack(): void {
    throw new Error('A fake input takes no tracks.');
  }

  clone(): MediaStream {
    return new FakeMediaStream(this.channels, this.signal);
  }
}

/** What a fake source feeds: a node that takes a quantum of input when it renders. */
export interface FedNode extends WorkletNodePort {
  feedFrom(source: FakeMediaStreamSource | undefined): void;
}

function isFed(node: WorkletNodePort): node is FedNode {
  return 'feedFrom' in node;
}

/** A fake context's source of a {@link FakeMediaStream}. */
export class FakeMediaStreamSource implements MediaStreamSourcePort {
  readonly stream: FakeMediaStream;
  /** Whether the input gives no audio now, as a stopped or muted track gives none. */
  absent = false;
  #node: FedNode | undefined;

  constructor(stream: MediaStream) {
    if (!(stream instanceof FakeMediaStream)) {
      throw new Error('A fake context opens only a fake input.');
    }
    this.stream = stream;
  }

  get connected(): boolean {
    return this.#node !== undefined;
  }

  connect(node: WorkletNodePort): void {
    if (!isFed(node)) throw new Error('A fake source feeds only a fake capture node.');
    this.#node = node;
    node.feedFrom(this);
  }

  disconnect(): void {
    this.#node?.feedFrom(undefined);
    this.#node = undefined;
  }

  /** The input's quantum of `frames` frames from context frame `frame`, or none while absent. */
  quantum(frame: number, frames: number): Float32Array[] {
    if (this.absent) return [];
    const { channels, signal } = this.stream;
    return Array.from({ length: channels }, (_, channel) =>
      Float32Array.from({ length: frames }, (_, offset) => signal(channel, frame + offset)),
    );
  }
}
