/**
 * What the history and the undo menu call each edit: a short sentence naming
 * what was done and to which asset or region.
 */

import {
  planIsSilence,
  type EditOperation,
  type RangeEdit,
  type SpectralEdit,
} from '@audiogubbins/domain';
import { quoted } from '@audiogubbins/text';

/** The verb phrase of a range edit. */
function rangeEditWords(edit: RangeEdit): string {
  switch (edit.kind) {
    case 'gain':
      return 'Change the level of';
    case 'fade':
      return edit.direction === 'in' ? 'Fade in' : 'Fade out';
    case 'silence':
      return 'Silence';
    case 'invert':
      return 'Invert the polarity of';
    case 'swap-channels':
      return 'Swap two channels of';
    case 'copy-channel':
      return 'Copy a channel across';
    case 'channel-gains':
      return 'Balance the channels of';
    case 'rack':
      return 'Apply a chain of processors to';
    case 'punch':
      return 'Punch in on';
    case 'spectral':
      return spectralWords(edit);
  }
}

/** The verb phrase of a spectral edit, which acts on an area of time and frequency. */
function spectralWords(edit: SpectralEdit): string {
  switch (edit.operation.kind) {
    case 'attenuate':
      return edit.operation.gain === 0 ? 'Remove an area of' : 'Attenuate an area of';
    case 'isolate':
      return 'Isolate an area of';
    case 'heal':
      return 'Heal an area of';
    case 'process':
      return 'Clean up an area of';
  }
}

/** What an asset edit is called, on the asset or region named `name`. */
export function editDescription(operation: EditOperation, name: string): string {
  switch (operation.kind) {
    case 'delete':
      return `Delete part of ${quoted(name)}`;
    case 'trim':
      return `Trim ${quoted(name)}`;
    case 'insert':
      return planIsSilence(operation.payload)
        ? `Insert silence into ${quoted(name)}`
        : `Paste into ${quoted(name)}`;
    case 'reverse':
      return `Reverse part of ${quoted(name)}`;
    case 'convert-layout':
      return `Convert the channels of ${quoted(name)}`;
    case 'process':
      return `${rangeEditWords(operation.edit)} ${quoted(name)}`;
    case 'stretch':
      return `Stretch part of ${quoted(name)}`;
    case 'convert-rate':
      return `Convert the sample rate of ${quoted(name)}`;
  }
}

/** What a region's own processing is called. */
export function regionEditDescription(edit: RangeEdit, name: string): string {
  return `${rangeEditWords(edit)} region ${quoted(name)}`;
}
