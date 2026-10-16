/**
 * The page's game preview (ADR-0104): the scenario set up, the renders its
 * members are heard from, made while it is set up, and the one run of it at a
 * time.
 *
 * What a scenario plays from is read from the project as it stands
 * (`preview-setup.ts`); each time the scenario, the project's audio or the
 * preview quality changes, the renders its members need are asked for again,
 * and a run waits until they are made, so no voice waits on a measurement
 * mid-run. A run plays under a key of its own, so the transport tells one run
 * from the next. Each change to the scenario while it plays is handed to it,
 * which plays as a running change what can be heard moving
 * (`preview-live-values.ts`); the rest is heard from the next run. Starting
 * another run, or stopping, ends the one playing.
 */

import {
  FailureKind,
  fail,
  failure,
  mapResult,
  type DomainResult,
  type QualitySettings,
} from '@audiogubbins/domain';
import {
  CachePurpose,
  PreviewClient,
  previewPort,
  type CachedStreams,
  type ToPreview,
} from '@audiogubbins/audio-engine';
import type { PreviewHost } from '@audiogubbins/audio-runtime';
import type { GamePreviewScenario, PreviewEmitterId } from '@audiogubbins/game-audio';

import type { AssetCatalogue } from '../state/asset-catalogue.js';
import { previewQualityOf, type AudioSettingsStore } from '../state/audio-settings-store.js';
import { createGamePreviewStore, type GamePreviewStore } from '../state/game-preview-store.js';
import type { Observable } from '../state/observable.js';
import type { ProjectStores } from '../state/project-stores.js';
import { browserSchedule } from './browser-schedule.js';
import type { PlaybackControl } from './playback-control.js';
import { HeldRenders, renderRequests } from './preview-renders.js';
import { PreviewRun, type PreviewPlayback, type RunPorts } from './preview-run.js';
import { setupNow, type PreviewSetup, type SetupResult } from './preview-setup.js';

/** What the preview reads besides its store, and plays and renders through. */
export interface PreviewSources extends Omit<RunPorts, 'show'> {
  /** What `scenario` plays from in the project as it stands now. */
  readonly setupOf: (scenario: GamePreviewScenario) => SetupResult;
  /** The preview quality in force, which renders are made at. */
  readonly quality: () => QualitySettings;
  /** The preview worker's renders, opened on first use. */
  readonly renders: () => CachedStreams;
  /** Tells of a change of what a setup is read from: the project's audio, the quality. */
  readonly changes: readonly Pick<Observable<unknown>, 'subscribe'>[];
}

/** The Game preview's state and its run, as the shell's commands reach them. */
export interface GamePreviewParts {
  readonly store: GamePreviewStore;
  readonly runner: PreviewRunner;
}

/** The page's run of the preview, if one plays, and the renders held for its scenario. */
export class PreviewRunner {
  readonly #store: GamePreviewStore;
  readonly #sources: PreviewSources;
  readonly #renders: HeldRenders;
  readonly #stops: readonly (() => void)[];
  #run: PreviewRun | undefined;
  #runs = 0;
  /** The key of the run started last, the only one whose view is shown. */
  #latest: string | undefined;
  #shown: GamePreviewScenario | undefined;

  constructor(store: GamePreviewStore, sources: PreviewSources) {
    this.#store = store;
    this.#sources = sources;
    this.#renders = new HeldRenders(sources.renders, store.showRenders);
    this.#shown = store.get().draft?.scenario;
    this.#stops = [
      store.subscribe(() => {
        this.#followDraft();
      }),
      ...sources.changes.map((one) =>
        one.subscribe(() => {
          this.#prepare();
        }),
      ),
    ];
    this.#prepare();
  }

  /** Each change of the scenario set up: its renders asked for, and the run playing it told. */
  #followDraft(): void {
    const now = this.#store.get().draft?.scenario;
    if (now === this.#shown) return;
    this.#shown = now;
    this.#prepare();
    const run = this.playing();
    if (run !== undefined && now?.id === run.scenario) void run.follow(now);
  }

  /** Asks for the renders the scenario set up needs, and lets go of any it no longer does. */
  #prepare(): void {
    const scenario = this.#store.get().draft?.scenario;
    const made = scenario === undefined ? undefined : this.#sources.setupOf(scenario);
    if (made?.ok !== true) {
      this.#renders.release();
      return;
    }
    const { setup } = made;
    const quality = this.#sources.quality();
    this.#renders.hold(
      renderRequests(setup.members.values(), setup.catalogue, quality),
      setup.media,
      quality,
    );
  }

  /** The run playing, where one is. */
  playing(): PreviewRun | undefined {
    return this.#run?.ended === false ? this.#run : undefined;
  }

  /** Plays `setup`, ending any run playing, or says why it cannot: a render is still being made. */
  start(setup: PreviewSetup): DomainResult<void> {
    const { made, needed } = this.#store.get().renders;
    if (made < needed) {
      return fail(
        failure(
          'preview.renders-unready',
          FailureKind.Rejected,
          `Its members' sound is still being prepared: ${String(made)} of ${String(needed)} made.`,
        ),
      );
    }
    this.#run?.stop();
    this.#runs += 1;
    const key = `game-preview:${String(this.#runs)}`;
    this.#latest = key;
    const started = PreviewRun.start(setup, key, {
      ...this.#sources,
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

  /** Stops the run, lets go of every render and stops following what it read. */
  dispose(): void {
    this.stop();
    this.#renders.release();
    for (const stop of this.#stops) stop();
  }
}

/** What the page's preview is made from. */
export interface PreviewParts {
  readonly parts: {
    readonly playback: PlaybackControl;
    readonly audioSettings: AudioSettingsStore;
  };
  readonly previews: Pick<PreviewHost, 'connect'>;
}

/**
 * The Game preview as the page runs it: played through `audio`'s playback on
 * the page's timers, its members' renders made by `audio`'s preview worker, and
 * set up from the project open in `projects` and `assets`.
 */
export function startGamePreview(
  audio: PreviewParts,
  assets: AssetCatalogue,
  projects: Pick<ProjectStores, 'project'> | undefined,
): GamePreviewParts {
  const project = projects?.project;
  const store = createGamePreviewStore();
  const { playback, audioSettings } = audio.parts;
  let renders: CachedStreams | undefined;
  const sources: PreviewSources & { readonly playback: PreviewPlayback } = {
    playback,
    schedule: browserSchedule,
    now: () => performance.now(),
    quality: () => previewQualityOf(audioSettings.get()).settings,
    renders: () => {
      renders ??= new PreviewClient(
        previewPort<ToPreview>(audio.previews.connect(CachePurpose.Playback).port),
      );
      return renders;
    },
    setupOf: (scenario) => setupNow({ project, assets, audioSettings }, scenario),
    changes: [assets, audioSettings, ...(project === undefined ? [] : [project])],
  };
  return { store, runner: new PreviewRunner(store, sources) };
}
