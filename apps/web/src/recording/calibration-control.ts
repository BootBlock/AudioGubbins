/**
 * The guided loopback calibration (`REQ-REC-095`, `ADR-0070`): the round trip
 * from the engine's output, through the speakers or a cable, back to the
 * input, measured and kept for the input, the output and the rate.
 *
 * The input is opened for the calibration alone, with Raw/Studio's processing,
 * since a browser's echo cancellation would remove the very signal listened
 * for, and closed once it is done. The capture starts first; the known burst is
 * then played through playback, in the same context, and the transport's clock
 * anchor says the context frame it left the engine at. The capture from that
 * frame is measured in a worker, and the round trip it finds, less the output
 * latency the context reports, is the input's share. A measurement with no
 * clear peak is refused with the reason, and nothing is kept.
 */

import {
  FailureKind,
  fail,
  failure,
  sampleCount,
  succeed,
  type DomainResult,
} from '@audiogubbins/domain';
import { TransportMode, type ClockAnchor } from '@audiogubbins/audio-engine';
import { CaptureReader } from '@audiogubbins/audio-runtime';
import {
  RAW_STUDIO_PROFILE,
  isSameDevice,
  loopbackCaptureLength,
  measuredCalibration,
  type DeviceIdentity,
  type LatencyCalibration,
} from '@audiogubbins/recording';

import type { PlaybackControl } from '../audio/playback-control.js';
import type { AudioSettingsStore } from '../state/audio-settings-store.js';
import type { AudioView } from '../state/audio-view-store.js';
import { observable, type Observable } from '../state/observable.js';
import { keepCalibration } from '../state/recording-settings.js';
import { CALIBRATION_PROGRAMME, CALIBRATION_PROGRAMME_KEY } from './calibration-programme.js';
import { identityOfDevice } from './capture-facts.js';
import { joinContext, openInput, type InputOpening, type OpenedCapture } from './input-opener.js';
import type { InputView } from './input-view.js';
import type { MeasureRoundTrip } from './loopback-measure.js';
import { LoopbackCapture } from './loopback-capture.js';

/** Where a calibration has reached. */
export type CalibrationStage =
  | { readonly kind: 'idle' }
  | { readonly kind: 'opening' }
  | { readonly kind: 'measuring'; readonly device: DeviceIdentity }
  | { readonly kind: 'analysing'; readonly device: DeviceIdentity }
  | { readonly kind: 'measured'; readonly calibration: LatencyCalibration }
  | { readonly kind: 'refused'; readonly reason: string };

/** Whether a calibration holds an input open, or is about to. */
export function calibrating(stage: CalibrationStage): boolean {
  return stage.kind === 'opening' || stage.kind === 'measuring' || stage.kind === 'analysing';
}

/** The longest the transport is waited for to start the signal. */
const PLAY_WAIT_MILLISECONDS = 10_000;

/** Seconds of capture held while the signal is waited for, beyond what is measured. */
const HELD_SECONDS = 12;

/** What a calibration is made with. */
export interface CalibrationOptions {
  readonly opening: InputOpening;
  readonly settings: AudioSettingsStore;
  readonly input: Observable<InputView>;
  readonly playback: Pick<PlaybackControl, 'play' | 'stop' | 'programme'>;
  readonly audio: Observable<AudioView>;
  readonly measure: MeasureRoundTrip;
  /** Calls a callback after a delay, and answers how to cancel it. */
  readonly schedule: (callback: () => void, milliseconds: number) => () => void;
  /** Milliseconds since the epoch, for when a calibration was measured. */
  readonly now: () => number;
  readonly announce: (text: string) => void;
}

function refused(code: string, summary: string): DomainResult<never> {
  return fail(failure(`recording.${code}`, FailureKind.Conflict, summary));
}

/** The channel the signal was heard loudest on, which a loopback cable may have reached alone. */
function loudest(channels: readonly Float32Array[]): Float32Array<ArrayBuffer> {
  let best = new Float32Array(channels[0]?.length ?? 0);
  let most = -1;
  for (const channel of channels) {
    let energy = 0;
    for (const sample of channel) energy += sample * sample;
    if (energy > most) {
      most = energy;
      best = Float32Array.from(channel);
    }
  }
  return best;
}

/** Runs the loopback calibration, one at a time. */
export class CalibrationControl {
  readonly #options: CalibrationOptions;
  readonly #stage = observable<CalibrationStage>({ kind: 'idle' });
  /** Counts runs, so one given up stops where it is. */
  #run = 0;
  /** The input open for the run now, closed at once when the run is given up. */
  #opened: OpenedCapture | undefined;

  constructor(options: CalibrationOptions) {
    this.#options = options;
  }

  /** Where the calibration has reached. */
  get stage(): Observable<CalibrationStage> {
    return this.#stage;
  }

  /** Why a calibration cannot start now, or nothing where it can. */
  refusal(): string | undefined {
    if (calibrating(this.#stage.get())) return 'A calibration is running.';
    const { session } = this.#options.input.get();
    if (session.kind === 'asking') return 'The browser is asking for the microphone.';
    if (session.kind !== 'closed' && session.kind !== 'ready' && session.kind !== 'failed') {
      return 'Disarm the input first: the calibration opens it on its own.';
    }
    if (this.#options.audio.get().playback?.transport.mode === TransportMode.Playing) {
      return 'Stop playback first: the calibration plays a signal of its own.';
    }
    return undefined;
  }

  /**
   * Calibrates the input the person chose, or the browser's default, from the
   * person's gesture: the context is started before anything is awaited.
   */
  calibrate(): DomainResult<void> {
    const refusal = this.refusal();
    if (refusal !== undefined) return refused('calibration-refused', refusal);
    this.#run += 1;
    const run = this.#run;
    const hold = joinContext(this.#options.opening, {
      replaced: (why) => {
        this.#end(
          run,
          why.kind === 'playback'
            ? 'The audio context was made again for playback, so the calibration stopped.'
            : 'The audio engine was made again at another sample rate, so the calibration stopped.',
        );
      },
    });
    this.#stage.set({ kind: 'opening' });
    void this.#measure(run, hold);
    return succeed(undefined);
  }

  /** Gives up the calibration running, if one is. */
  cancel(): DomainResult<void> {
    if (!calibrating(this.#stage.get())) {
      return refused('calibration-idle', 'No calibration is running.');
    }
    this.#end(this.#run, 'The calibration was cancelled.');
    return succeed(undefined);
  }

  /** The chosen input, found among the listed inputs, or the browser's default. */
  #device(): DeviceIdentity | undefined {
    const remembered = this.#options.settings.get().recording.input;
    if (remembered === undefined) return undefined;
    const listed = this.#options.input
      .get()
      .devices.flatMap((one) => identityOfDevice(one) ?? [])
      .find((one) => isSameDevice(remembered, one));
    return listed ?? remembered;
  }

  async #measure(run: number, hold: Parameters<typeof openInput>[2]): Promise<void> {
    const opened = await openInput(
      this.#options.opening,
      {
        device: this.#device(),
        profile: RAW_STUDIO_PROFILE,
        devices: this.#options.input.get().devices,
      },
      hold,
    );
    if (!opened.ok) {
      this.#end(run, opened.failures[0].summary);
      return;
    }
    if (run !== this.#run) {
      opened.value.close();
      return;
    }
    this.#opened = opened.value;
    const { facts } = opened.value;
    this.#stage.set({ kind: 'measuring', device: facts.device });
    const captured = await this.#capture(run, opened.value);
    this.#closeInput();
    if (run !== this.#run) return;
    if (!captured.ok) {
      this.#end(run, captured.failures[0].summary);
      return;
    }
    this.#stage.set({ kind: 'analysing', device: facts.device });
    const measurement = await this.#options.measure(loudest(captured.value), facts.rate);
    if (run !== this.#run) return;
    if (!measurement.ok) {
      this.#end(run, measurement.failures[0].summary);
      return;
    }
    const report = opened.value.lifecycle.report;
    const output = (report?.baseLatencySeconds ?? 0) + (report?.outputLatencySeconds ?? 0);
    const calibration = measuredCalibration(
      { input: facts.device, output: this.#options.input.get().output, rate: facts.rate },
      measurement.value,
      output,
      this.#options.now(),
    );
    if (!calibration.ok) {
      this.#end(run, calibration.failures[0].summary);
      return;
    }
    this.#options.settings.reviseRecording(keepCalibration(calibration.value));
    this.#stage.set({ kind: 'measured', calibration: calibration.value });
    const milliseconds = Math.round((measurement.value.roundTrip / facts.rate) * 1000);
    this.#options.announce(
      `The round trip measures ${String(milliseconds)} milliseconds. Takes recorded on this input are placed by it.`,
    );
  }

  /** Captures from before the signal is played until the frames the measurement reads are in. */
  async #capture(
    run: number,
    opened: OpenedCapture,
  ): Promise<DomainResult<readonly Float32Array[]>> {
    const { capture, lifecycle, facts } = opened;
    const context = lifecycle.context();
    const armed = capture.arm(0);
    if (!armed.ok) return armed;
    if (!context.ok) return context;
    const start = sampleCount(Math.round(context.value.currentTime * context.value.sampleRate));
    if (!start.ok) return start;
    const channel = capture.record(start.value);
    if (!channel.ok) return channel;
    const reader = new CaptureReader(channel.value);
    const held = new LoopbackCapture(reader, Math.round(HELD_SECONDS * facts.rate));
    this.#options.playback.play(CALIBRATION_PROGRAMME);
    const anchor = await this.#anchor(run);
    const frames = anchor.ok
      ? await held.framesFrom(
          anchor.value.contextFrame - anchor.value.timelineFrame,
          loopbackCaptureLength(facts.rate),
        )
      : anchor;
    reader.close();
    return frames;
  }

  /** The transport's clock anchor once the signal plays, or why it did not. */
  #anchor(run: number): Promise<DomainResult<ClockAnchor>> {
    const { audio, playback, schedule } = this.#options;
    return new Promise((answer) => {
      let stop = (): void => undefined;
      const settle = (result: DomainResult<ClockAnchor>): void => {
        stop();
        answer(result);
      };
      const check = (): void => {
        if (run !== this.#run) {
          settle(refused('calibration-given-up', 'The calibration was given up.'));
          return;
        }
        const view = audio.get();
        const transport = view.playback?.transport;
        if (
          transport?.mode === TransportMode.Playing &&
          playback.programme() === CALIBRATION_PROGRAMME_KEY
        ) {
          settle(succeed(transport.anchor));
        } else if (!view.starting && view.problems.length > 0) {
          settle(
            refused(
              'calibration-unplayed',
              `The calibration signal could not be played: ${view.problems.join(' ')}`,
            ),
          );
        }
      };
      const unsubscribe = audio.subscribe(check);
      const cancel = schedule(() => {
        settle(
          refused('calibration-unplayed', 'The calibration signal did not start playing in time.'),
        );
      }, PLAY_WAIT_MILLISECONDS);
      stop = () => {
        unsubscribe();
        cancel();
      };
      check();
    });
  }

  /** Closes the input open for the calibration, and stops its signal where it still plays. */
  #closeInput(): void {
    this.#opened?.close();
    this.#opened = undefined;
    if (this.#options.playback.programme() === CALIBRATION_PROGRAMME_KEY) {
      this.#options.playback.stop();
    }
  }

  /** Ends run `run` with `reason`, where it is the one running, closing what it opened. */
  #end(run: number, reason: string): void {
    if (run !== this.#run || !calibrating(this.#stage.get())) return;
    this.#run += 1;
    this.#closeInput();
    this.#stage.set({ kind: 'refused', reason });
    this.#options.announce(`The latency was not measured. ${reason}`);
  }
}
