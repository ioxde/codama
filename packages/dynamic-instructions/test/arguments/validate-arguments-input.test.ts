import { address } from '@solana/addresses';
import type { InstructionNode } from 'codama';
import {
    argumentValueNode,
    arrayTypeNode,
    instructionArgumentNode,
    instructionNode,
    instructionRemainingAccountsNode,
    numberTypeNode,
    programNode,
    publicKeyTypeNode,
    remainderCountNode,
    rootNode,
    structFieldTypeNode,
    structTypeNode,
} from 'codama';
import { describe, expect, test } from 'vitest';

import { encodeInstructionArguments } from '../../src/arguments/encode-instruction-arguments';
import { createArgumentsInputValidator } from '../../src/arguments/validate-arguments-input';

const PROGRAM_KEY = '11111111111111111111111111111111';

function makeRoot(ix: InstructionNode, definedTypes: Parameters<typeof programNode>[0]['definedTypes'] = []) {
    return rootNode(programNode({ definedTypes, instructions: [ix], name: 'test', publicKey: PROGRAM_KEY }));
}

describe('Instruction validation: remaining account arguments', () => {
    const ADDR_1 = address('11111111111111111111111111111111');
    const ADDR_2 = address('22222222222222222222222222222222222222222222');

    const multisigIx = instructionNode({
        arguments: [instructionArgumentNode({ name: 'm', type: numberTypeNode('u8') })],
        name: 'initializeMultisig',
        remainingAccounts: [
            instructionRemainingAccountsNode(argumentValueNode('signers'), { isOptional: false, isSigner: false }),
        ],
    });
    const multisigRoot = makeRoot(multisigIx);

    const transferIx = instructionNode({
        arguments: [instructionArgumentNode({ name: 'amount', type: numberTypeNode('u64') })],
        name: 'transfer',
        remainingAccounts: [
            instructionRemainingAccountsNode(argumentValueNode('multiSigners'), { isOptional: true, isSigner: false }),
        ],
    });
    const transferRoot = makeRoot(transferIx);

    test('should not reject remaining account args as extra keys', () => {
        const validate = createArgumentsInputValidator(multisigRoot, multisigIx);
        expect(() => validate({ m: 2, signers: [ADDR_1, ADDR_2] })).not.toThrow();
    });

    test('should still validate regular arguments when remaining account args are present', () => {
        const validate = createArgumentsInputValidator(multisigRoot, multisigIx);
        expect(() => validate({ m: 'invalid', signers: [ADDR_1] })).toThrow('Invalid argument "m"');
    });

    test('should not reject optional remaining account args when omitted', () => {
        const validate = createArgumentsInputValidator(transferRoot, transferIx);
        expect(() => validate({ amount: 100 })).not.toThrow();
    });

    test('should not reject optional remaining account args when provided', () => {
        const validate = createArgumentsInputValidator(transferRoot, transferIx);
        expect(() => validate({ amount: 100, multiSigners: [ADDR_1] })).not.toThrow();
    });

    // A path-bearing ref roots in a declared argument, not a virtual one, so the root stays in the validated input.
    const nestedIx = instructionNode({
        arguments: [
            instructionArgumentNode({
                name: 'data',
                type: structTypeNode([
                    structFieldTypeNode({ name: 'm', type: numberTypeNode('u8') }),
                    structFieldTypeNode({
                        name: 'signers',
                        type: arrayTypeNode(publicKeyTypeNode(), remainderCountNode()),
                    }),
                ]),
            }),
        ],
        name: 'initializeNestedMultisig',
        remainingAccounts: [
            instructionRemainingAccountsNode(argumentValueNode('data', ['signers']), {
                isOptional: false,
                isSigner: false,
            }),
        ],
    });
    const nestedRoot = makeRoot(nestedIx);

    test('should accept a declared argument that a path-bearing remaining-accounts ref roots in', () => {
        const validate = createArgumentsInputValidator(nestedRoot, nestedIx);
        expect(() => validate({ data: { m: 2, signers: [ADDR_1, ADDR_2] } })).not.toThrow();
    });

    test('should still validate the struct a path-bearing remaining-accounts ref roots in', () => {
        const validate = createArgumentsInputValidator(nestedRoot, nestedIx);
        expect(() => validate({ data: { m: 'invalid', signers: [ADDR_1] } })).toThrow('Invalid argument "data.m"');
    });

    test('should accept a path-bearing remaining-accounts ref whose root is a virtual argument', () => {
        const virtualNestedIx = instructionNode({
            arguments: [instructionArgumentNode({ name: 'amount', type: numberTypeNode('u64') })],
            name: 'virtualNested',
            remainingAccounts: [
                instructionRemainingAccountsNode(argumentValueNode('groups', ['signers']), {
                    isOptional: false,
                    isSigner: true,
                }),
            ],
        });
        const validate = createArgumentsInputValidator(makeRoot(virtualNestedIx), virtualNestedIx);
        expect(() => validate({ amount: 100n, groups: { signers: [ADDR_1] } })).not.toThrow();
    });

    test('should accept a path-less remaining-accounts ref that names a declared argument', () => {
        const declaredIx = instructionNode({
            arguments: [
                instructionArgumentNode({
                    name: 'multiSigners',
                    type: arrayTypeNode(publicKeyTypeNode(), remainderCountNode()),
                }),
            ],
            name: 'declaredMultiSig',
            remainingAccounts: [
                instructionRemainingAccountsNode(argumentValueNode('multiSigners'), {
                    isOptional: false,
                    isSigner: true,
                }),
            ],
        });
        const validate = createArgumentsInputValidator(makeRoot(declaredIx), declaredIx);
        expect(() => validate({ multiSigners: [ADDR_1, ADDR_2] })).not.toThrow();
    });

    test('should not encode remaining account args as instruction data', () => {
        const withSigners = encodeInstructionArguments(multisigRoot, multisigIx, {
            m: 2,
            signers: [ADDR_1, ADDR_2],
        });
        const withoutSigners = encodeInstructionArguments(multisigRoot, multisigIx, { m: 2 });

        expect(withSigners).toEqual(withoutSigners);
    });
});
