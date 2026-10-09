/**
 * The settings a report's detectors judged by, in the Analysis panel: one
 * field for each parameter a person may set, a silence's threshold among
 * them, showing the value the analysis used. A value typed and sent with
 * Enter runs `analysis.analyse-again` with it, which analyses the scope the
 * shown analysis used again, every other value it used kept. A value the
 * detection would refuse is said beside its field, by the same check the
 * command refuses it by; nothing is kept here but what is being typed and
 * what was last said, so the field shows what the analysis used otherwise.
 */

import { useState, type ReactNode } from 'react';

import { TextField } from '@audiogubbins/design-system';
import type { AssistantReport } from '@audiogubbins/detection-runtime';
import type { NumericParameterDescriptor } from '@audiogubbins/domain';
import { CANONICAL_ASSISTANTS, settledValues, type AudioDetector } from '@audiogubbins/processors';

import type { Detection } from '../../analysis/detection-control.js';
import { detectorArgument, overlaid, valuesRefusal } from '../../commands/detector-arguments.js';
import type { PanelCommands } from '../command-button.js';

/** The detectors `report` names that a person may set, as this build has them. */
function settableDetectors(report: AssistantReport): readonly AudioDetector[] {
  const keys = new Set(report.recommendation.detectors.map((identity) => identity.key));
  const all = CANONICAL_ASSISTANTS.flatMap((assistant) => assistant.detectors);
  return [...new Map(all.map((one) => [one.identity.key, one] as const)).values()].filter(
    (detector) => keys.has(detector.identity.key) && detector.parameters.length > 0,
  );
}

/**
 * The number typed, as a command reads a number: an empty field is no number,
 * rather than the zero `Number` makes of it, and a decimal comma is the point
 * it means.
 */
function typedNumber(typed: string): number {
  const trimmed = typed.trim().replace('−', '-').replace(',', '.');
  return trimmed === '' ? Number.NaN : Number(trimmed);
}

/**
 * One setting: its value as the analysis used it, typed and sent to analyse
 * again; `send` answers why the value would be refused, if it would be.
 */
function Setting({
  parameter,
  value,
  send,
}: {
  readonly parameter: NumericParameterDescriptor;
  readonly value: number;
  readonly send: (value: number) => string | undefined;
}): ReactNode {
  const [typed, setTyped] = useState<string | undefined>(undefined);
  const [refused, setRefused] = useState<string | undefined>(undefined);
  const unit = parameter.unit === undefined ? '' : ` in ${parameter.unit}`;
  return (
    <>
      <TextField
        label={`${parameter.label}${unit}`}
        description={`From ${String(parameter.minimum)} to ${String(parameter.maximum)}; press Enter to analyse again.`}
        value={typed ?? String(value)}
        onValueChange={setTyped}
        onSubmit={() => {
          if (typed === undefined) return;
          setRefused(send(typedNumber(typed)));
          setTyped(undefined);
        }}
      />
      {refused !== undefined && (
        <p role="status" className="ag-panel-note">
          {refused}
        </p>
      )}
    </>
  );
}

/** The settings `report`'s detectors judged by in `detection`, each sent to analyse again. */
export function DetectorSettings({
  report,
  detection,
  panel,
  commands,
}: {
  readonly report: AssistantReport;
  readonly detection: Detection;
  readonly panel: string;
  readonly commands: PanelCommands;
}): ReactNode {
  const detectors = settableDetectors(report);
  if (detectors.length === 0) return undefined;
  return (
    <>
      <h4 className="ag-analysis-heading">It judged by</h4>
      {detectors.map((detector) => {
        const key = detector.identity.key;
        const settled = settledValues(detector, detection.detectors[key]);
        return detector.parameters.map((parameter) => (
          <Setting
            key={`${key}-${parameter.key}`}
            parameter={parameter}
            value={
              settled.ok
                ? (settled.value.get(parameter.key) ?? parameter.defaultValue)
                : parameter.defaultValue
            }
            send={(value) => {
              commands.run('analysis.analyse-again', {
                view: panel,
                [detectorArgument(key, parameter.key)]: value,
              });
              return valuesRefusal(
                overlaid(detection.detectors, { [key]: { [parameter.key]: value } }),
              );
            }}
          />
        ));
      })}
    </>
  );
}
