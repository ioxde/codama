import { programNode } from '@codama/nodes';
import { expect, test } from 'vitest';

import { extractPdasFromProgram } from '../../src';
import { definedStruct, ix } from './_fixtures';

const DATA_RECORD = [1, 2, 3];

// One on-chain PDA reached via different paths must collapse to one model PDA -- seed names are
// not part of the on-chain address.
test('it unifies one PDA reached via an arg path and an account path into a single PDA', () => {
    const createThing = ix(
        'create_thing',
        [
            {
                name: 'data_record',
                pda: {
                    seeds: [
                        { kind: 'const', value: DATA_RECORD },
                        { kind: 'arg', path: 'args.owner_key' },
                        { kind: 'account', path: 'mint_b' },
                    ],
                },
                signer: false,
                writable: false,
            },
            { name: 'mint_b', signer: false, writable: false },
        ],
        {
            args: [{ name: 'args', type: { defined: { name: 'CreateArgs' } } }],
            definedTypes: [definedStruct('CreateArgs', { owner_key: 'pubkey' })],
            discriminator: [0, 0, 0, 0, 0, 0, 0, 1],
        },
    );
    const readThing = ix(
        'read_thing',
        [
            {
                name: 'data_record',
                pda: {
                    seeds: [
                        { kind: 'const', value: DATA_RECORD },
                        { account: 'StateAccount', kind: 'account', path: 'state_account.owner_key' },
                        { kind: 'account', path: 'mint_b' },
                    ],
                },
                signer: false,
                writable: false,
            },
            { name: 'state_account', signer: false, writable: false },
            { name: 'mint_b', signer: false, writable: false },
        ],
        {
            definedTypes: [definedStruct('StateAccount', { owner_key: 'pubkey' })],
            discriminator: [0, 0, 0, 0, 0, 0, 0, 2],
        },
    );

    const result = extractPdasFromProgram(
        programNode({ instructions: [createThing, readThing], name: 'test', publicKey: '1111' }),
    );

    expect(result.pdas).toHaveLength(1);
    expect(result.pdas[0].name).toBe('dataRecord');
});

// Twin-pubkey PDAs with no const seed stay separate by seed name -- a pure-structural fingerprint
// would false-merge them.
test('it keeps two distinct no-constant PDAs (escrow vs friendship) separate', () => {
    const ixNode = ix(
        'pair_up',
        [
            {
                name: 'escrow',
                pda: {
                    seeds: [
                        { kind: 'account', path: 'maker' },
                        { kind: 'account', path: 'taker' },
                    ],
                },
                signer: false,
                writable: false,
            },
            { name: 'maker', signer: false, writable: false },
            { name: 'taker', signer: false, writable: false },
            {
                name: 'friendship',
                pda: {
                    seeds: [
                        { kind: 'account', path: 'user_a' },
                        { kind: 'account', path: 'user_b' },
                    ],
                },
                signer: false,
                writable: false,
            },
            { name: 'user_a', signer: false, writable: false },
            { name: 'user_b', signer: false, writable: false },
        ],
        { discriminator: [0, 0, 0, 0, 0, 0, 0, 3] },
    );

    const result = extractPdasFromProgram(programNode({ instructions: [ixNode], name: 'test', publicKey: '1111' }));

    const names = result.pdas.map(p => p.name).sort();
    expect(names).toEqual(['escrow', 'friendship']);
});
