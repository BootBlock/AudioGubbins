/**
 * The asset groups' forest as an ARIA tree (ADR-0101, REQ-UX-005): each group a
 * tree item at its depth, with roving focus, so the tree is one stop in the tab
 * order and the arrows move inside it. Up and Down move to the item before and
 * after, Right opens a closed group or moves into an open one, Left closes an
 * open group or moves to its parent, Home and End go to the first and last,
 * Enter chooses the group, which the Inspector then shows, F2 renames it in
 * place, Escape putting the name back, and Delete deletes it, its refusal said
 * where it holds members or groups. A press chooses the group too.
 *
 * Every change is the command of its name, which the palette runs as well;
 * the tree keeps only which groups are closed and which one has the focus.
 */

import { useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';

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

/** What a key on a tree item may do: move the focus, open or close a group, or run a command on it. */
interface TreeMoves {
  readonly focus: (group: GameAssetGroupId | undefined) => void;
  readonly toggled: (group: GameAssetGroupId, open: boolean) => void;
  readonly isOpen: (row: TreeRow) => boolean;
  readonly rename: (group: GameAssetGroupId) => void;
  readonly run: PanelCommands['run'];
}

/** What each key does on the item `row`, the `index`th of `rows` (see the module comment). */
function keyActions(
  rows: readonly TreeRow[],
  row: TreeRow,
  index: number,
  moves: TreeMoves,
): Readonly<Record<string, () => void>> {
  const { focus, toggled } = moves;
  const open = moves.isOpen(row);
  const group = row.group.id;
  return {
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
      else toggled(group, true);
    },
    ArrowLeft: () => {
      if (open) toggled(group, false);
      else focus(row.parent);
    },
    Enter: () => {
      moves.run('game.choose-group', { group });
    },
    F2: () => {
      moves.rename(group);
    },
    Delete: () => {
      moves.run('game.delete-group', { group });
    },
  };
}

/** The style that indents an item by its depth, which the stylesheet reads as `--ag-group-depth`. */
function depthStyle(depth: number): CSSProperties & { readonly '--ag-group-depth': number } {
  return { '--ag-group-depth': depth };
}

/** What a group's item says: that it is chosen, its name, and how many members it has. */
function itemWords(view: GamePolicyView, group: GameAssetGroup, chosen: boolean): string {
  const members = view.membersOf(group.id).length;
  return `${chosen ? '▸ ' : ''}${group.name} (${String(members)} ${members === 1 ? 'member' : 'members'})`;
}

/** What every item of the tree reads: the tree's state, and how it moves and runs commands. */
interface TreeParts {
  readonly view: GamePolicyView;
  readonly rows: readonly TreeRow[];
  readonly chosen: GameAssetGroupId | undefined;
  /** The item that takes the tab stop. */
  readonly stop: GameAssetGroupId | undefined;
  readonly closed: ReadonlySet<GameAssetGroupId>;
  readonly renaming: GameAssetGroupId | undefined;
  readonly moves: TreeMoves;
  /** Each item shown, which the focus is moved to; read only in an event or a ref's callback. */
  readonly items: { readonly current: Map<GameAssetGroupId, HTMLLIElement> };
  readonly focused: (group: GameAssetGroupId) => void;
  readonly renamed: (group: GameAssetGroupId) => void;
  readonly commands: PanelCommands;
}

/** What a key does on the item `row`, the `index`th of the tree's rows. */
function onItemKey(event: KeyboardEvent, row: TreeRow, index: number, tree: TreeParts): void {
  if (event.target !== event.currentTarget) {
    // Escape in the name field puts the name back as it was.
    if (event.key === 'Escape' && tree.renaming === row.group.id) {
      event.preventDefault();
      tree.renamed(row.group.id);
    }
    return;
  }
  const act = keyActions(tree.rows, row, index, tree.moves)[event.key];
  if (act === undefined) return;
  event.preventDefault();
  act();
}

/** One group's item of the tree, at its depth, and what its keys and a press do. */
function TreeItem({
  row,
  index,
  tree,
}: {
  readonly row: TreeRow;
  readonly index: number;
  readonly tree: TreeParts;
}): ReactNode {
  const { group } = row;
  return (
    <li
      ref={(element) => {
        if (element === null) tree.items.current.delete(group.id);
        else tree.items.current.set(group.id, element);
      }}
      role="treeitem"
      aria-level={row.level}
      aria-selected={group.id === tree.chosen}
      {...(row.hasChildren ? { 'aria-expanded': !tree.closed.has(group.id) } : {})}
      tabIndex={tree.stop === group.id ? 0 : -1}
      style={depthStyle(row.level - 1)}
      onFocus={(event) => {
        if (event.target === event.currentTarget) tree.focused(group.id);
      }}
      onKeyDown={(event) => {
        onItemKey(event, row, index, tree);
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          tree.commands.run('game.choose-group', { group: group.id });
        }
      }}
    >
      {tree.renaming === group.id ? (
        <RenameField
          group={group}
          commands={tree.commands}
          onDone={() => {
            tree.renamed(group.id);
          }}
        />
      ) : (
        itemWords(tree.view, group, group.id === tree.chosen)
      )}
    </li>
  );
}

/** The tree's state, which groups are closed, focused and being renamed, and how it moves. */
function useTree(
  view: GamePolicyView,
  chosen: GameAssetGroupId | undefined,
  commands: PanelCommands,
): TreeParts {
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
  const moves: TreeMoves = {
    focus: (group) => {
      if (group === undefined) return;
      setFocused(group);
      items.current.get(group)?.focus();
    },
    toggled: (group, open) => {
      const next = new Set(closed);
      if (open) next.delete(group);
      else next.add(group);
      setClosed(next);
    },
    isOpen: (row) => row.hasChildren && !closed.has(row.group.id),
    rename: setRenaming,
    run: commands.run,
  };
  return {
    view,
    rows,
    chosen,
    stop: stop?.group.id,
    closed,
    renaming,
    moves,
    items,
    focused: setFocused,
    renamed: (group) => {
      setRenaming(undefined);
      moves.focus(group);
    },
    commands,
  };
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
  const tree = useTree(view, chosen, commands);
  if (tree.rows.length === 0) {
    return <p>No asset groups yet. Make one to give sounds a shared policy.</p>;
  }
  return (
    <ul role="tree" aria-label={label} className="ag-group-tree">
      {tree.rows.map((row, index) => (
        <TreeItem key={row.group.id} row={row} index={index} tree={tree} />
      ))}
    </ul>
  );
}
