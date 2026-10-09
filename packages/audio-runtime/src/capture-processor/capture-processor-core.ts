/**
 * The capture processor, apart from the worklet: what it does with each
 * message and each render quantum (ADR-0070).
 *
 * Kept out of the worklet's module so it runs in a Node test, as the engine
 * processor's core is (`threads/capture-processor.ts` is the shell that
 * registers it). It reads every message with the protocol's reader and never
 * throws out of `receive` or `process`.
 *
 * Each quantum does three things, in this order. It captures first: the dry
 * input is copied into the processor's own memory before anything else reads
 * it (`capture-recorder.ts`), so a take is the input, bit for bit, whatever
 * monitoring does (REQ-REC-020), and a take's queued frames are handed to its
 * capture channel. It measures the input with the engine's meter. And it
 * plays the monitored path, which is silent unless monitoring is on
 * (REQ-REC-091). A quantum allocates nothing but the blocks it posts and its
 * reports.
 *
 * A fault, a kernel's throw or a message the processor cannot read, ends a take
 * as failed with the reason, after every frame it had, lets every buffer go and
 * leaves the processor silent: what it would capture next is in doubt.
 */

import {
  sampleRate as readSampleRate,
  type DomainFailure,
  type FailureSummary,
  type SampleRate,
} from '@audiogubbins/domain';
import type { ChainProcessing } from '@audiogubbins/audio-engine';

import type { CaptureQueue } from '../capture/capture-queue.js';
import { CaptureEndReason } from '../capture/capture-wire.js';
import type { ScopeDsp } from '../dsp/dsp-instance.js';
import { RENDER_QUANTUM_FRAMES } from '../processor/loaded-graph.js';
import { workletDsp } from '../processor/worklet-dsp.js';
import {
  FromCaptureKind,
  ToCaptureKind,
  readToCapture,
  type FromCapture,
  type ToCapture,
} from '../protocol/capture-messages.js';
import { CaptureInput } from './capture-input.js';
import { CaptureRecorder } from './capture-recorder.js';
import type { AbandonReason } from './capture-take.js';
import { InputMeter } from './input-meter.js';
import { MonitoringPath } from './monitoring-path.js';

export interface CaptureProcessorOptions {
  /** The context's rate, as the worklet's global scope gives it. */
  readonly sampleRate: number;
  readonly post: (message: FromCapture) => void;
  /** The effect rack's chain processing, which a monitoring chain runs live through. */
  readonly processing: ChainProcessing;
}

/** What the processor holds once it knows its input. */
interface Configured {
  readonly input: CaptureInput;
  readonly recorder: CaptureRecorder;
  readonly meter: InputMeter;
  readonly monitoring: MonitoringPath;
  readonly dsp: ScopeDsp;
  readonly reportEveryBlocks: number;
}

type Configure = Extract<ToCapture, { readonly kind: typeof ToCaptureKind.Configure }>;
type SetChain = Extract<ToCapture, { readonly kind: typeof ToCaptureKind.SetChain }>;
type SetParameter = Extract<ToCapture, { readonly kind: typeof ToCaptureKind.SetParameter }>;

/** Every failure's code and summary, which are all of a failure that means anything off the audio thread. */
function summariesOf(
  failures: readonly [DomainFailure, ...DomainFailure[]],
): readonly [FailureSummary, ...FailureSummary[]] {
  const [first, ...rest] = failures;
  return [
    { code: first.code, summary: first.summary },
    ...rest.map(({ code, summary }) => ({ code, summary })),
  ];
}

/** What the processor runs once a `configure` says what its input is, or why it cannot. */
function configuredFor(
  message: Configure,
  rate: SampleRate,
  options: CaptureProcessorOptions,
):
  | { readonly ok: true; readonly configured: Configured }
  | { readonly ok: false; readonly reason: string } {
  const input = new CaptureInput(message.layout, rate);
  const dsp = workletDsp(message.dsp);
  const meter = InputMeter.make(message.layout, rate, RENDER_QUANTUM_FRAMES, dsp.dsp);
  if (!meter.ok) return { ok: false, reason: meter.failures[0].summary };
  const monitoring = new MonitoringPath({
    processing: options.processing,
    layout: message.layout,
    sampleRate: rate,
    blockFrames: RENDER_QUANTUM_FRAMES,
    dsp: dsp.dsp,
  });
  return {
    ok: true,
    configured: {
      input,
      recorder: new CaptureRecorder(input, options.post),
      meter: meter.value,
      monitoring,
      dsp,
      reportEveryBlocks: message.reportEveryBlocks,
    },
  };
}

/** The capture processor's logic, driven by the worklet's messages and quanta. */
export class CaptureProcessorCore {
  readonly #options: CaptureProcessorOptions;
  #configured: Configured | undefined;
  #quanta = 0;
  #faulted = false;
  #released = false;

  constructor(options: CaptureProcessorOptions) {
    this.#options = options;
  }

  /** The retrospective buffer, for a test to read what it holds. */
  get retrospective(): CaptureQueue | undefined {
    return this.#configured?.recorder.retrospective;
  }

  /** Acts on a message from the main thread, whatever arrived. */
  receive(data: unknown): void {
    if (this.#faulted || this.#released) return;
    const read = readToCapture(data);
    if (!read.ok) {
      this.#fault(`A message could not be read: ${read.failures[0].summary}`);
      return;
    }
    this.#act(read.value);
  }

  /** Hears that a message could not be received: what the page asked for is lost. */
  messageFailed(): void {
    this.#fault(
      'A message from the main thread could not be received by the capture processor, so what it records is in doubt.',
    );
  }

  /**
   * Runs one quantum starting at context frame `frame`: `input` is the
   * node's input, one array per channel, none where no source is connected,
   * and `output` the monitored output, every sample of which is written.
   */
  process(input: readonly Float32Array[], output: readonly Float32Array[], frame: number): void {
    const configured = this.#configured;
    if (configured === undefined || this.#faulted || this.#released) {
      for (const channel of output) channel.fill(0);
      return;
    }
    try {
      const dry = configured.input.dry(input);
      configured.recorder.capture(dry, frame);
      configured.meter.measure(dry, RENDER_QUANTUM_FRAMES);
      configured.monitoring.process(dry, output, RENDER_QUANTUM_FRAMES);
    } catch (error) {
      // A kernel that cannot go on throws, and nothing above the audio thread
      // would catch it.
      for (const channel of output) channel.fill(0);
      this.#fault(`Capture stopped: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    this.#report(configured, frame + RENDER_QUANTUM_FRAMES);
  }

  #report(configured: Configured, contextFrame: number): void {
    const every = configured.reportEveryBlocks;
    if (every === 0) return;
    this.#quanta += 1;
    if (this.#quanta < every) return;
    this.#quanta = 0;
    const { recorder } = configured;
    this.#post({
      kind: FromCaptureKind.Report,
      contextFrame,
      meter: configured.meter.take(),
      bufferedFrames: recorder.bufferedFrames,
      lostFrames: recorder.takeLost(),
      absentFrames: configured.input.takeAbsent(),
    });
  }

  #act(message: ToCapture): void {
    if (message.kind === ToCaptureKind.Configure) {
      this.#configure(message);
      return;
    }
    const configured = this.#configured;
    if (configured === undefined) {
      this.#post({
        kind: FromCaptureKind.Refused,
        command: message.kind,
        reason: 'The capture processor has not been told what its input is.',
      });
      return;
    }
    const { recorder, monitoring } = configured;
    switch (message.kind) {
      case ToCaptureKind.Arm:
        recorder.arm(message.retrospectiveSeconds);
        return;
      case ToCaptureKind.Disarm:
        recorder.disarm();
        return;
      case ToCaptureKind.Record:
        recorder.record(message);
        return;
      case ToCaptureKind.Stop:
        recorder.stop(message.at);
        return;
      case ToCaptureKind.Monitor:
        monitoring.turn(message.on);
        this.#postMonitoring(monitoring);
        return;
      case ToCaptureKind.SetChain:
        this.#setChain(monitoring, message);
        return;
      case ToCaptureKind.SetParameter:
        this.#setParameter(monitoring, message);
        return;
      case ToCaptureKind.Release:
        this.#letGo({ reason: CaptureEndReason.Released });
        this.#released = true;
        this.#post({ kind: FromCaptureKind.Released });
        return;
    }
  }

  #configure(message: Configure): void {
    if (this.#configured !== undefined) {
      this.#post({
        kind: FromCaptureKind.Refused,
        command: message.kind,
        reason: 'The capture processor is told what its input is once.',
      });
      return;
    }
    const rate = readSampleRate(this.#options.sampleRate);
    if (!rate.ok) {
      this.#fault(rate.failures[0].summary);
      return;
    }
    const made = configuredFor(message, rate.value, this.#options);
    if (!made.ok) {
      this.#fault(made.reason);
      return;
    }
    this.#configured = made.configured;
    this.#post({
      kind: FromCaptureKind.Configured,
      dsp: made.configured.dsp.dsp.implementation,
      dspFallbackReason: made.configured.dsp.fallbackReason,
    });
  }

  #setChain(monitoring: MonitoringPath, message: SetChain): void {
    const chosen = monitoring.choose(message.chain, message.quality);
    if (!chosen.ok) {
      this.#post({ kind: FromCaptureKind.ChainRefused, failures: summariesOf(chosen.failures) });
      return;
    }
    this.#postMonitoring(monitoring);
  }

  #setParameter(monitoring: MonitoringPath, message: SetParameter): void {
    const set = monitoring.setParameter(message.processor, message.parameter, message.value);
    if (set.ok) return;
    this.#post({
      kind: FromCaptureKind.ParameterRefused,
      processor: message.processor,
      parameter: message.parameter,
      failures: summariesOf(set.failures),
    });
  }

  #postMonitoring(monitoring: MonitoringPath): void {
    this.#post({
      kind: FromCaptureKind.Monitoring,
      on: monitoring.on,
      chained: monitoring.chained,
      chainLatencyFrames: monitoring.latency,
    });
  }

  /** Ends a take for `why`, overwrites every buffer with zeros and lets the input's kernels go. */
  #letGo(why: AbandonReason): void {
    const configured = this.#configured;
    if (configured === undefined) return;
    configured.recorder.letGo(why);
    configured.meter.release();
    configured.monitoring.release();
    this.#configured = undefined;
  }

  #post(message: FromCapture): void {
    this.#options.post(message);
  }

  /** Stops capturing and says why, once: a take ends as failed after every frame it had. */
  #fault(message: string): void {
    if (this.#faulted) return;
    this.#faulted = true;
    this.#letGo({ reason: CaptureEndReason.Failed, summary: message });
    this.#post({ kind: FromCaptureKind.Fault, message });
  }
}
