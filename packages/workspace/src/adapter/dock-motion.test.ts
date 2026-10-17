import { describe, expect, it, vi } from 'vitest';

import {
  DockChange,
  DockMotionLevel,
  forgetNames,
  nameArriving,
  nameDeparting,
  watchDrops,
  type DockMotion,
  type DrawnDockGroup,
  type MutationSource,
} from './dock-motion.js';

/**
 * What the dock names for a view transition and how it settles a drop.
 *
 * The browser does the morph; what it morphs is decided here, by the names: a
 * group that took the wrong name would fly from another group's place, and
 * one that kept a name in a workspace switch would leave the workspace's own
 * fade. The drop's settling is read from the animations each group is given.
 */

/** A box a group is drawn in. */
interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A group drawn at a box, holding panels, with its animations recorded. */
interface TestGroup extends DrawnDockGroup {
  readonly animate: ReturnType<typeof vi.fn>;

  /** Draws it somewhere else, as the engine's drop does. */
  readonly moveTo: (box: Box) => void;
}

function group(
  panels: readonly string[],
  box: Box = { x: 0, y: 0, width: 100, height: 100 },
  activePanel: string | undefined = panels[0],
): TestGroup {
  const element = document.createElement('div');
  let drawn = box;
  const animate = vi.fn(() => ({}) as Animation);
  element.getBoundingClientRect = () => DOMRectReadOnly.fromRect(drawn);
  element.animate = animate;
  return {
    element,
    panels,
    activePanel,
    animate,
    moveTo: (next) => {
      drawn = next;
    },
  };
}

const nameOf = (drawn: DrawnDockGroup): string => drawn.element.style.viewTransitionName;

const MOTION: DockMotion = {
  level: DockMotionLevel.Full,
  move: { duration: 240, easing: 'ease-in-out' },
  enter: { duration: 240, easing: 'ease-out' },
  enterScale: 0.98,
};

describe('naming the groups of a rebuilt dock', () => {
  it('names every group leaving a change of arrangement, under each of its panels', () => {
    const left = group(['assets']);
    const right = group(['inspector', 'history']);

    const departed = nameDeparting([left, right], DockChange.Arrangement, new Set());

    expect([nameOf(left), nameOf(right)]).toEqual(['ag-dock-group-0', 'ag-dock-group-1']);
    expect(departed.get('history')).toBe('ag-dock-group-1');
  });

  it('names only a group the next workspace shares a panel with, in a workspace switch', () => {
    // An unnamed group stays in the dock's own picture, which fades and
    // settles back as one; named, it would leave on its own.
    const shared = group(['editor']);
    const own = group(['rack']);

    nameDeparting([shared, own], DockChange.Workspace, new Set(['editor', 'spectral']));

    expect(nameOf(shared)).not.toBe('');
    expect(nameOf(own)).toBe('');
  });

  it('gives an arriving group the name its panel in front left under, before any other', () => {
    // The Diagnostics panel joined the Transport's group: that group keeps the
    // Transport's name, so it morphs in place rather than flying in from where
    // Diagnostics was.
    const departed = new Map([
      ['transport', 'ag-dock-group-2'],
      ['diagnostics', 'ag-dock-group-5'],
    ]);
    const joined = group(['diagnostics', 'transport'], undefined, 'transport');

    nameArriving([joined], DockChange.Arrangement, departed);

    expect(nameOf(joined)).toBe('ag-dock-group-2');
  });

  it('never gives two arriving groups one name, and names a new group of its own', () => {
    // A group split in two: the second half cannot morph from the same box as
    // the first, since a name drawn twice aborts the whole transition.
    const departed = new Map([
      ['a', 'ag-dock-group-0'],
      ['b', 'ag-dock-group-0'],
    ]);
    const first = group(['a']);
    const second = group(['b']);
    const fresh = group(['c']);

    nameArriving([first, second, fresh], DockChange.Arrangement, departed);

    expect(nameOf(first)).toBe('ag-dock-group-0');
    expect(new Set([nameOf(first), nameOf(second), nameOf(fresh)]).size).toBe(3);
    expect(nameOf(second)).not.toBe('');
  });

  it('leaves a group no panel of the last workspace is in unnamed, in a workspace switch', () => {
    const arriving = group(['spectral']);

    nameArriving([arriving], DockChange.Workspace, new Map([['editor', 'ag-dock-group-0']]));

    expect(nameOf(arriving)).toBe('');
  });

  it('takes the names off again', () => {
    const named = group(['assets']);
    nameDeparting([named], DockChange.Arrangement, new Set());

    forgetNames([named]);

    expect(nameOf(named)).toBe('');
  });
});

/** An engine whose structural changes a test makes, around a drop it describes. */
function engineOf(groups: () => readonly DrawnDockGroup[], motion: DockMotion) {
  const will = new Set<(event: { readonly origin: string }) => void>();
  const did = new Set<(event: { readonly origin: string }) => void>();
  const source: MutationSource = {
    onWillMutateLayout: (listener) => {
      will.add(listener);
      return { dispose: () => will.delete(listener) };
    },
    onDidMutateLayout: (listener) => {
      did.add(listener);
      return { dispose: () => did.delete(listener) };
    },
  };
  const watching = watchDrops(source, groups, () => motion);
  return {
    /** A drop the user makes: whatever `move` does happens between the engine's two events. */
    drop: (move: () => void, origin = 'user'): void => {
      for (const listener of will) listener({ origin });
      move();
      for (const listener of did) listener({ origin });
    },
    stop: watching.stop,
  };
}

describe('settling a drop', () => {
  it('moves a moved group from its old box to its new one at the full level', () => {
    const moved = group(['inspector'], { x: 300, y: 0, width: 200, height: 400 });
    const engine = engineOf(() => [moved], MOTION);

    engine.drop(() => {
      moved.moveTo({ x: 100, y: 0, width: 400, height: 400 });
    });

    expect(moved.animate).toHaveBeenCalledWith(
      [
        { transformOrigin: '0 0', transform: 'translate(200px, 0px) scale(0.5, 1)' },
        { transformOrigin: '0 0', transform: 'none' },
      ],
      { duration: 240, easing: 'ease-in-out' },
    );
  });

  it('grows in a group the drop made, and leaves a group that did not move alone', () => {
    const still = group(['assets']);
    const made = group(['inspector'], { x: 200, y: 0, width: 100, height: 100 });
    let drawn: readonly DrawnDockGroup[] = [still];
    const engine = engineOf(() => drawn, MOTION);

    engine.drop(() => {
      drawn = [still, made];
    });

    expect(still.animate).not.toHaveBeenCalled();
    expect(made.animate).toHaveBeenCalledWith(
      [
        { opacity: 0, transform: 'scale(0.98)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 240, easing: 'ease-out' },
    );
  });

  it('only fades a moved group in place at the reduced level', () => {
    const moved = group(['inspector']);
    const engine = engineOf(() => [moved], { ...MOTION, level: DockMotionLevel.Reduced });

    engine.drop(() => {
      moved.moveTo({ x: 50, y: 0, width: 100, height: 100 });
    });

    expect(moved.animate).toHaveBeenCalledWith([{ opacity: 0.4 }, { opacity: 1 }], {
      duration: 240,
      easing: 'ease-in-out',
    });
  });

  it('moves nothing when the motion level is off', () => {
    const moved = group(['inspector']);
    const engine = engineOf(() => [moved], { ...MOTION, level: DockMotionLevel.Off });

    engine.drop(() => {
      moved.moveTo({ x: 50, y: 0, width: 100, height: 100 });
    });

    expect(moved.animate).not.toHaveBeenCalled();
  });

  it('settles nothing the engine rearranged on its own, nor anything once stopped', () => {
    // The engine brackets the changes the adapter makes as it builds the dock
    // as well; those are the stage's transition to draw, and easing them here
    // too would move each group twice.
    const moved = group(['inspector']);
    const engine = engineOf(() => [moved], MOTION);

    engine.drop(() => {
      moved.moveTo({ x: 50, y: 0, width: 100, height: 100 });
    }, 'api');
    engine.stop();
    engine.drop(() => {
      moved.moveTo({ x: 0, y: 0, width: 100, height: 100 });
    });

    expect(moved.animate).not.toHaveBeenCalled();
  });
});
