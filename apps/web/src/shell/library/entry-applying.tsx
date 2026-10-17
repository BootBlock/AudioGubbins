/**
 * Applying a Library entry where the editor in use shows (REQ-EDIT-014): a
 * preset to the processor selected, or a chain to the selection, as a copy or
 * as one chain shared, with the way to several targets ticked in the row
 * (`target-chooser.tsx`). Each runs its library command, which refuses while
 * no editor shows the project's audio.
 */

import type { ReactNode } from 'react';

import { Button, ButtonTone, Hint, ToggleSwitch } from '@audiogubbins/design-system';
import type { LibraryEntry } from '@audiogubbins/domain';
import { quoted } from '@audiogubbins/text';

import { CommandButton, type PanelCommands } from '../command-button.js';
import type { Opening } from './row-opening.js';

/** The editor in use, and the name of what it shows, which a chain or preset is applied in. */
export interface Shown {
  readonly panel: string;
  readonly name: string;
}

/** Why applying cannot run while no editor shows the project's audio. */
const NOTHING_SHOWN = 'Open audio of the project in an editor to apply it there.';

/** What either way of applying is given. */
interface ApplyingParts {
  readonly entry: LibraryEntry;
  readonly shown: Shown | undefined;
  readonly commands: PanelCommands;
}

/** The view applying acts in, where an editor shows the project's audio. */
function whereOf(shown: Shown | undefined): { readonly view?: string } {
  return shown === undefined ? {} : { view: shown.panel };
}

/** Applying a preset to the processor selected. */
function ApplyPreset({ entry, shown, commands }: ApplyingParts): ReactNode {
  return (
    <div className="ag-library-apply">
      <CommandButton
        id="library.apply-preset"
        label="Apply to the selected processor"
        commands={commands}
        args={{ entry: entry.id, ...whereOf(shown) }}
        refusal={shown === undefined ? NOTHING_SHOWN : undefined}
        tone={ButtonTone.Primary}
        compact
      />
    </div>
  );
}

/** Applying a chain to the selection, shared or not, or opening the choice of several targets. */
function ApplyChain({
  entry,
  shown,
  commands,
  share,
  onShare,
  opening,
}: ApplyingParts & {
  readonly share: boolean;
  readonly onShare: (share: boolean) => void;
  readonly opening: Opening;
}): ReactNode {
  return (
    <div className="ag-library-apply">
      <span className="ag-library-share">
        <ToggleSwitch label="Share one chain" checked={share} onCheckedChange={onShare} small />
        <Hint label="About sharing one chain">
          <p>
            Every target names one copy, so a later change to it reaches them all. Off, each gets a
            copy of its own.
          </p>
        </Hint>
      </span>
      <Button
        compact
        tone={ButtonTone.Quiet}
        ref={opening.opener('targets')}
        onClick={() => {
          opening.show('targets');
        }}
      >
        Apply to several…
      </Button>
      <CommandButton
        id="library.apply-chain"
        label={shown === undefined ? 'Apply' : `Apply to ${quoted(shown.name)}`}
        commands={commands}
        args={{ entry: entry.id, ...whereOf(shown), share }}
        refusal={shown === undefined ? NOTHING_SHOWN : undefined}
        tone={ButtonTone.Primary}
        compact
      />
    </div>
  );
}

/** Applying an entry where the editor in use shows: a chain shared or not, or a preset. */
export function Applying(
  props: ApplyingParts & {
    readonly share: boolean;
    readonly onShare: (share: boolean) => void;
    readonly opening: Opening;
  },
): ReactNode {
  return props.entry.content.kind === 'preset' ? (
    <ApplyPreset {...props} />
  ) : (
    <ApplyChain {...props} />
  );
}
