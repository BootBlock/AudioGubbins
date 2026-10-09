/**
 * Capture profiles, and what one asks a browser for (`REQ-REC-092`, ADR-0070).
 *
 * Raw/Studio is the default: it asks for no echo cancellation, no noise
 * suppression, no automatic gain and no voice isolation, so the recording is
 * the source and not the browser's idea of a call. Voice asks for all four, and
 * Custom sets each. A profile asks only for what the browser says it can
 * control: a constraint it does not support would be ignored without a word, so
 * it is not asked for, and is named instead as one that could not be
 * controlled, for the person and for the take's provenance.
 *
 * These are the package's own shapes: the application maps the capabilities
 * adapter's supported constraints and granted settings to them, so nothing here
 * knows a browser type.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainResult,
  type SampleRate,
} from '@audiogubbins/domain';
import { asName } from '@audiogubbins/text';

/**
 * The browser processing a profile turns on or off, by the name the browser's
 * supported constraints give each, so a supported set is read without a map.
 */
export const ProcessingControl = {
  EchoCancellation: 'echoCancellation',
  NoiseSuppression: 'noiseSuppression',
  AutoGainControl: 'autoGainControl',
  VoiceIsolation: 'voiceIsolation',
} as const;

/** The browser processing a profile turns on or off. */
export type ProcessingControl = (typeof ProcessingControl)[keyof typeof ProcessingControl];

/** Every processing control, in the order they are shown. */
export const PROCESSING_CONTROLS: readonly ProcessingControl[] = Object.values(ProcessingControl);

/** Whether each processing control is to be on. */
export type ProcessingChoice = Readonly<Record<ProcessingControl, boolean>>;

/** The kinds of profile. */
export const CaptureProfileKind = {
  RawStudio: 'raw-studio',
  Voice: 'voice',
  Custom: 'custom',
} as const;

/** The kinds of profile. */
export type CaptureProfileKind = (typeof CaptureProfileKind)[keyof typeof CaptureProfileKind];

/**
 * A capture profile. Raw/Studio's and Voice's processing is their kind's, so a
 * stored one cannot disagree with its name; Custom carries its own.
 *
 * `headphones` is the person's word that this profile is used with headphones,
 * which no browser can tell: only such a profile may turn monitoring on by
 * itself (`monitoring.ts`).
 */
export type CaptureProfile =
  | {
      readonly kind: typeof CaptureProfileKind.RawStudio | typeof CaptureProfileKind.Voice;
      readonly name: string;
      readonly headphones: boolean;
    }
  | {
      readonly kind: typeof CaptureProfileKind.Custom;
      readonly name: string;
      readonly headphones: boolean;
      readonly processing: ProcessingChoice;
    };

/** The most characters a custom profile's name may have, which a list of profiles shows whole. */
export const PROFILE_NAME_CHARACTERS = 48;

const ALL_OFF: ProcessingChoice = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  voiceIsolation: false,
};

const ALL_ON: ProcessingChoice = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  voiceIsolation: true,
};

/** The default profile: every processing control off. */
export const RAW_STUDIO_PROFILE: CaptureProfile = {
  kind: CaptureProfileKind.RawStudio,
  name: 'Raw/Studio',
  headphones: false,
};

/** The profile for speech over a call: every processing control on. */
export const VOICE_PROFILE: CaptureProfile = {
  kind: CaptureProfileKind.Voice,
  name: 'Voice',
  headphones: false,
};

/** A custom profile named `name`, or why the name is refused. */
export function customProfile(
  name: unknown,
  processing: ProcessingChoice,
  headphones: boolean,
): DomainResult<CaptureProfile> {
  const named = asName(name, PROFILE_NAME_CHARACTERS);
  if (typeof named !== 'string') {
    return fail(
      failure(
        `recording.profile-name-${named.kind}`,
        FailureKind.Rejected,
        named.kind === 'blank'
          ? 'A capture profile needs a name.'
          : `A capture profile's name may have at most ${String(PROFILE_NAME_CHARACTERS)} characters.`,
      ),
    );
  }
  return succeed({ kind: CaptureProfileKind.Custom, name: named, headphones, processing });
}

/** `profile`, marked as used with headphones or not. */
export function withHeadphones(profile: CaptureProfile, headphones: boolean): CaptureProfile {
  return { ...profile, headphones };
}

/** Whether each processing control is to be on under `profile`. */
export function processingOf(profile: CaptureProfile): ProcessingChoice {
  switch (profile.kind) {
    case CaptureProfileKind.RawStudio:
      return ALL_OFF;
    case CaptureProfileKind.Voice:
      return ALL_ON;
    case CaptureProfileKind.Custom:
      return profile.processing;
  }
}

/** What a capture asks the browser for: only what the browser said it can control. */
export interface CaptureRequest {
  /** Each processing control asked for, and whether it is to be on. */
  readonly processing: Partial<Record<ProcessingControl, boolean>>;

  /** The channels asked for: the input's own count, so a recording has every channel it gives. */
  readonly channelCount?: number;

  /** The rate asked for: the audio context's, so the browser need not resample the input. */
  readonly sampleRate?: SampleRate;
}

/** A request, and what the profile wanted that the browser offers no control of. */
export interface CapturePlan {
  readonly profile: CaptureProfile;
  readonly request: CaptureRequest;

  /** The processing controls this browser cannot set, in the order they are shown. */
  readonly uncontrollable: readonly ProcessingControl[];
}

/** What the browser and the input say, which shape a request. */
export interface CaptureOffer {
  /** The names of the constraints the browser supports, as its supported constraints give them. */
  readonly supported: ReadonlySet<string>;

  /** The most channels the input reports, where it reports any. */
  readonly channelCount?: number;

  /** The audio context's rate, which every recording is taken at (ADR-0070). */
  readonly contextRate: SampleRate;
}

/** What `profile` asks of a browser that offers `offer`. */
export function capturePlan(profile: CaptureProfile, offer: CaptureOffer): CapturePlan {
  const choice = processingOf(profile);
  const processing: Partial<Record<ProcessingControl, boolean>> = {};
  const uncontrollable: ProcessingControl[] = [];
  for (const control of PROCESSING_CONTROLS) {
    if (offer.supported.has(control)) processing[control] = choice[control];
    else uncontrollable.push(control);
  }

  return {
    profile,
    request: {
      processing,
      ...(offer.supported.has('channelCount') && offer.channelCount !== undefined
        ? { channelCount: offer.channelCount }
        : {}),
      ...(offer.supported.has('sampleRate') ? { sampleRate: offer.contextRate } : {}),
    },
    uncontrollable,
  };
}
