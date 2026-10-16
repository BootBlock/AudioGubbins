/**
 * The Game preview panel's interaction state (ADR-0104, the plan's section 8):
 * the scenario the person is setting up, and what the run playing it shows.
 *
 * A scenario is a project object, but what the person drags or types while
 * listening is the session's until they keep it, so the draft lives here, with
 * the project's own copy it was opened from: keeping it runs the project's
 * scenario commands, which is the only way it reaches the project. Nothing here
 * is saved, undone or written into the project, and a run changes no edit.
 *
 * Beside it, how far the renders its members are heard from have come, which a
 * run waits for. The run's view is what the panel lists: the events heard so
 * far, newest last and only the latest {@link RECENT_EVENTS} of them, with a
 * count of every kind; the voices sounding against each emitter's limit; the
 * voice budget and how many were stolen or refused for it; and how late a hand
 * trigger is heard.
 */

import type {
  GamePreviewScenario,
  GamePreviewScenarioId,
  PreviewEmitterId,
  PreviewEvent,
} from '@audiogubbins/game-audio';

import { observable, type Observable } from './observable.js';
import type { Reasons } from './reasons.js';

/** How many of the latest events the panel's table lists. */
export const RECENT_EVENTS = 200;

/** A scenario being set up, and the project's copy it came from, where it came from one. */
export interface ScenarioDraft {
  readonly scenario: GamePreviewScenario;
  /** The project's copy as it was opened or last kept; `undefined` for one never kept. */
  readonly kept: GamePreviewScenario | undefined;
}

/** How many events of each kind a run has heard. */
export type EventCounts = Readonly<Record<PreviewEvent['kind'], number>>;

/** What a run has played, as far as the listener has heard it. */
export interface PreviewRunStats {
  readonly scenario: GamePreviewScenarioId;
  /** The most voices sounding at once across every emitter, at the preview quality. */
  readonly budget: number;
  /**
   * How long the last hand trigger took from the press to being heard, the feed
   * ahead, a chunk and the build included; `undefined` before one is heard.
   */
  readonly latencyMilliseconds: number | undefined;
  /** The latest events heard, oldest first, at most {@link RECENT_EVENTS}. */
  readonly recent: readonly PreviewEvent[];
  readonly counts: EventCounts;
  /** Each emitter's voices sounding now, and its limit. */
  readonly voices: ReadonlyMap<
    PreviewEmitterId,
    { readonly sounding: number; readonly limit: number }
  >;
  /** The streams of the plan playing now, which the preview keeps from growing without end. */
  readonly planStreams: number;
}

/** Where a run of the preview stands. */
export type PreviewRunView =
  | { readonly kind: 'idle' }
  /** Playing, or stopped by the person, with what it played. */
  | { readonly kind: 'running' | 'stopped'; readonly stats: PreviewRunStats }
  /** It stopped by itself, for these reasons: playback was refused, or moved to something else. */
  | { readonly kind: 'ended'; readonly reasons: Reasons; readonly stats: PreviewRunStats };

/** How far the renders the scenario's members are heard from have come. */
export interface RendersView {
  readonly needed: number;
  readonly made: number;
  /** Why a render is not kept, so its voices run the chain as they play. */
  readonly declined: readonly string[];
}

export interface GamePreviewState {
  readonly draft: ScenarioDraft | undefined;
  readonly run: PreviewRunView;
  readonly renders: RendersView;
}

/** Every event kind at none. */
export const NO_EVENTS: EventCounts = {
  started: 0,
  suppressed: 0,
  rejected: 0,
  'budget-rejected': 0,
  stolen: 0,
  'budget-stolen': 0,
  stopped: 0,
  ended: 0,
};

/** The Game preview's state, and the ways it changes. */
export interface GamePreviewStore extends Observable<GamePreviewState> {
  /** Sets up `scenario`, which is the project's `kept` where it came from the project. */
  readonly open: (scenario: GamePreviewScenario, kept: GamePreviewScenario | undefined) => void;
  /** Changes the scenario set up; nothing where none is. */
  readonly edit: (change: (scenario: GamePreviewScenario) => GamePreviewScenario) => void;
  /** That the project now holds `kept`, the scenario set up as it was kept. */
  readonly kept: (kept: GamePreviewScenario) => void;
  /** Sets nothing up. */
  readonly close: () => void;
  readonly showRun: (run: PreviewRunView) => void;
  readonly showRenders: (renders: RendersView) => void;
}

/** Whether `draft` differs from the project's copy, or was never kept. */
export function draftChanged(draft: ScenarioDraft): boolean {
  return draft.kept !== draft.scenario;
}

/** A store with nothing set up and nothing running. */
export function createGamePreviewStore(): GamePreviewStore {
  const state = observable<GamePreviewState>({
    draft: undefined,
    run: { kind: 'idle' },
    renders: { needed: 0, made: 0, declined: [] },
  });
  return {
    get: state.get,
    subscribe: state.subscribe,
    open: (scenario, kept) => {
      state.update((current) => ({ ...current, draft: { scenario, kept } }));
    },
    edit: (change) => {
      state.update((current) => {
        if (current.draft === undefined) return current;
        const scenario = change(current.draft.scenario);
        return scenario === current.draft.scenario
          ? current
          : { ...current, draft: { ...current.draft, scenario } };
      });
    },
    kept: (kept) => {
      state.update((current) =>
        current.draft?.scenario.id === kept.id
          ? { ...current, draft: { scenario: kept, kept } }
          : current,
      );
    },
    close: () => {
      state.update((current) => ({ ...current, draft: undefined }));
    },
    showRun: (run) => {
      state.update((current) => ({ ...current, run }));
    },
    showRenders: (renders) => {
      state.update((current) => ({ ...current, renders }));
    },
  };
}
