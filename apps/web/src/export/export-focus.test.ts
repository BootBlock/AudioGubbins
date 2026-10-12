import { describe, expect, it } from 'vitest';

import { unsafeBrandId } from '@audiogubbins/domain';
import { activePanelOf, PanelKinds } from '@audiogubbins/workspace';

import { buildShellContext } from '../testing/shell-context.js';
import type { ExportSubject } from './export-focus.js';

const RECORD: ExportSubject = { kind: 'record', record: unsafeBrandId('export-record-1') };

describe('an export as the Inspector’s subject (REQ-EDIT-072)', () => {
  it('stays the subject while other panels are used, and gives way to an editor brought into use', () => {
    const { context } = buildShellContext();
    const { workspace, exportFocus } = context;
    expect(workspace.openPanel(PanelKinds.Editor)).toBeUndefined();

    exportFocus.inspect(RECORD);
    expect(workspace.openPanel(PanelKinds.AssetBrowser)).toBeUndefined();
    expect(workspace.openPanel(PanelKinds.Inspector)).toBeUndefined();
    expect(exportFocus.subject.get()).toEqual(RECORD);

    expect(workspace.openPanel(PanelKinds.Editor)).toBeUndefined();
    expect(exportFocus.subject.get()).toBeUndefined();
  });

  it('is not given up by a change of the workspace with the editor still in use', () => {
    const { context } = buildShellContext();
    const { workspace, exportFocus } = context;
    expect(workspace.openPanel(PanelKinds.Editor)).toBeUndefined();
    exportFocus.inspect({ kind: 'batch' });

    const editor = activePanelOf(workspace.get().layout);
    expect(editor?.kind).toBe(PanelKinds.Editor);
    expect(workspace.resizeGroup(editor?.id ?? '', 1)).toBeUndefined();

    expect(exportFocus.subject.get()).toEqual({ kind: 'batch' });
  });

  it('gives way to recording claiming the Inspector, even where recording was its subject before', () => {
    const { context } = buildShellContext();
    const { workspace, exportFocus, recording } = context;
    expect(workspace.openPanel(PanelKinds.Recording)).toBeUndefined();
    expect(recording.focus.get()).toBe(true);

    exportFocus.inspect({ kind: 'batch' });
    expect(exportFocus.subject.get()).toEqual({ kind: 'batch' });

    recording.inspect(undefined);
    expect(exportFocus.subject.get()).toBeUndefined();
  });
});
