/**
 * One opened input in the audio context (ADR-0070): the application's stream
 * as a source, the capture processor's node it feeds, the node's monitored
 * output on the device, and the processor's replies, read before anyone
 * hears them.
 *
 * The node's input takes exactly the input's channels, explicitly and channel
 * by channel, and its output is as many, the monitored signal. A reply that
 * does not read is logged and dropped, as the engine link drops one, and a
 * reply lost in crossing is heard as a fault: what the processor said is gone.
 */

import { channelCount, type ChannelLayout } from '@audiogubbins/domain';
import type { Logger } from '@audiogubbins/diagnostics';

import type {
  AudioContextPort,
  MediaStreamSourcePort,
  WorkletNodePort,
} from '../context/audio-context-port.js';
import { CAPTURE_PROCESSOR_NAME } from '../capture-processor/capture-processor-name.js';
import {
  FromCaptureKind,
  ToCaptureKind,
  readFromCapture,
  type FromCapture,
  type ToCapture,
} from '../protocol/capture-messages.js';
import { monitorRouting } from './monitor-routing.js';

/** One input, its node and source, spoken to and heard through the protocol. */
export class CaptureNode {
  readonly layout: ChannelLayout;
  /** Why the input cannot be monitored on this device, or nothing where it can. */
  readonly monitorRefusal: string | undefined;
  readonly #node: WorkletNodePort;
  readonly #source: MediaStreamSourcePort;
  readonly #logger: Logger;
  readonly #heard: (reply: FromCapture) => void;
  #closed = false;

  /** Makes the node and the source, connects them and the monitored output, and listens. */
  constructor(
    port: AudioContextPort,
    stream: MediaStream,
    layout: ChannelLayout,
    logger: Logger,
    heard: (reply: FromCapture) => void,
  ) {
    this.layout = layout;
    this.#logger = logger;
    this.#heard = heard;
    const channels = channelCount(layout);
    this.#node = port.createWorkletNode(CAPTURE_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      inputChannelCount: channels,
      outputChannelCount: [channels],
    });
    this.#node.port.addEventListener('message', this.#received);
    this.#node.port.addEventListener('messageerror', this.#undeliverable);
    // A port listened to with `addEventListener` holds its messages until started.
    this.#node.port.start();
    const routing = monitorRouting(layout, port.destination);
    this.monitorRefusal = routing.refusal;
    this.#node.connect(port.destination, routing.outputChannelOf);
    this.#source = port.createMediaStreamSource(stream);
    this.#source.connect(this.#node);
  }

  /** Sends a message, transferring what is named rather than copying it. */
  send(message: ToCapture, transfer: Transferable[] = []): void {
    if (this.#closed) {
      // A wiring mistake: a closed node is disconnected and its processor gone.
      throw new Error('This input was closed; open it again.');
    }
    this.#node.port.postMessage(message, transfer);
  }

  /**
   * Tells the processor to let everything go, which overwrites its buffers
   * with zeros and ends a take as released, then disconnects the source and
   * the node and stops hearing it.
   */
  close(): void {
    if (this.#closed) return;
    this.send({ kind: ToCaptureKind.Release });
    this.#closed = true;
    this.#node.port.removeEventListener('message', this.#received);
    this.#node.port.removeEventListener('messageerror', this.#undeliverable);
    this.#source.disconnect();
    this.#node.disconnect();
  }

  readonly #received = (event: MessageEvent): void => {
    const read = readFromCapture(event.data);
    if (!read.ok) {
      const [problem] = read.failures;
      this.#logger.error('A reply from the capture processor could not be read, and was dropped.', {
        code: problem.code,
        reason: problem.summary,
      });
      return;
    }
    this.#heard(read.value);
  };

  readonly #undeliverable = (): void => {
    this.#logger.error('A reply from the capture processor could not be received.');
    this.#heard({
      kind: FromCaptureKind.Fault,
      message: 'A reply from the capture processor was lost, so what it records is in doubt.',
    });
  };
}
