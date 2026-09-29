/**
 * What the Transport panel reports of the engine: the context and the device,
 * the DSP path, every latency on the way to the listener, the stability of
 * the feed, the levels, and each audio feature this browser reduces.
 *
 * Every degradation says its reason where it is shown (WU-03.E): the
 * reference path with the reason it runs, a feature with the capability it
 * lacks. A reading the browser does not give says so rather than showing
 * nothing, since an absent number reads as zero.
 */

import { useSyncExternalStore, type ReactNode } from 'react';

import {
  AUDIO_PLAYBACK,
  CANONICAL_DSP,
  FeatureStatus,
  OFFLINE_RENDERING,
  OUTPUT_DEVICE_CHOICE,
  type CapabilityRegistry,
} from '@audiogubbins/capabilities';
import { PerformanceProfile, TransportMode } from '@audiogubbins/audio-engine';
import { LifecycleState, type MeterLevels, type PlaybackStatus } from '@audiogubbins/audio-runtime';

import { PROFILE_NAMES } from '../commands/audio-commands.js';
import {
  dspText,
  latencyFramesText,
  latencySecondsText,
  meterZone,
  peakText,
} from './audio-format.js';

/** The audio features whose reductions the panel lists, in the order a person meets them. */
const AUDIO_FEATURES = [AUDIO_PLAYBACK, CANONICAL_DSP, OFFLINE_RENDERING, OUTPUT_DEVICE_CHOICE];

const CONTEXT_STATES: Readonly<Record<LifecycleState, string>> = {
  [LifecycleState.Idle]: 'Not started; it starts when you press Play',
  [LifecycleState.Suspended]: 'Suspended',
  [LifecycleState.Running]: 'Running',
  [LifecycleState.Interrupted]: 'Held by the system',
  [LifecycleState.Closed]: 'Closed',
};

const TRANSPORT_MODES: Readonly<Record<TransportMode, string>> = {
  [TransportMode.Stopped]: 'Stopped',
  [TransportMode.Playing]: 'Playing',
  [TransportMode.Paused]: 'Paused',
  [TransportMode.Suspended]: 'Suspended by the system',
};

/** One term of a description list and what it says. */
function Reading({ term, children }: { readonly term: string; readonly children: ReactNode }) {
  return (
    <div className="ag-reading">
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** The latencies between the processor and the listener, at the context's rate. */
function Latencies({ status }: { readonly status: PlaybackStatus }): ReactNode {
  const device = status.device;
  if (device === undefined) return null;
  const rate = device.sampleRate;
  return (
    <>
      <Reading term="Base latency">{latencySecondsText(device.baseLatencySeconds, rate)}</Reading>
      <Reading term="Output latency">
        {device.outputLatencySeconds === undefined
          ? 'Not reported by this browser, so the position shown is early by the device’s share'
          : latencySecondsText(device.outputLatencySeconds, rate)}
      </Reading>
      <Reading term="Graph latency">
        {status.latencyFrames === undefined
          ? 'Not known: a node on the way cannot say its own'
          : latencyFramesText(status.latencyFrames, rate)}
      </Reading>
    </>
  );
}

/** The context, the transport, the DSP path, the device and the stability of the feed. */
export function EngineState({
  status,
}: {
  readonly status: PlaybackStatus | undefined;
}): ReactNode {
  if (status === undefined) {
    return (
      <dl className="ag-readings">
        <Reading term="Audio context">{CONTEXT_STATES[LifecycleState.Idle]}</Reading>
      </dl>
    );
  }
  const { dsp, device, stability } = status;
  return (
    <dl className="ag-readings">
      <Reading term="Audio context">{CONTEXT_STATES[status.contextState]}</Reading>
      <Reading term="Transport">{TRANSPORT_MODES[status.transport.mode]}</Reading>
      <Reading term="Processing">
        {dsp === undefined ? 'Not loaded yet' : dspText(dsp.implementation)}
        {dsp?.fallbackReason !== undefined && (
          <span className="ag-reading-note" data-ag-status="reduced">
            {dsp.fallbackReason}
          </span>
        )}
      </Reading>
      {device !== undefined && (
        <Reading term="Device rate">{`${String(device.sampleRate)} Hz`}</Reading>
      )}
      <Latencies status={status} />
      {stability !== undefined && (
        <Reading term="Underruns">
          {`${String(stability.underrunsInWindow)}. ${stability.explanation}`}
          {stability.recommendation !== undefined &&
            stability.recommendation !== PerformanceProfile.Custom && (
              <span className="ag-reading-note" data-ag-status="reduced">
                {`Recommended profile: ${PROFILE_NAMES[stability.recommendation]}.`}
              </span>
            )}
        </Reading>
      )}
    </dl>
  );
}

/** What a channel is called: left and right for a pair, a number otherwise. */
function channelName(channel: number, channels: number): string {
  if (channels === 2) return channel === 0 ? 'Left' : 'Right';
  return `Channel ${String(channel + 1)}`;
}

/** One meter's peak on each channel. */
function ChannelPeaks({ levels }: { readonly levels: MeterLevels }): ReactNode {
  return levels.peak.map((peak, channel) => {
    const name = channelName(channel, levels.peak.length);
    return (
      <div key={name} className="ag-meter">
        <span className="ag-meter-name">{name}</span>
        <div
          className="ag-meter-scale"
          role="meter"
          aria-label={`${name} peak`}
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={Math.min(1, peak)}
          aria-valuetext={peakText(peak)}
        >
          <div
            className="ag-meter-fill"
            data-ag-zone={meterZone(peak)}
            style={{ inlineSize: `${String(Math.min(1, peak) * 100)}%` }}
          />
        </div>
        <span className="ag-meter-value">{peakText(peak)}</span>
      </div>
    );
  });
}

/** The peak of each channel at each meter of the graph, as the processor last reported it. */
export function LevelMeters({
  status,
}: {
  readonly status: PlaybackStatus | undefined;
}): ReactNode {
  if (status === undefined || status.meters.size === 0) {
    return <p className="ag-panel-note">No levels until something plays.</p>;
  }
  return [...status.meters].map(([node, levels]) => (
    <div key={node} className="ag-meters" role="group" aria-label={`Levels at ${node}`}>
      <ChannelPeaks levels={levels} />
    </div>
  ));
}

/** Each audio feature this browser reduces or cannot run, with its reason. */
export function AudioDegradations({
  capabilities,
}: {
  readonly capabilities: CapabilityRegistry;
}): ReactNode {
  // Subscribed, so an answer the browser gives late redraws the list.
  useSyncExternalStore(capabilities.subscribe, capabilities.all);
  const degraded = capabilities.degradedFeatures(AUDIO_FEATURES);
  if (degraded.length === 0) return null;
  return (
    <ul className="ag-capability-list">
      {degraded.map((feature) => (
        <li key={feature.featureKey} className="ag-capability">
          <span className="ag-capability-name">{feature.label}</span>
          <span className="ag-capability-status" data-ag-status={feature.status}>
            {feature.status === FeatureStatus.Unavailable ? 'Unavailable' : 'Reduced'}
          </span>
          <p className="ag-capability-explanation">{feature.explanation}</p>
        </li>
      ))}
    </ul>
  );
}

/** What stopped playback, where anything did. */
export function PlaybackProblems({
  problems,
}: {
  readonly problems: readonly string[];
}): ReactNode {
  if (problems.length === 0) return null;
  return (
    <ul className="ag-audio-problems">
      {problems.map((problem) => (
        <li key={problem} data-ag-status="unavailable">
          {problem}
        </li>
      ))}
    </ul>
  );
}
