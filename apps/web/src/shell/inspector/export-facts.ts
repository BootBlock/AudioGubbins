/**
 * What the Inspector says of an export (REQ-EDIT-072, REQ-STOR-197): of the
 * page's export, where the batch is, what it exports and by which settings,
 * and of each of its files where it has got, how large it is and where it
 * goes; of an export the project's history records, when it was made and
 * from which point, the file it wrote, how and by what, where to, and how it
 * ended. Words only, each a term and its detail; the words for settings,
 * stages and destinations are shared with the Export dialog, the progress
 * surface and the History panel.
 */

import type { RegionId } from '@audiogubbins/domain';
import {
  batchProgress,
  safeFileName,
  type ExportJob,
  type ExportSettings,
} from '@audiogubbins/import-export';
import { ExportStatus, type ExportRecord } from '@audiogubbins/project-format';
import { counted, quoted } from '@audiogubbins/text';

import type { ExportRunState } from '../../export/export-types.js';
import { describeBytes, when } from '../../wording.js';
import {
  chosenDestinationWords,
  recordedDestinationWords,
  stageWords,
} from '../export/export-job-words.js';
import { METADATA_POLICY_WORDS, rangeWords, settingsPhrase } from '../export/export-words.js';
import { encodedByWords, reproducibleWords } from '../history/history-words.js';
import type { Fact } from './facts.js';

/** The page's export once one has started. */
export type ShownExport = Exclude<ExportRunState, { readonly kind: 'idle' }>;

/** The names the facts are worded with, read from the project and the folders kept trusted. */
export interface ExportWording {
  /** A region's name, or nothing for a region no longer in the project. */
  readonly regionName: (region: RegionId) => string | undefined;

  /** A trusted folder's name, by the key it is kept under, or nothing where it is no longer kept. */
  readonly trustedName: (key: string) => string | undefined;

  /** What a point of the history is, in a phrase, or nothing where it is no longer in the history. */
  readonly pointName: (node: string) => string | undefined;
}

/** One file of the page's export: the name it is shown by, and its facts. */
export interface DescribedJob {
  readonly id: string;
  readonly name: string;
  readonly facts: readonly Fact[];
}

/** What the settings of an export make, a fact each: the range, the encoding and the rest, the metadata and the name. */
function settingsFacts(settings: ExportSettings, wording: ExportWording): readonly Fact[] {
  return [
    { term: 'Exports', detail: rangeWords(settings.range, wording.regionName) },
    { term: 'Settings', detail: `${settingsPhrase(settings)}.` },
    { term: 'Metadata', detail: METADATA_POLICY_WORDS[settings.metadata.policy] },
    { term: 'Named by', detail: quoted(settings.fileName) },
  ];
}

/** Where the page's export is, in a sentence. */
function batchStateWords(state: ShownExport): string {
  switch (state.kind) {
    case 'running': {
      if (state.asking !== undefined) {
        return `Waiting for your answer about ${quoted(state.asking)}, whose name is taken.`;
      }
      const { jobsSettled, jobsTotal } = batchProgress(state.batch);
      return `Running: ${String(jobsSettled)} of ${counted(jobsTotal, 'file', 'files')} done.`;
    }
    case 'held':
      return 'Waiting on a file it could not deliver: retry it, deliver it elsewhere, or cancel the export.';
    case 'ended':
      return state.said;
  }
}

/**
 * The one set of settings every file of the batch is made by, where one is,
 * as the Export dialog's files are; none where its files each have their own,
 * as a game export's do.
 */
function sharedSettings(state: ShownExport): ExportSettings | undefined {
  const [first, ...rest] = state.settings.values();
  return rest.every((one) => one === first) ? first : undefined;
}

/** The facts of the page's export as a whole. */
export function batchFacts(state: ShownExport, wording: ExportWording): readonly Fact[] {
  const shared = sharedSettings(state);
  return [
    { term: 'Where it is', detail: batchStateWords(state) },
    ...(shared === undefined
      ? [{ term: 'Settings', detail: 'Each file has its own, from the policy of its group.' }]
      : settingsFacts(shared, wording)),
  ];
}

/** The bytes a file of the batch has staged, where it has staged any. */
function stagedBytes(job: ExportJob): number | undefined {
  const { state } = job;
  switch (state.kind) {
    case 'rendering':
    case 'encoding':
      return state.bytesStaged;
    case 'staged':
    case 'delivering':
    case 'delivered':
      return state.staged.bytes;
    default:
      return undefined;
  }
}

/** One file of the page's export, as the Inspector describes it. */
function describedJob(state: ShownExport, job: ExportJob, wording: ExportWording): DescribedJob {
  const file = state.files.get(job.id);
  const destination = state.destinations.get(job.id);
  const region = file?.span.region;
  const bytes = stagedBytes(job);
  const settings = state.settings.get(job.id);
  const facts: Fact[] = [{ term: 'Where it is', detail: stageWords(job) }];
  if (file !== undefined && (region !== undefined || settings !== undefined)) {
    facts.push({
      term: 'Of',
      detail:
        region === undefined
          ? rangeWords(settings?.range ?? { kind: 'project' }, wording.regionName)
          : rangeWords({ kind: 'region', region: region.id }, () => region.name),
    });
  }
  if (settings !== undefined && sharedSettings(state) === undefined) {
    facts.push({ term: 'Made as', detail: settingsPhrase(settings) });
  }
  if (bytes !== undefined) facts.push({ term: 'Size', detail: describeBytes(bytes) });
  if (destination !== undefined) {
    facts.push({
      term: 'Where it goes',
      detail: `${chosenDestinationWords(destination, wording.trustedName)}.`,
    });
  }
  return {
    id: job.id,
    // The name it was written under, which a rename may have changed, once it is delivered.
    name: state.names.get(job.id) ?? (file === undefined ? job.id : safeFileName(file.name)),
    facts,
  };
}

/** Each file of the page's export, in the batch's order. */
export function describedJobs(state: ShownExport, wording: ExportWording): readonly DescribedJob[] {
  return state.batch.jobs.map((job) => describedJob(state, job, wording));
}

/** How a recorded export ended, in a sentence, with what went wrong where anything did. */
function endingWords(record: ExportRecord): string {
  const problems = record.problems.length === 0 ? '' : ` ${record.problems.join(' ')}`;
  switch (record.status) {
    case ExportStatus.Succeeded:
      return 'Every file was written.';
    case ExportStatus.Partial:
      return `Only some of it was written.${problems}`;
    case ExportStatus.Failed:
      return `It failed.${problems}`;
  }
}

/** What an export made in the past was, by the record the project's history keeps of it. */
export function recordFacts(record: ExportRecord, wording: ExportWording): readonly Fact[] {
  const { file } = record;
  const facts: Fact[] = [{ term: 'Made', detail: when(record.at) }];
  if (record.historyNodeId !== undefined) {
    facts.push({
      term: 'From the point',
      detail: wording.pointName(record.historyNodeId) ?? 'A point no longer in the history',
    });
  }
  if (file === undefined) {
    facts.push({ term: 'Format', detail: record.output.container });
  } else {
    facts.push(
      {
        term: 'File',
        detail: file.fileName === undefined ? 'Its name was not kept' : quoted(file.fileName),
      },
      ...settingsFacts(file.settings, wording),
      { term: 'Encoded as', detail: encodedByWords(file.codec) },
      { term: 'Size', detail: describeBytes(file.byteLength) },
      { term: 'Its bytes', detail: `The project gives ${reproducibleWords(file.reproducible)}.` },
      { term: 'SHA-256', detail: file.sha256 },
    );
  }
  facts.push(
    { term: 'Where it went', detail: `${recordedDestinationWords(record.destination)}.` },
    { term: 'How it ended', detail: endingWords(record) },
  );
  if (record.engineVersions.size > 0) {
    facts.push({
      term: 'Rendered by',
      detail: [...record.engineVersions].map(([name, version]) => `${name} ${version}`).join(', '),
    });
  }
  return facts;
}
