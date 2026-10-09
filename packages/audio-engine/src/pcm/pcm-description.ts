/**
 * Audio described for another thread to make its source from.
 *
 * A source object cannot cross a thread, so the thread that has the audio
 * describes it and the thread that reads it makes the source (ADR-0045): a
 * render worker and the feeder for a graph's inputs, the peak worker for a
 * waveform. Audio in memory crosses as its planar arrays, transferred rather
 * than copied, so a long clip is never held twice; generated audio crosses as
 * its signal recipe; an edited sound crosses as its plan with the files it
 * reads, which the receiving thread reads in ranges. No layout crosses with any
 * of them: the receiving thread knows the layout it reads in, and a description
 * whose channels do not fit it is refused when the source is made.
 *
 * One reader, {@link pcmDescriptionOf}, validates a description that crossed
 * a thread, whoever sent it, as a field of the message that carried it.
 */

import {
  MAXIMUM_CHANNEL_COUNT,
  Malformed,
  countOf,
  editPlanOf,
  fieldsOf,
  flatMapResult,
  identifierOf,
  itemsOf,
  oneOfValues,
  rateOf,
  sampleArraysOf,
  sampleCountOf,
  textOf,
  type ChannelLayout,
  type DomainResult,
  type EditPlan,
  type SampleRate,
} from '@audiogubbins/domain';

import type { CanonicalDsp } from '../dsp/canonical-dsp.js';
import type { PlanProcessing } from './processed-content.js';
import { editedSource } from './edited-source.js';
import type { MediaEntry } from './plan-content.js';
import { frameBlock } from './frame-block.js';
import { isMediaFile, type MediaFile } from './media-file.js';
import { memorySource } from './memory-source.js';
import type { PcmSource } from './pcm-source.js';
import { signalRecipeOf, type SignalRecipe } from './signal-recipe.js';
import { signalSource } from './signal-source.js';

/** How audio is described. */
export const PcmDescriptionKind = {
  /** Audio in memory: a decoded clip's planar samples. */
  Pcm: 'pcm',
  /** Generated audio, which the receiving thread makes from its recipe. */
  Signal: 'signal',
  /**
   * An edited sound: its plan, and the file behind each asset it reads, which
   * the receiving thread reads in ranges as it needs them (ADR-0052).
   */
  Edited: 'edited',
} as const;

export type PcmDescriptionKind = (typeof PcmDescriptionKind)[keyof typeof PcmDescriptionKind];

/** Audio, as it crosses to the thread that reads it. */
export type PcmDescription =
  | {
      readonly kind: typeof PcmDescriptionKind.Pcm;
      readonly sampleRate: SampleRate;
      /**
       * One array per channel, in the layout's order, all the same length.
       * Transferred: the sender's arrays are detached once posted.
       */
      readonly channels: readonly Float32Array[];
    }
  | {
      readonly kind: typeof PcmDescriptionKind.Signal;
      readonly sampleRate: SampleRate;
      readonly recipe: SignalRecipe;
    }
  | {
      readonly kind: typeof PcmDescriptionKind.Edited;
      readonly sampleRate: SampleRate;
      readonly plan: EditPlan;
      readonly media: readonly MediaEntry[];
    };

/** A description's channels: sample arrays, all of one length. */
function channelsOf(value: unknown, field: string): readonly Float32Array[] {
  const channels = sampleArraysOf(value, field);
  const [first] = channels;
  if (first !== undefined && channels.some((channel) => channel.length !== first.length)) {
    throw new Malformed(field, 'a list of sample arrays of one length');
  }
  return channels;
}

/** The file behind an asset, which crosses a thread as itself. */
function mediaFileOf(value: unknown, field: string): MediaFile {
  if (!isMediaFile(value)) throw new Malformed(field, 'a file whose ranges can be read');
  return value;
}

/** One asset an edited sound reads, named `field`, as it crossed a thread. */
function mediaEntryOf(value: unknown, field: string): MediaEntry {
  const fields = fieldsOf(value, field);
  const channels = countOf(fields['channels'], `${field}.channels`);
  if (channels < 1 || channels > MAXIMUM_CHANNEL_COUNT) {
    throw new Malformed(`${field}.channels`, `a count from 1 to ${String(MAXIMUM_CHANNEL_COUNT)}`);
  }
  return {
    asset: identifierOf<'AssetId'>(fields['asset'], `${field}.asset`),
    identity: textOf(fields['identity'], `${field}.identity`),
    sampleRate: rateOf(fields['sampleRate'], `${field}.sampleRate`),
    channels,
    length: sampleCountOf(fields['length'], `${field}.length`),
    file: mediaFileOf(fields['file'], `${field}.file`),
  };
}

/** The assets a plan reads, named `field`, each with the file behind it. */
export function mediaEntriesOf(value: unknown, field: string): readonly MediaEntry[] {
  return itemsOf(value, field, mediaEntryOf);
}

/** An edited description's plan, which must start at the description's rate. */
function planOf(value: unknown, field: string, rate: SampleRate): EditPlan {
  const plan = editPlanOf(value, field);
  if (plan.streams[0].sampleRate !== rate) {
    throw new Malformed(field, 'a plan at the description’s rate');
  }
  return plan;
}

/**
 * The description `value` holds, named `field`, read field by field by the
 * one reader of a message's fields; a field reader for a message that
 * carries one.
 */
export function pcmDescriptionOf(value: unknown, field: string): PcmDescription {
  const fields = fieldsOf(value, field);
  const sampleRate = rateOf(fields['sampleRate'], `${field}.sampleRate`);
  const kind = oneOfValues(fields['kind'], `${field}.kind`, PcmDescriptionKind);
  switch (kind) {
    case PcmDescriptionKind.Pcm:
      return { kind, sampleRate, channels: channelsOf(fields['channels'], `${field}.channels`) };
    case PcmDescriptionKind.Signal:
      return { kind, sampleRate, recipe: signalRecipeOf(fields['recipe'], `${field}.recipe`) };
    case PcmDescriptionKind.Edited:
      return {
        kind,
        sampleRate,
        plan: planOf(fields['plan'], `${field}.plan`, sampleRate),
        media: mediaEntriesOf(fields['media'], `${field}.media`),
      };
  }
}

/** The source of the described audio in `layout`, made with `dsp`, or why it cannot be made. */
export function describedSource(
  description: PcmDescription,
  layout: ChannelLayout,
  dsp: CanonicalDsp,
  processing: PlanProcessing,
): DomainResult<PcmSource> {
  switch (description.kind) {
    case PcmDescriptionKind.Pcm:
      return flatMapResult(
        frameBlock(layout, description.sampleRate, description.channels),
        memorySource,
      );
    case PcmDescriptionKind.Signal:
      return signalSource(dsp, {
        layout,
        sampleRate: description.sampleRate,
        recipe: description.recipe,
      });
    case PcmDescriptionKind.Edited:
      return editedSource(description.plan, description.media, layout, dsp, processing);
  }
}

/**
 * Each distinct buffer behind the described arrays, to transfer rather than
 * copy. A shared buffer is not transferred but shared, and two channels that
 * view one buffer must be listed once, or the post is refused.
 */
export function describedBuffers(descriptions: readonly PcmDescription[]): readonly ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  for (const description of descriptions) {
    if (description.kind !== PcmDescriptionKind.Pcm) continue;
    for (const channel of description.channels) {
      if (channel.buffer instanceof ArrayBuffer) buffers.add(channel.buffer);
    }
  }
  return [...buffers];
}
