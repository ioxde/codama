import { type Address } from '@solana/addresses';
import { getUtf8Codec } from '@solana/codecs';
import {
    accountValueNode,
    argumentValueNode,
    constantPdaSeedNode,
    instructionAccountNode,
    pdaLinkNode,
    pdaNode,
    pdaValueNode,
    programNode,
    rootNode,
    stringTypeNode,
    stringValueNode,
} from 'codama';
import { describe, test } from 'vitest';

import { generateAddress } from '../../test-utils';
import { ixNodeStub } from './account-default-value-test-utils';
import { expectVisitorDerivesPda } from './pda-derive-helpers';

// pdaNode.programId is omitted throughout; the deriving program comes from pdaValueNode.programId.
const foreignPda = pdaNode({
    name: 'foreignPda',
    seeds: [constantPdaSeedNode(stringTypeNode('utf8'), stringValueNode('prefix'))],
});
const withForeignProgramAccount = {
    ...ixNodeStub,
    accounts: [instructionAccountNode({ isSigner: false, isWritable: false, name: 'foreignProgram' })],
};

describe('resolvePDAAddress honors pdaValueNode.programId', () => {
    test.each([
        {
            build: (program: Address) => ({
                ixNode: withForeignProgramAccount,
                node: pdaValueNode(pdaLinkNode('foreignPda'), [], accountValueNode('foreignProgram')),
                overrides: { accountsInput: { foreignProgram: program } },
            }),
            label: 'an account ref',
        },
        {
            build: (program: Address) => ({
                ixNode: ixNodeStub,
                node: pdaValueNode(pdaLinkNode('foreignPda'), [], argumentValueNode('targetProgram')),
                overrides: { argumentsInput: { targetProgram: program } },
            }),
            label: 'a flat arg ref',
        },
        {
            build: (program: Address) => ({
                ixNode: ixNodeStub,
                node: pdaValueNode(pdaLinkNode('foreignPda'), [], argumentValueNode('config', ['targetProgram'])),
                overrides: { argumentsInput: { config: { targetProgram: program } } },
            }),
            label: 'a nested arg-path ref',
        },
    ])('derives against the foreign program named by $label', async ({ build }) => {
        const localProgramAddress = await generateAddress();
        const foreignProgramAddress = await generateAddress();
        const root = rootNode(
            programNode({ accounts: [], name: 'local', pdas: [foreignPda], publicKey: localProgramAddress }),
        );
        const { ixNode, node, overrides } = build(foreignProgramAddress);

        await expectVisitorDerivesPda(node, { ...overrides, ixNode, root }, foreignProgramAddress, [
            getUtf8Codec().encode('prefix'),
        ]);
    });

    test('falls back to the default program when a dynamic nested-path programId arg is absent (no throw)', async () => {
        // programId is an optional override: when its arg is not provided, derivation must fall back
        // to the local program (runtimeProgramId ?? pdaNode.programId ?? root.program.publicKey),
        // not abort with a thrown ARGUMENT_MISSING.
        const localProgramAddress = await generateAddress();
        const root = rootNode(
            programNode({ accounts: [], name: 'local', pdas: [foreignPda], publicKey: localProgramAddress }),
        );
        const node = pdaValueNode(pdaLinkNode('foreignPda'), [], argumentValueNode('config', ['targetProgram']));

        await expectVisitorDerivesPda(node, { argumentsInput: {}, ixNode: ixNodeStub, root }, localProgramAddress, [
            getUtf8Codec().encode('prefix'),
        ]);
    });
});
