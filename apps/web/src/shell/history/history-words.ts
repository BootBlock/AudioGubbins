/**
 * What the History panel says of a point in the history and of what letting
 * history go would cost (REQ-STOR-196, REQ-STOR-197, REQ-STOR-200). What
 * differs between two states is `difference-words.ts`.
 *
 * Plain language and nothing of the journal: a point is a change a person made,
 * the start of the project, a snapshot or a branch, and an export is provenance
 * of the point it was made from, never a change of its own.
 */

import type { CompactionPlan, HistoryNode, LostCapability } from '@audiogubbins/history';
import { codecDescriptor, type CodecImplementation } from '@audiogubbins/codecs';
import type { ExportCodec, ExportedAudioFile, ExportRecord } from '@audiogubbins/project-format';
import { counted, quoted } from '@audiogubbins/text';

import { describeBytes, when } from '../../wording.js';

/** What a point of the history is, in a phrase. */
export function describeNode(node: HistoryNode): string {
  if (node.kind === 'change') return node.description;
  switch (node.origin.kind) {
    case 'new':
      return 'The project was made';
    case 'import':
      return 'The project was brought in';
    case 'fork':
      return 'The project was forked from another';
  }
}

/**
 * Where an encoder ran, as the end of a phrase after its version, which names
 * the encoder itself ("flacenc 0.5.1"): nothing for AudioGubbins' own writers,
 * whose version is the product's ("AudioGubbins 0.1.0").
 */
const IMPLEMENTATION_WORDS: Readonly<Record<CodecImplementation, string>> = {
  application: '',
  'codec-module': ' in the codec module',
  'encoder-module': ' in its encoder module',
  browser: ", the browser's own encoder",
};

/**
 * The codec an export was encoded with, by which encoder at which version and
 * where it ran: "FLAC by flacenc 0.5.1 in the codec module".
 */
export function encodedByWords(codec: ExportCodec): string {
  return `${codecDescriptor(codec.id).name} by ${codec.version}${IMPLEMENTATION_WORDS[codec.implementation]}`;
}

/** Whether the same project and settings give an export's bytes again, as a phrase. */
export function reproducibleWords(reproducible: boolean): string {
  return reproducible ? 'the same bytes on every machine' : 'bytes another machine may not repeat';
}

/** The file an export wrote, as a phrase names it: its codec, what served it and whether it is reproducible. */
function writtenFile(file: ExportedAudioFile): string {
  return `, encoded as ${encodedByWords(file.codec)}, ${reproducibleWords(file.reproducible)}`;
}

/**
 * What an export made from a point was, in a phrase: the file it wrote and
 * where, and for an audio file its codec, its version and whether the same
 * project gives the same bytes (REQ-STOR-197, REQ-AUDIO-145).
 */
export function describeExport(record: ExportRecord): string {
  const { file } = record;
  const label = record.destination.label;
  const written = file?.fileName === undefined ? undefined : quoted(file.fileName);
  const where =
    written === undefined
      ? (label ?? record.output.container)
      : label === undefined || label === file?.fileName
        ? written
        : `${written} to ${quoted(label)}`;
  const status =
    record.status === 'succeeded' ? '' : record.status === 'partial' ? ', in part' : ', and failed';
  return `Exported as ${where} on ${when(record.at)}${file === undefined ? '' : writtenFile(file)}${status}`;
}

/** What letting history go takes away, in a sentence. */
export function lostSentence(
  lost: LostCapability,
  exportName: (id: string) => string | undefined,
): string {
  switch (lost.kind) {
    case 'undo-before':
      return `You could no longer undo past ${when(lost.at)}, ${counted(lost.changes, 'change', 'changes')} back.`;
    case 'branch':
      return `The branch ${lost.name === undefined ? '' : `${quoted(lost.name)} `}of ${counted(lost.changes, 'change', 'changes')}, last used ${when(lost.latestAt)}, would go.`;
    case 'export-state':
      return `You could no longer go back to the state ${exportName(lost.export) ?? 'an export'} was made from.`;
  }
}

/** What a compaction would free and take away, a sentence each. */
export function compactionSentences(
  plan: CompactionPlan,
  exportName: (id: string) => string | undefined,
): readonly string[] {
  if (plan.removable.length === 0) return ['Nothing in the history would be removed.'];
  const said = [
    `This removes ${counted(plan.removable.length, 'point', 'points')} of the history for good, and frees ${describeBytes(plan.reclaimableBytes)}.`,
  ];
  for (const lost of plan.lost) said.push(lostSentence(lost, exportName));
  if (!plan.withinBudget)
    said.push('Even so, the history would still be larger than the limit set.');
  return said;
}
