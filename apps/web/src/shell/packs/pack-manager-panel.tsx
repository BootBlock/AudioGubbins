/**
 * The Model packs panel (REQ-AUDIO-139, ADR-0062): every pack version the
 * catalogue offers and every one kept here, each as `pack-row.tsx` shows it,
 * what the open project needs of them, and importing a pack from a folder.
 *
 * The state shown is the installer's, as the manager follows it, so a
 * download's progress moves its own row and no other: each row is keyed by
 * its pack and version. The catalogue is asked for once as the panel is first
 * shown, and again only when the person asks, never because a project opened.
 * Every action is a pack command; the panel writes nothing (`CLAUDE.md` G2).
 */

import { useEffect, useId, useSyncExternalStore, type ReactNode } from 'react';

import {
  packKey,
  packVersionCondition,
  refOf,
  type AvailabilityContext,
  type Installation,
  type ModelPackManifest,
} from '@audiogubbins/model-packs';

import { CONDITION_NAMES, packTitle } from '../../ml/pack-words.js';
import type { KnownAvailability } from '../../ml/model-availability.js';
import type { PackManagerState, PackManagerView } from '../../ml/pack-manager.js';
import { projectNeeds, type ProjectNeed } from '../../ml/pack-needs.js';
import type { Observable } from '../../state/observable.js';
import type { OpenProjectState } from '../../state/open-project-store.js';
import { CommandButton, type PanelCommands } from '../command-button.js';
import { PackRow, type PackVersion } from './pack-row.js';

/** What the Model packs panel reads. */
export interface PackManagerParts {
  readonly packs: PackManagerView;
  /** The project open here, absent where this browser keeps no projects. */
  readonly project: Observable<OpenProjectState> | undefined;
}

/** No project open, the one value of the stand-in below, so a reader sees it never change. */
const NONE_OPEN: OpenProjectState = { kind: 'none' };

/** A project that is never open, standing in where this browser keeps none. */
const NO_PROJECT: Observable<OpenProjectState> = {
  get: () => NONE_OPEN,
  subscribe: () => () => undefined,
};

/** The catalogue as last read, or none where it has not been. */
function offeredOf(state: PackManagerState): readonly ModelPackManifest[] {
  return state.catalogue.kind === 'unasked' ? [] : state.catalogue.packs;
}

/** Availability's context with the catalogue as last read, where availability is known. */
function contextOf(
  known: KnownAvailability,
  offered: readonly ModelPackManifest[],
): AvailabilityContext | undefined {
  return known.kind === 'known' ? { ...known.context, catalogue: offered } : undefined;
}

/**
 * Every version kept and every one offered, once each by pack and version, in
 * that order, with what holds for each.
 */
function versionsOf(
  state: PackManagerState,
  context: AvailabilityContext | undefined,
): readonly PackVersion[] {
  const offered = offeredOf(state);
  const kept = new Map<string, Installation>(
    state.installations.map((one) => [packKey(one.ref), one]),
  );
  const versionOf = (
    ref: Installation['ref'],
    manifest: ModelPackManifest | undefined,
    installation: Installation | undefined,
  ): PackVersion => ({
    ref,
    manifest,
    state: installation?.state ?? { kind: 'available' },
    condition:
      context === undefined || manifest === undefined
        ? undefined
        : packVersionCondition(manifest, context),
    needed: state.needed.get(packKey(ref)),
  });
  const versions = state.installations.map((one) =>
    versionOf(
      one.ref,
      one.manifest ?? offered.find((each) => packKey(refOf(each)) === packKey(one.ref)),
      one,
    ),
  );
  for (const manifest of offered) {
    if (!kept.has(packKey(refOf(manifest)))) {
      versions.push(versionOf(refOf(manifest), manifest, undefined));
    }
  }
  return versions;
}

/** What the catalogue is doing, or what it came to. */
function CatalogueLine({ state }: { readonly state: PackManagerState }): ReactNode {
  const { catalogue } = state;
  switch (catalogue.kind) {
    case 'unasked':
      return <p className="ag-panel-note">The catalogue has not been asked this session.</p>;
    case 'reading':
      return <p role="status">Asking the catalogue what it offers…</p>;
    case 'read':
      return null;
    case 'failed':
      return <p role="status">{`The catalogue could not be read. ${catalogue.reason}`}</p>;
  }
}

/** What the open project needs of the packs, and which condition holds for each. */
function ProjectNeeds({
  needs,
  commands,
}: {
  readonly needs: readonly ProjectNeed[];
  readonly commands: PanelCommands;
}): ReactNode {
  const heading = useId();
  if (needs.length === 0) return null;
  return (
    <div role="group" aria-labelledby={heading}>
      <h3 className="ag-section-heading" id={heading}>
        What the open project needs
      </h3>
      <ul className="ag-pack-needs">
        {needs.map(({ key, label, availability }) => {
          const offered =
            availability.condition === 'required-unavailable' ||
            availability.condition === 'optional-unavailable' ||
            availability.condition === 'incompatible'
              ? availability.offered
              : undefined;
          return (
            <li key={key}>
              <span>{`${label}: ${CONDITION_NAMES[availability.condition]}.`}</span>
              {'reason' in availability && <span>{` ${availability.reason.summary}`}</span>}
              {offered !== undefined && (
                <CommandButton
                  id="packs.install"
                  label={`Install ${packTitle(offered.name, offered.version)}`}
                  commands={commands}
                  args={{ id: offered.id, version: offered.version }}
                  compact
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Every version offered or kept, each its own row, keyed by its pack and version. */
function PackList({
  state,
  context,
  commands,
}: {
  readonly state: PackManagerState;
  readonly context: AvailabilityContext | undefined;
  readonly commands: PanelCommands;
}): ReactNode {
  const heading = useId();
  const versions = versionsOf(state, context);
  const offered = new Set(offeredOf(state).map((manifest) => packKey(refOf(manifest))));
  return (
    <div role="group" aria-labelledby={heading}>
      <h3 className="ag-section-heading" id={heading}>
        Packs
      </h3>
      {versions.length === 0 ? (
        <p>No pack is kept here, and the catalogue offers none.</p>
      ) : (
        <ul className="ag-pack-list">
          {versions.map((version) => (
            <PackRow
              key={packKey(version.ref)}
              version={version}
              offered={offered.has(packKey(version.ref))}
              commands={commands}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Asking the catalogue again, and importing a pack from a folder. */
function PackActions({ commands }: { readonly commands: PanelCommands }): ReactNode {
  return (
    <div className="ag-settings-row">
      <CommandButton
        id="packs.refresh-catalogue"
        label="Check the catalogue again"
        commands={commands}
        compact
      />
      <CommandButton
        id="packs.import"
        label="Import a pack from a folder…"
        commands={commands}
        compact
      />
    </div>
  );
}

/** The Model packs panel. */
export function PackManagerPanel({
  title,
  parts,
  commands,
}: {
  readonly title: string;
  readonly parts: PackManagerParts;
  readonly commands: PanelCommands;
}): ReactNode {
  const state = useSyncExternalStore(parts.packs.subscribe, parts.packs.get);
  const { availability, unavailable } = parts.packs;
  const known = useSyncExternalStore(availability.subscribe, availability.get);
  const project = parts.project ?? NO_PROJECT;
  const open = useSyncExternalStore(project.subscribe, project.get);
  const unasked = state.catalogue.kind === 'unasked';

  // Asked once as the panel is first shown, where packs can be kept here.
  useEffect(() => {
    if (unasked && unavailable === undefined) commands.run('packs.refresh-catalogue');
  }, [unasked, unavailable, commands]);

  const context = contextOf(known, offeredOf(state));
  const needs =
    open.kind === 'open' && context !== undefined
      ? projectNeeds(open.snapshot.model.state, context)
      : [];
  return (
    <section className="ag-panel ag-packs">
      <h2 className="ag-panel-title">{title}</h2>
      <p className="ag-panel-note">
        Model packs hold the machine-learning models some processors run, here on this device.
        Nothing is downloaded until you install a pack, and no audio leaves this device.
      </p>
      {unavailable !== undefined ? (
        <p>{unavailable}</p>
      ) : (
        <>
          <PackActions commands={commands} />
          <CatalogueLine state={state} />
          {state.problem !== undefined && <p role="status">{state.problem}</p>}
          {context === undefined && (
            <p className="ag-panel-note">Which packs can run on this device is not known yet.</p>
          )}
          <ProjectNeeds needs={needs} commands={commands} />
          <PackList state={state} context={context} commands={commands} />
        </>
      )}
    </section>
  );
}
