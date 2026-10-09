/**
 * Capture from one input at a time through the capture processor: the page's
 * side, which the recording commands reach (ADR-0070).
 *
 * It runs in the playback context, which it takes from the lifecycle, so a
 * capture and playback share one media clock and a capture's first frame is a
 * frame of the transport's; it never makes a context of its own. It opens no
 * input either: the application opens one through the capabilities' media
 * input adapter and hands the stream here, with the layout the input's
 * granted channel count has (REQ-ARCH-157).
 *
 * The page holds no recorded audio. Each take gets a capture channel of its
 * own, whose one end goes to the processor and the other is handed back for
 * the application to transfer to the storage worker, which reads it with
 * `capture/capture-reader.ts`; where memory is shared the samples cross in a
 * ring, made here, and otherwise in posted blocks. What is left here is the
 * person's commands, the processor's replies, the input's last meter reading
 * and the monitored path's latency.
 *
 * It decides nothing the recording session decides, which states may follow
 * which, or whether a take may start: it does what it is asked, and a
 * processor that refuses says why in a reply its listeners hear.
 */

import {
  FailureKind,
  channelCount,
  fail,
  failure,
  succeed,
  type ChannelLayout,
  type DomainResult,
  type EffectChain,
  type ParameterId,
  type ProcessorId,
  type QualityMode,
} from '@audiogubbins/domain';
import type { Logger } from '@audiogubbins/diagnostics';
import type { AudioRuntimeCapabilities } from '@audiogubbins/capabilities';

import type { AudioContextPort } from '../context/audio-context-port.js';
import {
  LifecycleEventKind,
  type ContextLifecycle,
  type LifecycleEvent,
} from '../context/context-lifecycle.js';
import { deliveredAs, type CompiledDspModule, type DspDelivery } from '../dsp/dsp-delivery.js';
import { createSampleRing } from '../feed/sample-ring.js';
import type { ChannelEnds } from '../playback/channel-ends.js';
import { WorkletModule } from '../playback/worklet-module.js';
import { RENDER_QUANTUM_FRAMES } from '../processor/loaded-graph.js';
import {
  FromCaptureKind,
  ToCaptureKind,
  retrospectiveRefusal,
  type FromCapture,
  type InputMeterReport,
} from '../protocol/capture-messages.js';
import type { Schedule } from '../schedule.js';
import { CaptureNode } from './capture-node.js';

/** Meter reports a second, as playback's are. */
const REPORTS_PER_SECOND = 30;

/** Seconds of a take a shared ring holds for a storage worker that falls behind. */
const RING_SECONDS = 4;

/** How long opening an input waits for the processor's answer. */
const OPEN_ANSWER_MILLISECONDS = 10_000;

/** What the person is told when the audio context goes away under an open input. */
const LOST_PROBLEM =
  'The input stopped because the browser closed the audio device. Open the input again to go on.';

/** What a session captures with. */
export interface CaptureSessionOptions {
  readonly lifecycle: ContextLifecycle;
  readonly capabilities: AudioRuntimeCapabilities;
  /** The canonical DSP module, for a monitoring chain and the meter, or why there is none. */
  readonly dsp: DspDelivery<CompiledDspModule>;
  /** Where the bundler put the capture processor's module (`threads/capture-processor.ts`). */
  readonly workletModuleUrl: string;
  /** Makes the channel a take crosses to the storage worker on: a `MessageChannel`. */
  readonly createChannel: () => ChannelEnds;
  /** Calls a callback after a delay, and answers how to cancel it; `setTimeout` in production. */
  readonly schedule: Schedule;
  readonly logger: Logger;
}

/** An input the application opened, as it hands it to the session. */
export interface CaptureSource {
  /** The stream the capabilities' media input adapter opened. */
  readonly stream: MediaStream;
  /** The layout of the channels the browser granted, which a take is recorded in. */
  readonly layout: ChannelLayout;
  /** Seconds the input adds before the context, as its track reports, where it does. */
  readonly inputLatency: number | undefined;
}

/** How late the monitored signal is heard (REQ-ARCH-144). */
export interface MonitoringLatency {
  /** Frames the monitoring chain adds, at the context's rate; none dry. */
  readonly chainFrames: number;
  /** Seconds the context and the output device add after the processor, where the browser says. */
  readonly outputSeconds: number | undefined;
  /** Seconds the input adds before the processor, where its track says. */
  readonly inputSeconds: number | undefined;
  /** The whole path, from the input to the ear, where every part of it is known. */
  readonly totalSeconds: number | undefined;
}

/** What a session's listeners hear: each reply of the processor, and the loss of the context. */
export type CaptureSessionEvent = FromCapture | { readonly kind: 'lost'; readonly problem: string };

/** Hears what the capture processor says, and the context's loss. */
export type CaptureListener = (event: CaptureSessionEvent) => void;

/** The input open now, and what it last said. */
interface OpenInput {
  readonly node: CaptureNode;
  readonly port: AudioContextPort;
  readonly source: CaptureSource;
  meter: InputMeterReport | undefined;
  chainFrames: number;
}

function refused(code: string, summary: string): DomainResult<never> {
  return fail(failure(`capture.${code}`, FailureKind.Rejected, summary));
}

/** Captures from one input at a time through the capture processor. */
export class CaptureSession {
  readonly #options: CaptureSessionOptions;
  readonly #module: WorkletModule;
  readonly #listeners = new Set<CaptureListener>();
  readonly #stopListening: () => void;
  #open: OpenInput | undefined;
  /** Counts opens and closes, so an open that another overtook stands down. */
  #generation = 0;
  #disposed = false;

  constructor(options: CaptureSessionOptions) {
    this.#options = options;
    this.#module = new WorkletModule(options.workletModuleUrl, options.logger);
    this.#stopListening = options.lifecycle.subscribe(this.#lifecycleEvent);
  }

  /** Hears every event from now until the answer is called. */
  subscribe(listener: CaptureListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Opens `source` in the context, closing the input open before, which
   * overwrites its buffers with zeros and ends its take as released, and
   * settles once the processor is ready, or with why it is not.
   */
  async open(source: CaptureSource): Promise<DomainResult<void>> {
    this.#assertLive();
    this.close();
    const generation = this.#generation;
    const context = this.#options.lifecycle.context();
    if (!context.ok) return context;
    const port = context.value;
    const added = await this.#module.addTo(port);
    if (!added.ok) return added;
    if (generation !== this.#generation) {
      return refused('open-superseded', 'Another input was opened or closed first.');
    }
    let answered: (reply: FromCapture | undefined) => void = () => undefined;
    const answer = new Promise<FromCapture | undefined>((resolve) => {
      answered = resolve;
    });
    const node = new CaptureNode(
      port,
      source.stream,
      source.layout,
      this.#options.logger,
      (reply) => {
        answered(reply);
        this.#heard(reply);
      },
    );
    const open: OpenInput = { node, port, source, meter: undefined, chainFrames: 0 };
    this.#open = open;
    node.send({
      kind: ToCaptureKind.Configure,
      layout: source.layout,
      dsp: deliveredAs(this.#options.dsp, (module) => module.bytes),
      reportEveryBlocks: Math.max(
        1,
        Math.round(port.sampleRate / RENDER_QUANTUM_FRAMES / REPORTS_PER_SECOND),
      ),
    });
    const cancel = this.#options.schedule(() => {
      answered(undefined);
    }, OPEN_ANSWER_MILLISECONDS);
    const reply = await answer;
    cancel();
    return this.#opened(open, reply);
  }

  /** What the processor's first answer to an open means. */
  #opened(open: OpenInput, reply: FromCapture | undefined): DomainResult<void> {
    if (this.#open !== open)
      return refused('open-superseded', 'Another input was opened or closed first.');
    if (reply?.kind === FromCaptureKind.Configured) return succeed(undefined);
    this.close();
    if (reply === undefined) {
      this.#options.logger.error('The capture processor did not answer in time.');
      return refused(
        'processor-unanswered',
        'The audio thread did not answer when the input was opened.',
      );
    }
    const why =
      reply.kind === FromCaptureKind.Fault
        ? reply.message
        : reply.kind === FromCaptureKind.Refused
          ? reply.reason
          : `The capture processor answered the input with ${reply.kind}.`;
    return refused('processor-refused', why);
  }

  /**
   * Arms the input, keeping its last `retrospectiveSeconds` seconds, or none
   * at zero, as the recording package's setting allows. Arming never turns
   * monitoring on (REQ-REC-091).
   */
  arm(retrospectiveSeconds: number): DomainResult<void> {
    const open = this.#current();
    if (!open.ok) return open;
    const refusal = retrospectiveRefusal(retrospectiveSeconds);
    if (refusal !== undefined) return refused('retrospective-unkeepable', refusal);
    open.value.node.send({ kind: ToCaptureKind.Arm, retrospectiveSeconds });
    return succeed(undefined);
  }

  /** Disarms the input; its retrospective buffer is overwritten with zeros and let go. */
  disarm(): DomainResult<void> {
    return this.#send({ kind: ToCaptureKind.Disarm });
  }

  /**
   * Records a take from context frame `at`, after what the retrospective
   * buffer holds, and answers the end of its capture channel the storage
   * worker reads it from, for the application to transfer there. The take's
   * first frame arrives in the `recording` reply.
   */
  record(at: number): DomainResult<MessagePort> {
    const open = this.#current();
    if (!open.ok) return open;
    const { node, port, source } = open.value;
    let ring: SharedArrayBuffer | undefined;
    if (this.#options.capabilities.sharedMemory) {
      const made = createSampleRing(
        channelCount(source.layout),
        Math.round(RING_SECONDS * port.sampleRate),
      );
      if (!made.ok) return made;
      ring = made.value;
    }
    const channel = this.#options.createChannel();
    node.send({ kind: ToCaptureKind.Record, at, channel: channel.port1, ring }, [channel.port1]);
    return succeed(channel.port2);
  }

  /** Stops the take before context frame `at`. */
  stop(at: number): DomainResult<void> {
    return this.#send({ kind: ToCaptureKind.Stop, at });
  }

  /** Turns monitoring on or off, or says why the input cannot be monitored on this device. */
  monitor(on: boolean): DomainResult<void> {
    const open = this.#current();
    if (!open.ok) return open;
    const refusal = open.value.node.monitorRefusal;
    if (on && refusal !== undefined) return refused('monitoring-unroutable', refusal);
    open.value.node.send({ kind: ToCaptureKind.Monitor, on });
    return succeed(undefined);
  }

  /**
   * Monitors through `chain` run live at `quality`, or dry where there is
   * none. A chain that cannot run live is refused in a `chain-refused` reply,
   * with its reason, and monitoring and capture go on as they were.
   */
  monitorThrough(chain: EffectChain | undefined, quality: QualityMode): DomainResult<void> {
    return this.#send({ kind: ToCaptureKind.SetChain, chain, quality });
  }

  /** Changes a numeric parameter of the monitoring chain as it runs. */
  setMonitoringParameter(
    processor: ProcessorId,
    parameter: ParameterId,
    value: number,
  ): DomainResult<void> {
    return this.#send({ kind: ToCaptureKind.SetParameter, processor, parameter, value });
  }

  /** The input's last levels, read where they are shown rather than published. */
  meters(): InputMeterReport | undefined {
    return this.#open?.meter;
  }

  /** How late the monitored signal is heard, as far as each part of the path is known. */
  monitoringLatency(): MonitoringLatency | undefined {
    const open = this.#open;
    if (open === undefined) return undefined;
    const { port, source, chainFrames } = open;
    const outputSeconds =
      port.outputLatency === undefined ? undefined : port.baseLatency + port.outputLatency;
    const inputSeconds = source.inputLatency;
    const totalSeconds =
      outputSeconds === undefined || inputSeconds === undefined
        ? undefined
        : inputSeconds + chainFrames / port.sampleRate + outputSeconds;
    return { chainFrames, outputSeconds, inputSeconds, totalSeconds };
  }

  /** Closes the input open now, its buffers overwritten with zeros and its take ended as released. */
  close(): void {
    this.#generation += 1;
    const open = this.#open;
    this.#open = undefined;
    open?.node.close();
  }

  /** Closes the input and stops hearing the context. */
  dispose(): void {
    if (this.#disposed) return;
    this.close();
    this.#disposed = true;
    this.#stopListening();
    this.#listeners.clear();
  }

  #send(message: Parameters<CaptureNode['send']>[0]): DomainResult<void> {
    const open = this.#current();
    if (!open.ok) return open;
    open.value.node.send(message);
    return succeed(undefined);
  }

  #current(): DomainResult<OpenInput> {
    this.#assertLive();
    const open = this.#open;
    return open === undefined ? refused('no-input', 'No input is open.') : succeed(open);
  }

  #heard(reply: FromCapture): void {
    const open = this.#open;
    if (open !== undefined) {
      if (reply.kind === FromCaptureKind.Report && reply.meter !== undefined)
        open.meter = reply.meter;
      if (reply.kind === FromCaptureKind.Monitoring) open.chainFrames = reply.chainLatencyFrames;
    }
    this.#emit(reply);
  }

  #emit(event: CaptureSessionEvent): void {
    for (const listener of [...this.#listeners]) listener(event);
  }

  readonly #lifecycleEvent = (event: LifecycleEvent): void => {
    if (event.kind !== LifecycleEventKind.Lost) return;
    // The node and its source went with the context, and the processor's
    // memory with them; a take's channel hears no end, so the listeners are
    // told, and the storage worker ends the take from what it committed.
    this.#generation += 1;
    this.#module.forget();
    if (this.#open === undefined) return;
    this.#open = undefined;
    this.#emit({ kind: 'lost', problem: LOST_PROBLEM });
  };

  #assertLive(): void {
    if (this.#disposed) {
      // A wiring mistake: a disposed session has let go of its input and context.
      throw new Error('This capture session was disposed; create another.');
    }
  }
}
