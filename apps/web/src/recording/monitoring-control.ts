/**
 * Input monitoring, the second state machine beside the recording session
 * (`REQ-REC-091`, `ADR-0070`): what the person hears of the input, and the
 * capture processor kept in step with it.
 *
 * Monitoring is off whenever an input opens, and arming never turns it on: the
 * recording package's machine turns it on by itself only for a profile the
 * person marked as used with headphones, and only where they had it on before
 * with that input and profile. One toggle turns it on or off, and each time the
 * choice is remembered for the input and the profile. Turning it on where the
 * speakers may feed the microphone, or where the browser cannot say which
 * output is playing, asks the person to confirm first. A chain monitored
 * through runs live in the capture processor, which answers with its latency or
 * the reason it cannot run live; monitoring goes off with that reason, and the
 * recording is never touched by it.
 */

import {
  FailureKind,
  derivedSampleCount,
  fail,
  failure,
  succeed,
  type AssetId,
  type DomainResult,
  type EffectChain,
  type QualityMode,
} from '@audiogubbins/domain';
import { FromCaptureKind, type FromCapture } from '@audiogubbins/audio-runtime';
import {
  MONITORING_UNAVAILABLE,
  feedbackRisk,
  nextMonitoring,
  type CaptureProfile,
  type ChainVerdict,
  type Monitoring,
  type MonitoringContext,
  type MonitoringEvent,
  type MonitoringRoute,
  type OutputIdentity,
  UNKNOWN_OUTPUT,
} from '@audiogubbins/recording';

import type { CapturePort } from '../audio/capture-parts.js';
import type { AudioSettingsStore } from '../state/audio-settings-store.js';
import { observable, type Observable } from '../state/observable.js';
import {
  monitoringRemembered,
  preferMonitoring,
  profileNamed,
} from '../state/recording-settings.js';
import type { OpenedFacts } from './input-view.js';

/** A chain of the project the person chose to monitor through, by the asset whose rack it is. */
export interface MonitoringChainChoice {
  readonly asset: AssetId;
  /** What the person calls it: the asset's name. */
  readonly name: string;
  readonly chain: EffectChain;
}

/** What the views read of monitoring. */
export interface MonitoringView {
  readonly monitoring: Monitoring;
  /** The chain monitored through, where one is chosen, whether or not it can run live. */
  readonly chain: Omit<MonitoringChainChoice, 'chain'> | undefined;
  /**
   * Whether the output's latency is known: where the browser does not say, the
   * latency shown is short of the truth by the output's share.
   */
  readonly outputKnown: boolean;
}

const NO_MONITORING: MonitoringView = {
  monitoring: MONITORING_UNAVAILABLE,
  chain: undefined,
  outputKnown: false,
};

/** What an open input is, for monitoring. */
interface Opened {
  readonly capture: CapturePort;
  readonly facts: OpenedFacts;
  /** The profile the input opened with, as the person marks it for headphones now. */
  profile: CaptureProfile;
  route: MonitoringRoute;
  /** The chain asked for and not yet answered for. */
  asked: MonitoringChainChoice | undefined;
}

/** What monitoring is made with. */
export interface MonitoringControlOptions {
  readonly settings: AudioSettingsStore;
  /** The quality a chain monitored through runs at: playback's preview quality. */
  readonly quality: () => QualityMode;
  readonly announce: (text: string) => void;
}

function refused(code: string, summary: string): DomainResult<never> {
  return fail(failure(code, FailureKind.Conflict, summary));
}

/** Keeps monitoring and the capture processor in step. */
export class MonitoringControl {
  readonly #options: MonitoringControlOptions;
  readonly #view = observable(NO_MONITORING);
  readonly #stopFollowingSettings: () => void;
  #opened: Opened | undefined;
  #chain: MonitoringChainChoice | undefined;
  /** The output the page plays through, as the input control's device watch last read it. */
  #output: OutputIdentity = UNKNOWN_OUTPUT;

  constructor(options: MonitoringControlOptions) {
    this.#options = options;
    // The person's word that a profile is used with headphones changes what
    // monitoring may do with it at once, on the input open now.
    this.#stopFollowingSettings = options.settings.subscribe(this.#settingsChanged);
  }

  /** Stops following the settings, once the input control has closed the input for good. */
  dispose(): void {
    this.#stopFollowingSettings();
  }

  /** What the views read. */
  get view(): Observable<MonitoringView> {
    return this.#view;
  }

  /** An input opened: monitoring is off, unless the machine turns it on for a headphones profile. */
  inputOpened(capture: CapturePort, facts: OpenedFacts, profile: CaptureProfile): void {
    const opened: Opened = { capture, facts, profile, route: { kind: 'direct' }, asked: undefined };
    this.#opened = opened;
    const remembered = monitoringRemembered(
      this.#options.settings.get().recording,
      facts.device,
      profile.name,
    );
    this.#apply({ kind: 'input-opened', context: this.#context(opened), remembered });
    if (this.#chain !== undefined) this.#ask(opened, this.#chain);
  }

  /** The output the page plays through is `output` now, which may change the feedback risk. */
  outputChanged(output: OutputIdentity): void {
    this.#output = output;
    const opened = this.#opened;
    if (opened !== undefined) {
      this.#apply({ kind: 'context-changed', context: this.#context(opened) });
    }
  }

  /** The input closed: nothing can be monitored. */
  inputClosed(): void {
    this.#opened = undefined;
    this.#view.set({ ...this.#view.get(), monitoring: MONITORING_UNAVAILABLE });
  }

  /** Hears what the capture processor said of monitoring. */
  heard(reply: FromCapture): void {
    const opened = this.#opened;
    if (opened === undefined) return;
    if (reply.kind === FromCaptureKind.Monitoring) {
      if (opened.asked !== undefined && reply.chained) this.#settleChain(opened, undefined);
      if (opened.route.kind === 'chain' && opened.route.verdict.live) {
        opened.route = {
          kind: 'chain',
          verdict: { live: true, latency: derivedSampleCount(reply.chainLatencyFrames) },
        };
      }
      this.#apply({ kind: 'context-changed', context: this.#context(opened) });
    } else if (reply.kind === FromCaptureKind.ChainRefused) {
      this.#settleChain(opened, reply.failures.map((one) => one.summary).join(' '));
      this.#apply({ kind: 'context-changed', context: this.#context(opened) });
    }
  }

  /** The one command: monitoring on or off, or why it cannot change. */
  toggle(): DomainResult<void> {
    const result = this.#apply({ kind: 'toggle' });
    if (!result.ok) return result;
    const { monitoring } = this.#view.get();
    const opened = this.#opened;
    if (opened !== undefined && monitoring.kind !== 'confirming') {
      this.#options.settings.reviseRecording(
        preferMonitoring(opened.facts.device, opened.profile.name, monitoring.kind === 'on'),
      );
    }
    return succeed(undefined);
  }

  /** Accepts the feedback risk, which starts monitoring. */
  confirm(): DomainResult<void> {
    const result = this.#apply({ kind: 'confirm' });
    const opened = this.#opened;
    if (result.ok && opened !== undefined) {
      this.#options.settings.reviseRecording(
        preferMonitoring(opened.facts.device, opened.profile.name, true),
      );
    }
    return result;
  }

  /**
   * Monitors through `choice`, or dry where it is `undefined`. The chain's
   * verdict comes from the capture processor, which runs it live or says why
   * it cannot; a choice made with no input open is used when one opens.
   */
  monitorThrough(choice: MonitoringChainChoice | undefined): DomainResult<void> {
    const opened = this.#opened;
    this.#chain = choice;
    this.#view.set({
      ...this.#view.get(),
      chain: choice === undefined ? undefined : { asset: choice.asset, name: choice.name },
    });
    if (opened === undefined) return succeed(undefined);
    if (choice === undefined) {
      opened.asked = undefined;
      opened.route = { kind: 'direct' };
      this.#apply({ kind: 'context-changed', context: this.#context(opened) });
      return opened.capture.monitorThrough(undefined, this.#options.quality());
    }
    return this.#ask(opened, choice);
  }

  readonly #settingsChanged = (): void => {
    const opened = this.#opened;
    if (opened === undefined) return;
    const profile = profileNamed(this.#options.settings.get().recording, opened.profile.name);
    if (profile === undefined || profile.headphones === opened.profile.headphones) return;
    opened.profile = profile;
    this.#apply({ kind: 'context-changed', context: this.#context(opened) });
  };

  #ask(opened: Opened, choice: MonitoringChainChoice): DomainResult<void> {
    opened.asked = choice;
    return opened.capture.monitorThrough(choice.chain, this.#options.quality());
  }

  /** The chain asked for is answered: live, or refused for `reason`. */
  #settleChain(opened: Opened, reason: string | undefined): void {
    const asked = opened.asked;
    opened.asked = undefined;
    if (asked === undefined) return;
    const verdict: ChainVerdict =
      reason === undefined
        ? { live: true, latency: derivedSampleCount(0) }
        : { live: false, reason };
    opened.route = { kind: 'chain', verdict };
    if (reason !== undefined) {
      this.#options.announce(`${asked.name} cannot be monitored through. ${reason}`);
    }
  }

  #context(opened: Opened): MonitoringContext {
    const latency = opened.capture.monitoringLatency();
    return {
      headphones: opened.profile.headphones,
      risk: feedbackRisk(opened.facts.device, this.#output),
      path: {
        route: opened.route,
        rate: opened.facts.rate,
        output: latency?.outputSeconds ?? 0,
        ...(latency?.inputSeconds === undefined ? {} : { input: latency.inputSeconds }),
      },
    };
  }

  /**
   * Takes `event` through the machine, and turns the processor's monitoring
   * on or off where the state crossed between on and anything else. A
   * processor that cannot route the input to the output on this device keeps
   * monitoring off, with its reason.
   */
  #apply(event: MonitoringEvent): DomainResult<void> {
    const before = this.#view.get();
    const next = nextMonitoring(before.monitoring, event);
    if (!next.ok) return next;
    let monitoring = next.value;
    const opened = this.#opened;
    const wasOn = before.monitoring.kind === 'on';
    const isOn = monitoring.kind === 'on';
    if (opened !== undefined && wasOn !== isOn) {
      const routed = opened.capture.monitor(isOn);
      if (!routed.ok && monitoring.kind === 'on') {
        monitoring = {
          kind: 'off',
          context: monitoring.context,
          refusal: routed.failures[0].summary,
        };
      }
    }
    this.#view.set({
      ...before,
      monitoring,
      outputKnown: opened?.capture.monitoringLatency()?.outputSeconds !== undefined,
    });
    if (monitoring.kind === 'off' && monitoring.refusal !== undefined && isOn) {
      return refused('monitoring.unroutable', monitoring.refusal);
    }
    return succeed(undefined);
  }
}
