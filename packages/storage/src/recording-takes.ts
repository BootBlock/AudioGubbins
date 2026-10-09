/**
 * The change a finished recording makes (ADR-0071, ADR-0072): its asset
 * added, then the take its manifest's purpose names, as one group that one
 * undo takes away.
 *
 * The purpose is carried out as it was set up: a new take, chosen, at the end
 * of the stack named; the first take of a new stack; or the first take of a
 * new punch stack and the punch edit that reads it, over the range of the
 * asset the punch was set up on. A punch's range is stated on the asset's
 * chain as it was when the punch was set up, so an asset edited since is
 * refused for it, with the reason, rather than punched where the range no
 * longer lies; the recording stays, to be recovered. The commands are the
 * caller's, since the storage does not depend on the project commands.
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import {
  TakeState,
  fail,
  succeed,
  type Asset,
  type DomainResult,
  type EditOperation,
  type IdGenerator,
  type Take,
  type TakeStack,
  type TakeStackId,
} from '@audiogubbins/domain';
import type {
  AssetSource,
  ProjectState,
  RecoveryChunkManifest,
} from '@audiogubbins/project-format';
import { quoted } from '@audiogubbins/text';

import { punchMoved, stackUnnamed } from './recording-failures.js';

/** The project commands' invocations a finished recording is made with. */
export interface RecordingCommands {
  /** `addAssetInvocation`. */
  readonly addAsset: (asset: Asset, source: AssetSource) => CommandInvocation;

  /** `createTakeStackInvocation`. */
  readonly createStack: (stack: TakeStack) => CommandInvocation;

  /** `addTakeInvocation`. */
  readonly addTake: (
    stack: Pick<TakeStack, 'id'>,
    take: Take,
    choose: boolean,
  ) => CommandInvocation;

  /** `addPunchInvocation`. */
  readonly addPunch: (
    asset: Pick<Asset, 'id'>,
    operation: EditOperation,
    stack: TakeStack,
  ) => CommandInvocation;
}

/** What the take a recording becomes is called and placed by, as the person's settings give it. */
export interface TakeRequest {
  /** The take's name, which its asset takes too. */
  readonly name: string;

  /** The name of the stack the recording starts, where its purpose starts one. */
  readonly stackName?: string;

  /** The latency the take is placed by, in frames at its rate (ADR-0070). */
  readonly compensation: number;
}

/** A recorded asset and its source, as a finished recording adds them. */
export interface RecordedAsset {
  readonly asset: Asset;
  readonly source: AssetSource;
}

/** The change a finished recording makes, and the take it made. */
export interface TakeChange {
  readonly description: string;
  readonly invocations: readonly [CommandInvocation, ...CommandInvocation[]];
  readonly take: Take;
  readonly stack: TakeStackId;
}

/**
 * The change that adds `recorded` and the take `manifest`'s purpose names, in
 * the project as `state` holds it, or why that take cannot be made.
 */
export function takeChange(
  state: ProjectState,
  manifest: RecoveryChunkManifest,
  recorded: RecordedAsset,
  request: TakeRequest,
  ids: IdGenerator,
  commands: RecordingCommands,
): DomainResult<TakeChange> {
  const { asset, source } = recorded;
  const take: Take = {
    id: ids.next<'TakeId'>(),
    asset: asset.id,
    name: request.name,
    note: '',
    state: TakeState.Kept,
    compensation: request.compensation,
  };
  const step = takeStep(state, manifest, take, request, ids, commands);
  if (!step.ok) return step;
  return succeed({
    description: `Record ${quoted(request.name)}`,
    invocations: [commands.addAsset(asset, source), step.value.invocation],
    take,
    stack: step.value.stack,
  });
}

/** The step that adds `take` as `manifest`'s purpose says, and the stack it is in. */
function takeStep(
  state: ProjectState,
  manifest: RecoveryChunkManifest,
  take: Take,
  request: TakeRequest,
  ids: IdGenerator,
  commands: RecordingCommands,
): DomainResult<{ readonly invocation: CommandInvocation; readonly stack: TakeStackId }> {
  const { purpose } = manifest;
  if (purpose.kind === 'take') {
    const invocation = commands.addTake({ id: purpose.stack }, take, true);
    return succeed({ invocation, stack: purpose.stack });
  }
  if (request.stackName === undefined) return fail(stackUnnamed(manifest.session));
  const stack: TakeStack = {
    id: ids.next<'TakeStackId'>(),
    name: request.stackName,
    takes: [take],
    chosen: take.id,
  };
  if (purpose.kind === 'stack') {
    return succeed({ invocation: commands.createStack(stack), stack: stack.id });
  }
  const target = state.project.assets.get(purpose.asset);
  if (target !== undefined && target.edits.length !== purpose.basis) {
    return fail(punchMoved(manifest.session));
  }
  const operation: EditOperation = {
    id: ids.next<'EditOperationId'>(),
    kind: 'process',
    range: purpose.range,
    edit: { kind: 'punch', stack: stack.id },
  };
  const punched = { ...stack, punch: purpose.punch };
  return succeed({
    invocation: commands.addPunch({ id: purpose.asset }, operation, punched),
    stack: stack.id,
  });
}
