/**
 * The asset groups' forest as an ARIA tree (ADR-0101, REQ-UX-005): each group
 * a tree item at its depth, with roving focus, so the tree is one stop in the
 * tab order and the arrows move inside it. Up and Down move to the item
 * before and after, Right opens a closed group or moves into an open one,
 * Left closes an open group or moves to its parent, Home and End go to the
 * first and last, Enter chooses the group, which the Inspector then shows,
 * F2 renames it in place, Escape putting the name back, and Delete deletes
 * it, its refusal said where it holds members or groups. A press chooses the
 * group too.
 *
 * Every change is the command of its name, which the palette runs as well;
 * the tree keeps only which groups are closed and which one has the focus.
 */

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { TextField } from '@audiogubbins/design-system';
import type { GameAssetGroup, GameAssetGroupId } from '@audiogubbins/game-audio';

import type { GamePolicyView } from '../../state/game-policy-view.js';
import type { PanelCommands } from '../command-button.js';

/** A group as the tree shows it: where it sits, and whether it has groups inside it. */
interface TreeRow {
  readonly group: GameAssetGroup;
  readonly level: number;
  readonly parent: GameAssetGroupId | undefined;
  readonly hasChildren: boolean;
}

/** The rows shown, depth first in the order the view gives, a closed group's inside left out. */
function rowsOf(view: GamePolicyView, closed: ReadonlySet<GameAssetGroupId>): readonly TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (parent: GameAssetGroupId | undefined, level: number): void => {
    for (const group of view.childrenOf(parent)) {
      const hasChildren = view.childrenOf(group.id).length > 0;
      rows.push({ group, level, parent, hasChildren });
      if (hasChildren && !closed.has(group.id)) walk(group.id, level + 1);
    }
  };
  walk(undefined, 1);
  return rows;
}

/** The name typed in place of a group's, kept by the rename command once it is entered. */
function RenameField({
  group,
  commands,
  onDone,
}: {
  readonly group: GameAssetGroup;
  readonly commands: PanelCommands;
  readonly onDone: () => void;
}): ReactNode {
  const [name, setName] = useState(group.name);
  return (
    <TextField
      label={`New name for ${group.name}`}
      value={name}
      onValueChange={setName}
      onSubmit={() => {
        commands.run('game.rename-group', { group: group.id, name });
        onDone();
      }}
    />
  );
}

/** The asset groups' tree (see the module comment). */
export function GroupTree({
  view,
  chosen,
  commands,
  label,
}: {
  readonly view: GamePolicyView;
  readonly chosen: GameAssetGroupId | undefined;
  readonly commands: PanelCommands;
  readonly label: string;
}): ReactNode {
  const [closed, setClosed] = useState<ReadonlySet<GameAssetGroupId>>(new Set());
  const [focused, setFocused] = useState<GameAssetGroupId | undefined>(undefined);
  const [renaming, setRenaming] = useState<GameAssetGroupId | undefined>(undefined);
  const items = useRef(new Map<GameAssetGroupId, HTMLLIElement>());
  const rows = rowsOf(view, closed);
  // The item that takes the tab stop: the one last focused, else the one
  // chosen, else the first, while it is shown.
  const stop =
    rows.find((row) => row.group.id === focused) ??
    rows.find((row) => row.group.id === chosen) ??
    rows[0];

  const focus = (group: GameAssetGroupId | undefined): void => {
    if (group === undefined) return;
    setFocused(group);
    items.current.get(group)?.focus();
  };
  const toggled = (group: GameAssetGroupId, open: boolean): void => {
    const next = new Set(closed);
    if (open) next.delete(group);
    else next.add(group);
    setClosed(next);
  };

  const onKeyDown = (event: KeyboardEvent, row: TreeRow, index: number): void => {
    const open = row.hasChildren && !closed.has(row.group.id);
    const keys: Readonly<Record<string, () => void>> = {
      ArrowDown: () => {
        focus(rows[index + 1]?.group.id);
      },
      ArrowUp: () => {
        focus(rows[index - 1]?.group.id);
      },
      Home: () => {
        focus(rows[0]?.group.id);
      },
      End: () => {
        focus(rows.at(-1)?.group.id);
      },
      ArrowRight: () => {
        if (!row.hasChildren) return;
        if (open) focus(rows[index + 1]?.group.id);
        else toggled(row.group.id, true);
      },
      ArrowLeft: () => {
        if (open) toggled(row.group.id, false);
        else focus(row.parent);
      },
      Enter: () => {
        commands.run('game.choose-group', { group: row.group.id });
      },
      F2: () => {
        setRenaming(row.group.id);
      },
      Delete: () => {
        commands.run('game.delete-group', { group: row.group.id });
      },
    };
    const act = keys[event.key];
    if (act === undefined) return;
    event.preventDefault();
    act();
  };

  if (rows.length === 0)
    return <p>No asset groups yet. Make one to give sounds a shared policy.</p>;
  return (
    <ul role="tree" aria-label={label} className="ag-group-tree">
      {rows.map((row, index) => {
        const { group } = row;
        const isChosen = group.id === chosen;
        const members = view.membersOf(group.id).length;
        return (
          <li
            key={group.id}
            ref={(element) => {
              if (element === null) items.current.delete(group.id);
              else items.current.set(group.id, element);
            }}
            role="treeitem"
            aria-level={row.level}
            aria-selected={isChosen}
            {...(row.hasChildren ? { 'aria-expanded': !closed.has(group.id) } : {})}
            tabIndex={stop?.group.id === group.id ? 0 : -1}
            style={{ paddingInlineStart: `${String(row.level - 1)}rem` }}
            onFocus={(event) => {
              if (event.target === event.currentTarget) setFocused(group.id);
            }}
            onKeyDown={(event) => {
              if (event.target === event.currentTarget) onKeyDown(event, row, index);
              else if (event.key === 'Escape' && renaming === group.id) {
                // Escape in the name field puts the name back as it was.
                event.preventDefault();
                setRenaming(undefined);
                focus(group.id);
              }
            }}
            onClick={(event) => {
              if (event.target !== event.currentTarget) return;
              commands.run('game.choose-group', { group: group.id });
            }}
          >
            {renaming === group.id ? (
              <RenameField
                group={group}
                commands={commands}
                onDone={() => {
                  setRenaming(undefined);
                  focus(group.id);
                }}
              />
            ) : (
              `${isChosen ? '▸ ' : ''}${group.name} (${String(members)} ${members === 1 ? 'member' : 'members'})`
            )}
          </li>
        );
      })}
    </ul>
  );
}
