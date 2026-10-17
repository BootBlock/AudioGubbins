/**
 * The motion level the theme resolves, as the dock follows it (REQ-UX-222).
 *
 * The design system resolves the level, the user's choice or else the
 * system's request for reduced motion, and the typed scale of its durations;
 * the workspace package names neither, so the shell hands the dock the level
 * and the timings in the dock's own terms.
 */

import { MotionLevel, type Theme } from '@audiogubbins/design-system';
import { DockMotionLevel, type DockMotion } from '@audiogubbins/workspace';

/** Each motion level, as the dock names it. */
const DOCK_LEVELS: Readonly<Record<MotionLevel, DockMotionLevel>> = {
  [MotionLevel.Full]: DockMotionLevel.Full,
  [MotionLevel.Reduced]: DockMotionLevel.Reduced,
  [MotionLevel.Minimal]: DockMotionLevel.Off,
};

/** How the dock moves under a theme. */
export function dockMotionOf(theme: Theme): DockMotion {
  const { motion } = theme;
  return {
    level: DOCK_LEVELS[theme.motionLevel],
    move: { duration: motion.moderate, easing: motion.easeInOut },
    enter: { duration: motion.moderate, easing: motion.easeOut },
    enterScale: motion.scale.dialogue,
  };
}
