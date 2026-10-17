/**
 * The Spectral panel's operations (ADR-0081, REQ-AUDIO-016): attenuating by the
 * decibels typed, removing, isolating with the rest lowered by the decibels
 * typed or removed, healing, and cleaning up with a restoration processor, each
 * analysed at the resolution chosen and run as the `spectral.*` command of the
 * same name; a processor whose model cannot run says so before it is applied,
 * and its button then cleans up knowingly, as the command asks. Each button
 * opens its command's reason on hover or focus while the command cannot run.
 */

import { useState, useSyncExternalStore, type ReactNode } from 'react';

import {
  Button,
  ButtonTone,
  Hint,
  Icon,
  OptionSelect,
  Section,
  TextField,
} from '@audiogubbins/design-system';
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
import { commandPress } from '../command-press.js';
import { SpectralFormRow } from './spectral-form-row.js';
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

/** The view acted on and the resolution chosen, which every operation is given. */
type Base = Readonly<Record<string, string | number>>;

/** An operation's button, which opens its command's reason on hover or focus. */
function OperationButton({
  id,
  args,
  context,
  tone,
  icon,
  children,
}: {
  readonly id: string;
  readonly args: Readonly<Record<string, string | number | boolean>>;
  readonly context: SpectralContext;
  readonly tone?: ButtonTone;
  readonly icon?: 'spectral-remove' | 'spectral-heal' | 'clean-up';
  readonly children: string;
}): ReactNode {
  const { onPress, ...reason } = commandPress(context, id, args);
  return (
    <Button {...(tone === undefined ? {} : { tone })} compact {...reason} onClick={onPress}>
      {icon !== undefined && <Icon name={icon} />}
      {children}
    </Button>
  );
}

/** Attenuating by the decibels typed. */
function AttenuateRow({
  base,
  context,
}: {
  readonly base: Base;
  readonly context: SpectralContext;
}): ReactNode {
  const [attenuation, setAttenuation] = useState(String(DEFAULT_ATTENUATION_DECIBELS));
  return (
    <SpectralFormRow label="Attenuate">
      <div className="ag-spectral-field-row">
        <TextField
          label="Attenuate by, in decibels"
          unit="dB"
          value={attenuation}
          onValueChange={setAttenuation}
        />
        <OperationButton
          id="spectral.attenuate"
          args={{ ...base, decibels: typedNumber(attenuation) }}
          context={context}
        >
          Attenuate
        </OperationButton>
      </div>
    </SpectralFormRow>
  );
}

/** Isolating with the rest lowered by the decibels typed, or removed. */
function IsolateRow({
  base,
  context,
}: {
  readonly base: Base;
  readonly context: SpectralContext;
}): ReactNode {
  const [isolation, setIsolation] = useState('');
  return (
    <SpectralFormRow label="Isolate">
      <div className="ag-spectral-field-row">
        <TextField
          label="Lower the rest by, in decibels"
          unit="dB"
          value={isolation}
          onValueChange={setIsolation}
        />
        <OperationButton
          id="spectral.isolate"
          args={isolation.trim() === '' ? base : { ...base, decibels: typedNumber(isolation) }}
          context={context}
        >
          Isolate
        </OperationButton>
        <Hint label="About isolating">Left empty, the rest of the area’s span is removed.</Hint>
      </div>
    </SpectralFormRow>
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
  const [resolution, setResolution] = useState(String(DEFAULT_SPECTRAL_RESOLUTION));
  const [typeKey, setTypeKey] = useState(CLEANUP_PROCESSORS[0]?.typeKey ?? '');
  useSyncExternalStore(context.modelGate.subscribe, context.modelGate.get);
  const cannot = cleanupRefusal(context, typeKey);
  const base: Base = { view: shown.panel, resolution: Number(resolution) };
  return (
    <Section title="Repair">
      <div className="ag-spectral-form">
        <SpectralFormRow label="Frames">
          <OptionSelect
            label="Analysed in frames of"
            value={resolution}
            options={RESOLUTION_OPTIONS}
            onValueChange={setResolution}
          />
        </SpectralFormRow>
        <AttenuateRow base={base} context={context} />
        <IsolateRow base={base} context={context} />
        <SpectralFormRow label="Clean up">
          <OptionSelect
            label="Clean up with"
            value={typeKey}
            options={CLEANUP_OPTIONS}
            onValueChange={setTypeKey}
          />
        </SpectralFormRow>
      </div>
      {cannot !== undefined && (
        <p className="ag-spectral-caption" data-ag-status="reduced">
          {`It can be applied, but it is not heard until it can run: ${cannot}`}
        </p>
      )}
      <div className="ag-spectral-actions">
        <OperationButton
          id="spectral.remove"
          args={base}
          context={context}
          tone={ButtonTone.QuietDestructive}
          icon="spectral-remove"
        >
          Remove
        </OperationButton>
        <OperationButton id="spectral.heal" args={base} context={context} icon="spectral-heal">
          Heal
        </OperationButton>
        <OperationButton
          id="spectral.process"
          args={cannot === undefined ? { ...base, typeKey } : { ...base, typeKey, knowingly: true }}
          context={context}
          tone={ButtonTone.Primary}
          icon="clean-up"
        >
          {cannot === undefined ? 'Clean up' : 'Clean up anyway'}
        </OperationButton>
      </div>
    </Section>
  );
}
