/**
 * Where each open asset's playhead is parked: the boundary playback of the
 * asset starts from, and the one every view of it draws while it is not
 * playing (REQ-EDIT-012's playhead).
 *
 * One transport plays one asset at a time, so while an asset plays its views
 * draw the audible position instead, and setting the playhead moves playback
 * there; parked, the position is kept here, per asset, for the session.
 */

import { ZERO_SAMPLES, type SampleCount } from '@audiogubbins/domain';

import { observable, type Observable } from './observable.js';

/** Each asset's parked playhead that is not at its start, by asset identity. */
export type CueState = ReadonlyMap<string, SampleCount>;

/** The parked playheads. */
export interface CueStore extends Observable<CueState> {
  /** Where `asset`'s playhead is parked: its start until it is moved. */
  readonly of: (asset: string) => SampleCount;
  /** Parks `asset`'s playhead at `position`. */
  readonly park: (asset: string, position: SampleCount) => void;
}

/** Makes the store, every playhead at its asset's start. */
export function createCueStore(): CueStore {
  const state = observable<CueState>(new Map());
  const of = (asset: string): SampleCount => state.get().get(asset) ?? ZERO_SAMPLES;
  return {
    get: state.get,
    subscribe: state.subscribe,
    of,
    park: (asset, position) => {
      if (of(asset) === position) return;
      const next = new Map(state.get());
      next.set(asset, position);
      state.set(next);
    },
  };
}
