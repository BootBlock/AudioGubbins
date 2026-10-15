import { describe, expect, it } from 'vitest';

import { BUILT_IN_PRESETS, type ExportPreset } from '@audiogubbins/import-export';

import { profileFromPreset } from './game-export-profile.js';

describe('a game export profile from a preset', () => {
  it("keeps every built-in preset's format and choices", () => {
    for (const preset of BUILT_IN_PRESETS) {
      expect(profileFromPreset(preset)).toEqual({
        format: preset.format,
        choices: preset.settings,
      });
    }
  });

  it('leaves out the range and the file name, which each member and its naming give', () => {
    const preset: ExportPreset = {
      id: 'own',
      name: 'Mine',
      format: 'flac',
      settings: {
        encoding: { bits: 24, compressionLevel: 5, keepRiffChunks: true },
        range: { kind: 'every-region' },
        fileName: '{project}',
      },
    };
    expect(profileFromPreset(preset)).toEqual({
      format: 'flac',
      choices: { encoding: { bits: 24, compressionLevel: 5, keepRiffChunks: true } },
    });
  });
});
