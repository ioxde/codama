import {
    argumentValueNode,
    arrayTypeNode,
    enumEmptyVariantTypeNode,
    enumTypeNode,
    fixedCountNode,
    instructionArgumentNode,
    instructionNode,
    type NumberTypeNode,
    numberTypeNode,
} from 'codama';
import { describe, expect, test } from 'vitest';

import { makeVisitor } from './pda-seed-value-test-utils';

// Anchor encodes a numeric seed as `value.to_le_bytes()`: LE, two's-complement, no length prefix.
describe('pda-seed-value: numeric seed encoding is little-endian', () => {
    async function encodeSeed(name: string, type: NumberTypeNode, value: unknown): Promise<unknown> {
        const visitor = makeVisitor({
            argumentsInput: { [name]: value },
            ixNode: instructionNode({ arguments: [instructionArgumentNode({ name, type })], name: 'ix' }),
        });
        return await visitor.visitArgumentValue(argumentValueNode(name));
    }

    test('signed i32 -> 4-byte LE (Borsh/Anchor default to_le_bytes)', async () => {
        // 256 chosen because it is not endian-palindromic, so this distinguishes LE from BE.
        expect(await encodeSeed('value', numberTypeNode('i32'), 256)).toEqual(new Uint8Array([0, 1, 0, 0]));
    });

    // The Anchor IDL has no byte-transform field, so BE seeds need a manual
    // node.endian override to derive correctly.
    test('signed i32 honors big-endian when the node declares it', async () => {
        expect(await encodeSeed('dataGroupLowerStartIndex', numberTypeNode('i32', 'be'), 256)).toEqual(
            new Uint8Array([0, 0, 1, 0]),
        );
    });

    test('signed i64 -> 8-byte LE twos-complement', async () => {
        expect(await encodeSeed('index', numberTypeNode('i64'), -1n)).toEqual(
            new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255]),
        );
    });

    test('u64 -> 8-byte LE', async () => {
        expect(await encodeSeed('rewardIndex', numberTypeNode('u64'), 1n)).toEqual(
            new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0]),
        );
    });

    test('u16 -> 2-byte LE', async () => {
        expect(await encodeSeed('index', numberTypeNode('u16'), 300)).toEqual(new Uint8Array([44, 1]));
    });

    test('u16 honors big-endian when the node declares it', async () => {
        expect(await encodeSeed('index', numberTypeNode('u16', 'be'), 300)).toEqual(new Uint8Array([1, 44]));
    });

    test('u32 -> 4-byte LE (defensive; no confirmed real seed, but IDL-expressible)', async () => {
        expect(await encodeSeed('index', numberTypeNode('u32'), 300)).toEqual(new Uint8Array([44, 1, 0, 0]));
    });

    test('enum arg seed -> 1-byte Borsh ordinal (variant index)', async () => {
        const type = enumTypeNode([enumEmptyVariantTypeNode('admin'), enumEmptyVariantTypeNode('user')]);
        const visitor = makeVisitor({
            argumentsInput: { role: 1 },
            ixNode: instructionNode({ arguments: [instructionArgumentNode({ name: 'role', type })], name: 'ix' }),
        });
        expect(await visitor.visitArgumentValue(argumentValueNode('role'))).toEqual(new Uint8Array([1]));
    });

    test('[u8; 32] fixed array -> 32 raw bytes, no length prefix', async () => {
        const value = Array.from({ length: 32 }, () => 7);
        const visitor = makeVisitor({
            argumentsInput: { root: value },
            ixNode: instructionNode({
                arguments: [
                    instructionArgumentNode({
                        name: 'root',
                        type: arrayTypeNode(numberTypeNode('u8'), fixedCountNode(32)),
                    }),
                ],
                name: 'ix',
            }),
        });
        expect(await visitor.visitArgumentValue(argumentValueNode('root'))).toEqual(new Uint8Array(32).fill(7));
    });
});
