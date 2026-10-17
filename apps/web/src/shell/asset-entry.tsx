/**
 * One row of the Asset Browser: an asset or a region of the project, its
 * regions listed under it. An entry a view can open is opened by a press on its
 * name, marked with the lit edge while the editor in use shows it; one it
 * cannot open yet says why, as the editor view of it would.
 */

import type { ReactNode } from 'react';

import {
  Badge,
  BadgeTone,
  Button,
  ButtonTone,
  Icon,
  IconSize,
  Spinner,
} from '@audiogubbins/design-system';

import type { EditorAsset } from '../assets/editor-asset.js';
import type { UnopenedEntry } from '../state/asset-catalogue.js';
import { ExportCommand } from '../commands/import-export-ids.js';
import { EXPORT_BUTTON } from '../import-export-words.js';
import { CommandButton, type PanelCommands } from './command-button.js';

/** An asset or region of the project as the browser lists it. */
export interface BrowserEntry {
  /** The identity a view names it by. */
  readonly id: string;
  /** What a view opens, or why it cannot open it yet. */
  readonly shown: EditorAsset | UnopenedEntry;
  /** The regions of an asset, in the project's order; none for a region. */
  readonly regions: readonly BrowserEntry[];
  /** Which takes an asset is the recording of, where it is a take's (ADR-0072). */
  readonly takes?: string;
}

/** Whether `shown` is a region of the project rather than an asset. */
function isRegion(shown: EditorAsset): boolean {
  return shown.owner.kind === 'project' && shown.owner.region !== undefined;
}

/** The glyph a row leads with: what it is, or that it is still being read. */
function EntryGlyph({ shown }: { readonly shown: BrowserEntry['shown'] }): ReactNode {
  if ('reason' in shown) {
    return shown.kind === 'finding' ? (
      <Spinner size={IconSize.Inline} />
    ) : (
      <Icon name="missing-file" />
    );
  }
  // No region carries a colour of its own yet, so a region is told by its glyph.
  return <Icon name={isRegion(shown) ? 'region' : 'audio-file'} />;
}

/** An entry a view cannot open yet: its name, and why. */
function UnopenedFace({ shown }: { readonly shown: UnopenedEntry }): ReactNode {
  return (
    <>
      <p className="ag-asset-name">{shown.name}</p>
      <p
        className="ag-asset-detail"
        {...(shown.kind === 'unavailable' ? { 'data-ag-status': 'unavailable' } : {})}
      >
        {shown.reason}
      </p>
    </>
  );
}

/**
 * An entry a view can open: its name, the button that opens it, what it is,
 * the takes it records, and a region's export.
 */
function OpenedFace({
  entry,
  shown,
  current,
  commands,
}: {
  readonly entry: BrowserEntry;
  readonly shown: EditorAsset;
  readonly current: boolean;
  readonly commands: PanelCommands;
}): ReactNode {
  const region = shown.owner.kind === 'project' ? shown.owner.region : undefined;
  return (
    <>
      <Button
        tone={ButtonTone.Quiet}
        aria-current={current ? 'true' : undefined}
        onClick={() => {
          commands.run('editor.open-asset', { asset: entry.id });
        }}
      >
        {shown.name}
      </Button>
      <p className="ag-asset-detail">{shown.description}</p>
      {entry.takes !== undefined && <p className="ag-asset-detail">{entry.takes}</p>}
      <span className="ag-asset-actions">
        {entry.takes !== undefined && <Badge tone={BadgeTone.Accent}>Take</Badge>}
        {region !== undefined && (
          <CommandButton
            id={ExportCommand.Region}
            label={EXPORT_BUTTON}
            args={{ region: region.id }}
            commands={commands}
            tone={ButtonTone.Quiet}
            compact
          />
        )}
      </span>
    </>
  );
}

/** One asset or region, and the regions under it. */
export function EntryItem({
  entry,
  inUse,
  commands,
  nested = false,
}: {
  readonly entry: BrowserEntry;
  /** The identity the editor in use shows, where it shows one. */
  readonly inUse: string | undefined;
  readonly commands: PanelCommands;
  readonly nested?: boolean;
}): ReactNode {
  const { shown } = entry;
  const current = inUse === entry.id;
  return (
    <li className="ag-asset-entry">
      <div
        className="ag-asset-row ag-lit-row"
        data-ag-lit={current ? '' : undefined}
        data-ag-nested={nested ? '' : undefined}
      >
        <span className="ag-asset-glyph">
          <EntryGlyph shown={shown} />
        </span>
        {'reason' in shown ? (
          <UnopenedFace shown={shown} />
        ) : (
          <OpenedFace entry={entry} shown={shown} current={current} commands={commands} />
        )}
      </div>
      {entry.regions.length > 0 && (
        <ul className="ag-asset-list ag-asset-sublist" aria-label={`Regions of ${shown.name}`}>
          {entry.regions.map((region) => (
            <EntryItem key={region.id} entry={region} inUse={inUse} commands={commands} nested />
          ))}
        </ul>
      )}
    </li>
  );
}
