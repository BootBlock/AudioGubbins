/**
 * A graph checked on the main thread before anything is made for it.
 *
 * The processor compiles the graph again when it arrives, but a graph that
 * cannot play is refused here first, with the compiler's reasons, before a
 * worklet node, a ring or a module load has been spent on it; and compiling
 * here is how the main thread learns what it must make: the sink's channel
 * count for the node's output, the device channel each of them plays on, and
 * a feed for each graph input. A sink the device cannot take every channel
 * of is refused here too, since playing it would drop or mix channels.
 */

import {
  FailureKind,
  fail,
  failure,
  flatMapResult,
  succeed,
  type ChannelLayout,
  type DomainFailure,
  type DomainResult,
  type SampleRate,
} from '@audiogubbins/domain';
import type { AudioRuntimeCapabilities } from '@audiogubbins/capabilities';
import {
  compileGraph,
  type ExecutionPlan,
  type GraphDescriptor,
  type GraphDiagnostic,
} from '@audiogubbins/audio-graph';
import { BUILT_IN_NODES, type PerformanceSettings } from '@audiogubbins/audio-engine';

import type { AudioDestinationPort } from '../context/audio-context-port.js';
import { deviceChannelsFor, type DeviceChannels } from '../context/device-channels.js';
import type { SourceDescription } from '../protocol/source-descriptions.js';
import { PlaybackFeeds } from './feed-bindings.js';
import { feedPlanFor, type FeedPlan } from './feed-plan.js';
import { bindSources } from './source-binding.js';

/** A graph to play, and the audio of each of its graph inputs. */
export interface PlaybackRequest {
  readonly graph: GraphDescriptor;
  /**
   * The audio of each graph input, at the context's rate, described for the
   * feeder worker that makes it: a tone, or recorded audio whose arrays are
   * transferred to the feeder, and so detached here, when the request loads.
   */
  readonly sources: readonly SourceDescription[];
}

/** A graph that can play here, and what playing it needs. */
export interface PreparedPlayback {
  readonly plan: ExecutionPlan;
  /** The layout of the one sink, whose channels the worklet node's output carries. */
  readonly sinkLayout: ChannelLayout;
  /** The device channel each of the sink's channels plays on. */
  readonly device: DeviceChannels;
  readonly feeds: PlaybackFeeds;
  readonly feedPlan: FeedPlan;
}

/** What a graph is prepared against. */
export interface PreparationOptions {
  readonly capabilities: AudioRuntimeCapabilities;
  readonly settings: PerformanceSettings;
}

/** A problem the compiler found, as a failure that keeps the compiler's code. */
function graphProblem(diagnostic: GraphDiagnostic): DomainFailure {
  return failure('playback.graph-invalid', FailureKind.Rejected, diagnostic.message, {
    details: { diagnostic: diagnostic.code },
  });
}

/**
 * The graph compiled at `rate`, placed on the channels of `destination`'s
 * device, its sources bound and its feeds made, or every reason it cannot play.
 */
export function preparePlayback(
  request: PlaybackRequest,
  rate: SampleRate,
  destination: AudioDestinationPort,
  options: PreparationOptions,
): DomainResult<PreparedPlayback> {
  if (!options.capabilities.playback) {
    return fail(
      failure(
        'playback.unavailable',
        FailureKind.Rejected,
        'This browser cannot process audio on the audio thread, which playback needs.',
      ),
    );
  }
  const compiled = compileGraph(request.graph, BUILT_IN_NODES, rate);
  if (!compiled.ok) {
    const [first, ...rest] = compiled.diagnostics;
    return fail(graphProblem(first), ...rest.map(graphProblem));
  }
  const { plan } = compiled;
  const [sink, ...others] = plan.sinks;
  const sinkLayout = plan.steps.find((step) => step.node === sink?.node)?.inputs[0]?.layout;
  if (sink === undefined || others.length > 0 || sinkLayout === undefined) {
    // The processor plays exactly one output, and says so the same way.
    return fail(
      failure(
        'playback.graph-sinks',
        FailureKind.Rejected,
        `The graph has ${String(plan.sinks.length)} outputs; playback plays exactly one.`,
      ),
    );
  }
  return flatMapResult(deviceChannelsFor(sinkLayout, destination.maxChannelCount), (device) =>
    flatMapResult(bindSources(plan, request.sources, rate), (sources) =>
      flatMapResult(feedPlanFor(options.settings, rate), (feedPlan) =>
        flatMapResult(
          PlaybackFeeds.create({
            sources,
            plan: feedPlan,
            sharedMemory: options.capabilities.sharedMemory,
          }),
          (feeds) => succeed({ plan, sinkLayout, device, feeds, feedPlan }),
        ),
      ),
    ),
  );
}
