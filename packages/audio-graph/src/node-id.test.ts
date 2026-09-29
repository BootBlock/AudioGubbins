import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { describe, expect, it } from 'vitest';

import { childNodeId, nodeId } from './node-id.js';

describe('nodeId', () => {
  it.each(['gain', 'eq-2', '3band', 'bus/reverb', 'a/b/c-1'])('accepts %s', (value) => {
    expect(expectSuccess(nodeId(value))).toBe(value);
  });

  it.each(['', 'Gain', '-gain', 'a//b', 'a/', '/a', 'a b', 'a.b', 'a/-b'])(
    'refuses "%s"',
    (value) => {
      expect(expectFailureCode(nodeId(value))).toBe('graph.node-id-invalid');
    },
  );

  it('names an inner node of a subgraph under the subgraph', () => {
    const child = childNodeId(expectSuccess(nodeId('bus')), expectSuccess(nodeId('verb/tail')));
    expect(child).toBe('bus/verb/tail');
    expect(expectSuccess(nodeId(child))).toBe(child);
  });
});
