/**
 * Input monitoring, a state machine apart from the recording session
 * (`REQ-REC-091`, `REQ-ARCH-153`, ADR-0070).
 *
 * Monitoring is off by default and one toggle turns it on or off. It can be on
 * only while an input is open, and arming never turns it on: only a profile the
 * person marked as used with headphones turns it on by itself, and only where
 * the person had it on before with that device and profile. Where the input and
 * the output look like one device's microphone and speakers, turning it on asks
 * the person to confirm first, since the speakers would feed the microphone;
 * and so it does where the browser cannot say which output is playing, unless
 * the profile is marked as used with headphones, since nothing rules it out.
 * Monitoring through effects is possible only through a chain whose listening
 * is live; a chain that is not is refused with its reason, and recording goes
 * on regardless.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainResult,
  type SampleCount,
  type SampleRate,
} from '@audiogubbins/domain';

import type { DeviceIdentity, OutputIdentity } from './device-identity.js';

/**
 * Whether the speakers may feed the microphone, and why it is thought so:
 * `unknown` where the app cannot tell which output is playing, which is no
 * judgement of the risk either way.
 */
export type FeedbackRisk =
  | { readonly kind: 'none' }
  | { readonly kind: 'likely'; readonly why: 'same-device' | 'same-name' }
  | { readonly kind: 'unknown' };

/**
 * The words a browser's device names use for a device's role, which two halves
 * of one device differ by: "Microphone (Realtek Audio)" and "Speakers (Realtek
 * Audio)", or "MacBook Pro Microphone" and "MacBook Pro Speakers".
 */
const ROLE_WORDS =
  /\b(?:default|communications|microphones?|mics?|speakers?|input|output|line in|line out|array)\b/gu;

/** An output named as worn on the head, which keeps its sound from the microphone. */
const WORN = /\b(?:headphones?|headsets?|earphones?|earbuds?|airpods)\b/u;

/**
 * Whether monitoring `input` through `output` is likely to feed back. A
 * heuristic over what the browser gives: one group means one physical device,
 * and two names that differ only by their role words name one. A device worn
 * on the head is taken at its name, since its sound does not reach a
 * microphone; a false warning costs a confirmation, a missed one a howl. An
 * output the browser cannot name is judged neither way.
 */
export function feedbackRisk(input: DeviceIdentity, output: OutputIdentity): FeedbackRisk {
  if (output.kind === 'unknown') return { kind: 'unknown' };
  const outputName = output.device.label?.toLowerCase() ?? '';
  if (WORN.test(outputName)) return { kind: 'none' };
  if (input.group !== undefined && input.group !== '' && input.group === output.device.group) {
    return { kind: 'likely', why: 'same-device' };
  }
  const inputDevice = deviceName(input.label?.toLowerCase() ?? '');
  return inputDevice !== '' && inputDevice === deviceName(outputName)
    ? { kind: 'likely', why: 'same-name' }
    : { kind: 'none' };
}

/** A device's name without its role words, punctuation or spacing. */
function deviceName(label: string): string {
  return label
    .replace(ROLE_WORDS, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Whether a chain may be monitored through, and its latency or why not. */
export type ChainVerdict =
  | { readonly live: true; readonly latency: SampleCount }
  | { readonly live: false; readonly reason: string };

/** What the monitored signal passes through after the input: nothing, or a chain. */
export type MonitoringRoute =
  { readonly kind: 'direct' } | { readonly kind: 'chain'; readonly verdict: ChainVerdict };

/** The monitoring path: its route and the latencies the browser reports, in seconds. */
export interface MonitoringPath {
  readonly route: MonitoringRoute;
  readonly rate: SampleRate;
  readonly output: number;

  /** The input's latency, which not every browser reports. */
  readonly input?: number;
}

/** How late the monitored signal is heard: an estimate, and short of the truth where the input's share is unknown. */
export interface MonitoringLatency {
  readonly seconds: number;
  readonly inputKnown: boolean;
}

/** What monitoring needs to know of an open input. */
export interface MonitoringContext {
  /** Whether the input's profile is marked as used with headphones. */
  readonly headphones: boolean;
  readonly risk: FeedbackRisk;
  readonly path: MonitoringPath;
}

/**
 * - `unavailable`: no input is open, so nothing can be monitored.
 * - `off`: an input is open and monitoring is off; `refusal` says why where it
 *   was turned off, or kept off, by a chain that cannot run live.
 * - `confirming`: the person turned it on, and is asked to confirm a feedback
 *   risk, likely or unknown, before it starts.
 * - `on`: the input is heard, this late.
 */
export type Monitoring =
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'off'; readonly context: MonitoringContext; readonly refusal?: string }
  | { readonly kind: 'confirming'; readonly context: MonitoringContext }
  | {
      readonly kind: 'on';
      readonly context: MonitoringContext;
      readonly latency: MonitoringLatency;
    };

/**
 * What happens to monitoring.
 *
 * - `input-opened`: an input opened; `remembered` is whether the person had
 *   monitoring on with this device and profile.
 * - `input-closed`: the input closed.
 * - `toggle`: the one command, on or off.
 * - `confirm`: the person accepts the feedback risk.
 * - `context-changed`: the route, its verdict, a latency or the risk changed.
 */
export type MonitoringEvent =
  | {
      readonly kind: 'input-opened';
      readonly context: MonitoringContext;
      readonly remembered: boolean;
    }
  | { readonly kind: 'input-closed' }
  | { readonly kind: 'toggle' }
  | { readonly kind: 'confirm' }
  | { readonly kind: 'context-changed'; readonly context: MonitoringContext };

/** Monitoring with no input open. */
export const MONITORING_UNAVAILABLE: Monitoring = { kind: 'unavailable' };

/** The latency of monitoring through `path`: output, input where known, and the chain's. */
export function monitoringLatency(path: MonitoringPath): MonitoringLatency {
  const chain =
    path.route.kind === 'chain' && path.route.verdict.live ? path.route.verdict.latency : 0;
  return {
    seconds: path.output + (path.input ?? 0) + chain / path.rate,
    inputKnown: path.input !== undefined,
  };
}

/** The next monitoring state, or why `monitoring` cannot take `event`. */
export function nextMonitoring(
  monitoring: Monitoring,
  event: MonitoringEvent,
): DomainResult<Monitoring> {
  switch (event.kind) {
    case 'input-opened':
      return monitoring.kind === 'unavailable'
        ? succeed(opened(event.context, event.remembered))
        : refused('monitoring.input-already-open', 'An input is already open for monitoring.');
    case 'input-closed':
      return succeed(MONITORING_UNAVAILABLE);
    case 'toggle':
      return toggled(monitoring);
    case 'confirm':
      return monitoring.kind === 'confirming'
        ? started(monitoring.context)
        : refused(
            'monitoring.nothing-to-confirm',
            'No feedback warning is waiting to be confirmed.',
          );
    case 'context-changed':
      return contextChanged(monitoring, event.context);
  }
}

/** Monitoring on a newly opened input: off, unless a headphones profile had it on before. */
function opened(context: MonitoringContext, remembered: boolean): Monitoring {
  if (!context.headphones || !remembered) return { kind: 'off', context };
  const refusal = chainRefusal(context.path);
  return refusal === undefined
    ? { kind: 'on', context, latency: monitoringLatency(context.path) }
    : { kind: 'off', context, refusal };
}

function toggled(monitoring: Monitoring): DomainResult<Monitoring> {
  switch (monitoring.kind) {
    case 'unavailable':
      return refused('monitoring.no-input', 'No input is open, so there is nothing to monitor.');
    case 'on':
    case 'confirming':
      return succeed({ kind: 'off', context: monitoring.context });
    case 'off': {
      // A chain that cannot run live is refused before any warning is shown.
      const refusal = chainRefusal(monitoring.context.path);
      if (refusal !== undefined) return refused('monitoring.chain-not-live', refusal);
      return mustConfirm(monitoring.context)
        ? succeed({ kind: 'confirming', context: monitoring.context })
        : started(monitoring.context);
    }
  }
}

function contextChanged(
  monitoring: Monitoring,
  context: MonitoringContext,
): DomainResult<Monitoring> {
  switch (monitoring.kind) {
    case 'unavailable':
      return refused('monitoring.no-input', 'No input is open, so there is nothing to monitor.');
    case 'off':
      return succeed({ kind: 'off', context });
    case 'confirming':
      return succeed({ kind: 'confirming', context });
    case 'on': {
      // A risk graver than the one confirmed stops monitoring until the person
      // confirms again, and a chain that can no longer run live stops it with
      // its reason.
      const refusal = chainRefusal(context.path);
      if (refusal !== undefined) return succeed({ kind: 'off', context, refusal });
      if (mustConfirm(context) && !confirmedIn(monitoring.context, context.risk)) {
        return succeed({ kind: 'confirming', context });
      }
      return succeed({ kind: 'on', context, latency: monitoringLatency(context.path) });
    }
  }
}

/** Whether turning monitoring on in `context` asks the person to confirm a feedback risk first. */
function mustConfirm(context: MonitoringContext): boolean {
  return context.risk.kind !== 'none' && !context.headphones;
}

/**
 * Whether monitoring on in `context` stands confirmed for `risk`: its own risk
 * had to be confirmed, and was at least as grave. A likely risk is graver than
 * one the app cannot judge, so confirming an unknown output does not cover the
 * speakers it turns out to be.
 */
function confirmedIn(context: MonitoringContext, risk: FeedbackRisk): boolean {
  return mustConfirm(context) && gravity(context.risk) >= gravity(risk);
}

/** How grave a risk is, for `confirmedIn`. */
function gravity(risk: FeedbackRisk): number {
  switch (risk.kind) {
    case 'none':
      return 0;
    case 'unknown':
      return 1;
    case 'likely':
      return 2;
  }
}

/** Monitoring on in `context`, or the chain's reason it cannot be. */
function started(context: MonitoringContext): DomainResult<Monitoring> {
  const refusal = chainRefusal(context.path);
  return refusal === undefined
    ? succeed({ kind: 'on', context, latency: monitoringLatency(context.path) })
    : refused('monitoring.chain-not-live', refusal);
}

/** Why `path`'s chain cannot be monitored through, or none. */
function chainRefusal(path: MonitoringPath): string | undefined {
  return path.route.kind === 'chain' && !path.route.verdict.live
    ? path.route.verdict.reason
    : undefined;
}

function refused(code: string, summary: string): DomainResult<never> {
  return fail(failure(code, FailureKind.Conflict, summary));
}
