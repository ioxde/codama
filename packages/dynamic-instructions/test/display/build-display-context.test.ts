import type { Address } from '@solana/addresses';
import {
    accountLinkNode,
    accountNode,
    definedTypeLinkNode,
    definedTypeNode,
    enumEmptyVariantTypeNode,
    enumTypeNode,
    getLastNodeFromPath,
    instructionAccountNode,
    instructionArgumentNode,
    instructionNode,
    type NodePath,
    numberTypeNode,
    numberValueNode,
    providedNode,
    structFieldTypeNode,
    structTypeNode,
} from 'codama';
import { describe, expect, test } from 'vitest';

import { buildDisplayContext } from '../../src/display/build-display-context';
import { makeParsedInstruction, makeRoot, mintAccountNode } from '../test-utils';

const MINT = '86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY' as Address;

describe('buildDisplayContext', () => {
    test('it threads the parsed instruction onto the context', async () => {
        // Given a parsed instruction with one account and one decoded argument.
        const instruction = instructionNode({
            accounts: [instructionAccountNode({ isSigner: false, isWritable: false, name: 'mint' })],
            arguments: [instructionArgumentNode({ name: 'amount', type: numberTypeNode('u64') })],
            name: 'transfer',
        });
        const root = makeRoot([instruction]);
        const parsed = makeParsedInstruction(root, instruction, { amount: 42n }, new Map([['mint', MINT]]));

        // When we build the display context.
        const context = await buildDisplayContext(root, parsed);

        // Then the parsed instruction (data, accounts, path) is threaded through as-is.
        expect(context.parsedInstruction).toBe(parsed);
    });

    test('it indexes the instruction provides by name', async () => {
        // Given an instruction exposing a provided value.
        const instruction = instructionNode({
            accounts: [],
            arguments: [],
            name: 'transfer',
            provides: [providedNode('decimals', numberValueNode(6))],
        });
        const root = makeRoot([instruction]);
        const parsed = makeParsedInstruction(root, instruction);

        // When we build the display context.
        const context = await buildDisplayContext(root, parsed);

        // Then the provided value is keyed by its name.
        expect(context.provides.get('decimals')).toEqual(providedNode('decimals', numberValueNode(6)));
    });

    test('it has an empty provides map when the instruction exposes nothing', async () => {
        // Given an instruction with no provides.
        const instruction = instructionNode({ accounts: [], arguments: [], name: 'transfer' });
        const root = makeRoot([instruction]);
        const parsed = makeParsedInstruction(root, instruction);

        // When we build the display context.
        const context = await buildDisplayContext(root, parsed);

        // Then the provides map is empty.
        expect(context.provides.size).toBe(0);
    });

    test('it resolves a defined-type link against the root', async () => {
        // Given a root whose program defines an enum referenced by the instruction.
        const orderType = definedTypeNode({
            name: 'orderType',
            type: enumTypeNode([enumEmptyVariantTypeNode('buy'), enumEmptyVariantTypeNode('sell')]),
        });
        const instruction = instructionNode({
            accounts: [],
            arguments: [instructionArgumentNode({ name: 'order', type: definedTypeLinkNode('orderType') })],
            name: 'placeOrder',
        });
        const root = makeRoot([instruction], 'testProgram', [], [orderType]);
        const parsed = makeParsedInstruction(root, instruction);

        // When we resolve a link path rooted at the program.
        const context = await buildDisplayContext(root, parsed);
        const linkPath = [root, root.program, definedTypeLinkNode('orderType')] as NodePath<
            ReturnType<typeof definedTypeLinkNode>
        >;
        const resolvedPath = context.resolveDefinedType(linkPath);

        // Then the path to the underlying defined type is returned.
        expect(resolvedPath && getLastNodeFromPath(resolvedPath)).toBe(orderType);
    });

    test('it returns undefined when a defined-type link cannot be resolved', async () => {
        // Given a root that does not define the referenced type.
        const instruction = instructionNode({
            accounts: [],
            arguments: [instructionArgumentNode({ name: 'order', type: definedTypeLinkNode('orderType') })],
            name: 'placeOrder',
        });
        const root = makeRoot([instruction]);
        const parsed = makeParsedInstruction(root, instruction);

        // When we resolve an unknown link path.
        const context = await buildDisplayContext(root, parsed);
        const linkPath = [root, root.program, definedTypeLinkNode('missing')] as NodePath<
            ReturnType<typeof definedTypeLinkNode>
        >;
        const resolvedPath = context.resolveDefinedType(linkPath);

        // Then we get undefined.
        expect(resolvedPath).toBeUndefined();
    });

    test('it decodes account bytes that conform to the linked layout', async () => {
        // Given an account linked to a mint layout with one u8 field.
        const instruction = instructionNode({
            accounts: [
                instructionAccountNode({
                    accountLink: accountLinkNode('mint'),
                    isSigner: false,
                    isWritable: false,
                    name: 'mint',
                }),
            ],
            arguments: [],
            name: 'transfer',
        });
        const root = makeRoot([instruction], 'testProgram', [mintAccountNode()]);
        const parsed = makeParsedInstruction(root, instruction, {}, new Map([['mint', MINT]]));

        // When we decode one conforming byte.
        const context = await buildDisplayContext(root, parsed);
        expect(context.resolveAccountData('mint', new Uint8Array([6]))).toEqual({ decimals: 6 });
    });

    test('it returns null when account bytes do not decode against the linked layout', async () => {
        // Given an account linked to a layout requiring one u64 (8 bytes).
        const vault = accountNode({
            data: structTypeNode([structFieldTypeNode({ name: 'amount', type: numberTypeNode('u64') })]),
            name: 'vault',
        });
        const instruction = instructionNode({
            accounts: [
                instructionAccountNode({
                    accountLink: accountLinkNode('vault'),
                    isSigner: false,
                    isWritable: false,
                    name: 'vault',
                }),
            ],
            arguments: [],
            name: 'transfer',
        });
        const root = makeRoot([instruction], 'testProgram', [vault]);
        const parsed = makeParsedInstruction(root, instruction, {}, new Map([['vault', MINT]]));

        // When we decode truncated bytes.
        const context = await buildDisplayContext(root, parsed);

        // Then decoding degrades to null instead of throwing and killing the display.
        expect(context.resolveAccountData('vault', new Uint8Array([1, 2]))).toBeNull();
    });

    test('it threads the fetchAccount option through', async () => {
        // Given a fetchAccount hook.
        const instruction = instructionNode({ accounts: [], arguments: [], name: 'transfer' });
        const root = makeRoot([instruction]);
        const parsed = makeParsedInstruction(root, instruction);
        const fetchAccount = (address: Address) => Promise.resolve({ address, exists: false } as const);

        // When we build the display context with that option.
        const context = await buildDisplayContext(root, parsed, { fetchAccount });

        // Then the hook is carried on the context.
        expect(context.fetchAccount).toBe(fetchAccount);
    });
});
