/**
 * The scenario set up, as the person changes it (ADR-0104): its name, space,
 * seed and panning, the listener, the bus levels and each emitter, with every
 * reason it cannot be played as it stands. A change is the session's until
 * the scenario is kept; while a run plays it, what can be heard moving is
 * heard at once and the rest from the next run, which the panel says.
 */

import { useId, useMemo, type ReactNode } from 'react';

import { Button, TextField } from '@audiogubbins/design-system';
import type { IdGenerator, Project } from '@audiogubbins/domain';
import {
  busName,
  memberKey,
  previewScenarioProblems,
  resolveAll,
  type BusName,
  type GameAudioState,
  type GamePreviewScenario,
  type PreviewEmitterId,
} from '@audiogubbins/game-audio';

import type { PanelCommands } from '../command-button.js';
import { ChoiceField, NumberField, type Choice } from '../export/setting-fields.js';
import { EmitterEditor } from './emitter-editor.js';
import { PositionFields } from './position-fields.js';
import { newEmitter } from '../../state/scenario-drafts.js';

/** The most emitters a scenario has. */
const MOST_EMITTERS = 16;

const SPACES: readonly Choice<GamePreviewScenario['space']>[] = [
  { value: '3d', label: '3D' },
  { value: '2d', label: '2D' },
];

/** What the scenario editor reads. */
export interface ScenarioParts {
  readonly project: Project;
  readonly game: GameAudioState | undefined;
  readonly ids: IdGenerator;
  readonly commands: PanelCommands;
  /** Each emitter's voices sounding and limit, while a run of this scenario plays. */
  readonly voices:
    | ReadonlyMap<PreviewEmitterId, { readonly sounding: number; readonly limit: number }>
    | undefined;
}

/** The buses the members of `scenario`'s subjects play on, each once, sorted, `Master` among them where one sets none. */
function busesOf(
  project: Project,
  game: GameAudioState | undefined,
  scenario: GamePreviewScenario,
): readonly BusName[] {
  if (game === undefined) return [];
  const policies = resolveAll(project, game);
  const master = busName('Master');
  const names = new Set<BusName>();
  for (const { subject } of scenario.emitters) {
    const members =
      subject.kind === 'member'
        ? [subject.member]
        : game.memberships.filter((one) => one.group === subject.group).map((one) => one.member);
    for (const member of members) {
      const bus = policies.get(memberKey(member))?.bus.value;
      if (bus !== undefined) names.add(bus);
      else if (master.ok) names.add(master.value);
    }
  }
  return [...names].toSorted((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

/** `scenario` moved into `space`: a position in 2D has no z. */
function inSpace(
  scenario: GamePreviewScenario,
  space: GamePreviewScenario['space'],
): GamePreviewScenario {
  if (space === scenario.space) return scenario;
  const flat = <P extends { readonly z: number }>(at: P): P =>
    space === '2d' ? { ...at, z: 0 } : at;
  return {
    ...scenario,
    space,
    listener: { ...scenario.listener, at: flat(scenario.listener.at) },
    emitters: scenario.emitters.map((emitter) => ({
      ...emitter,
      motion:
        emitter.motion.kind === 'still'
          ? { kind: 'still', at: flat(emitter.motion.at) }
          : {
              ...emitter.motion,
              points: emitter.motion.points.map((one) => ({ ...one, at: flat(one.at) })),
            },
    })),
  };
}

function BusLevels({
  buses,
  scenario,
  onScenario,
}: {
  readonly buses: readonly BusName[];
  readonly scenario: GamePreviewScenario;
  readonly onScenario: (scenario: GamePreviewScenario) => void;
}): ReactNode {
  if (buses.length === 0) return null;
  return (
    <div className="ag-preview-buses" role="group" aria-label="Bus levels">
      {buses.map((bus) => (
        <NumberField
          key={bus}
          label={`${bus} bus level`}
          unit="decibels, −80 to 24"
          value={scenario.busLevels.find((one) => one.bus === bus)?.decibels ?? 0}
          onNumber={(decibels) => {
            onScenario({
              ...scenario,
              busLevels: [
                ...scenario.busLevels.filter((one) => one.bus !== bus),
                { bus, decibels },
              ],
            });
          }}
        />
      ))}
    </div>
  );
}

/** What a part of the editor is given: the scenario, and how to change it. */
interface Editing {
  readonly scenario: GamePreviewScenario;
  readonly onScenario: (scenario: GamePreviewScenario) => void;
}

/** The scenario's own fields: its name, space, seed and panning. */
function ScenarioFields({ scenario, onScenario }: Editing): ReactNode {
  return (
    <>
      <TextField
        label="Scenario name"
        value={scenario.name}
        maxLength={128}
        onValueChange={(name) => {
          onScenario({ ...scenario, name });
        }}
      />
      <ChoiceField
        label="Space"
        value={scenario.space}
        choices={SPACES}
        onChoose={(space) => {
          onScenario(inSpace(scenario, space));
        }}
      />
      <NumberField
        label="Seed"
        description="The same seed draws the same choices every run."
        value={scenario.seed}
        onNumber={(seed) => {
          onScenario({ ...scenario, seed });
        }}
      />
      {scenario.space === '2d' ? (
        <NumberField
          label="Pan width"
          unit="pixels to the side at which a pan is full"
          value={scenario.panWidth}
          onNumber={(panWidth) => {
            onScenario({ ...scenario, panWidth });
          }}
        />
      ) : null}
      <NumberField
        label="Panning strength"
        description="0 keeps every sound centred; 1 pans fully. Godot's default is 0.5."
        value={scenario.panningStrength}
        onNumber={(panningStrength) => {
          onScenario({ ...scenario, panningStrength });
        }}
      />
    </>
  );
}

/** Where the listener stands, and which way it faces. */
function ListenerFields({ scenario, onScenario }: Editing): ReactNode {
  const { listener } = scenario;
  return (
    <>
      <PositionFields
        label="Listener"
        at={listener.at}
        space={scenario.space}
        onPosition={(at) => {
          onScenario({ ...scenario, listener: { ...listener, at } });
        }}
      />
      <NumberField
        label="Listener facing"
        unit="turns, 0 facing ahead"
        value={listener.facingTurns}
        onNumber={(facingTurns) => {
          onScenario({ ...scenario, listener: { ...listener, facingTurns } });
        }}
      />
    </>
  );
}

/** Each emitter's editor, and adding one more. */
function EmitterList({
  scenario,
  onScenario,
  parts,
}: Editing & { readonly parts: ScenarioParts }): ReactNode {
  const { emitters } = scenario;
  const first = emitters[0]?.subject;
  const { project, game, ids, commands, voices } = parts;
  return (
    <>
      {emitters.map((emitter, index) => (
        <EmitterEditor
          key={emitter.id}
          emitter={emitter}
          parts={{
            project,
            game,
            space: scenario.space,
            commands,
            voices: voices?.get(emitter.id),
          }}
          onEmitter={(changed) => {
            onScenario({
              ...scenario,
              emitters: emitters.map((one, at) => (at === index ? changed : one)),
            });
          }}
          onRemove={
            emitters.length === 1
              ? undefined
              : () => {
                  onScenario({ ...scenario, emitters: emitters.filter((_, at) => at !== index) });
                }
          }
        />
      ))}
      {first === undefined || emitters.length >= MOST_EMITTERS ? null : (
        <Button
          compact
          onClick={() => {
            const added = newEmitter(ids, first, emitters.length + 1, scenario.space);
            onScenario({ ...scenario, emitters: [...emitters, added] });
          }}
        >
          Add an emitter
        </Button>
      )}
    </>
  );
}

/** The editor of `scenario`, which `onScenario` changes. */
export function ScenarioEditor({
  scenario,
  parts,
  onScenario,
}: Editing & { readonly parts: ScenarioParts }): ReactNode {
  const heading = useId();
  const { project, game } = parts;
  const problems = useMemo(() => previewScenarioProblems(scenario), [scenario]);
  const buses = useMemo(() => busesOf(project, game, scenario), [project, game, scenario]);
  return (
    <section className="ag-inspector-section" aria-labelledby={heading}>
      <h3 className="ag-inspector-heading" id={heading}>
        {scenario.name}
      </h3>
      <ScenarioFields scenario={scenario} onScenario={onScenario} />
      <ListenerFields scenario={scenario} onScenario={onScenario} />
      <BusLevels buses={buses} scenario={scenario} onScenario={onScenario} />
      {problems.length === 0 ? null : (
        <ul className="ag-preview-problems" aria-label="Why this scenario cannot be played yet">
          {problems.map((problem, index) => (
            <li key={index}>{problem.summary}</li>
          ))}
        </ul>
      )}
      <EmitterList scenario={scenario} onScenario={onScenario} parts={parts} />
    </section>
  );
}
