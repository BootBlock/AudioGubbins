/**
 * What the browser granted, beside what was asked, and what each difference
 * means for the recording (`REQ-REC-092`, `REQ-REC-097`).
 *
 * A browser may ignore a constraint, or honour it and report otherwise, so the
 * settings read from the track are compared with the request rather than the
 * request being taken as what happened. Each difference carries a sentence
 * saying what it does to the recording, for the progressive disclosure of the
 * profile's detail; the differences and the controls that could not be set at
 * all are kept in the take's provenance (ADR-0071).
 */

import { counted } from '@audiogubbins/text';

import { ProcessingControl, processingOf, type CapturePlan } from './capture-profile.js';

/** The settings the browser reports for an open input, read from its track. */
export interface GrantedCapture {
  /** Each processing control the browser reports, and whether it is on. */
  readonly processing: Partial<Record<ProcessingControl, boolean>>;

  /** The channels the input gives, where reported. */
  readonly channelCount?: number;

  /** The input's own rate, where reported. */
  readonly sampleRate?: number;

  /** The input's latency in seconds, where the browser reports one. */
  readonly latency?: number;
}

/**
 * One way the granted capture differs from the request. `granted` is absent
 * where the browser did not report the setting, so it cannot be confirmed.
 */
export type CaptureDifference =
  | {
      readonly kind: 'processing';
      readonly control: ProcessingControl;
      readonly requested: boolean;
      readonly granted?: boolean;
      readonly meaning: string;
    }
  | {
      readonly kind: 'channel-count';
      readonly requested: number;
      readonly granted?: number;
      readonly meaning: string;
    }
  | {
      readonly kind: 'sample-rate';
      readonly requested: number;
      readonly granted?: number;
      readonly meaning: string;
    };

/** A processing control the browser offers no control of, and what that may mean. */
export interface UncontrollableProcessing {
  readonly control: ProcessingControl;
  readonly wanted: boolean;
  readonly meaning: string;
}

/** Every difference between the request and the grant, and what could not be asked at all. */
export interface CaptureComparison {
  readonly differences: readonly CaptureDifference[];
  readonly uncontrollable: readonly UncontrollableProcessing[];
}

/** Each control's name, at the start of a sentence. */
const CONTROL_NAMES: Readonly<Record<ProcessingControl, string>> = {
  echoCancellation: 'Echo cancellation',
  noiseSuppression: 'Noise suppression',
  autoGainControl: 'Automatic gain control',
  voiceIsolation: 'Voice isolation',
};

/** What each control does to a recording while it is on. */
const WHILE_ON: Readonly<Record<ProcessingControl, string>> = {
  echoCancellation:
    'removes sound it takes for an echo of the speakers, which can thin or cut off quiet and sustained sounds',
  noiseSuppression:
    "removes steady sound it takes for noise, such as room tone, breath and a note's tail",
  autoGainControl:
    "changes the level as it records, pulling quiet and loud passages together, so the recording's dynamics are not the performance's",
  voiceIsolation: 'keeps what it takes for a voice and removes the rest, which alters music',
};

/** What a recording lacks while each control is off. */
const WHILE_OFF: Readonly<Record<ProcessingControl, string>> = {
  echoCancellation:
    'sound from the speakers may be recorded with the input; headphones keep it out',
  noiseSuppression: 'background noise is recorded as it is heard',
  autoGainControl: "the level is not adjusted, so the input's gain decides it",
  voiceIsolation: 'sound besides the voice is recorded as it is heard',
};

/** The rate shown in a sentence, with its digits grouped. */
const HERTZ = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

/** How `granted` differs from what `plan` asked, and what `plan` could not ask. */
export function compareCapture(plan: CapturePlan, granted: GrantedCapture): CaptureComparison {
  const differences: CaptureDifference[] = [];

  for (const [control, requested] of requestedProcessing(plan)) {
    const reported = granted.processing[control];
    if (reported === requested) continue;
    differences.push(
      reported === undefined
        ? { kind: 'processing', control, requested, meaning: unconfirmed(control, requested) }
        : {
            kind: 'processing',
            control,
            requested,
            granted: reported,
            meaning: contrary(control, reported),
          },
    );
  }

  const { channelCount, sampleRate } = plan.request;
  if (channelCount !== undefined && granted.channelCount !== channelCount) {
    differences.push(channelDifference(channelCount, granted.channelCount));
  }
  if (sampleRate !== undefined && granted.sampleRate !== sampleRate) {
    differences.push(rateDifference(sampleRate, granted.sampleRate));
  }

  const choice = processingOf(plan.profile);
  return {
    differences,
    uncontrollable: plan.uncontrollable.map((control) => ({
      control,
      wanted: choice[control],
      meaning: uncontrollableMeaning(control, choice[control]),
    })),
  };
}

/** The processing controls the request asked for, each with its value, in the order shown. */
function requestedProcessing(
  plan: CapturePlan,
): readonly (readonly [ProcessingControl, boolean])[] {
  return Object.values(ProcessingControl).flatMap((control) => {
    const requested = plan.request.processing[control];
    return requested === undefined ? [] : [[control, requested] as const];
  });
}

function contrary(control: ProcessingControl, on: boolean): string {
  return on
    ? `${CONTROL_NAMES[control]} is on although it was asked to be off: the browser ${WHILE_ON[control]}.`
    : `${CONTROL_NAMES[control]} is off although it was asked to be on: ${WHILE_OFF[control]}.`;
}

function unconfirmed(control: ProcessingControl, requested: boolean): string {
  const asked = `The browser does not say whether ${lowered(control)} is on, so it cannot be confirmed`;
  return requested
    ? `${asked} that it is on as asked; if it is off, ${WHILE_OFF[control]}.`
    : `${asked} that it is off as asked; if it is on, the browser ${WHILE_ON[control]}.`;
}

function uncontrollableMeaning(control: ProcessingControl, wanted: boolean): string {
  const offered = `This browser offers no control of ${lowered(control)}, so it cannot be turned ${wanted ? 'on' : 'off'} as the profile asks`;
  return wanted
    ? `${offered}; without it, ${WHILE_OFF[control]}.`
    : `${offered}; if the browser applies it anyway, it ${WHILE_ON[control]}.`;
}

function channelDifference(requested: number, granted: number | undefined): CaptureDifference {
  const asked = counted(requested, 'channel', 'channels');
  return granted === undefined
    ? {
        kind: 'channel-count',
        requested,
        meaning: `The browser does not say how many channels the input gives, so it cannot be confirmed that the recording has the ${asked} asked for.`,
      }
    : {
        kind: 'channel-count',
        requested,
        granted,
        meaning: `The input gives ${counted(granted, 'channel', 'channels')} where ${asked} ${requested === 1 ? 'was' : 'were'} asked for, so the recording has ${String(granted)}.`,
      };
}

function rateDifference(requested: number, granted: number | undefined): CaptureDifference {
  const context = `${HERTZ.format(requested)} Hz`;
  return granted === undefined
    ? {
        kind: 'sample-rate',
        requested,
        meaning: `The browser does not say the input's rate, so it may be resampling the input to the recording's ${context}.`,
      }
    : {
        kind: 'sample-rate',
        requested,
        granted,
        meaning: `The input runs at ${HERTZ.format(granted)} Hz and the recording at ${context}, so the browser resamples the input, which adds a little latency and can soften the highest frequencies.`,
      };
}

function lowered(control: ProcessingControl): string {
  return CONTROL_NAMES[control].toLowerCase();
}
