/**
 * Opening an asset in an editor view, and opening another view of the asset
 * in use (REQ-EDIT-061): the second view starts fitted to the asset and keeps
 * its own presentation from then on, while the asset's content, selection and
 * playhead are the ones the first view shows.
 */

import { CommandCategory, unchanged, type Command } from '@audiogubbins/commands';
import { PanelKinds, activePanelOf } from '@audiogubbins/workspace';

import type { EditorAsset } from '../assets/editor-asset.js';
import { focusedEditor, needsEditor } from './editor-target.js';
import { shellCommand, textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/**
 * Shows `asset` in the editor panel `panel`, or in a new Editor panel where
 * there is none, so a list outside the editor, as the Asset Browser is, and an
 * import always show what they open. Answers why where it cannot.
 */
export function showInEditor(
  context: ShellContext,
  asset: EditorAsset,
  panel: string | undefined,
): string | undefined {
  let shownIn = panel;
  if (shownIn === undefined) {
    const refused = context.workspace.openPanel(PanelKinds.Editor);
    if (refused !== undefined) return refused;
    const opened = activePanelOf(context.workspace.get().layout);
    if (opened?.kind !== PanelKinds.Editor) return 'The new editor panel could not be found.';
    shownIn = opened.id;
  }
  context.editorViews.open(shownIn, asset);
  context.editorViews.focus(shownIn);
  return undefined;
}

function openAsset(): Command<ShellContext> {
  return shellCommand(
    'editor.open-asset',
    'Open an asset in an editor',
    CommandCategory.File,
    (context, invocation) => {
      const named = textArgument(invocation, 'asset');
      if (named === undefined) return 'Choose an asset to open.';
      const asset = context.assets.find(named);
      if (asset === undefined) {
        const unopened = context.assets.get().unopened.get(named);
        return unopened === undefined
          ? 'That asset is not open in this session.'
          : `${unopened.name} cannot be shown yet. ${unopened.reason}`;
      }
      // Named by a view's own list, or else the editor last in use.
      const view = textArgument(invocation, 'view') ?? context.editorViews.get().focused;
      if (view !== undefined && context.editorViews.entry(view)?.asset === asset.id) {
        return unchanged('editor.open-already', `${asset.name} is open in that view already.`);
      }
      const refused = showInEditor(context, asset, view);
      if (refused !== undefined) return refused;
      context.interaction.announce(`${asset.name} is open in the editor.`);
      return undefined;
    },
    { discoverable: false },
  );
}

function newView(): Command<ShellContext> {
  return shellCommand(
    'editor.new-view',
    'Open another view of this asset',
    CommandCategory.View,
    (context) => {
      const target = focusedEditor(context);
      if (typeof target === 'string') return target;
      const refused = context.workspace.openPanel(PanelKinds.Editor, target.panel);
      if (refused !== undefined) return refused;
      const opened = activePanelOf(context.workspace.get().layout);
      if (opened?.kind !== PanelKinds.Editor) return 'The new editor panel could not be found.';
      context.editorViews.open(opened.id, target.asset);
      context.editorViews.focus(opened.id);
      context.interaction.announce(`A second view of ${target.asset.name} is open.`);
      return undefined;
    },
    {
      keywords: ['view', 'editor', 'another', 'second', 'split', 'duplicate', 'window'],
      description:
        'Opens the asset in use in a new editor panel beside it, with its own zoom, scroll and tool, sharing its markers and selection.',
      availability: needsEditor,
    },
  );
}

/** The commands that open assets in views. */
export function editorAssetCommands(): readonly Command<ShellContext>[] {
  return [openAsset(), newView()];
}
