/**
 * What the dials' and meters' tests share: a render inside a theme and the
 * hints, as the application draws every control, and a clock the test holds,
 * so a meter's ballistics run frame by frame at times the test chooses rather
 * than on the machine's timers.
 */

import { render, type RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';

import { HintProvider } from '../primitives/overlays.js';
import { ThemeProvider, fixedSystemAppearance } from '../theme/theme-provider.js';
import {
  DEFAULT_THEME_PREFERENCES,
  MotionLevel,
  UNKNOWN_SYSTEM_APPEARANCE,
} from '../tokens/preferences.js';
import type { FrameClock } from '../primitives/dials/frame-clock.js';

/**
 * Renders `ui` inside a theme at `motion` and the hints, which stay round it
 * when the test renders it again with new props.
 */
export function renderThemed(ui: ReactNode, motion: MotionLevel = MotionLevel.Full): RenderResult {
  const preferences = { ...DEFAULT_THEME_PREFERENCES, motion };
  const system = fixedSystemAppearance(UNKNOWN_SYSTEM_APPEARANCE);
  return render(ui, {
    wrapper: ({ children }: { readonly children: ReactNode }) => (
      <ThemeProvider preferences={preferences} system={system}>
        <HintProvider>{children}</HintProvider>
      </ThemeProvider>
    ),
  });
}

/** A clock that stands still until the test moves it. */
export interface HeldClock {
  readonly clock: FrameClock;

  /** Moves the time on by `milliseconds` and draws the frames that were waiting. */
  readonly advance: (milliseconds: number) => void;

  /** How many frames are waiting to be drawn. */
  readonly waiting: () => number;
}

/** A clock at time 0 whose frames are drawn only when the test moves it. */
export function heldClock(): HeldClock {
  let time = 0;
  let next = 1;
  const frames = new Map<number, () => void>();
  return {
    clock: {
      now: () => time,
      requestFrame: (draw) => {
        const handle = next;
        next += 1;
        frames.set(handle, draw);
        return handle;
      },
      cancelFrame: (handle) => {
        frames.delete(handle);
      },
    },
    advance: (milliseconds) => {
      time += milliseconds;
      const due = [...frames.values()];
      frames.clear();
      for (const draw of due) draw();
    },
    waiting: () => frames.size,
  };
}
