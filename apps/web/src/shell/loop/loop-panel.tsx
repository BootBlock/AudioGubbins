/**
 * The Loop panel (ADR-0103, the plan's section 11): the loop of the region the
 * editor in use acts on, the one it shows or the one selected there, as the
 * Inspector finds it; its checks with their verdicts in words, values,
 * thresholds and the audio each compared the seam with; the seam as heard; the
 * candidate loop points a search found, with the micro-crossfades suggested for
 * them; and hearing the loop cycle, its seam stress-tested, or a candidate's.
 *
 * It reads the stores and runs commands; it writes nothing itself (`CLAUDE.md`
 * G2). Nothing is applied by being shown: a candidate becomes the region's loop
 * only by Apply, which runs the region's loop command, one step of the history.
 * An analysis made before the region's sound changed is shown as of the sound
 * it was made of, and offers nothing to hear or apply until it is made again.
 */

import { useSyncExternalStore, type ReactNode } from 'react';

import { EmptyState, Hint, PanelHeader } from '@audiogubbins/design-system';
import { LOOP_ANALYSIS_VERSION } from '@audiogubbins/loop-analysis';
import { formatPosition } from '@audiogubbins/timeline';
import { quoted } from '@audiogubbins/text';

import { regionLoopOf, type RegionLoop } from '../../analysis/loop-analysing.js';
import { channelNames } from '../../assets/channel-names.js';
import { regionEntryId } from '../../assets/project-entry.js';
import type { Auditioning } from '../../audio/loop-audition.js';
import type { EditorPanelParts } from '../../editor/panel-parts.js';
import { LOOP_PANEL } from '../../input/use-shortcuts.js';
import type { AssetCatalogue } from '../../state/asset-catalogue.js';
import { isCurrent, type LoopAnalyses } from '../../state/loop-analysis-store.js';
import type { Observable } from '../../state/observable.js';
import type { OpenProjectState } from '../../state/open-project-store.js';
import type { PanelCommands } from '../command-button.js';
import { inspected } from '../inspector/inspected.js';
import { HeardSide, SearchSide, type Analysed, type Shown } from './loop-sides.js';

/** What the Loop panel reads. */
export interface LoopParts {
  readonly editorViews: EditorPanelParts['stores']['editorViews'];
  readonly selections: EditorPanelParts['stores']['selections'];
  readonly assets: Pick<AssetCatalogue, 'get' | 'subscribe' | 'find'>;
  /** The open project, absent where this browser keeps none. */
  readonly project: Observable<OpenProjectState> | undefined;
  readonly analyses: Observable<LoopAnalyses>;
  readonly audition: Observable<Auditioning | undefined>;
}

/** A store that never changes, standing in for the project where this browser keeps none. */
const NO_PROJECT = { get: () => undefined, subscribe: () => () => undefined };

/** Reads the region the editor in use acts on, and its loop as heard now; or why there is none. */
function useShown(parts: LoopParts): Shown | string {
  const { editorViews, selections, assets } = parts;
  const views = useSyncExternalStore(editorViews.subscribe, editorViews.get);
  const catalogue = useSyncExternalStore(assets.subscribe, assets.get);
  useSyncExternalStore(selections.subscribe, selections.get);
  const open = useSyncExternalStore(
    parts.project?.subscribe ?? NO_PROJECT.subscribe,
    parts.project?.get ?? NO_PROJECT.get,
  );
  const panel = views.focused;
  const entry = panel === undefined ? undefined : editorViews.entry(panel);
  const asset = entry === undefined ? undefined : assets.find(entry.asset);
  const state = open?.kind === 'open' ? open.snapshot.model.state : undefined;
  const subject =
    panel === undefined || entry === undefined || asset === undefined
      ? undefined
      : inspected({ panel, asset, state: entry.state }, selections.of(asset.id), state);
  const region = subject?.kind === 'project' ? subject.region?.region : undefined;
  const sound = region === undefined ? undefined : assets.find(regionEntryId(region.id));
  // Made again only when the region's sound or the project changes, by the
  // compiler's memoising.
  const looped =
    sound === undefined || state === undefined ? undefined : regionLoopOf(sound, state);
  if (panel === undefined || entry === undefined || region === undefined) {
    return 'Select a region, or open one in a view of its own, to analyse its loop here.';
  }
  if (sound === undefined || looped === undefined) {
    return (
      catalogue.unopened.get(regionEntryId(region.id))?.reason ??
      `${quoted(region.displayName)} cannot be heard yet.`
    );
  }
  return {
    panel,
    name: region.displayName,
    looped,
    region: region.id,
    position: (frames) => formatPosition(frames, sound.sampleRate, entry.state.timeFormat),
    channels: channelNames(sound.layout),
  };
}

/** The region's loop: how it sounds and is judged, beside the search near it. */
function RegionLoopView({
  shown,
  looped,
  parts,
  commands,
}: {
  readonly shown: Shown;
  readonly looped: RegionLoop;
  readonly parts: LoopParts;
  readonly commands: PanelCommands;
}): ReactNode {
  const analyses = useSyncExternalStore(parts.analyses.subscribe, parts.analyses.get);
  const audition = useSyncExternalStore(parts.audition.subscribe, parts.audition.get);
  const record = analyses.get(shown.region);
  const analysed: Analysed = {
    record,
    current: record?.kind === 'done' && isCurrent(record, looped.identity, LOOP_ANALYSIS_VERSION),
  };
  return (
    <div className="ag-loop-split">
      <HeardSide
        shown={shown}
        looped={looped}
        analysed={analysed}
        audition={audition}
        commands={commands}
      />
      <SearchSide shown={shown} analysed={analysed} commands={commands} />
    </div>
  );
}

/** The Loop panel. */
export function LoopPanel({
  title,
  parts,
  commands,
}: {
  readonly title: string;
  readonly parts: LoopParts;
  readonly commands: PanelCommands;
}): ReactNode {
  const shown = useShown(parts);
  return (
    <section className="ag-panel ag-stacked-panel ag-loop" {...{ [LOOP_PANEL]: '' }}>
      <PanelHeader
        title={title}
        icon="loop"
        {...(typeof shown === 'string' ? {} : { subLabel: shown.name })}
        actions={
          <Hint label="About the loop’s checks">
            The checks measure the seam as it is heard. Nothing changes until you apply a candidate,
            which one undo reverses.
          </Hint>
        }
      />
      {typeof shown === 'string' ? (
        <EmptyState icon="loop" title="No loop to analyse" text={shown} />
      ) : typeof shown.looped === 'string' ? (
        <EmptyState icon="loop" title="No loop to analyse" text={shown.looped} />
      ) : (
        <RegionLoopView shown={shown} looped={shown.looped} parts={parts} commands={commands} />
      )}
    </section>
  );
}
