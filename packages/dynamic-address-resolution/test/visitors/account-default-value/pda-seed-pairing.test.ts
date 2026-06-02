import { getAddressEncoder } from '@solana/addresses';
import { getUtf8Codec } from '@solana/codecs';
import {
    accountValueNode,
    argumentValueNode,
    constantPdaSeedNode,
    fillDefaultPdaSeedValuesVisitor,
    instructionAccountNode,
    instructionArgumentNode,
    instructionNode,
    isNode,
    LinkableDictionary,
    pdaLinkNode,
    pdaNode,
    pdaSeedValueNode,
    pdaValueNode,
    programNode,
    publicKeyTypeNode,
    rootNode,
    stringTypeNode,
    stringValueNode,
    variablePdaSeedNode,
    visit,
} from 'codama';
import { describe, expect, test } from 'vitest';

import { generateAddress } from '../../test-utils';
import { ixNodeStub, makeVisitor } from './account-default-value-test-utils';
import { expectVisitorDerivesPda } from './pda-derive-helpers';

const prefixSeed = constantPdaSeedNode(stringTypeNode('utf8'), stringValueNode('prefix'));
const PREFIX_BYTES = getUtf8Codec().encode('prefix');
const pubkeySeed = (name: string) => variablePdaSeedNode(name, publicKeyTypeNode());
const pubkeyArg = (name: string) => instructionArgumentNode({ name, type: publicKeyTypeNode() });
const encodeAddr = getAddressEncoder().encode;

describe('account-default-value: PDA seed value pairing', () => {
    test('binds each variable seed by name when the value list is out of definition order', async () => {
        const programAddress = await generateAddress();
        const authority = await generateAddress();
        const owner = await generateAddress();

        const pda = pdaNode({ name: 'testPda', seeds: [prefixSeed, pubkeySeed('authority'), pubkeySeed('owner')] });
        const root = rootNode(programNode({ name: 'test', pdas: [pda], publicKey: programAddress }));
        const node = pdaValueNode(pdaLinkNode('testPda'), [
            pdaSeedValueNode('owner', argumentValueNode('ownerArg')),
            pdaSeedValueNode('authority', argumentValueNode('authorityArg')),
        ]);
        const ixNode = { ...ixNodeStub, arguments: [pubkeyArg('authorityArg'), pubkeyArg('ownerArg')] };

        await expectVisitorDerivesPda(
            node,
            { argumentsInput: { authorityArg: authority, ownerArg: owner }, ixNode, root },
            programAddress,
            [PREFIX_BYTES, encodeAddr(authority), encodeAddr(owner)],
        );
    });

    test('resolves each variable seed to its own value when two seeds in one PDA share a name', async () => {
        const programAddress = await generateAddress();
        const a = await generateAddress();
        const b = await generateAddress();

        const pda = pdaNode({
            name: 'testPda',
            seeds: [prefixSeed, pubkeySeed('ownerKey'), pubkeySeed('ownerKey')],
        });
        const root = rootNode(programNode({ name: 'test', pdas: [pda], publicKey: programAddress }));
        const node = pdaValueNode(pdaLinkNode('testPda'), [
            pdaSeedValueNode('ownerKey', argumentValueNode('a')),
            pdaSeedValueNode('ownerKey', argumentValueNode('b')),
        ]);
        const ixNode = { ...ixNodeStub, arguments: [pubkeyArg('a'), pubkeyArg('b')] };

        await expectVisitorDerivesPda(node, { argumentsInput: { a, b }, ixNode, root }, programAddress, [
            PREFIX_BYTES,
            encodeAddr(a),
            encodeAddr(b),
        ]);
    });

    test('errors on the missing-value position, not the seed name, when a duplicate-name bucket empties', async () => {
        const programAddress = await generateAddress();
        const a = await generateAddress();

        const pda = pdaNode({ name: 'testPda', seeds: [pubkeySeed('mint'), pubkeySeed('mint')] });
        const root = rootNode(programNode({ name: 'test', pdas: [pda], publicKey: programAddress }));
        const node = pdaValueNode(pdaLinkNode('testPda'), [pdaSeedValueNode('mint', accountValueNode('a'))]);
        const ixNode = {
            ...ixNodeStub,
            accounts: [instructionAccountNode({ isSigner: false, isWritable: false, name: 'a' })],
        };

        await expect(makeVisitor({ accountsInput: { a }, ixNode, root }).visitPdaValue(node)).rejects.toThrow(
            /position|index|slot|1/,
        );
    });

    test('derives correctly when fillDefault appends seed values out of definition order', async () => {
        const programAddress = await generateAddress();
        const authority = await generateAddress();
        const owner = await generateAddress();

        const pda = pdaNode({ name: 'testPda', seeds: [pubkeySeed('authority'), pubkeySeed('owner')] });
        const instruction = instructionNode({
            accounts: [
                instructionAccountNode({ isSigner: false, isWritable: false, name: 'authority' }),
                instructionAccountNode({ isSigner: false, isWritable: false, name: 'owner' }),
            ],
            name: 'foo',
        });
        const program = programNode({
            instructions: [instruction],
            name: 'test',
            pdas: [pda],
            publicKey: programAddress,
        });

        const linkables = new LinkableDictionary();
        linkables.recordPath([program, pda]);

        const partial = pdaValueNode(pdaLinkNode('testPda'), [pdaSeedValueNode('owner', accountValueNode('owner'))]);
        const filled = visit(partial, fillDefaultPdaSeedValuesVisitor([program, instruction], linkables));
        if (!isNode(filled, 'pdaValueNode')) throw new Error('expected fillDefault to return a pdaValueNode');
        expect(filled.seeds.map(s => s.name)).toEqual(['owner', 'authority']);

        await expectVisitorDerivesPda(
            filled,
            { accountsInput: { authority, owner }, ixNode: instruction, root: rootNode(program) },
            programAddress,
            [encodeAddr(authority), encodeAddr(owner)],
        );
    });
});
