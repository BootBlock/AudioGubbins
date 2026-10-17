/**
 * The compressor's controls: its transfer curve drawn from its settings
 * (`compressor-curve.ts`) above the controls of every one of its parameters.
 */

import { useCallback, type ReactNode } from 'react';

import { ParameterControls, type PresentationProps } from '../parameter-controls.js';
import { CurveCanvas, type CurveDrawing } from './curve-canvas.js';
import { drawCompressor } from './compressor-curve.js';

/** The compressor's controls (see the module comment). */
export function CompressorControls({ descriptor, parts }: PresentationProps): ReactNode {
  const { values } = parts.processor;
  const draw = useCallback(
    (drawing: CurveDrawing) => {
      drawCompressor(drawing, values);
    },
    [values],
  );
  return (
    <>
      <div className="ag-processor-display">
        <CurveCanvas
          className="ag-processor-curve"
          label="The compressor’s transfer curve, drawn from its settings"
          draw={draw}
        />
      </div>
      <ParameterControls parameters={descriptor.parameters} parts={parts} />
    </>
  );
}
