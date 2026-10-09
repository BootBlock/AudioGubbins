/**
 * Where the next take goes (`ADR-0072`, `REQ-REC-089`, `REQ-REC-093`): the
 * armed input's purpose read against the project as it stands when Record is
 * pressed, with the names the take and a new stack are given.
 *
 * A new stack's first take; the next take of a stack, which is how successive
 * recordings go into the stack that is armed; or a punch. A punch over a range
 * is placed on the asset's edited timeline as it stands now, and a punch
 * stack's later takes are placed where its punch edit lies now, the edits made
 * since carried over it, so the performer hears the same pre-roll each time. A
 * punch is recorded at the rate of the audio it replaces, since capture and
 * playback share one context, so another rate is refused with the reason.
 */

import {
  FailureKind,
  anchorResolver,
  derivedSampleCount,
  fail,
  failure,
  punchStackOf,
  shapesOf,
  succeed,
  type Asset,
  type DomainResult,
  type Project,
  type SampleCount,
  type SampleRate,
  type TakeStack,
} from '@audiogubbins/domain';
import type { ArmedPurpose } from '@audiogubbins/recording';
import { quoted } from '@audiogubbins/text';

/** Where a punch's take is recorded on the asset it punches, as it stands now. */
export interface PunchPlace {
  readonly asset: Asset;

  /** The range's first frame on the asset's edited timeline now. */
  readonly start: SampleCount;
  readonly length: SampleCount;

  /** The frames recorded before the range and after it. */
  readonly preRoll: SampleCount;
  readonly postRoll: SampleCount;
}

/** Where the next take goes, and what it and a stack it starts are called. */
export type TakeTarget =
  | { readonly kind: 'new-stack'; readonly takeName: string; readonly stackName: string }
  | {
      readonly kind: 'take';
      readonly stack: TakeStack;
      readonly takeName: string;
      /** Where the stack's punch lies now, where it is a punch's. */
      readonly punch?: PunchPlace;
    }
  | {
      readonly kind: 'punch';
      readonly takeName: string;
      readonly stackName: string;
      readonly place: PunchPlace;
      /** The asset's chain length the range is stated on. */
      readonly basis: number;
    };

/** The name of the take after the `made` takes a stack has. */
function takeNameAfter(made: number): string {
  return `Take ${String(made + 1)}`;
}

/** The name a new stack of `project` is given: the first "Recording N" no stack has. */
function newStackName(project: Project): string {
  const names = new Set([...project.takeStacks.values()].map((stack) => stack.name));
  let number = project.takeStacks.size + 1;
  while (names.has(`Recording ${String(number)}`)) number += 1;
  return `Recording ${String(number)}`;
}

/** The name a punch over `asset` starts its stack with. */
function punchStackName(project: Project, asset: Asset): string {
  const name = `Punch over ${quoted(asset.displayName)}`;
  const names = new Set([...project.takeStacks.values()].map((stack) => stack.name));
  if (!names.has(name)) return name;
  let number = 2;
  while (names.has(`${name} ${String(number)}`)) number += 1;
  return `${name} ${String(number)}`;
}

function refused(code: string, summary: string): DomainResult<never> {
  return fail(failure(`recording.${code}`, FailureKind.Rejected, summary));
}

/** Why a punch on `asset` cannot be recorded at `rate`, or nothing where it can. */
function rateRefusal(asset: Asset, rate: SampleRate): string | undefined {
  const shape = shapesOf(asset).at(-1);
  if (shape === undefined || shape.sampleRate === rate) return undefined;
  return `${quoted(asset.displayName)} is at ${String(shape.sampleRate)} Hz and the input records at ${String(rate)} Hz. A punch is recorded at the rate of the audio it replaces, so arm the punch again to open the input at that rate.`;
}

/**
 * Where the punch of `stack` lies now, or why it has none: a stack that is no
 * punch's, or whose punch edit was taken away.
 */
export function punchPlaceOf(project: Project, stack: TakeStack): DomainResult<PunchPlace> {
  const { punch } = stack;
  for (const asset of punch === undefined ? [] : project.assets.values()) {
    const index = asset.edits.findIndex((operation) => punchStackOf(operation) === stack.id);
    const operation = asset.edits[index];
    if (operation?.kind !== 'process' || punch === undefined) continue;
    // A punch changes no time, so the edits after it carry its range as they
    // carry any span placed at its place in the chain.
    const span = anchorResolver(asset).span(index, operation.range);
    if (span === undefined) break;
    return succeed({
      asset,
      start: derivedSampleCount(span.start),
      length: derivedSampleCount(span.end - span.start),
      preRoll: punch.preRoll,
      postRoll: punch.postRoll,
    });
  }
  return refused(
    'punch-gone',
    `${quoted(stack.name)} has no punch in the project now, so no take can be punched into it. Undo the punch's removal, or arm a new punch.`,
  );
}

/** Where the next take of the stack `purpose` names goes. */
function nextTake(
  purpose: Extract<ArmedPurpose, { kind: 'take' }>,
  project: Project,
  rate: SampleRate,
): DomainResult<TakeTarget> {
  const stack = project.takeStacks.get(purpose.stack);
  if (stack === undefined) {
    return refused(
      'stack-gone',
      'The take stack the input is armed for is no longer in the project. Arm it again.',
    );
  }
  const takeName = takeNameAfter(stack.takes.length);
  if (stack.punch === undefined) return succeed({ kind: 'take', stack, takeName });
  const place = punchPlaceOf(project, stack);
  if (!place.ok) return place;
  const refusal = rateRefusal(place.value.asset, rate);
  if (refusal !== undefined) return refused('punch-rate', refusal);
  return succeed({ kind: 'take', stack, takeName, punch: place.value });
}

/** Where a new punch `purpose` arms goes. */
function newPunch(
  purpose: Extract<ArmedPurpose, { kind: 'punch' }>,
  project: Project,
  rate: SampleRate,
): DomainResult<TakeTarget> {
  const asset = project.assets.get(purpose.asset);
  if (asset === undefined) {
    return refused(
      'punch-asset-gone',
      'The audio the punch is armed over is no longer in the project.',
    );
  }
  const refusal = rateRefusal(asset, rate);
  if (refusal !== undefined) return refused('punch-rate', refusal);
  const length = shapesOf(asset).at(-1)?.length ?? asset.length;
  if (purpose.start + purpose.length > length) {
    return refused(
      'punch-outside',
      `The punch's range no longer lies within ${quoted(asset.displayName)}. Select the range again and arm the punch.`,
    );
  }
  const { start, preRoll, postRoll } = purpose;
  return succeed({
    kind: 'punch',
    takeName: takeNameAfter(0),
    stackName: punchStackName(project, asset),
    place: { asset, start, length: purpose.length, preRoll, postRoll },
    basis: asset.edits.length,
  });
}

/**
 * Where a take recorded at `rate` for `purpose` goes in `project` now, or why
 * it cannot be recorded for it.
 */
export function takeTargetOf(
  purpose: ArmedPurpose,
  project: Project,
  rate: SampleRate,
): DomainResult<TakeTarget> {
  switch (purpose.kind) {
    case 'new-stack':
      return succeed({
        kind: 'new-stack',
        takeName: takeNameAfter(0),
        stackName: newStackName(project),
      });
    case 'take':
      return nextTake(purpose, project, rate);
    case 'punch':
      return newPunch(purpose, project, rate);
  }
}
