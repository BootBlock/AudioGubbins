import { describe, expect, it } from 'vitest';

import { DockRegion } from './panel.js';
import { PanelKinds, buildPresets } from './presets.js';

describe('the Recording preset', () => {
  it('puts the Recording panel in front of the transport, given height below the editor', () => {
    const recording = buildPresets(new Set(Object.values(PanelKinds))).find(
      (layout) => layout.id === 'recording',
    );
    const bottom = recording?.groups.find((group) => group.region === DockRegion.Bottom);
    expect(bottom?.panels.map((panel) => panel.kind)).toEqual([
      PanelKinds.Recording,
      PanelKinds.Transport,
    ]);
    expect(bottom?.activePanelId).toBe('recording:recording');
  });

  it('leaves the Recording panel out of a build that has none', () => {
    const recording = buildPresets(new Set([PanelKinds.Editor, PanelKinds.Transport])).find(
      (layout) => layout.id === 'recording',
    );
    expect(recording?.groups.flatMap((group) => group.panels.map((panel) => panel.kind))).toEqual([
      PanelKinds.Editor,
      PanelKinds.Transport,
    ]);
  });
});

describe('the Game Audio preset (REQ-UX-058)', () => {
  it('puts the Asset groups panel a tab beside the Asset Browser, which is in front', () => {
    const layout = buildPresets(new Set(Object.values(PanelKinds))).find(
      (one) => one.id === 'game-audio',
    );
    const left = layout?.groups.find((group) => group.region === DockRegion.Left);

    expect(left?.panels.map((panel) => panel.kind)).toEqual([
      PanelKinds.AssetBrowser,
      PanelKinds.GameGroups,
    ]);
    expect(left?.activePanelId).toBe('game-audio:asset-browser');
  });
});

describe('the Spectral Repair preset (REQ-UX-058)', () => {
  it('puts the Spectral panel in front of the Inspector, beside the editor', () => {
    const repair = buildPresets(new Set(Object.values(PanelKinds))).find(
      (layout) => layout.id === 'spectral-repair',
    );
    const right = repair?.groups.find((group) => group.region === DockRegion.Right);
    expect(right?.panels.map((panel) => panel.kind)).toEqual([
      PanelKinds.Spectral,
      PanelKinds.Inspector,
    ]);
    expect(right?.activePanelId).toBe('spectral-repair:spectral');
  });
});

describe('the Game Audio preset (REQ-UX-058)', () => {
  it('puts the Loop and Game preview panels in tabs beside the transport, the transport in front', () => {
    const game = buildPresets(new Set(Object.values(PanelKinds))).find(
      (layout) => layout.id === 'game-audio',
    );
    const bottom = game?.groups.find((group) => group.region === DockRegion.Bottom);
    expect(bottom?.panels.map((panel) => panel.kind)).toEqual([
      PanelKinds.Transport,
      PanelKinds.LoopEditor,
      PanelKinds.GamePreview,
    ]);
    expect(bottom?.activePanelId).toBe('game-audio:transport');
  });
});
