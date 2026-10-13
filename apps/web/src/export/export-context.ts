/**
 * What an export of an asset is planned against (ADR-0092): the asset's audio
 * as it is heard, its regions each as its own audio, and the codecs as this
 * browser serves them, read from its codec environment as it stands, so the bit
 * rates its encoder was probed to take hold the settings from the moment the
 * probe is heard. The source is named by the project, which a file name's
 * `{project}` fills with; a region's file is named by its region through
 * `{region}`.
 *
 * The export renders what the person hears. The asset's audio is its plan,
 * racks and edits included, at the rate and layout its plan gives; a region's
 * is the region's own plan, its slice of the asset with its own processing,
 * so a region is described from its own first frame (`start` is 0) at the
 * rate, layout and length its plan gives, which its processing may change
 * from its asset's. The regions come in the order the asset's view places
 * them, which is the timeline's.
 *
 * The precision a source needs is integer only where the audio heard is the
 * file's own integers: an asset read in place from integer PCM, or from G.711
 * or ADPCM (which decode to 16 bits), with no edit and no chain over it, and a
 * region of one with no processing of its own. Anything else, a decoded
 * rendition, a recording, an edit or a chain, is floating point, so a default
 * never quantises away what processing made.
 */

import {
  ZERO_SAMPLES,
  anchorResolver,
  combine,
  derivedSampleCount,
  fail,
  failure,
  FailureKind,
  flatMapResult,
  mapResult,
  regionPlan,
  streamLength,
  succeed,
  type Asset,
  type DomainResult,
  type EditPlan,
  type PlacedRegion,
  type Region,
} from '@audiogubbins/domain';
import { codecDescriptorIn, type CodecEnvironment } from '@audiogubbins/codecs';
import type {
  CodecLookup,
  ExportContext,
  ExportableRegion,
  SourcePrecision,
} from '@audiogubbins/import-export';
import type { ProjectState } from '@audiogubbins/project-format';

import { planContextOf } from '../assets/project-assets.js';
import type { Observable } from '../state/observable.js';
import { bypassesProcessing } from '../assets/project-entry.js';
import type { ExportContextOf } from './export-types.js';

/** The codecs as `environment` serves them as it stands, the lookup every export is checked against. */
export function servedCodecs(environment: Observable<CodecEnvironment>): CodecLookup {
  return (codec) => codecDescriptorIn(environment.get(), codec);
}

/** The bits G.711 and ADPCM decode to, which their exports count as (ADR-0092). */
const CODED_BITS = 16;

const FLOAT: SourcePrecision = { kind: 'float' };

/** Why an asset cannot be exported from `state`. */
function notExportable(summary: string): DomainResult<never> {
  return fail(failure('export.asset-unavailable', FailureKind.Rejected, summary));
}

/** The precision of the file `asset` is read from, where its audio is that file's samples. */
function filePrecision(state: ProjectState, asset: Asset): SourcePrecision {
  const provenance = state.sources.get(asset.id)?.provenance;
  if (provenance === undefined || provenance.rendition !== undefined) return FLOAT;
  const encoding = provenance.audio?.encoding;
  switch (encoding?.kind) {
    case 'integer':
      return { kind: 'integer', bits: encoding.bits };
    case 'g711-alaw':
    case 'g711-ulaw':
    case 'ima-adpcm':
    case 'ms-adpcm':
      return { kind: 'integer', bits: CODED_BITS };
    default:
      return FLOAT;
  }
}

/** The precision the audio heard needs: the file's, where nothing processes it, else float. */
function heardPrecision(state: ProjectState, asset: Asset, region?: Region): SourcePrecision {
  const processed =
    asset.edits.length > 0 ||
    bypassesProcessing(asset, region) ||
    (region !== undefined && region.operations.length > 0);
  return processed ? FLOAT : filePrecision(state, asset);
}

/** A region of `asset`, described from its own plan. */
function exportableRegion(
  state: ProjectState,
  asset: Asset,
  placed: PlacedRegion,
  plan: (region: Region) => DomainResult<EditPlan>,
): DomainResult<ExportableRegion> {
  const region = state.project.regions.get(placed.id);
  if (region === undefined) {
    return notExportable(`The region ${placed.displayName} is no longer in the project.`);
  }
  return mapResult(plan(region), ({ streams: [stream] }) => ({
    id: region.id,
    name: region.displayName,
    sampleRate: stream.sampleRate,
    layout: stream.layout,
    precision: heardPrecision(state, asset, region),
    start: ZERO_SAMPLES,
    length: derivedSampleCount(streamLength(stream)),
  }));
}

/** What an export of `asset`'s audio is planned against in `state` (see the module comment). */
export const exportContextOf: ExportContextOf = (editor, state, codecs) => {
  const { owner } = editor;
  if (owner.kind !== 'project') return notExportable(owner.reason);
  if (owner.region !== undefined) {
    return notExportable(
      `${editor.name} is a region; export it from its asset, as one region or with the rest.`,
    );
  }
  const asset = state.project.assets.get(owner.asset.id);
  if (asset === undefined) {
    return notExportable(`${editor.name} is no longer in the project.`);
  }
  const context = planContextOf(state);
  const resolver = anchorResolver(asset);
  const plan = (region: Region): DomainResult<EditPlan> =>
    regionPlan(asset, region, context, resolver);
  return flatMapResult(
    combine(editor.regions.map((placed) => exportableRegion(state, asset, placed, plan))),
    (regions): DomainResult<ExportContext> =>
      succeed({
        source: {
          name: state.project.displayName,
          sampleRate: editor.sampleRate,
          layout: editor.layout,
          precision: heardPrecision(state, asset),
          length: editor.length,
          regions,
        },
        codecs,
      }),
  );
};
