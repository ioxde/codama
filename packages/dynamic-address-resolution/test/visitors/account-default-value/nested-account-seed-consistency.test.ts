import { instructionAccountNodesFromAnchorV01 } from '@codama/nodes-from-anchor';
import {
    instructionArgumentNode,
    instructionNode,
    isNode,
    numberTypeNode,
    publicKeyTypeNode,
    structFieldTypeNode,
    structTypeNode,
} from 'codama';
import { describe, expect, test } from 'vitest';

import { generateAddress } from '../../test-utils';
import { makeVisitor } from './account-default-value-test-utils';

const DATA_RECORD_PREFIX = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

const argsType = () => structTypeNode([structFieldTypeNode({ name: 'ownerKey', type: publicKeyTypeNode() })]);

describe('account-default-value: nested-account-data PDA seed consistency', () => {
    test('a dataRecord PDA derives the same address from an arg field (create) and an account field (read)', async () => {
        const [createDataRecord] = instructionAccountNodesFromAnchorV01(
            [
                {
                    name: 'dataRecord',
                    pda: {
                        seeds: [
                            { kind: 'const', value: DATA_RECORD_PREFIX },
                            { kind: 'arg', path: 'args.owner_key' },
                            { kind: 'account', path: 'mint_b' },
                        ],
                    },
                    signer: false,
                    writable: false,
                },
            ],
            [instructionArgumentNode({ name: 'args', type: argsType() })],
            undefined,
            [],
        );

        const [readDataRecord] = instructionAccountNodesFromAnchorV01(
            [
                {
                    name: 'dataRecord',
                    pda: {
                        seeds: [
                            { kind: 'const', value: DATA_RECORD_PREFIX },
                            { account: 'State', kind: 'account', path: 'state.owner_key' },
                            { kind: 'account', path: 'mint_b' },
                        ],
                    },
                    signer: false,
                    writable: false,
                },
            ],
            [],
            undefined,
            [{ name: 'State', type: { fields: [{ name: 'owner_key', type: 'pubkey' }], kind: 'struct' } }],
        );

        if (
            !isNode(createDataRecord.defaultValue, 'pdaValueNode') ||
            !isNode(readDataRecord.defaultValue, 'pdaValueNode')
        ) {
            throw new Error('expected both dataRecord accounts to carry a pdaValueNode default');
        }

        const ownerKey = await generateAddress();
        const mintB = await generateAddress();
        const state = await generateAddress();

        const createAddress = await makeVisitor({
            accountsInput: { mintB },
            argumentsInput: { args: { ownerKey } },
            ixNode: instructionNode({
                arguments: [instructionArgumentNode({ name: 'args', type: argsType() })],
                name: 'createThing',
            }),
        }).visitPdaValue(createDataRecord.defaultValue);

        const readAddress = await makeVisitor({
            accountsInput: { mintB, state },
            argumentsInput: { ownerKey },
            ixNode: instructionNode({
                extraArguments: [instructionArgumentNode({ name: 'ownerKey', type: publicKeyTypeNode() })],
                name: 'readThing',
            }),
        }).visitPdaValue(readDataRecord.defaultValue);

        expect(readAddress).toBe(createAddress);
    });

    test('a numeric PDA seed derives the same address from an arg field and an account-data field', async () => {
        const PREFIX = [105, 100, 120]; // "idx"
        const numericArgs = () => structTypeNode([structFieldTypeNode({ name: 'index', type: numberTypeNode('u16') })]);

        const [createPda] = instructionAccountNodesFromAnchorV01(
            [
                {
                    name: 'somePda',
                    pda: {
                        seeds: [
                            { kind: 'const', value: PREFIX },
                            { kind: 'arg', path: 'args.index' },
                        ],
                    },
                    signer: false,
                    writable: false,
                },
            ],
            [instructionArgumentNode({ name: 'args', type: numericArgs() })],
            undefined,
            [],
        );
        const [migratePda] = instructionAccountNodesFromAnchorV01(
            [
                {
                    name: 'somePda',
                    pda: {
                        seeds: [
                            { kind: 'const', value: PREFIX },
                            { account: 'Pool', kind: 'account', path: 'pool.index' },
                        ],
                    },
                    signer: false,
                    writable: false,
                },
            ],
            [],
            undefined,
            [{ name: 'Pool', type: { fields: [{ name: 'index', type: 'u16' }], kind: 'struct' } }],
        );

        if (!isNode(createPda.defaultValue, 'pdaValueNode') || !isNode(migratePda.defaultValue, 'pdaValueNode')) {
            throw new Error('expected both accounts to carry a pdaValueNode default');
        }

        const pool = await generateAddress();

        const createAddress = await makeVisitor({
            argumentsInput: { args: { index: 7 } },
            ixNode: instructionNode({
                arguments: [instructionArgumentNode({ name: 'args', type: numericArgs() })],
                name: 'create',
            }),
        }).visitPdaValue(createPda.defaultValue);

        // A u16 field encodes as 2 LE bytes; an accountValueNode('pool') override would encode as 32.
        // The previous pubkey-shape test can't distinguish them; this one does.
        const migrateAddress = await makeVisitor({
            accountsInput: { pool },
            argumentsInput: { index: 7 },
            ixNode: instructionNode({
                extraArguments: [instructionArgumentNode({ name: 'index', type: numberTypeNode('u16') })],
                name: 'migrate',
            }),
        }).visitPdaValue(migratePda.defaultValue);

        expect(migrateAddress).toBe(createAddress);
    });
});
