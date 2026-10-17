/**
 * How playback runs, in the Transport panel: the mode it runs in, with its
 * reason (REQ-ARCH-079), and where what plays cannot run live, the cached
 * preview it reads, with how far it has been made (ADR-0061).
 *
 * As the approved Transport draws it, each is a row of the panel's grid, a
 * chip with its reason behind a hint, the preview's with its bar.
 *
 * It reads the settings and the preview renders, and changes neither.
 */

import { useSyncExternalStore, type ReactNode } from 'react';

import {
  Hint,
  ProgressBar,
  ProgressPlace,
  PropertyGrid,
  StatusChip,
  StatusTone,
  type IconName,
  type PropertyRow,
} from '@audiogubbins/design-system';
import {
  CachePurpose,
  ProcessingMode,
  ProcessingPurpose,
  RenderPhase,
  selectProcessingMode,
  type ProcessingModeChoice,
  type RenderReport,
} from '@audiogubbins/audio-engine';
import type { PreviewRenders } from '@audiogubbins/audio-runtime';

import type { AudioSettings } from '../state/audio-settings-store.js';
import type { AudioView } from '../state/audio-view-store.js';
import type { Observable } from '../state/observable.js';
import { MODE_NAMES } from './processing-modes.js';

/**
 * Why playback that can run live does not move to a cached preview when it
 * cannot keep up: nothing measures what live processing costs yet, so the
 * choice never claims a move it will not make. Processing that cannot run
 * live at all plays from a cached preview, which says so instead.
 */
const LIVE_PLAYBACK_UNAVAILABLE: ReadonlyMap<ProcessingMode, string> = new Map([
  [
    ProcessingMode.CachedPreview,
    'nothing measures what live processing costs yet, so processing that can run live plays live.',
  ],
]);

/** How each mode's chip is toned: live processing is what playback is for, a preview the fallback. */
const MODE_TONES: Readonly<Record<ProcessingMode, StatusTone>> = {
  [ProcessingMode.RealTime]: StatusTone.Success,
  [ProcessingMode.CachedPreview]: StatusTone.Accent,
  [ProcessingMode.BackgroundOffline]: StatusTone.Neutral,
  [ProcessingMode.FinalOffline]: StatusTone.Neutral,
};

/** The glyph each mode's chip leads with, where the vocabulary has one that says it. */
const MODE_GLYPHS: Readonly<Partial<Record<ProcessingMode, IconName>>> = {
  [ProcessingMode.RealTime]: 'real-time',
};

/** What a cached preview's chip says, and its tone, by how far it has been made. */
const PREVIEW_STATES: Readonly<
  Record<RenderPhase, { readonly words: string; readonly tone: StatusTone }>
> = {
  [RenderPhase.Queued]: { words: 'Waiting', tone: StatusTone.Neutral },
  [RenderPhase.Making]: { words: 'Making', tone: StatusTone.Accent },
  [RenderPhase.Made]: { words: 'Cached', tone: StatusTone.Accent },
  [RenderPhase.Failed]: { words: 'Not made', tone: StatusTone.Error },
};

/** The render playback reads now, where it reads one: the render a playback reader holds. */
function playbackRender(previews: PreviewRenders): RenderReport | undefined {
  return previews.renders.find((render) => render.purposes.includes(CachePurpose.Playback));
}

/** How far a cached preview has been made, as a sentence. */
function previewProgressText(render: RenderReport): string {
  switch (render.phase) {
    case RenderPhase.Queued:
      return 'It is waiting for another preview to be made first.';
    case RenderPhase.Making:
      return render.reached === 0
        ? 'It is being made: anything that measures the whole sound measures it first.'
        : `It is being made: ${String(Math.floor((render.reached / Math.max(1, render.length)) * 100))}% so far.`;
    case RenderPhase.Made:
      return 'It is made, and plays from memory.';
    case RenderPhase.Failed:
      return `It could not be made: ${render.failure ?? 'no reason was given.'}`;
  }
}

/**
 * The mode playback runs in: from a cached preview where what plays cannot
 * run live, and live otherwise, where nothing measures its cost yet, so the
 * choice says so rather than inventing one.
 */
function playbackChoice(
  settings: AudioSettings,
  render: RenderReport | undefined,
): ProcessingModeChoice | undefined {
  const chosen = selectProcessingMode({
    purpose: ProcessingPurpose.Monitor,
    settings: settings.chosen.settings,
    ...(render?.reason === undefined
      ? { unavailable: LIVE_PLAYBACK_UNAVAILABLE }
      : { cannotRunLive: render.reason }),
  });
  return chosen.ok ? chosen.value : undefined;
}

/** A mode as its chip, and why it was chosen behind the hint beside it. */
function ModeChip({
  choice,
  about,
}: {
  readonly choice: ProcessingModeChoice | undefined;
  /** What the hint explains, its accessible name. */
  readonly about: string;
}): ReactNode {
  if (choice === undefined) return 'Not known';
  const glyph = MODE_GLYPHS[choice.mode];
  return (
    <span className="ag-mode-value">
      <StatusChip tone={MODE_TONES[choice.mode]} {...(glyph === undefined ? {} : { icon: glyph })}>
        {MODE_NAMES[choice.mode]}
      </StatusChip>
      <Hint label={about}>{choice.reason}</Hint>
    </span>
  );
}

/**
 * The cached preview playback reads: how far it has been made as a chip and a
 * bar, with the sentence saying so behind its hint.
 */
function PreviewState({ render }: { readonly render: RenderReport }): ReactNode {
  const { words, tone } = PREVIEW_STATES[render.phase];
  return (
    <span className="ag-mode-value">
      <StatusChip tone={tone}>{words}</StatusChip>
      <ProgressBar
        label="Cached preview made"
        value={render.reached / Math.max(1, render.length)}
        place={ProgressPlace.Row}
      />
      <Hint label="About the cached preview">{previewProgressText(render)}</Hint>
    </span>
  );
}

/** How far the cached preview is being made, said in tenths rather than at every block. */
function PreviewStatus({ render }: { readonly render: RenderReport }): ReactNode {
  const tenths = Math.floor((render.reached / Math.max(1, render.length)) * 10) * 10;
  return (
    <p role="status" className="ag-panel-note">
      {render.phase === RenderPhase.Making ? `Making the preview: ${String(tenths)}%` : ''}
    </p>
  );
}

/**
 * How playback runs, as rows of the panel's grid: its mode as a chip with why
 * behind a hint, and the cached preview it reads, where it reads one.
 */
export function PlaybackModes({
  audio,
  settings: store,
}: {
  /** The engine's view, whose cached preview renders playback may be reading. */
  readonly audio: Observable<AudioView>;
  readonly settings: Observable<AudioSettings>;
}): ReactNode {
  const settings = useSyncExternalStore(store.subscribe, store.get);
  const { previews } = useSyncExternalStore(audio.subscribe, audio.get);
  const cached = playbackRender(previews);
  const rows: PropertyRow[] = [
    {
      id: 'playback',
      label: 'Playback',
      value: <ModeChip choice={playbackChoice(settings, cached)} about="Why playback runs so" />,
    },
  ];
  if (cached !== undefined) {
    rows.push({ id: 'preview', label: 'Preview', value: <PreviewState render={cached} /> });
  }
  return (
    <>
      <PropertyGrid rows={rows} />
      {cached !== undefined && <PreviewStatus render={cached} />}
    </>
  );
}
