import { isNode, programNode } from '@codama/nodes';
import { expect, test } from 'vitest';

import { extractPdasFromProgram } from '../../src';
import { definedStruct, ix } from './_fixtures';

const bytes = (s: string) => Array.from(new TextEncoder().encode(s));

test('it unifies a state_account PDA across the account-path and arg-path mints', () => {
    const STATE_ACCOUNT = bytes('state_account');
    const init = ix(
        'init_two_mints',
        [
            {
                name: 'state_account',
                pda: {
                    seeds: [
                        { kind: 'const', value: STATE_ACCOUNT },
                        { kind: 'account', path: 'mint_a' },
                        { kind: 'account', path: 'mint_b' },
                    ],
                },
                signer: false,
                writable: true,
            },
            { name: 'mint_a', signer: false, writable: false },
            { name: 'mint_b', signer: false, writable: false },
        ],
        { discriminator: [0, 0, 0, 0, 0, 0, 0, 1] },
    );
    const setStatus = ix(
        'set_status_with_args',
        [
            {
                name: 'state_account',
                pda: {
                    seeds: [
                        { kind: 'const', value: STATE_ACCOUNT },
                        { kind: 'arg', path: 'args.mint_a' },
                        { kind: 'arg', path: 'args.mint_b' },
                    ],
                },
                signer: false,
                writable: true,
            },
        ],
        {
            args: [{ name: 'args', type: { defined: { name: 'SetStatusArgs' } } }],
            definedTypes: [definedStruct('SetStatusArgs', { mint_a: 'pubkey', mint_b: 'pubkey' })],
            discriminator: [0, 0, 0, 0, 0, 0, 0, 2],
        },
    );

    const result = extractPdasFromProgram(
        programNode({ instructions: [init, setStatus], name: 'test_program', publicKey: '1111' }),
    );

    expect(result.pdas).toHaveLength(1);
    expect(result.pdas.map(p => p.name)).toEqual(['stateAccount']);
});

// Assert non-skip on migrate's pool before the count check -- otherwise a wrongly-skipped migrate
// would still let the count assertion pass.
test('it resolves and unifies a pool PDA across create (arg + accounts) and migrate (data fields)', () => {
    const POOL = bytes('pool');
    const createPool = ix(
        'create_pool',
        [
            {
                name: 'pool',
                pda: {
                    seeds: [
                        { kind: 'const', value: POOL },
                        { kind: 'arg', path: 'index' },
                        { kind: 'account', path: 'owner' },
                        { kind: 'account', path: 'mint_a' },
                        { kind: 'account', path: 'mint_b' },
                    ],
                },
                signer: false,
                writable: true,
            },
            { name: 'owner', signer: true, writable: false },
            { name: 'mint_a', signer: false, writable: false },
            { name: 'mint_b', signer: false, writable: false },
        ],
        { args: [{ name: 'index', type: 'u16' }], discriminator: [0, 0, 0, 0, 0, 0, 0, 3] },
    );
    const migrate = ix(
        'migrate_from_data_fields',
        [
            {
                name: 'pool',
                pda: {
                    seeds: [
                        { kind: 'const', value: POOL },
                        { account: 'Pool', kind: 'account', path: 'pool.index' },
                        { account: 'Pool', kind: 'account', path: 'pool.owner' },
                        { account: 'Pool', kind: 'account', path: 'pool.mint_a' },
                        { account: 'Pool', kind: 'account', path: 'pool.mint_b' },
                    ],
                },
                signer: false,
                writable: true,
            },
        ],
        {
            definedTypes: [
                definedStruct('Pool', { index: 'u16', mint_a: 'pubkey', mint_b: 'pubkey', owner: 'pubkey' }),
            ],
            discriminator: [0, 0, 0, 0, 0, 0, 0, 4],
        },
    );

    const migratePool = migrate.accounts.find(a => a.name === 'pool');
    expect(isNode(migratePool?.defaultValue, 'pdaValueNode')).toBe(true);

    const result = extractPdasFromProgram(
        programNode({ instructions: [createPool, migrate], name: 'test_program', publicKey: '1111' }),
    );
    expect(result.pdas).toHaveLength(1);
    expect(result.pdas.map(p => p.name)).toEqual(['pool']);
});

test('a foreign-program PDA keeps its inline defaultValue but is not promoted into this program.pdas', () => {
    const FOREIGN_PROGRAM = Array.from({ length: 32 }, (_, i) => i + 1);
    const PREFIX = bytes('external_data_record');

    const createToken = ix(
        'create_token',
        [
            {
                name: 'external_data_record',
                pda: {
                    program: { kind: 'const', value: FOREIGN_PROGRAM },
                    seeds: [
                        { kind: 'const', value: PREFIX },
                        { kind: 'arg', path: 'args.owner_key' },
                        { kind: 'account', path: 'mint_b' },
                    ],
                },
                signer: false,
                writable: true,
            },
            { name: 'mint_b', signer: false, writable: false },
        ],
        {
            args: [{ name: 'args', type: { defined: { name: 'CreateTokenArgs' } } }],
            definedTypes: [definedStruct('CreateTokenArgs', { owner_key: 'pubkey' })],
            discriminator: [0, 0, 0, 0, 0, 0, 0, 5],
        },
    );
    const read = ix(
        'init_two_mints',
        [
            {
                name: 'external_data_record',
                pda: {
                    program: { kind: 'const', value: FOREIGN_PROGRAM },
                    seeds: [
                        { kind: 'const', value: PREFIX },
                        { account: 'StateAccount', kind: 'account', path: 'state_account.owner_key' },
                        { kind: 'account', path: 'mint_b' },
                    ],
                },
                signer: false,
                writable: true,
            },
            { name: 'state_account', signer: false, writable: false },
            { name: 'mint_b', signer: false, writable: false },
        ],
        {
            definedTypes: [definedStruct('StateAccount', { owner_key: 'pubkey' })],
            discriminator: [0, 0, 0, 0, 0, 0, 0, 6],
        },
    );

    expect(isNode(createToken.accounts.find(a => a.name === 'externalDataRecord')?.defaultValue, 'pdaValueNode')).toBe(
        true,
    );
    expect(isNode(read.accounts.find(a => a.name === 'externalDataRecord')?.defaultValue, 'pdaValueNode')).toBe(true);

    const result = extractPdasFromProgram(
        programNode({ instructions: [createToken, read], name: 'test_program', publicKey: '1111' }),
    );
    expect(result.pdas.map(p => p.name)).not.toContain('externalDataRecord');
});

// "Accepted" fracture: dropping seed names from the fingerprint would false-merge genuinely-distinct
// PDAs like escrow[maker,taker] vs friendship[userA,userB].
test('it does not unify a state_account PDA across differently-named bare mint accounts', () => {
    const STATE_ACCOUNT = bytes('state_account');
    const init = ix(
        'init',
        [
            {
                name: 'state_account',
                pda: {
                    seeds: [
                        { kind: 'const', value: STATE_ACCOUNT },
                        { kind: 'account', path: 'mint' },
                    ],
                },
                signer: false,
                writable: true,
            },
            { name: 'mint', signer: false, writable: false },
        ],
        { discriminator: [0, 0, 0, 0, 0, 0, 0, 1] },
    );
    const initV2 = ix(
        'init_v2',
        [
            {
                name: 'state_account',
                pda: {
                    seeds: [
                        { kind: 'const', value: STATE_ACCOUNT },
                        { kind: 'account', path: 'mint_a' },
                    ],
                },
                signer: false,
                writable: true,
            },
            { name: 'mint_a', signer: false, writable: false },
        ],
        { discriminator: [0, 0, 0, 0, 0, 0, 0, 2] },
    );

    const result = extractPdasFromProgram(
        programNode({ instructions: [init, initV2], name: 'test', publicKey: '1111' }),
    );

    expect(result.pdas).toHaveLength(2);
    expect(result.pdas.map(p => p.name).sort()).toEqual(['stateAccount', 'initV2StateAccount'].sort());
});
