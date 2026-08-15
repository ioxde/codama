import {
    argumentValueNode,
    arrayTypeNode,
    bytesTypeNode,
    camelCase,
    fixedSizeTypeNode,
    instructionAccountNode,
    instructionArgumentNode,
    instructionNode,
    instructionRemainingAccountsNode,
    numberTypeNode,
    publicKeyTypeNode,
    remainderCountNode,
    structFieldTypeNode,
    structTypeNode,
} from 'codama';
import { describe, expect, test } from 'vitest';

import { generateResolutionInputTypes } from '../../src/codegen/generate-resolution-input-types';
import { makeRoot } from '../test-utils';

describe('generateResolutionInputTypes', () => {
    test('should generate Args type with correct TS types', () => {
        const root = makeRoot([
            instructionNode({
                arguments: [
                    instructionArgumentNode({
                        name: 'amount',
                        type: { endian: 'le', format: 'u64', kind: 'numberTypeNode' },
                    }),
                    instructionArgumentNode({
                        name: 'memo',
                        type: { encoding: 'utf8', kind: 'stringTypeNode' },
                    }),
                ],
                name: 'transfer',
            }),
        ]);
        const output = generateResolutionInputTypes(root);
        expect(output).toContain('export type TransferArgs');
        expect(output).toContain('amount: number | bigint;');
        expect(output).toContain('memo: string;');
    });

    test('should filter omitted arguments from Args type', () => {
        const root = makeRoot([
            instructionNode({
                arguments: [
                    instructionArgumentNode({
                        name: 'visible',
                        type: { endian: 'le', format: 'u8', kind: 'numberTypeNode' },
                    }),
                    instructionArgumentNode({
                        defaultValue: { kind: 'numberValueNode', number: 0 },
                        defaultValueStrategy: 'omitted',
                        name: 'hidden',
                        type: { endian: 'le', format: 'u8', kind: 'numberTypeNode' },
                    }),
                ],
                name: 'init',
            }),
        ]);
        const output = generateResolutionInputTypes(root);
        expect(output).toContain('visible: number;');
        expect(output).not.toContain('hidden');
    });

    test('should skip Args block when there are no arguments', () => {
        const root = makeRoot([
            instructionNode({
                accounts: [instructionAccountNode({ isSigner: true, isWritable: false, name: 'authority' })],
                name: 'noArgs',
            }),
        ]);
        const output = generateResolutionInputTypes(root);
        expect(output).not.toContain('NoArgsArgs');
    });

    test('should mark auto-resolvable accounts with ? and required ones plain', () => {
        const root = makeRoot([
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: { kind: 'payerValueNode' },
                        isSigner: true,
                        isWritable: true,
                        name: 'payer',
                    }),
                    instructionAccountNode({
                        defaultValue: {
                            kind: 'publicKeyValueNode',
                            publicKey: '11111111111111111111111111111111',
                        },
                        isSigner: false,
                        isWritable: false,
                        name: 'systemProgram',
                    }),
                    instructionAccountNode({ isSigner: false, isWritable: true, name: 'target' }),
                ],
                name: 'create',
            }),
        ]);
        const output = generateResolutionInputTypes(root);
        expect(output).toContain('export type CreateAccounts');
        expect(output).toContain('payer: Address;');
        expect(output).toContain('systemProgram?: Address;');
        expect(output).toContain('target: Address;');
    });

    test('should emit | null for optional accounts', () => {
        const root = makeRoot([
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        isOptional: true,
                        isSigner: false,
                        isWritable: false,
                        name: 'closeAuthority',
                    }),
                ],
                name: 'maybeClose',
            }),
        ]);
        const output = generateResolutionInputTypes(root);
        expect(output).toContain('closeAuthority: Address | null;');
    });

    test('should emit Resolvers type when resolverValueNode exists', () => {
        const root = makeRoot([
            instructionNode({
                accounts: [instructionAccountNode({ isSigner: true, isWritable: false, name: 'authority' })],
                arguments: [
                    instructionArgumentNode({
                        defaultValue: { kind: 'resolverValueNode', name: camelCase('computeValue') },
                        name: 'computedValue',
                        type: { endian: 'le', format: 'u64', kind: 'numberTypeNode' },
                    }),
                ],
                name: 'customResolve',
            }),
        ]);
        const output = generateResolutionInputTypes(root);
        expect(output).toContain('export type CustomResolveResolvers');
        expect(output).toContain('computeValue: ResolverFn<CustomResolveArgs, CustomResolveAccounts>;');
    });

    test('should mark optional type arguments with ?', () => {
        const root = makeRoot([
            instructionNode({
                arguments: [
                    instructionArgumentNode({
                        name: 'maybeValue',
                        type: {
                            item: { endian: 'le', format: 'u32', kind: 'numberTypeNode' },
                            kind: 'optionTypeNode',
                            prefix: { endian: 'le', format: 'u8', kind: 'numberTypeNode' },
                        },
                    }),
                ],
                name: 'optionalArgs',
            }),
        ]);
        const output = generateResolutionInputTypes(root);
        expect(output).toContain('maybeValue?: number | null;');
    });

    test('should emit remaining account arguments in Args type', () => {
        const root = makeRoot([
            instructionNode({
                name: 'multiSig',
                remainingAccounts: [
                    instructionRemainingAccountsNode(
                        { kind: 'argumentValueNode', name: camelCase('multiSigners') },
                        { isSigner: true, isWritable: false },
                    ),
                ],
            }),
        ]);
        const output = generateResolutionInputTypes(root);
        expect(output).toContain('export type MultiSigArgs');
        expect(output).toContain('multiSigners: Address[];');
    });

    test('should not re-emit the root argument of a path-bearing remaining account reference', () => {
        // The arguments loop already emitted the root; emitting it again duplicates the key.
        const root = makeRoot([
            instructionNode({
                arguments: [
                    instructionArgumentNode({
                        name: 'data',
                        type: structTypeNode([
                            structFieldTypeNode({
                                name: 'multiSigners',
                                type: arrayTypeNode(publicKeyTypeNode(), remainderCountNode()),
                            }),
                        ]),
                    }),
                ],
                name: 'nestedMultiSig',
                remainingAccounts: [
                    instructionRemainingAccountsNode(argumentValueNode('data', ['multiSigners']), {
                        isSigner: true,
                        isWritable: false,
                    }),
                ],
            }),
        ]);
        const output = generateResolutionInputTypes(root);
        expect(output).toContain('data: { multiSigners: Address[] };');
        expect(output.match(/^\s*data\??:/gm)).toHaveLength(1);
    });

    test('should emit extraArguments as optional keys in the Args type', () => {
        const root = makeRoot([
            instructionNode({
                arguments: [instructionArgumentNode({ name: 'amountIn', type: numberTypeNode('u64') })],
                extraArguments: [
                    instructionArgumentNode({
                        name: 'creatorHash',
                        type: fixedSizeTypeNode(bytesTypeNode(), 32),
                    }),
                ],
                name: 'buyExactIn',
            }),
        ]);
        const output = generateResolutionInputTypes(root);
        expect(output).toContain('amountIn: number | bigint;');
        expect(output).toContain('creatorHash?: Uint8Array;');
    });

    test('should emit an Args type for an instruction whose only inputs are extraArguments', () => {
        const root = makeRoot([
            instructionNode({
                extraArguments: [instructionArgumentNode({ name: 'creatorHash', type: publicKeyTypeNode() })],
                name: 'collectFee',
            }),
        ]);
        const output = generateResolutionInputTypes(root);
        expect(output).toContain('export type CollectFeeArgs');
        expect(output).toContain('creatorHash?: Address;');
    });

    test('should not emit a duplicate key when a path-less remaining account reference names a declared argument', () => {
        const root = makeRoot([
            instructionNode({
                arguments: [
                    instructionArgumentNode({
                        name: 'multiSigners',
                        type: arrayTypeNode(publicKeyTypeNode(), remainderCountNode()),
                    }),
                ],
                name: 'declaredMultiSig',
                remainingAccounts: [
                    instructionRemainingAccountsNode(argumentValueNode('multiSigners'), {
                        isSigner: true,
                        isWritable: false,
                    }),
                ],
            }),
        ]);
        const output = generateResolutionInputTypes(root);
        expect(output.match(/^\s*multiSigners\??:/gm)).toHaveLength(1);
    });

    test('should synthesize an object type for a path-bearing reference to an undeclared root', () => {
        const root = makeRoot([
            instructionNode({
                arguments: [instructionArgumentNode({ name: 'amount', type: numberTypeNode('u64') })],
                name: 'virtualNested',
                remainingAccounts: [
                    instructionRemainingAccountsNode(argumentValueNode('groups', ['signers']), { isSigner: true }),
                ],
            }),
        ]);
        const output = generateResolutionInputTypes(root);
        expect(output).toContain('groups: { signers: Address[] };');
    });

    test('should mark a virtual path-bearing root optional when every group reading it is optional', () => {
        const root = makeRoot([
            instructionNode({
                arguments: [instructionArgumentNode({ name: 'amount', type: numberTypeNode('u64') })],
                name: 'virtualNestedOptional',
                remainingAccounts: [
                    instructionRemainingAccountsNode(argumentValueNode('groups', ['signers']), {
                        isOptional: true,
                        isSigner: true,
                    }),
                ],
            }),
        ]);
        const output = generateResolutionInputTypes(root);
        expect(output).toContain('groups?: { signers?: Address[] };');
    });

    test('should merge every path-bearing group sharing a virtual root into one key', () => {
        const root = makeRoot([
            instructionNode({
                arguments: [instructionArgumentNode({ name: 'amount', type: numberTypeNode('u64') })],
                name: 'virtualMerged',
                remainingAccounts: [
                    instructionRemainingAccountsNode(argumentValueNode('groups', ['signers']), { isSigner: true }),
                    instructionRemainingAccountsNode(argumentValueNode('groups', ['delegates']), {
                        isOptional: true,
                        isSigner: false,
                    }),
                ],
            }),
        ]);
        const output = generateResolutionInputTypes(root);
        expect(output).toContain('groups: { signers: Address[]; delegates?: Address[] };');
        expect(output.match(/^\s*groups\??:/gm)).toHaveLength(1);
    });

    test('should intersect Address[] with the nested shape when one group path prefixes another', () => {
        // The runtime resolves each path independently, so the type must keep both contracts.
        const root = makeRoot([
            instructionNode({
                arguments: [instructionArgumentNode({ name: 'amount', type: numberTypeNode('u64') })],
                name: 'virtualPrefixed',
                remainingAccounts: [
                    instructionRemainingAccountsNode(argumentValueNode('groups', ['signers']), { isSigner: true }),
                    instructionRemainingAccountsNode(argumentValueNode('groups', ['signers', 'backup']), {
                        isOptional: true,
                        isSigner: true,
                    }),
                ],
            }),
        ]);
        const output = generateResolutionInputTypes(root);
        expect(output).toContain('groups: { signers: Address[] & { backup?: Address[] } };');
    });

    test('should intersect regardless of the order the prefixed groups are declared in', () => {
        const root = makeRoot([
            instructionNode({
                arguments: [instructionArgumentNode({ name: 'amount', type: numberTypeNode('u64') })],
                name: 'virtualPrefixedReversed',
                remainingAccounts: [
                    instructionRemainingAccountsNode(argumentValueNode('groups', ['signers', 'backup']), {
                        isOptional: true,
                        isSigner: true,
                    }),
                    instructionRemainingAccountsNode(argumentValueNode('groups', ['signers']), { isSigner: true }),
                ],
            }),
        ]);
        const output = generateResolutionInputTypes(root);
        expect(output).toContain('groups: { signers: Address[] & { backup?: Address[] } };');
    });

    test('should intersect Address[] with the nested shape when a path-less group shares the root', () => {
        const root = makeRoot([
            instructionNode({
                arguments: [instructionArgumentNode({ name: 'amount', type: numberTypeNode('u64') })],
                name: 'virtualMixedDepth',
                remainingAccounts: [
                    instructionRemainingAccountsNode(argumentValueNode('groups'), { isSigner: true }),
                    instructionRemainingAccountsNode(argumentValueNode('groups', ['delegates']), {
                        isOptional: true,
                        isSigner: false,
                    }),
                ],
            }),
        ]);
        const output = generateResolutionInputTypes(root);
        expect(output).toContain('groups: Address[] & { delegates?: Address[] };');
    });

    test('should emit empty Accounts fallback for instructions without accounts', () => {
        const root = makeRoot([instructionNode({ name: 'noAccounts' })]);
        const output = generateResolutionInputTypes(root);
        expect(output).toContain('export type NoAccountsAccounts = Record<string, never>;');
        expect(output).toContain(
            'export type NoAccountsAccountsWithData = Record<string, Address | null | undefined>;',
        );
    });

    test('should not emit Signers or InstructionBuilders blocks', () => {
        const root = makeRoot([
            instructionNode({
                accounts: [instructionAccountNode({ isSigner: 'either', isWritable: false, name: 'authority' })],
                name: 'transfer',
            }),
        ]);
        const output = generateResolutionInputTypes(root);
        expect(output).not.toContain('TransferSigners');
        expect(output).not.toContain('InstructionBuilders');
    });
});
