import { describe, expect, it } from 'vitest';

import { unsafeBrandId, type BusId, type TrackId } from '../identity/branded-id.js';
import { StandardLayouts } from '../audio/channel-layout.js';
import {
  MAIN_OUTPUT,
  type Bus,
  type Track,
  isTrackAudible,
  routeToBus,
  routingPathToOutput,
} from './routing.js';

function trackId(name: string): TrackId {
  return unsafeBrandId<'TrackId'>(`aaaaaaaa-${name}`);
}

function busId(name: string): BusId {
  return unsafeBrandId<'BusId'>(`bbbbbbbb-${name}`);
}

function makeTrack(id: string, overrides: Partial<Track> = {}): Track {
  return {
    id: trackId(id),
    displayName: id,
    channelLayout: StandardLayouts.stereo,
    gain: 1,
    pan: 0,
    muted: false,
    soloed: false,
    output: MAIN_OUTPUT,
    ...overrides,
  };
}

function makeBus(id: string, output?: Bus['output']): Bus {
  return {
    id: busId(id),
    displayName: id,
    channelLayout: StandardLayouts.stereo,
    gain: 1,
    muted: false,
    ...(output === undefined ? {} : { output }),
  };
}

describe('isTrackAudible', () => {
  it('hears an ordinary track when nothing is soloed', () => {
    const subject = makeTrack('aaaaaaaa');
    expect(isTrackAudible(subject, [subject, makeTrack('bbbbbbbb')])).toBe(true);
  });

  it('silences a muted track', () => {
    const muted = makeTrack('aaaaaaaa', { muted: true });
    expect(isTrackAudible(muted, [muted])).toBe(false);
  });

  it('silences every track that is not soloed once any track is soloed', () => {
    const soloed = makeTrack('aaaaaaaa', { soloed: true });
    const ordinary = makeTrack('bbbbbbbb');
    const tracks = [soloed, ordinary];
    expect(isTrackAudible(soloed, tracks)).toBe(true);
    expect(isTrackAudible(ordinary, tracks)).toBe(false);
  });

  it('keeps mute winning over solo on the same track', () => {
    const both = makeTrack('aaaaaaaa', { soloed: true, muted: true });
    expect(isTrackAudible(both, [both])).toBe(false);
  });

  it('hears every soloed track when several are soloed', () => {
    const first = makeTrack('aaaaaaaa', { soloed: true });
    const second = makeTrack('bbbbbbbb', { soloed: true });
    const third = makeTrack('cccccccc');
    const tracks = [first, second, third];
    expect(isTrackAudible(first, tracks)).toBe(true);
    expect(isTrackAudible(second, tracks)).toBe(true);
    expect(isTrackAudible(third, tracks)).toBe(false);
  });
});

describe('routingPathToOutput', () => {
  it('reports an empty path for something already at the main output', () => {
    expect(routingPathToOutput(MAIN_OUTPUT, new Map())).toEqual([]);
  });

  it('follows a single bus to the main output', () => {
    const reverb = makeBus('aaaaaaaa');
    const buses = new Map([[reverb.id, reverb]]);
    expect(routingPathToOutput(routeToBus(reverb.id), buses)).toEqual([reverb.id]);
  });

  it('follows a chain of buses in order', () => {
    const master = makeBus('cccccccc');
    const group = makeBus('bbbbbbbb', routeToBus(master.id));
    const send = makeBus('aaaaaaaa', routeToBus(group.id));
    const buses = new Map([
      [master.id, master],
      [group.id, group],
      [send.id, send],
    ]);
    expect(routingPathToOutput(routeToBus(send.id), buses)).toEqual([send.id, group.id, master.id]);
  });

  it('reports a cycle rather than following it forever', () => {
    const first = makeBus('aaaaaaaa', routeToBus(busId('bbbbbbbb')));
    const second = makeBus('bbbbbbbb', routeToBus(busId('aaaaaaaa')));
    const buses = new Map([
      [first.id, first],
      [second.id, second],
    ]);
    expect(routingPathToOutput(routeToBus(first.id), buses)).toBeUndefined();
  });

  it('reports a bus that routes to itself as a cycle', () => {
    const self = makeBus('aaaaaaaa', routeToBus(busId('aaaaaaaa')));
    expect(routingPathToOutput(routeToBus(self.id), new Map([[self.id, self]]))).toBeUndefined();
  });

  it('reports routing to a bus the project does not hold', () => {
    expect(routingPathToOutput(routeToBus(busId('aaaaaaaa')), new Map())).toBeUndefined();
  });
});
