/**
 * What the Transport panel reports of the engine: the context and the device,
 * the DSP path of each thread, every latency on the way to the listener, the
 * stability of the feed, the levels and the correlation of a pair, and each
 * audio feature this browser reduces.
 *
 * Each thread's DSP is said as it is: which path it has, and whether anything
 * it runs calls it. A graph of gains and meters calls no DSP whatever the
 * audio thread has loaded, and the test signal's tone is made on the feeder's.
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
import type { NodeId } from '@audiogubbins/audio-graph';
import { PerformanceProfile, TransportMode } from '@audiogubbins/audio-engine';
import {
  GpuUseKind,
  LifecycleState,
  type DspStatus,
  type GpuUse,
  type MeterLevels,
  type PlaybackStatus,
} from '@audiogubbins/audio-runtime';

import { PROFILE_NAMES } from '../commands/audio-commands.js';
import {
  correlationText,
  dspText,
  latencyFramesText,
  latencySecondsText,
  meterZone,
  peakText,
} from '../audio-format.js';

/** The audio features whose reductions the panel lists, in the order a person meets them. */
const AUDIO_FEATURES = [AUDIO_PLAYBACK, CANONICAL_DSP, OFFLINE_RENDERING, OUTPUT_DEVICE_CHOICE];

const CONTEXT_STATES: Readonly<Record<LifecycleState, string>> = {
  [LifecycleState.Idle]: 'Not started; it starts when you press Play',
  [LifecycleState.Suspended]: 'Suspended',
  [LifecycleState.AwaitingGesture]: 'Waiting for a click or a key press to start',
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

/**
 * A thread's DSP: its path, a note where nothing it runs calls it, and why
 * the reference path runs, where it does.
 */
function DspReading({
  term,
  dsp,
  unused,
}: {
  readonly term: string;
  readonly dsp: DspStatus;
  /** What is said where nothing the thread runs calls the DSP. */
  readonly unused: string;
}): ReactNode {
  return (
    <Reading term={term}>
      {dspText(dsp.implementation)}
      {!dsp.inUse && <span className="ag-reading-note">{unused}</span>}
      {dsp.fallbackReason !== undefined && (
        <span className="ag-reading-note" data-ag-status="reduced">
          {dsp.fallbackReason}
        </span>
      )}
    </Reading>
  );
}

/** What the loaded graph runs on the GPU, as the engine chose it. */
function gpuText(gpu: GpuUse): string {
  switch (gpu.kind) {
    case GpuUseKind.Unavailable:
      return 'Not available: this browser offers no GPU through WebGPU.';
    case GpuUseKind.Unused:
      return 'Available; no processor in this graph uses it.';
    case GpuUseKind.Used:
      return `Used by ${gpu.nodes.join(', ')}.`;
  }
}

/**
 * The context, the transport, each thread's DSP path, the GPU, the device and
 * the stability of the feed.
 */
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
  const { processorDsp, feederDsp, device, stability } = status;
  return (
    <dl className="ag-readings">
      <Reading term="Audio context">{CONTEXT_STATES[status.contextState]}</Reading>
      <Reading term="Transport">{TRANSPORT_MODES[status.transport.mode]}</Reading>
      {processorDsp === undefined ? (
        <Reading term="Graph on the audio thread">Not loaded yet</Reading>
      ) : (
        <DspReading
          term="Graph on the audio thread"
          dsp={processorDsp}
          unused="Loaded; no node of this graph calls it."
        />
      )}
      {feederDsp !== undefined && (
        <DspReading
          term="Sources in the feeder thread"
          dsp={feederDsp}
          unused="Loaded; the sources are recorded audio, which calls none of it."
        />
      )}
      {status.gpu !== undefined && <Reading term="GPU">{gpuText(status.gpu)}</Reading>}
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

/** What a correlated pair is called: left and right for a stereo meter, a number otherwise. */
function pairName(pair: number, channels: number): string {
  return channels === 2 ? 'Left and right' : `Pair ${String(pair + 1)}`;
}

/**
 * Each correlated pair's phase correlation, on a scale from −1, one channel
 * the inverse of the other, through 0, unrelated, to 1, in phase: a bar from
 * the middle, towards the end the reading is nearer.
 */
function PairCorrelations({ levels }: { readonly levels: MeterLevels }): ReactNode {
  return levels.correlation.map((correlation, pair) => {
    const name = pairName(pair, levels.peak.length);
    const reach = Math.min(1, Math.abs(correlation)) * 50;
    return (
      <div key={name} className="ag-meter">
        <span className="ag-meter-name">Correlation</span>
        <div
          className="ag-meter-scale"
          role="meter"
          aria-label={`${name} correlation`}
          aria-valuemin={-1}
          aria-valuemax={1}
          aria-valuenow={correlation}
          aria-valuetext={correlationText(correlation)}
        >
          <div
            className="ag-meter-fill"
            data-ag-zone={correlation < 0 ? 'high' : 'low'}
            style={{
              marginInlineStart: `${String(correlation < 0 ? 50 - reach : 50)}%`,
              inlineSize: `${String(reach)}%`,
            }}
          />
        </div>
        <span className="ag-meter-value">{correlationText(correlation)}</span>
      </div>
    );
  });
}

/**
 * The peak of each channel at each meter of the graph, and the correlation of
 * each pair it names, as the processor last reported them.
 */
export function LevelMeters({
  meters,
}: {
  readonly meters: ReadonlyMap<NodeId, MeterLevels>;
}): ReactNode {
  if (meters.size === 0) {
    return <p className="ag-panel-note">No levels until something plays.</p>;
  }
  return [...meters].map(([node, levels]) => (
    <div key={node} className="ag-meters" role="group" aria-label={`Levels at ${node}`}>
      <ChannelPeaks levels={levels} />
      <PairCorrelations levels={levels} />
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
