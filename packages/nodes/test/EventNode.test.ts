import type { CamelCaseString } from '@codama/node-types';
import { expect, test } from 'vitest';

import { structTypeNode } from '../src';
import { eventNode } from '../src';

test('it returns the right node kind', () => {
    const node = eventNode({ data: structTypeNode([]), name: 'foo' });
    expect(node.kind).toBe('eventNode');
});

test('it returns a frozen object', () => {
    const node = eventNode({ data: structTypeNode([]), name: 'foo' });
    expect(Object.isFrozen(node)).toBe(true);
});

test('it stores the framing metadata when provided', () => {
    const framing = {
        kind: 'anchorEventCpi' as const,
        sharedConstantName: 'anchorEventCpiDiscriminator' as CamelCaseString,
    };
    const node = eventNode({ data: structTypeNode([]), framing, name: 'foo' });
    expect(node.framing).toStrictEqual(framing);
});

test('it omits the framing key when not provided', () => {
    const node = eventNode({ data: structTypeNode([]), name: 'foo' });
    expect('framing' in node).toBe(false);
});
