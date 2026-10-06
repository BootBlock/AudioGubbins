import { describe, expect, it } from 'vitest';

import { MAXIMUM_QUALITY, instantiateProcessor, unsafeBrandId } from '@audiogubbins/domain';

import { PROCESSOR_TYPES_BY_KEY } from '../catalogue.js';
import { processorNodeSettings, readProcessorNode } from './processor-node.js';

const GAIN = PROCESSOR_TYPES_BY_KEY.get('gain');
if (GAIN === undefined) throw new Error('The catalogue has a gain.');
const { descriptor } = GAIN;
const instance = instantiateProcessor(unsafeBrandId<'ProcessorId'>('0000beef-0000'), descriptor);
const quality = MAXIMUM_QUALITY.settings;

describe("a processor node's start", () => {
  it('is read back as the frame of the stream its run starts at', () => {
    const settings = processorNodeSettings(instance, descriptor, quality, 4_800);
    expect(readProcessorNode(descriptor, settings, quality).reading?.start).toBe(4_800);
  });

  it('is never taken as frame 0 where a node does not state one, or states no frame', () => {
    // A default would hide a part-way start behind a run from the first frame.
    const { start: _, ...unstated } = processorNodeSettings(instance, descriptor, quality, 0);
    for (const settings of [unstated, { ...unstated, start: -1 }, { ...unstated, start: 0.5 }]) {
      expect(readProcessorNode(descriptor, settings, quality).problems).toEqual([
        'it does not say at which frame of its stream its run starts',
      ]);
    }
  });
});
