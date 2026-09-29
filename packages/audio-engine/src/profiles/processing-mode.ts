/**
 * Choosing how expensive processing runs (REQ-ARCH-079).
 *
 * The same processing can be heard live, rendered ahead into a cache and
 * played from there, rendered in the background, or rendered as the canonical
 * final output. Which is right depends on what the work is for and what the
 * machine measured it to cost, and the choice is shown to the person with its
 * reason, so every choice carries one. An expert may override it wherever the
 * override still makes sense.
 *
 * The profile moves only the line between hearing it live and hearing it from
 * a cache. It never removes a mode: {@link availableProcessingModes} takes no
 * profile, so a profile cannot change what is possible.
 *
 * What the host can run is its own fact, not the purpose's: a host with no
 * cache to play from says so, with its reason, and the choice then never
 * claims one, whether chosen automatically or asked for.
 */

import { fail, failure, FailureKind, succeed, type DomainResult } from '@audiogubbins/domain';

import type { ResourceWarning } from '../scheduling/workload.js';
import type { LatencyHint, PerformanceSettings } from './performance-profile.js';

/** The strategies processing can run under. */
export const ProcessingMode = {
  RealTime: 'real-time',
  CachedPreview: 'cached-preview',
  BackgroundOffline: 'background-offline',
  FinalOffline: 'final-offline',
} as const;

/** The strategies processing can run under. */
export type ProcessingMode = (typeof ProcessingMode)[keyof typeof ProcessingMode];

/** What the processing is for. */
export const ProcessingPurpose = {
  /** Heard while playing, as the person edits. */
  Monitor: 'monitor',
  /** Heard to judge a change before committing it. */
  Preview: 'preview',
  /** Measured rather than heard: peaks, spectra, loudness. */
  Analysis: 'analysis',
  /** The canonical output written to a file. */
  FinalRender: 'final-render',
} as const;

/** What the processing is for. */
export type ProcessingPurpose = (typeof ProcessingPurpose)[keyof typeof ProcessingPurpose];

/** What {@link selectProcessingMode} decides from. */
export interface ProcessingModeRequest {
  readonly purpose: ProcessingPurpose;
  /**
   * Processing seconds per second of audio, as measured; undefined until it
   * has been measured. 1 means the work only just keeps pace.
   */
  readonly measuredCostRatio?: number;
  readonly override?: ProcessingMode;
  readonly settings: PerformanceSettings;
  /**
   * Modes the host cannot run, each with the reason, worded for the person.
   * None is chosen automatically, and one asked for is refused.
   */
  readonly unavailable?: ReadonlyMap<ProcessingMode, string>;
  /**
   * What planning the workload warned of. A warning that the processor is the
   * limiting resource moves a final render into the background.
   */
  readonly warnings?: readonly ResourceWarning[];
}

/** The mode chosen and why, worded for the person it is shown to. */
export interface ProcessingModeChoice {
  readonly mode: ProcessingMode;
  readonly reason: string;
  readonly overridden: boolean;
}

const AVAILABLE: Readonly<Record<ProcessingPurpose, readonly ProcessingMode[]>> = {
  [ProcessingPurpose.Monitor]: [ProcessingMode.RealTime, ProcessingMode.CachedPreview],
  [ProcessingPurpose.Preview]: [ProcessingMode.RealTime, ProcessingMode.CachedPreview],
  [ProcessingPurpose.Analysis]: [ProcessingMode.BackgroundOffline, ProcessingMode.FinalOffline],
  // A final render must be canonical: bit-identical whatever the machine's
  // speed, which only the offline path guarantees (REQ-ARCH-081). Rendered in
  // the background it is the same render, queued behind interactive work.
  [ProcessingPurpose.FinalRender]: [ProcessingMode.FinalOffline, ProcessingMode.BackgroundOffline],
};

/** The modes processing for `purpose` may run under, whatever the profile. */
export function availableProcessingModes(purpose: ProcessingPurpose): readonly ProcessingMode[] {
  return AVAILABLE[purpose];
}

const MODE_NAMES: Readonly<Record<ProcessingMode, string>> = {
  [ProcessingMode.RealTime]: 'real-time processing',
  [ProcessingMode.CachedPreview]: 'a cached preview',
  [ProcessingMode.BackgroundOffline]: 'background rendering',
  [ProcessingMode.FinalOffline]: 'final offline rendering',
};

/**
 * The most a live chain may cost, as a share of real time, under a latency
 * hint. A shorter device buffer absorbs less of a slow block before it runs
 * dry, so the lower the latency, the more headroom live processing must leave.
 * A hint in seconds is placed by the buffer it asks for: under 20 ms behaves
 * like an interactive context, up to 100 ms like a balanced one.
 */
function realTimeCostCeiling(hint: LatencyHint): number {
  if (hint === 'interactive' || (typeof hint === 'number' && hint < 0.02)) return 0.5;
  if (hint === 'balanced' || (typeof hint === 'number' && hint <= 0.1)) return 0.7;
  return 0.85;
}

function percent(ratio: number): string {
  return `${String(Math.round(ratio * 100))}%`;
}

function capitalised(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/**
 * Live or from a cache, by the measured cost. `noCache` is why the host has no
 * cache to play from, where it has none: live playback is then the only way to
 * hear it, and the reason says what that risks rather than promising a cache
 * the host cannot give.
 */
function automaticListening(
  cost: number | undefined,
  settings: PerformanceSettings,
  noCache: string | undefined,
): ProcessingModeChoice {
  if (cost === undefined) {
    return {
      mode: ProcessingMode.RealTime,
      reason:
        noCache === undefined
          ? 'Playing live. The processing has not been measured yet; it moves to a cached preview if it cannot keep up.'
          : `Playing live. The processing has not been measured yet, and a cached preview is not available: ${noCache}`,
      overridden: false,
    };
  }
  const ceiling = realTimeCostCeiling(settings.latencyHint);
  if (cost <= ceiling) {
    return {
      mode: ProcessingMode.RealTime,
      reason: `Playing live. The processing takes ${percent(cost)} of real time, within the ${percent(ceiling)} this profile allows.`,
      overridden: false,
    };
  }
  const tooCostly =
    `The processing takes ${percent(cost)} of real time, more than ` +
    `the ${percent(ceiling)} this profile allows for playing live without drop-outs.`;
  if (noCache !== undefined) {
    return {
      mode: ProcessingMode.RealTime,
      reason: `Playing live, which may drop out. ${tooCostly} A cached preview is not available: ${noCache}`,
      overridden: false,
    };
  }
  return {
    mode: ProcessingMode.CachedPreview,
    reason: `Playing from a cached preview. ${tooCostly}`,
    overridden: false,
  };
}

/** The compute warning planning gave, where the processor is the limiting resource. */
function computeWarning(request: ProcessingModeRequest): ResourceWarning | undefined {
  return request.warnings?.find((warning) => warning.resource === 'compute');
}

/**
 * Offline, in the foreground where someone waits on it, or in the background
 * where the processor is the limiting resource and playback and editing would
 * otherwise queue behind it.
 */
function automaticFinalRender(request: ProcessingModeRequest): ProcessingModeChoice {
  const compute = computeWarning(request);
  if (compute !== undefined && !request.unavailable?.has(ProcessingMode.BackgroundOffline)) {
    return {
      mode: ProcessingMode.BackgroundOffline,
      reason:
        'Rendering in the background at full quality, so playback and editing come first; ' +
        `the file is identical on every machine either way. ${compute.explanation}`,
      overridden: false,
    };
  }
  return {
    mode: ProcessingMode.FinalOffline,
    reason: 'Rendering offline at full quality, so the file is identical on every machine.',
    overridden: false,
  };
}

function automatic(request: ProcessingModeRequest, cost: number | undefined): ProcessingModeChoice {
  switch (request.purpose) {
    case ProcessingPurpose.Monitor:
    case ProcessingPurpose.Preview:
      return automaticListening(
        cost,
        request.settings,
        request.unavailable?.get(ProcessingMode.CachedPreview),
      );
    case ProcessingPurpose.Analysis:
      return {
        mode: ProcessingMode.BackgroundOffline,
        reason: 'Analysing in the background, so playback and editing stay responsive.',
        overridden: false,
      };
    case ProcessingPurpose.FinalRender:
      return automaticFinalRender(request);
  }
}

/** What choosing `override` over the automatic choice risks, as a sentence to add. */
function riskOf(
  request: ProcessingModeRequest,
  override: ProcessingMode,
  chosen: ProcessingModeChoice,
): string {
  if (override === ProcessingMode.RealTime && chosen.mode !== ProcessingMode.RealTime) {
    return ' It may drop out: the measured cost leaves too little headroom.';
  }
  const compute = computeWarning(request);
  if (override === ProcessingMode.FinalOffline && compute !== undefined) {
    return ` It holds up playback and editing while it runs. ${compute.explanation}`;
  }
  return '';
}

function withOverride(
  request: ProcessingModeRequest,
  override: ProcessingMode,
  chosen: ProcessingModeChoice,
): ProcessingModeChoice {
  if (!AVAILABLE[request.purpose].includes(override)) {
    const refusal =
      request.purpose === ProcessingPurpose.FinalRender
        ? `A final render always runs offline, so the file is canonical; ${MODE_NAMES[override]} was not used.`
        : `This work cannot use ${MODE_NAMES[override]}, so that choice was not applied.`;
    return { ...chosen, reason: `${refusal} ${chosen.reason}` };
  }
  const missing = request.unavailable?.get(override);
  if (missing !== undefined) {
    return {
      ...chosen,
      reason:
        `${capitalised(MODE_NAMES[override])} is not available, so that choice was not applied: ` +
        `${missing} ${chosen.reason}`,
    };
  }
  return {
    mode: override,
    reason: `Using ${MODE_NAMES[override]}, as chosen.${riskOf(request, override, chosen)}`,
    overridden: true,
  };
}

/**
 * Chooses the mode for a piece of processing, and says why.
 *
 * An override that is available for the purpose, and that the host can run,
 * is honoured, with a warning where the measurement argues against it; one
 * that is not is refused and the automatic choice stands, with the refusal in
 * its reason.
 */
export function selectProcessingMode(
  request: ProcessingModeRequest,
): DomainResult<ProcessingModeChoice> {
  const cost = request.measuredCostRatio;
  if (cost !== undefined && !(Number.isFinite(cost) && cost >= 0)) {
    return fail(
      failure(
        'processing-mode.cost-ratio-invalid',
        FailureKind.Rejected,
        `A measured cost ratio must be a finite number of at least zero; ${String(cost)} was given.`,
      ),
    );
  }
  const chosen = automatic(request, cost);
  return succeed(
    request.override === undefined ? chosen : withOverride(request, request.override, chosen),
  );
}
