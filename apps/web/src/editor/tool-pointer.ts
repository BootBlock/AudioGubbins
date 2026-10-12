/**
 * One pointer working a view's tool: a press, the drag that may follow and the
 * release, read into the editor-view package's tool steps and carried out as
 * commands (REQ-EDIT-065). Mouse, pen and a single finger take this one path,
 * each with its own reach and drag threshold. A finger or a pen held still is
 * the context action instead (REQ-UX-067), which the pointer input recognises
 * and which abandons the press here rather than finishing it.
 *
 * Every position is snapped as the view's settings say before a tool reads it
 * (REQ-EDIT-013), among targets gathered from the same values the frame is
 * drawn from. A zero crossing needs the audio, which the peak worker searches;
 * events are taken in order, each waiting for its search, so where a press or a
 * release lands does not depend on how quickly the worker answered, and a drag
 * that outruns it skips the moves that were overtaken. A drag that traces a
 * path, a lasso's or a brush's, skips none: every move is a point of its shape,
 * so a shape whose moves were skipped would depend on how quickly the worker
 * answered. A press that is abandoned, or overtaken by the next, abandons the
 * search it is waiting on.
 */

import { SnapKind, boundaryAt, samplesWithin, type SnapTarget } from '@audiogubbins/timeline';
import { toolStrength, type GestureSettings, type PointerSample } from '@audiogubbins/input';
import {
  IDLE,
  hitTest,
  laneAt,
  move,
  press,
  release,
  snapInView,
  tracesPath,
  type Interaction,
  type ToolInput,
  type ToolPreview,
  type ToolStep,
  type ViewLayout,
} from '@audiogubbins/editor-view';
import { sampleCount, type SampleCount } from '@audiogubbins/domain';

import { commandsOf, type IntentCommand } from './intent-commands.js';
import {
  shownChannels,
  snapTargetsFor,
  type SceneSources,
  type SnapExclusions,
} from './view-scene.js';

/** What the pointer reads of its view at the moment of each event. */
export interface PointerSnapshot {
  readonly sources: Pick<SceneSources, 'state' | 'asset' | 'selection' | 'playhead' | 'picture'>;
  readonly layout: ViewLayout;
}

/** What the pointer works through. */
export interface ToolPointerHost {
  readonly panel: string;
  /** The view as it is now, or `undefined` where it shows nothing. */
  readonly snapshot: () => PointerSnapshot | undefined;
  /** Whether the space bar is held, which makes any tool the hand. */
  readonly panning: () => boolean;
  /** How gestures are read, whose pressure choice gives a pointer its strength. */
  readonly gestures: () => GestureSettings;
  readonly run: (command: IntentCommand) => void;
  /** Shows the drag in progress, and the target a position snapped to. */
  readonly show: (preview: ToolPreview | undefined, snap: SnapTarget | undefined) => void;
  /** Records a fault met while an event was taken. */
  readonly fault: (error: unknown) => void;
  /** The zero crossing nearest a position, searched until `signal` gives the press up. */
  readonly zeroCrossing: (
    position: number,
    within: number,
    channels: readonly number[],
    signal: AbortSignal,
  ) => Promise<number | undefined>;
}

/** The modifiers a tool reads with a position. */
export interface Modifiers {
  readonly shift: boolean;
  readonly alt: boolean;
}

function boundary(value: number | undefined): SampleCount | undefined {
  if (value === undefined) return undefined;
  const read = sampleCount(value);
  return read.ok ? read.value : undefined;
}

/** One pointer's work with a view's tool. */
export class ToolPointer {
  readonly #host: ToolPointerHost;
  #interaction: Interaction = IDLE;
  #pointer: number | undefined;
  /** Gives up the searches of the press under way, when it is abandoned or overtaken while held. */
  #press = new AbortController();
  /** The event being taken, and the move waiting behind it, which a later move replaces. */
  #busy: Promise<void> = Promise.resolve();
  #waitingMove: (() => Promise<void>) | undefined;
  /**
   * Whether the press under way traces a path, every move of which is taken:
   * read as it is pressed, since the press may still wait on its search when
   * its first moves come.
   */
  #tracing = false;

  constructor(host: ToolPointerHost) {
    this.#host = host;
  }

  /** Whether a press is under way. */
  get pressed(): boolean {
    return this.#interaction.kind !== 'idle';
  }

  down(sample: PointerSample, modifiers: Modifiers): void {
    // A press still held is overtaken; one released keeps its release.
    this.#abandon();
    this.#pointer = sample.pointerId;
    this.#press = new AbortController();
    const pressed = this.#host.snapshot()?.sources.state.tool;
    this.#tracing = !this.#host.panning() && pressed !== undefined && tracesPath(pressed);
    const signal = this.#press.signal;
    this.#enqueue(signal, async () => {
      const snapshot = this.#host.snapshot();
      if (snapshot === undefined) return;
      const input = await this.#input(snapshot, sample, modifiers, {}, signal);
      const { state, selection } = snapshot.sources;
      const hit = hitTest(
        {
          layout: snapshot.layout,
          viewport: state.viewport,
          markers: state.overlays.markers ? snapshot.sources.asset.markers : [],
          regions: state.overlays.regions ? snapshot.sources.asset.regions : [],
          selection: selection.time,
        },
        sample.x,
        sample.y,
        sample.kind,
      );
      this.#apply(
        press(
          {
            tool: state.tool,
            panning: this.#host.panning(),
            hit,
            selection: selection.time,
            visibleChannels: shownChannels(state, snapshot.sources.asset),
            spectral: {
              lane: laneAt(snapshot.layout, sample.y),
              axis: state.spectral,
              viewport: state.viewport,
              length: snapshot.sources.asset.length,
              channelCount: snapshot.sources.asset.layout.roles.length,
              selection,
              settings: state.spectralTools,
            },
          },
          input,
        ),
        input.snap,
      );
    });
  }

  moved(sample: PointerSample, modifiers: Modifiers): void {
    if (sample.pointerId !== this.#pointer) return;
    const signal = this.#press.signal;
    const step = async (): Promise<void> => {
      const snapshot = this.#host.snapshot();
      if (snapshot === undefined || this.#interaction.kind === 'idle') return;
      const input = await this.#input(snapshot, sample, modifiers, this.#exclusions(), signal);
      this.#apply(move(this.#interaction, input), input.snap);
    };
    if (this.#tracing) {
      this.#enqueue(signal, step);
      return;
    }
    // A move not yet taken is overtaken by this one.
    const waiting = this.#waitingMove !== undefined;
    this.#waitingMove = step;
    if (!waiting) {
      this.#enqueue(signal, async () => {
        const next = this.#waitingMove;
        this.#waitingMove = undefined;
        await next?.();
      });
    }
  }

  up(sample: PointerSample, modifiers: Modifiers): void {
    if (sample.pointerId !== this.#pointer) return;
    this.#pointer = undefined;
    const signal = this.#press.signal;
    this.#enqueue(signal, async () => {
      const snapshot = this.#host.snapshot();
      if (snapshot === undefined || this.#interaction.kind === 'idle') return;
      const input = await this.#input(snapshot, sample, modifiers, this.#exclusions(), signal);
      this.#apply(release(this.#interaction, input), undefined);
    });
  }

  /**
   * Abandons the press, and the search it waits on, as a second finger, a long
   * press or a cancelled pointer does.
   */
  cancel(): void {
    this.#abandon();
    this.#waitingMove = undefined;
    this.#enqueue(undefined, () => {
      this.#interaction = IDLE;
      this.#host.show(undefined, undefined);
      return Promise.resolve();
    });
  }

  /** Gives up the searches of the press still held, if one is. */
  #abandon(): void {
    if (this.#pointer !== undefined) this.#press.abort();
    this.#pointer = undefined;
  }

  /**
   * Takes `work` after the events before it, for the press `signal` belongs to,
   * or for none. Work its press gave up is dropped quietly, before it starts or
   * while it waits, since what it served is gone. Work that failed otherwise is
   * recorded, and the press it belonged to is abandoned, so the events after it
   * are still taken.
   */
  #enqueue(signal: AbortSignal | undefined, work: () => Promise<void>): void {
    this.#busy = this.#busy
      .then(async () => {
        if (signal?.aborted !== true) await work();
      })
      .catch((error: unknown) => {
        if (signal?.aborted === true) return;
        this.#interaction = IDLE;
        this.#host.show(undefined, undefined);
        this.#host.fault(error);
      });
  }

  #exclusions(): SnapExclusions {
    const interaction = this.#interaction;
    if (interaction.kind === 'idle') return {};
    if (interaction.hit.kind === 'marker') return { marker: interaction.hit.id };
    if (interaction.hit.kind === 'region-edge') return { region: interaction.hit.id };
    return interaction.hit.kind === 'selection-edge' ? { selectionEdges: true } : {};
  }

  /** The tool input at `sample`: its boundary snapped as the view says, and the target it took. */
  async #input(
    snapshot: PointerSnapshot,
    sample: PointerSample,
    modifiers: Modifiers,
    exclusions: SnapExclusions,
    signal: AbortSignal,
  ): Promise<ToolInput & { readonly snap: SnapTarget | undefined }> {
    const { state, asset } = snapshot.sources;
    const raw = boundaryAt(state.viewport, sample.x, asset.length);
    const { snapping } = state;
    let crossing: SampleCount | undefined;
    if (snapping.enabled && snapping.kinds.has(SnapKind.ZeroCrossing)) {
      crossing = boundary(
        await this.#host.zeroCrossing(
          raw,
          samplesWithin(state.viewport, snapping.tolerance),
          shownChannels(state, asset),
          signal,
        ),
      );
    }
    const result = snapInView(
      raw,
      snapTargetsFor(snapshot.sources, crossing, exclusions),
      snapping,
      state.viewport,
    );
    return {
      x: sample.x,
      y: sample.y,
      pointer: sample.kind,
      boundary: result.position,
      channel: laneAt(snapshot.layout, sample.y)?.channel,
      shift: modifiers.shift,
      alt: modifiers.alt,
      strength: toolStrength(sample, this.#host.gestures()),
      snap: result.target,
    };
  }

  #apply(step: ToolStep, snap: SnapTarget | undefined): void {
    this.#interaction = step.interaction;
    this.#host.show(step.preview, step.preview === undefined ? undefined : snap);
    for (const intent of step.intents) {
      for (const command of commandsOf(intent, this.#host.panel)) this.#host.run(command);
    }
  }
}
