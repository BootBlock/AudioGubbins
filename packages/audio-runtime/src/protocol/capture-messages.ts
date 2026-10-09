/**
 * The messages between the page and the capture processor (ADR-0070).
 *
 * One discriminated union each way, each message read field by field on
 * arrival (`message-reading.ts`), as the engine processor's are. The page
 * says what the input is and what the person asked for: arm, with or without
 * a retrospective buffer, record from a context frame, stop at one, monitor
 * or not, and through which chain. The processor answers each with what it
 * did, and reports the input's meters at the rate the page asked for.
 *
 * The recorded samples do not come this way. Each take has a capture channel
 * of its own (`capture/capture-wire.ts`), whose far end the page gives the
 * storage worker, and whose near end crosses here in the `record`.
 */

import {
  bytesAt,
  countAt,
  effectChainOf,
  failureSummaryOf,
  fieldsOf,
  flagAt,
  identifierAt,
  layoutOf,
  Malformed,
  nonEmptyObjectsAt,
  numberAt,
  numbersAt,
  oneOf,
  optionalTextAt,
  qualityModeAt,
  readMessage,
  textAt,
  type ChannelLayout,
  type DomainResult,
  type EffectChain,
  type FailureSummary,
  type MessageFields,
  type ParameterId,
  type ProcessorId,
  type QualityMode,
} from '@audiogubbins/domain';
import { DspImplementation } from '@audiogubbins/audio-engine';

import { CaptureEndReason } from '../capture/capture-wire.js';
import type { DspDelivery } from '../dsp/dsp-delivery.js';
import { dspDeliveryAt, portAt, sharedMemoryAt } from './message-reading.js';

/**
 * Why a retrospective buffer of `seconds` cannot be kept, or nothing where it
 * can; zero is none. The span a person may choose, and how much of it the
 * page's memory allows, are the recording package's to decide (REQ-REC-090),
 * and the application asks for nothing else; the processor refuses only a
 * length no buffer could have.
 */
export function retrospectiveRefusal(seconds: number): string | undefined {
  if (Number.isFinite(seconds) && seconds >= 0) return undefined;
  return `A retrospective buffer cannot keep ${String(seconds)} seconds.`;
}

/** The kinds of message the capture processor is sent. */
export const ToCaptureKind = {
  Configure: 'configure',
  Arm: 'arm',
  Disarm: 'disarm',
  Record: 'record',
  Stop: 'stop',
  Monitor: 'monitor',
  SetChain: 'set-chain',
  SetParameter: 'set-parameter',
  Release: 'release',
} as const;

export type ToCaptureKind = (typeof ToCaptureKind)[keyof typeof ToCaptureKind];

/** A message the capture processor is sent. */
export type ToCapture =
  | {
      /** What the input is, and what the processor runs with; nothing is captured before it. */
      readonly kind: typeof ToCaptureKind.Configure;
      /** The input's layout, of the channels the node's input takes. */
      readonly layout: ChannelLayout;
      /** The canonical DSP module's bytes, which a monitoring chain and the meter run with. */
      readonly dsp: DspDelivery<Uint8Array<ArrayBuffer>>;
      /** Quanta between two reports of the meters; zero for none. */
      readonly reportEveryBlocks: number;
    }
  | {
      /**
       * Arms the input: keeps its last `retrospectiveSeconds` seconds, from 5
       * to 60, ready to become a take's first frames, or nothing at zero.
       * Arming again replaces the buffer, the old one overwritten with zeros.
       */
      readonly kind: typeof ToCaptureKind.Arm;
      readonly retrospectiveSeconds: number;
    }
  | {
      /** Disarms the input; the retrospective buffer is overwritten with zeros and let go. */
      readonly kind: typeof ToCaptureKind.Disarm;
    }
  | {
      /**
       * Records a take from context frame `at`, or from the next quantum where
       * that has passed, after whatever the retrospective buffer holds, onto
       * `channel`, in `ring` where memory is shared.
       */
      readonly kind: typeof ToCaptureKind.Record;
      readonly at: number;
      readonly channel: MessagePort;
      readonly ring: SharedArrayBuffer | undefined;
    }
  | {
      /** Stops the take before context frame `at`, or at the next quantum where that has passed. */
      readonly kind: typeof ToCaptureKind.Stop;
      readonly at: number;
    }
  | {
      /** Turns monitoring on or off; only this message does. */
      readonly kind: typeof ToCaptureKind.Monitor;
      readonly on: boolean;
    }
  | {
      /** Monitors through `chain` run live at `quality`, or dry where there is none. */
      readonly kind: typeof ToCaptureKind.SetChain;
      readonly chain: EffectChain | undefined;
      readonly quality: QualityMode;
    }
  | {
      /** Changes a numeric parameter of the monitoring chain as it runs. */
      readonly kind: typeof ToCaptureKind.SetParameter;
      readonly processor: ProcessorId;
      readonly parameter: ParameterId;
      readonly value: number;
    }
  | {
      /** Lets go of everything: a take is ended, every buffer is overwritten with zeros. */
      readonly kind: typeof ToCaptureKind.Release;
    };

/** The kinds of message the capture processor sends. */
export const FromCaptureKind = {
  Configured: 'configured',
  Armed: 'armed',
  Disarmed: 'disarmed',
  Recording: 'recording',
  Stopped: 'stopped',
  Monitoring: 'monitoring',
  ChainRefused: 'chain-refused',
  ParameterRefused: 'parameter-refused',
  Refused: 'refused',
  Report: 'report',
  Released: 'released',
  Fault: 'fault',
} as const;

/** The input's levels over the quanta since the last report, one value per channel or pair. */
export interface InputMeterReport {
  readonly peak: readonly number[];
  readonly rms: readonly number[];
  /** The phase correlation of each pair of neighbouring channels, the first and second, and so on. */
  readonly correlation: readonly number[];
}

/** Every reason something was refused, the first the one to show. */
type Failures = readonly [FailureSummary, ...FailureSummary[]];

/** A message the capture processor sends. */
export type FromCapture =
  | {
      readonly kind: typeof FromCaptureKind.Configured;
      readonly dsp: DspImplementation;
      /** Why the reference path runs, when it does. */
      readonly dspFallbackReason: string | undefined;
    }
  | {
      /** Armed, keeping at most `retrospectiveFrames` frames before a take; none where the buffer is off. */
      readonly kind: typeof FromCaptureKind.Armed;
      readonly retrospectiveFrames: number;
    }
  | { readonly kind: typeof FromCaptureKind.Disarmed }
  | {
      /**
       * A take began: its first frame is context frame `firstFrame`, which is
       * `retrospectiveFrames` frames before `startFrame`, the frame the
       * recording itself started at.
       */
      readonly kind: typeof FromCaptureKind.Recording;
      readonly firstFrame: number;
      readonly startFrame: number;
      readonly retrospectiveFrames: number;
    }
  | {
      /** The take ended before context frame `endFrame`, and its channel has said so. */
      readonly kind: typeof FromCaptureKind.Stopped;
      readonly endFrame: number;
      readonly reason: typeof CaptureEndReason.Stopped | typeof CaptureEndReason.Released;
    }
  | {
      /** Whether monitoring is on, and whether through a chain, which adds `chainLatencyFrames`. */
      readonly kind: typeof FromCaptureKind.Monitoring;
      readonly on: boolean;
      readonly chained: boolean;
      readonly chainLatencyFrames: number;
    }
  | {
      /** A chain was refused for monitoring; monitoring goes on as it was, and so does capture. */
      readonly kind: typeof FromCaptureKind.ChainRefused;
      readonly failures: Failures;
    }
  | {
      /** The monitoring chain refused a parameter, which keeps the value it had. */
      readonly kind: typeof FromCaptureKind.ParameterRefused;
      readonly processor: ProcessorId;
      readonly parameter: ParameterId;
      readonly failures: Failures;
    }
  | {
      /** A command that does not apply where the processor stands, and why; nothing changed. */
      readonly kind: typeof FromCaptureKind.Refused;
      readonly command: ToCaptureKind;
      readonly reason: string;
    }
  | {
      /** The meters and counts since the last report, as of context frame `contextFrame`. */
      readonly kind: typeof FromCaptureKind.Report;
      readonly contextFrame: number;
      /** The input's levels, where a quantum reached the meter since the last report. */
      readonly meter: InputMeterReport | undefined;
      /** Frames the retrospective buffer holds now. */
      readonly bufferedFrames: number;
      /** Frames of a take the processor could not keep since the last report, each reported as a gap. */
      readonly lostFrames: number;
      /** Frames the input gave no audio for since the last report, taken as silence. */
      readonly absentFrames: number;
    }
  | { readonly kind: typeof FromCaptureKind.Released }
  | {
      /** Processing threw: the processor captures nothing and outputs silence from now on. */
      readonly kind: typeof FromCaptureKind.Fault;
      readonly message: string;
    };

function chainOf(fields: MessageFields): EffectChain | undefined {
  if (fields['chain'] === undefined) return undefined;
  const chain = effectChainOf(fields['chain'], 'chain');
  if (!chain.ok) throw new Malformed('chain', `a chain (${chain.failures[0].summary})`);
  return chain.value;
}

function toCaptureFrom(fields: MessageFields): ToCapture {
  const kind = oneOf(fields, 'kind', ToCaptureKind);
  switch (kind) {
    case ToCaptureKind.Configure:
      return {
        kind,
        layout: layoutOf(fields['layout'], 'layout'),
        dsp: dspDeliveryAt(fields, 'dsp', bytesAt),
        reportEveryBlocks: countAt(fields, 'reportEveryBlocks'),
      };
    case ToCaptureKind.Arm:
      return { kind, retrospectiveSeconds: numberAt(fields, 'retrospectiveSeconds') };
    case ToCaptureKind.Record:
      return {
        kind,
        at: countAt(fields, 'at'),
        channel: portAt(fields, 'channel'),
        ring: fields['ring'] === undefined ? undefined : sharedMemoryAt(fields, 'ring'),
      };
    case ToCaptureKind.Stop:
      return { kind, at: countAt(fields, 'at') };
    case ToCaptureKind.Monitor:
      return { kind, on: flagAt(fields, 'on') };
    case ToCaptureKind.SetChain:
      return { kind, chain: chainOf(fields), quality: qualityModeAt(fields, 'quality') };
    case ToCaptureKind.SetParameter:
      return {
        kind,
        processor: identifierAt<'ProcessorId'>(fields, 'processor'),
        parameter: identifierAt<'ParameterId'>(fields, 'parameter'),
        value: numberAt(fields, 'value'),
      };
    case ToCaptureKind.Disarm:
    case ToCaptureKind.Release:
      return { kind };
  }
}

function meterOf(value: unknown): InputMeterReport | undefined {
  if (value === undefined) return undefined;
  const fields = fieldsOf(value, 'meter');
  return {
    peak: numbersAt(fields, 'peak'),
    rms: numbersAt(fields, 'rms'),
    correlation: numbersAt(fields, 'correlation'),
  };
}

function recordingFrom(fields: MessageFields): FromCapture {
  return {
    kind: FromCaptureKind.Recording,
    firstFrame: countAt(fields, 'firstFrame'),
    startFrame: countAt(fields, 'startFrame'),
    retrospectiveFrames: countAt(fields, 'retrospectiveFrames'),
  };
}

function reportFrom(fields: MessageFields): FromCapture {
  return {
    kind: FromCaptureKind.Report,
    contextFrame: countAt(fields, 'contextFrame'),
    meter: meterOf(fields['meter']),
    bufferedFrames: countAt(fields, 'bufferedFrames'),
    lostFrames: countAt(fields, 'lostFrames'),
    absentFrames: countAt(fields, 'absentFrames'),
  };
}

function stoppedFrom(fields: MessageFields): FromCapture {
  const reason = oneOf(fields, 'reason', CaptureEndReason);
  if (reason === CaptureEndReason.Failed) throw new Malformed('reason', 'stopped or released');
  return { kind: FromCaptureKind.Stopped, endFrame: countAt(fields, 'endFrame'), reason };
}

function fromCaptureFrom(fields: MessageFields): FromCapture {
  const kind = oneOf(fields, 'kind', FromCaptureKind);
  switch (kind) {
    case FromCaptureKind.Configured:
      return {
        kind,
        dsp: oneOf(fields, 'dsp', DspImplementation),
        dspFallbackReason: optionalTextAt(fields, 'dspFallbackReason'),
      };
    case FromCaptureKind.Armed:
      return { kind, retrospectiveFrames: countAt(fields, 'retrospectiveFrames') };
    case FromCaptureKind.Recording:
      return recordingFrom(fields);
    case FromCaptureKind.Stopped:
      return stoppedFrom(fields);
    case FromCaptureKind.Monitoring:
      return {
        kind,
        on: flagAt(fields, 'on'),
        chained: flagAt(fields, 'chained'),
        chainLatencyFrames: countAt(fields, 'chainLatencyFrames'),
      };
    case FromCaptureKind.ChainRefused:
      return { kind, failures: nonEmptyObjectsAt(fields, 'failures', failureSummaryOf) };
    case FromCaptureKind.ParameterRefused:
      return {
        kind,
        processor: identifierAt<'ProcessorId'>(fields, 'processor'),
        parameter: identifierAt<'ParameterId'>(fields, 'parameter'),
        failures: nonEmptyObjectsAt(fields, 'failures', failureSummaryOf),
      };
    case FromCaptureKind.Refused:
      return {
        kind,
        command: oneOf(fields, 'command', ToCaptureKind),
        reason: textAt(fields, 'reason'),
      };
    case FromCaptureKind.Report:
      return reportFrom(fields);
    case FromCaptureKind.Fault:
      return { kind, message: textAt(fields, 'message') };
    case FromCaptureKind.Disarmed:
    case FromCaptureKind.Released:
      return { kind };
  }
}

/** A message the capture processor received, read, or why it cannot be. */
export function readToCapture(value: unknown): DomainResult<ToCapture> {
  return readMessage(value, 'protocol.capture-message-malformed', toCaptureFrom);
}

/** A message the capture processor sent, read, or why it cannot be. */
export function readFromCapture(value: unknown): DomainResult<FromCapture> {
  return readMessage(value, 'protocol.capture-reply-malformed', fromCaptureFrom);
}
