/**
 * A canvas a processor's curve is drawn on: an equaliser's response, a
 * compressor's transfer. It is a presentation of the processor's own
 * settings, drawn again whenever they, the theme or its own size change, at
 * the screen's pixel density, in the colours and type the theme resolves
 * (REQ-UX-155, ADR-0012), so a change of theme, accent, brightness or
 * contrast reaches it as it reaches every other surface.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import {
  oklchToHex,
  oklchToSrgb,
  useTheme,
  type Oklch,
  type Theme,
} from '@audiogubbins/design-system';

/** What a curve is drawn with. */
export interface CurveDrawing {
  readonly context: CanvasRenderingContext2D;
  /** The canvas's size in CSS pixels, which the context is scaled to. */
  readonly width: number;
  readonly height: number;
  readonly theme: Theme;
}

/**
 * A theme colour as a canvas takes it, at its own alpha or `alpha`: the
 * design system's sRGB form of it, with its alpha as a fourth pair of digits.
 */
export function canvasColour(colour: Oklch, alpha?: number): string {
  const opacity = Math.round(Math.min(1, Math.max(0, alpha ?? oklchToSrgb(colour).alpha)) * 255);
  return `${oklchToHex(colour)}${opacity.toString(16).padStart(2, '0')}`;
}

/** The type a curve's scale is printed in: the numeric family at the scale's size. */
export function scaleFont(theme: Theme): string {
  return `${String(theme.typeface.weight.medium)} ${String(theme.metrics.text.scale)}px ${theme.typeface.family.numeric}`;
}

/**
 * A canvas drawn by `draw`, named `label` as the picture it is. `draw` is
 * called again whenever it changes, so a caller makes it from the settings it
 * draws and nothing else.
 */
export function CurveCanvas({
  label,
  draw,
  className,
}: {
  readonly label: string;
  readonly draw: (drawing: CurveDrawing) => void;
  readonly className: string;
}): ReactNode {
  const canvas = useRef<HTMLCanvasElement>(null);
  const theme = useTheme();
  // Its laid-out size in CSS pixels, followed as the panel is resized.
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = canvas.current;
    if (element === null) return undefined;
    const measure = (): void => {
      const { width, height } = element.getBoundingClientRect();
      setSize((was) => (was.width === width && was.height === height ? was : { width, height }));
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(element);
    return () => {
      watch.disconnect();
    };
  }, []);
  useEffect(() => {
    const element = canvas.current;
    const { width, height } = size;
    if (element === null || width === 0 || height === 0) return;
    const ratio = window.devicePixelRatio;
    element.width = Math.round(width * ratio);
    element.height = Math.round(height * ratio);
    const context = element.getContext('2d');
    // A canvas the browser cannot draw on shows nothing; the settings it
    // would draw are the controls beside it.
    if (context === null) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    draw({ context, width, height, theme });
  }, [size, theme, draw]);
  return <canvas ref={canvas} className={className} role="img" aria-label={label} />;
}
