/**
 * The Spectral panel's operations (ADR-0081, REQ-AUDIO-016): attenuating by
 * the decibels typed, removing, isolating with the rest lowered by the
 * decibels typed or removed, healing, and cleaning up with a restoration
 * processor, each analysed at the resolution chosen and run as the
 * `spectral.*` command of the same name; a processor whose model cannot run
 * says so before it is applied. Comparing the latest spectral edit with
 * before it, and hearing the original beside it, follow.
 */

import { useId, useState, useSyncExternalStore, type ReactNode } from 'react';

import { OptionSelect, TextField } from '@audiogubbins/design-system';
import {
  DEFAULT_SPECTRAL_RESOLUTION,
  LARGEST_SPECTRAL_RESOLUTION,
  SMALLEST_SPECTRAL_RESOLUTION,
  instantiateProcessor,
  unsafeBrandId,
} from '@audiogubbins/domain';

import { processorLabel } from '../../commands/rack-words.js';
import {
  CLEANUP_PROCESSORS,
  DEFAULT_ATTENUATION_DECIBELS,
} from '../../commands/spectral-edit-commands.js';
import { CommandButton, useCommandReasons } from '../command-button.js';
import { HearingSwitch } from '../rack/hearing-switch.js';
import { SharedReasonNotes, type SharedReasons } from '../settings/reasoned-button.js';
import type { ShownView, SpectralContext } from './shown-spectral.js';

/** Every resolution a spectral edit may analyse with, shortest first. */
const RESOLUTIONS: readonly number[] = Array.from(
  { length: Math.log2(LARGEST_SPECTRAL_RESOLUTION / SMALLEST_SPECTRAL_RESOLUTION) + 1 },
  (_, index) => SMALLEST_SPECTRAL_RESOLUTION * 2 ** index,
);

const SAMPLES = new Intl.NumberFormat('en-GB');

const RESOLUTION_OPTIONS = RESOLUTIONS.map((resolution) => ({
  value: String(resolution),
  label: `${SAMPLES.format(resolution)} samples`,
}));

const CLEANUP_OPTIONS = CLEANUP_PROCESSORS.map((one) => ({
  value: one.typeKey,
  label: processorLabel(one.typeKey),
}));

/** A number typed, as a command reads one: an empty field is no number, so the command asks. */
function typedNumber(typed: string): number {
  return typed.trim() === '' ? Number.NaN : Number(typed);
}

/**
 * Why the processor `typeKey` cannot run here, asked of the gate as an
 * instance of it would be: a model's absence depends on its type alone.
 */
function cleanupRefusal(context: SpectralContext, typeKey: string): string | undefined {
  const descriptor = CLEANUP_PROCESSORS.find((one) => one.typeKey === typeKey);
  if (descriptor === undefined) return undefined;
  const asked = instantiateProcessor(unsafeBrandId<'ProcessorId'>('asked'), descriptor);
  return context.modelGate.get()(asked);
}

/** The operations whose reasons are said once above them. */
const OPERATIONS: readonly string[] = [
  'spectral.attenuate',
  'spectral.remove',
  'spectral.isolate',
  'spectral.heal',
  'spectral.process',
];

/** What each row of operations is given: the panel's commands, their reasons, and the base arguments. */
interface RowParts {
  readonly context: SpectralContext;
  readonly reasons: SharedReasons<string>;
  /** The view acted on and the resolution chosen, which every operation is given. */
  readonly base: Readonly<Record<string, string | number>>;
}

/** An operation's button, its reason said once above the rows. */
function OperationButton({
  id,
  label,
  args,
  parts,
}: {
  readonly id: string;
  readonly label: string;
  readonly args: Readonly<Record<string, string | number>>;
  readonly parts: RowParts;
}): ReactNode {
  return (
    <CommandButton
      id={id}
      label={label}
      commands={parts.context}
      args={args}
      compact
      shared={parts.reasons}
    />
  );
}

/** Attenuating by the decibels typed, and removing. */
function AttenuateRow({ parts }: { readonly parts: RowParts }): ReactNode {
  const [attenuation, setAttenuation] = useState(String(DEFAULT_ATTENUATION_DECIBELS));
  return (
    <div className="ag-inspector-row">
      <TextField
        label="Attenuate by, in decibels"
        value={attenuation}
        onValueChange={setAttenuation}
      />
      <OperationButton
        id="spectral.attenuate"
        label="Attenuate"
        args={{ ...parts.base, decibels: typedNumber(attenuation) }}
        parts={parts}
      />
      <OperationButton id="spectral.remove" label="Remove" args={parts.base} parts={parts} />
    </div>
  );
}

/** Isolating with the rest lowered by the decibels typed, or removed, and healing. */
function IsolateRow({ parts }: { readonly parts: RowParts }): ReactNode {
  const [isolation, setIsolation] = useState('');
  return (
    <div className="ag-inspector-row">
      <TextField
        label="Lower the rest by, in decibels"
        description="Left empty, the rest of the area's span is removed."
        value={isolation}
        onValueChange={setIsolation}
      />
      <OperationButton
        id="spectral.isolate"
        label="Isolate"
        args={
          isolation.trim() === '' ? parts.base : { ...parts.base, decibels: typedNumber(isolation) }
        }
        parts={parts}
      />
      <OperationButton id="spectral.heal" label="Heal" args={parts.base} parts={parts} />
    </div>
  );
}

/** Cleaning up with the restoration processor chosen, saying first where it cannot run. */
function CleanUpRow({ parts }: { readonly parts: RowParts }): ReactNode {
  const [typeKey, setTypeKey] = useState(CLEANUP_PROCESSORS[0]?.typeKey ?? '');
  useSyncExternalStore(parts.context.modelGate.subscribe, parts.context.modelGate.get);
  const cannot = cleanupRefusal(parts.context, typeKey);
  return (
    <>
      <div className="ag-inspector-row">
        <OptionSelect
          label="Clean up with"
          value={typeKey}
          options={CLEANUP_OPTIONS}
          onValueChange={setTypeKey}
        />
        <OperationButton
          id="spectral.process"
          label="Clean up"
          args={{ ...parts.base, typeKey }}
          parts={parts}
        />
      </div>
      {cannot !== undefined && (
        <p className="ag-panel-note" data-ag-status="reduced">
          {`It can be applied, but it is not heard until it can run: ${cannot}`}
        </p>
      )}
    </>
  );
}

/** The spectral operations, with what each is given. */
export function OperationsSection({
  shown,
  context,
}: {
  readonly shown: ShownView;
  readonly context: SpectralContext;
}): ReactNode {
  const heading = useId();
  const [resolution, setResolution] = useState(String(DEFAULT_SPECTRAL_RESOLUTION));
  const reasons = useCommandReasons(context, OPERATIONS);
  const parts: RowParts = {
    context,
    reasons,
    base: { view: shown.panel, resolution: Number(resolution) },
  };
  return (
    <section className="ag-inspector-section" aria-labelledby={heading}>
      <h3 className="ag-inspector-heading" id={heading}>
        Repair the selection
      </h3>
      <SharedReasonNotes reasons={reasons} />
      <OptionSelect
        label="Analysed in frames of"
        value={resolution}
        options={RESOLUTION_OPTIONS}
        onValueChange={setResolution}
      />
      <AttenuateRow parts={parts} />
      <IsolateRow parts={parts} />
      <CleanUpRow parts={parts} />
      <HearingSwitch hearing={context.hearing} commands={context} />
      <CommandButton
        id="spectral.compare-before-edit"
        label="Compare with before the latest spectral edit"
        commands={context}
        args={{ view: shown.panel }}
        compact
        sayWhenUnchanged
      />
    </section>
  );
}
