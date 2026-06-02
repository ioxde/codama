import { expect, test } from 'vitest';

import { argumentValueNode } from '../../src';

test('it returns the right node kind', () => {
    const node = argumentValueNode('space');
    expect(node.kind).toBe('argumentValueNode');
});

test('it returns a frozen object', () => {
    const node = argumentValueNode('space');
    expect(Object.isFrozen(node)).toBe(true);
});

test('it camelCases the name', () => {
    expect(argumentValueNode('my_arg').name).toBe('myArg');
});

test.each([undefined, []])('it omits path when absent or empty (%j)', path => {
    const node = argumentValueNode('foo', path);
    expect(node.path).toBeUndefined();
    expect('path' in node).toBe(false);
});

test('it stores name and path independently', () => {
    // #992 convention: name is the root arg; path is the sub-field path from that root.
    const node = argumentValueNode('args', ['owner_key']);
    expect(node.name).toBe('args');
    expect(node.path).toEqual(['ownerKey']);
});

test.each([
    [
        ['input', 'inner_struct', 'seed_enum'],
        ['input', 'innerStruct', 'seedEnum'],
    ],
    [
        ['foo', '0', 'bar'],
        ['foo', '0', 'bar'],
    ],
])('it camelCases path segments, preserving numeric indices (%j)', (input, expected) => {
    expect(argumentValueNode('x', input).path).toEqual(expected);
});

test('it returns a frozen path array', () => {
    expect(Object.isFrozen(argumentValueNode('b', ['a', 'b']).path)).toBe(true);
});
