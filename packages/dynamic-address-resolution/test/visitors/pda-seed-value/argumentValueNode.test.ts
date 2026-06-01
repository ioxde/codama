import { getU64Encoder, getUtf8Codec } from '@solana/codecs';
import {
    argumentValueNode,
    arrayTypeNode,
    definedTypeLinkNode,
    definedTypeNode,
    fixedCountNode,
    instructionArgumentNode,
    instructionNode,
    numberTypeNode,
    programNode,
    publicKeyTypeNode,
    remainderOptionTypeNode,
    rootNode,
    sizePrefixTypeNode,
    stringTypeNode,
    structFieldTypeNode,
    structTypeNode,
} from 'codama';
import { describe, expect, test } from 'vitest';

import { generateAddress } from '../../test-utils';
import { makeVisitor } from './pda-seed-value-test-utils';

describe('pda-seed-value: visitArgumentValue', () => {
    const ixNodeWithArg = instructionNode({
        arguments: [instructionArgumentNode({ name: 'title', type: stringTypeNode('utf8') })],
        name: 'testInstruction',
    });

    test('should encode argument value using its codec', async () => {
        const visitor = makeVisitor({
            argumentsInput: { title: 'hello' },
            ixNode: ixNodeWithArg,
        });
        const result = await visitor.visitArgumentValue(argumentValueNode('title'));
        expect(result).toEqual(getUtf8Codec().encode('hello'));
    });

    test('should use seedTypeNode override instead of argument type', async () => {
        // Argument type is sizePrefixTypeNode (u32 length prefix + utf8 string),
        // but seedTypeNode overrides it to plain stringTypeNode (raw utf8 bytes only).
        // This mirrors how on-chain PDA derivation uses raw string bytes as seeds,
        // even when the instruction argument is serialized with a length prefix.
        const sizePrefixedArgType = sizePrefixTypeNode(stringTypeNode('utf8'), numberTypeNode('u32'));
        const ixNodeWithSizePrefixedArg = instructionNode({
            arguments: [instructionArgumentNode({ name: 'name', type: sizePrefixedArgType })],
            name: 'testInstruction',
        });

        const visitor = makeVisitor({
            argumentsInput: { name: 'hello' },
            ixNode: ixNodeWithSizePrefixedArg,
            seedTypeNode: stringTypeNode('utf8'),
        });
        const result = await visitor.visitArgumentValue(argumentValueNode('name'));

        // Should produce raw utf8 bytes (5 bytes), NOT size-prefixed bytes (4 + 5 = 9 bytes)
        const rawUtf8Bytes = getUtf8Codec().encode('hello');
        expect(result).toEqual(rawUtf8Bytes);
        expect(result.length).toBe(5);
    });

    test('should throw for unknown argument name', async () => {
        const visitor = makeVisitor({ ixNode: ixNodeWithArg });
        await expect(visitor.visitArgumentValue(argumentValueNode('unknown'))).rejects.toThrow(
            /Referenced node \[unknown\] not found in \[testInstruction\]/,
        );
    });

    test('should throw when required argument value is undefined', async () => {
        const visitor = makeVisitor({
            argumentsInput: {},
            ixNode: ixNodeWithArg,
        });
        await expect(visitor.visitArgumentValue(argumentValueNode('title'))).rejects.toThrow(
            /Missing argument \[title\]/,
        );
    });

    test('should throw when required argument value is null', async () => {
        const visitor = makeVisitor({
            argumentsInput: { title: null },
            ixNode: ixNodeWithArg,
        });
        await expect(visitor.visitArgumentValue(argumentValueNode('title'))).rejects.toThrow(
            /Missing argument \[title\]/,
        );
    });

    describe('nested struct argument paths', () => {
        const planDataStruct = structTypeNode([
            structFieldTypeNode({ name: 'planId', type: numberTypeNode('u64') }),
            structFieldTypeNode({ name: 'label', type: stringTypeNode('utf8') }),
        ]);
        const ixNodeWithStructArg = instructionNode({
            arguments: [instructionArgumentNode({ name: 'planData', type: planDataStruct })],
            name: 'createPlan',
        });

        test('should encode nested numeric field via path', async () => {
            const visitor = makeVisitor({
                argumentsInput: { planData: { label: 'x', planId: 42n } },
                ixNode: ixNodeWithStructArg,
            });
            const result = await visitor.visitArgumentValue(argumentValueNode('planData', ['planId']));
            expect(result).toEqual(getU64Encoder().encode(42n));
        });

        test('should throw when nested path does not exist on struct', async () => {
            const visitor = makeVisitor({
                argumentsInput: { planData: { label: 'x', planId: 42n } },
                ixNode: ixNodeWithStructArg,
            });
            await expect(visitor.visitArgumentValue(argumentValueNode('planData', ['missing']))).rejects.toThrow(
                /struct has no field "missing"/,
            );
        });

        test('should throw when intermediate value is missing', async () => {
            const visitor = makeVisitor({
                argumentsInput: {},
                ixNode: ixNodeWithStructArg,
            });
            await expect(visitor.visitArgumentValue(argumentValueNode('planData', ['planId']))).rejects.toThrow(
                /Missing argument \[planData\]/,
            );
        });

        test('should throw when path traverses a non-struct type', async () => {
            const visitor = makeVisitor({
                argumentsInput: { title: 'hi' },
                ixNode: ixNodeWithArg, // title is stringTypeNode
            });
            await expect(visitor.visitArgumentValue(argumentValueNode('title', ['bogus']))).rejects.toThrow(
                /expected structTypeNode/,
            );
        });

        test('should walk through definedTypeLinkNode to nested struct field', async () => {
            const planDataLink = definedTypeLinkNode('planData');
            const localProgram = programNode({
                definedTypes: [definedTypeNode({ name: 'planData', type: planDataStruct })],
                name: 'test',
                publicKey: '11111111111111111111111111111111',
            });
            const localRoot = rootNode(localProgram);
            const ixNode = instructionNode({
                arguments: [instructionArgumentNode({ name: 'planData', type: planDataLink })],
                name: 'createPlan',
            });
            const visitor = makeVisitor({
                argumentsInput: { planData: { label: 'x', planId: 7n } },
                ixNode,
                root: localRoot,
            });
            const result = await visitor.visitArgumentValue(argumentValueNode('planData', ['planId']));
            expect(result).toEqual(getU64Encoder().encode(7n));
        });
    });

    describe('nested paths when seedTypeNode is provided (the real PDA-resolution path)', () => {
        // resolveVariablePdaSeed always passes seedTypeNode, so the declared seed type drives encoding;
        // the arg-path walk must never fail an encode that seedTypeNode + the value can complete.

        test('encodes via seedTypeNode even when the declared arg type cannot be walked to the leaf', async () => {
            // Arg type is an unresolvable definedTypeLink, but seedTypeNode (u64) + the value still encode.
            const ixNode = instructionNode({
                arguments: [instructionArgumentNode({ name: 'config', type: definedTypeLinkNode('externalConfig') })],
                name: 'doThing',
            });
            const visitor = makeVisitor({
                argumentsInput: { config: { amount: 5n } },
                ixNode,
                seedTypeNode: numberTypeNode('u64'),
            });
            const result = await visitor.visitArgumentValue(argumentValueNode('config', ['amount']));
            expect(result).toEqual(getU64Encoder().encode(5n));
        });

        test('a runtime-shape mismatch reports a user-facing error, not an internal invariant', async () => {
            // Descending into a non-object (here an array) is bad user input: pda-seed must report it
            // like account-default-value does, not as an internal invariant from the arg-path walk.
            const ixNode = instructionNode({
                arguments: [
                    instructionArgumentNode({
                        name: 'items',
                        type: arrayTypeNode(numberTypeNode('u8'), fixedCountNode(3)),
                    }),
                ],
                name: 'doThing',
            });
            const visitor = makeVisitor({
                argumentsInput: { items: [1, 2, 3] },
                ixNode,
                seedTypeNode: numberTypeNode('u8'),
            });
            const promise = visitor.visitArgumentValue(argumentValueNode('items', ['0']));
            await expect(promise).rejects.toThrow(/Invalid argument input/);
            await expect(promise).rejects.not.toThrow(/Internal invariant violation/);
        });
    });

    describe('remainderOptionTypeNode seeds', () => {
        // Mirrors the pmp IDL's metadata PDA:
        // the "authority" seed is remainderOptionTypeNode(publicKeyTypeNode) — null is canonical.
        const ixNodeWithOptionalSeed = instructionNode({
            arguments: [
                instructionArgumentNode({
                    name: 'authority',
                    type: remainderOptionTypeNode(publicKeyTypeNode()),
                }),
            ],
            name: 'testInstruction',
        });

        test('should return empty bytes when argument is undefined', async () => {
            const visitor = makeVisitor({
                argumentsInput: {},
                ixNode: ixNodeWithOptionalSeed,
            });
            const result = await visitor.visitArgumentValue(argumentValueNode('authority'));
            expect(result).toEqual(new Uint8Array(0));
        });

        test('should return empty bytes when argument is null', async () => {
            const visitor = makeVisitor({
                argumentsInput: { authority: null },
                ixNode: ixNodeWithOptionalSeed,
            });
            const result = await visitor.visitArgumentValue(argumentValueNode('authority'));
            expect(result).toEqual(new Uint8Array(0));
        });

        test('should encode value when argument is provided', async () => {
            const authority = await generateAddress();
            const visitor = makeVisitor({
                argumentsInput: { authority },
                ixNode: ixNodeWithOptionalSeed,
            });
            const result = await visitor.visitArgumentValue(argumentValueNode('authority'));
            expect(result.length).toBe(32);
        });

        test('should return empty bytes when seedTypeNode override is remainderOptionTypeNode and argument is null', async () => {
            const ixNodeWithRequiredArg = instructionNode({
                arguments: [instructionArgumentNode({ name: 'authority', type: publicKeyTypeNode() })],
                name: 'testInstruction',
            });
            const visitor = makeVisitor({
                argumentsInput: { authority: null },
                ixNode: ixNodeWithRequiredArg,
                seedTypeNode: remainderOptionTypeNode(publicKeyTypeNode()),
            });
            const result = await visitor.visitArgumentValue(argumentValueNode('authority'));
            expect(result).toEqual(new Uint8Array(0));
        });
    });
});
