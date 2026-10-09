import { describe, expect, it } from 'vitest';

import { cataloguePathProblem, packFilePathProblem } from './pack-path.js';

describe('the pack path grammar', () => {
  it('admits a file of a pack version and the catalogue’s own file', () => {
    expect(cataloguePathProblem('catalogue.json')).toBeUndefined();
    expect(cataloguePathProblem('deepfilternet-3/1.0.0/models/enc.onnx')).toBeUndefined();
    expect(packFilePathProblem('models/enc.onnx')).toBeUndefined();
  });

  // Each form names a place outside the folder a pack is served or kept in.
  it.each([
    ['another drive', 'D:/secret.txt', /never absolute/u],
    ['a drive with a backslash', 'C:\\secret.txt', /never a backslash/u],
    ['the extended-length form', '\\\\?\\C:\\secret.txt', /never a backslash/u],
    ['a share', '\\\\example.test\\share\\secret.txt', /never a backslash/u],
    ['a share written with slashes', '//example.test/share/secret.txt', /never absolute/u],
    ['an absolute path', '/etc/secret.txt', /never absolute/u],
    ['a climb out', 'models/../../secret.txt', /never climbs out/u],
  ])('refuses %s in a file’s path', (_form, path, reason) => {
    expect(packFilePathProblem(path)).toMatch(reason);
    expect(cataloguePathProblem(`sample-pack/1.0.0/${path}`)).toMatch(reason);
  });

  it.each([
    ['a drive for the pack', 'C:/1.0.0/model.onnx'],
    ['a share for the pack', '\\\\example.test/1.0.0/model.onnx'],
    ['an absolute path', '/sample-pack/1.0.0/model.onnx'],
    ['a climb out for the pack', '../1.0.0/model.onnx'],
    ['a climb out for the version', 'sample-pack/../model.onnx'],
    ['a pack version and no file', 'sample-pack/1.0.0'],
    ['a pack and no version', 'sample-pack'],
  ])('refuses %s under the catalogue', (_form, path) => {
    expect(cataloguePathProblem(path)).toBeDefined();
  });
});
