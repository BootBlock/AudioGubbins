/**
 * The page's one run of the game preview at a time (ADR-0104), and what the
 * person changes while it plays reaching it.
 *
 * A run is started from a setup read from the project as it stands and plays
 * under a key of its own, so the transport tells one run from the next. Each
 * change to the scenario set up while it plays is handed to it, which plays as
 * a running change what can be heard moving (`preview-live-values.ts`); the rest is
 * heard from the next run. Starting another run, or stopping, ends the one
 * playing.
 */

import { mapResult, type DomainResult } from '@audiogubbins/domain';
import type { PreviewEmitterId } from '@audiogubbins/game-audio';

import { browserSchedule } from './browser-schedule.js';
import { PreviewRun, type PreviewPlayback, type RunPorts } from './preview-run.js';
import { createGamePreviewStore, type GamePreviewStore } from '../state/game-preview-store.js';
import type { PreviewSetup } from './preview-setup.js';

/** The Game preview's state and its run, as the shell's commands reach them. */
export interface GamePreviewParts {
  readonly store: GamePreviewStore;
  readonly runner: PreviewRunner;
}

/** The page's run of the preview, if one plays. */
export class PreviewRunner {
  readonly #store: GamePreviewStore;
  readonly #ports: Omit<RunPorts, 'show'>;
  #run: PreviewRun | undefined;
  #runs = 0;
  /** The key of the run started last, the only one whose view is shown. */
  #latest: string | undefined;

  constructor(store: GamePreviewStore, ports: Omit<RunPorts, 'show'>) {
    this.#store = store;
    this.#ports = ports;
    let shown = store.get().draft?.scenario;
    // Each change of the scenario set up reaches the run playing it.
    store.subscribe(() => {
      const now = store.get().draft?.scenario;
      if (now === shown) return;
      shown = now;
      const run = this.playing();
      if (run !== undefined && now?.id === run.scenario) void run.follow(now);
    });
  }

  /** The run playing, where one is. */
  playing(): PreviewRun | undefined {
    return this.#run?.ended === false ? this.#run : undefined;
  }

  /** Plays `setup`, ending any run playing, or says why it cannot. */
  start(setup: PreviewSetup): DomainResult<void> {
    this.#run?.stop();
    this.#runs += 1;
    const key = `game-preview:${String(this.#runs)}`;
    this.#latest = key;
    const started = PreviewRun.start(setup, key, {
      ...this.#ports,
      show: (run) => {
        if (this.#latest === key) this.#store.showRun(run);
      },
    });
    return mapResult(started, (run) => {
      this.#run = run;
    });
  }

  /** Stops the run playing. */
  stop(): void {
    this.#run?.stop();
    this.#run = undefined;
  }

  trigger(emitter: PreviewEmitterId): void {
    void this.playing()?.trigger(emitter);
  }

  stopVoices(emitter: PreviewEmitterId): void {
    void this.playing()?.stopVoices(emitter);
  }
}

/** The Game preview as the page runs it, played through `playback` on the page's timers. */
export function startGamePreview(playback: PreviewPlayback): GamePreviewParts {
  const store = createGamePreviewStore();
  return {
    store,
    runner: new PreviewRunner(store, {
      playback,
      schedule: browserSchedule,
      now: () => performance.now(),
    }),
  };
}
