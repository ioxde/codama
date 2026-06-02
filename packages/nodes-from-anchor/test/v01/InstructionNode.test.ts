import {
    argumentValueNode,
    assertIsNode,
    bytesTypeNode,
    constantPdaSeedNodeFromBytes,
    fieldDiscriminatorNode,
    fixedSizeTypeNode,
    instructionAccountNode,
    instructionArgumentNode,
    instructionNode,
    isNode,
    numberTypeNode,
    pdaNode,
    pdaSeedValueNode,
    pdaValueNode,
    publicKeyTypeNode,
    variablePdaSeedNode,
} from '@codama/nodes';
import { expect, test } from 'vitest';

import { getAnchorDiscriminatorV01, instructionNodeFromAnchorV01 } from '../../src';
import { definedStruct, firstSeedInputName, generics, ix, seedArgNames } from './_fixtures';

test('it creates instruction nodes', () => {
    const node = instructionNodeFromAnchorV01(
        {
            accounts: [
                {
                    name: 'distribution',
                    pda: {
                        seeds: [
                            { kind: 'const', value: [42, 31, 29] },
                            { account: 'Distribution', kind: 'account', path: 'distribution.group_mint' },
                        ],
                    },
                    signer: false,
                    writable: true,
                },
            ],
            args: [{ name: 'amount', type: 'u8' }],
            discriminator: [246, 28, 6, 87, 251, 45, 50, 42],
            name: 'mintTokens',
        },
        [{ name: 'Distribution', type: { fields: [{ name: 'group_mint', type: 'pubkey' }], kind: 'struct' } }],
        generics,
    );

    // A data-field self-ref is rescued as a non-serialized extra arg, not skipped.
    expect(node).toEqual(
        instructionNode({
            accounts: [
                instructionAccountNode({
                    defaultValue: pdaValueNode(
                        pdaNode({
                            name: 'distribution',
                            seeds: [
                                constantPdaSeedNodeFromBytes('base58', 'F9bS'),
                                variablePdaSeedNode('groupMint', publicKeyTypeNode()),
                            ],
                        }),
                        [pdaSeedValueNode('groupMint', argumentValueNode('groupMint'))],
                    ),
                    isSigner: false,
                    isWritable: true,
                    name: 'distribution',
                }),
            ],
            arguments: [
                instructionArgumentNode({
                    defaultValue: getAnchorDiscriminatorV01([246, 28, 6, 87, 251, 45, 50, 42]),
                    defaultValueStrategy: 'omitted',
                    name: 'discriminator',
                    type: fixedSizeTypeNode(bytesTypeNode(), 8),
                }),
                instructionArgumentNode({ name: 'amount', type: numberTypeNode('u8') }),
            ],
            discriminators: [fieldDiscriminatorNode('discriminator')],
            extraArguments: [instructionArgumentNode({ name: 'groupMint', type: publicKeyTypeNode() })],
            name: 'mintTokens',
        }),
    );
});

test('it creates instruction nodes with anchor discriminators', () => {
    const node = instructionNodeFromAnchorV01(
        {
            accounts: [],
            args: [],
            discriminator: [246, 28, 6, 87, 251, 45, 50, 42],
            name: 'myInstruction',
        },
        [],
        generics,
    );

    expect(node).toEqual(
        instructionNode({
            arguments: [
                instructionArgumentNode({
                    defaultValue: getAnchorDiscriminatorV01([246, 28, 6, 87, 251, 45, 50, 42]),
                    defaultValueStrategy: 'omitted',
                    name: 'discriminator',
                    type: fixedSizeTypeNode(bytesTypeNode(), 8),
                }),
            ],
            discriminators: [fieldDiscriminatorNode('discriminator')],
            name: 'myInstruction',
        }),
    );
});

test('it declares a non-serialized extra argument for a nested account-data PDA seed', () => {
    const node = ix(
        'foo',
        [
            { name: 'mint', signer: false, writable: false },
            {
                name: 'derived',
                pda: { seeds: [{ account: 'Mint', kind: 'account', path: 'mint.authority' }] },
                signer: false,
                writable: false,
            },
        ],
        { definedTypes: [definedStruct('Mint', { authority: 'pubkey' })] },
    );

    expect(node.extraArguments).toEqual([instructionArgumentNode({ name: 'authority', type: publicKeyTypeNode() })]);
});

test('it declares only an account-data-field seed as a leaf-named extra argument (host PDA)', () => {
    const node = ix(
        'read',
        [
            { name: 'state_account', signer: false, writable: false },
            {
                name: 'derived',
                pda: {
                    seeds: [
                        { kind: 'const', value: Array.from(new TextEncoder().encode('derived')) },
                        { account: 'StateAccount', kind: 'account', path: 'state_account.owner_key' },
                        { kind: 'account', path: 'mint_b' },
                    ],
                },
                signer: false,
                writable: true,
            },
            { name: 'mint_b', signer: false, writable: false },
        ],
        {
            definedTypes: [definedStruct('StateAccount', { owner_key: 'pubkey' })],
            discriminator: [0, 0, 0, 0, 0, 0, 0, 2],
        },
    );

    expect(node.extraArguments).toEqual([instructionArgumentNode({ name: 'ownerKey', type: publicKeyTypeNode() })]);
});

test('a foreign-program PDA seeded by an account-data field lifts AND adds the data-field extra argument', () => {
    const node = ix(
        'init_two_mints',
        [
            { name: 'state_account', signer: false, writable: false },
            {
                name: 'external_data_record',
                pda: {
                    program: { kind: 'const', value: Array.from({ length: 32 }, (_, i) => i + 1) },
                    seeds: [
                        { kind: 'const', value: Array.from(new TextEncoder().encode('external_data_record')) },
                        { account: 'StateAccount', kind: 'account', path: 'state_account.owner_key' },
                        { kind: 'account', path: 'mint_b' },
                    ],
                },
                signer: false,
                writable: true,
            },
            { name: 'mint_b', signer: false, writable: false },
        ],
        {
            definedTypes: [definedStruct('StateAccount', { owner_key: 'pubkey' })],
            discriminator: [0, 0, 0, 0, 0, 0, 0, 2],
        },
    );

    const dv = node.accounts.find(a => a.name === 'externalDataRecord')?.defaultValue;
    expect(isNode(dv, 'pdaValueNode')).toBe(true);
    expect(node.extraArguments ?? []).toEqual([
        instructionArgumentNode({ name: 'ownerKey', type: publicKeyTypeNode() }),
    ]);
});

test('it dedups a data-field extra argument shared by two PDAs in one instruction', () => {
    const node = ix(
        'foo',
        [
            { name: 'state_account', signer: false, writable: false },
            {
                name: 'fee_a',
                pda: { seeds: [{ account: 'StateAccount', kind: 'account', path: 'state_account.owner_key' }] },
                signer: false,
                writable: false,
            },
            {
                name: 'fee_b',
                pda: { seeds: [{ account: 'StateAccount', kind: 'account', path: 'state_account.owner_key' }] },
                signer: false,
                writable: false,
            },
        ],
        { definedTypes: [definedStruct('StateAccount', { owner_key: 'pubkey' })] },
    );

    expect(node.extraArguments).toEqual([instructionArgumentNode({ name: 'ownerKey', type: publicKeyTypeNode() })]);
});

test('declares two independent inputs when same-named fields of DIFFERENT accounts seed two PDAs', () => {
    const node = ix(
        'process',
        [
            { name: 'pool_a', signer: false, writable: false },
            { name: 'pool_b', signer: false, writable: false },
            {
                name: 'vault_a',
                pda: { seeds: [{ account: 'PoolA', kind: 'account', path: 'pool_a.mint' }] },
                signer: false,
                writable: false,
            },
            {
                name: 'vault_b',
                pda: { seeds: [{ account: 'PoolB', kind: 'account', path: 'pool_b.mint' }] },
                signer: false,
                writable: false,
            },
        ],
        { definedTypes: [definedStruct('PoolA', { mint: 'pubkey' }), definedStruct('PoolB', { mint: 'pubkey' })] },
    );

    expect(node.extraArguments).toHaveLength(2);

    // Each vault must derive from its own field's input, not a fused one.
    expect(firstSeedInputName(node, 'vaultA')).toBeDefined();
    expect(firstSeedInputName(node, 'vaultA')).not.toBe(firstSeedInputName(node, 'vaultB'));
});

test('declares a distinct input for a data-field seed whose leaf collides with a serialized arg', () => {
    const node = ix(
        'update',
        [
            { name: 'pool', signer: false, writable: false },
            {
                name: 'vault',
                pda: { seeds: [{ account: 'Pool', kind: 'account', path: 'pool.amount' }] },
                signer: false,
                writable: false,
            },
        ],
        { args: [{ name: 'amount', type: 'u64' }], definedTypes: [definedStruct('Pool', { amount: 'u64' })] },
    );

    const extras = node.extraArguments ?? [];
    expect(extras).toHaveLength(1);
    expect(extras[0]?.name).not.toBe('amount');
});

test('declares two independent inputs for prefixed accounts whose PDAs seed on same-named fields', () => {
    const node = ix(
        'process',
        [
            { name: 'authority', signer: false, writable: false },
            { name: 'pool_a', signer: false, writable: false },
            { name: 'pool_b', signer: false, writable: false },
            {
                accounts: [
                    { name: 'authority', signer: false, writable: false }, // duplicate of top-level `authority` -> turns on prefixing
                    {
                        name: 'vault_a',
                        pda: { seeds: [{ account: 'PoolA', kind: 'account', path: 'pool_a.mint' }] },
                        signer: false,
                        writable: false,
                    },
                    {
                        name: 'vault_b',
                        pda: { seeds: [{ account: 'PoolB', kind: 'account', path: 'pool_b.mint' }] },
                        signer: false,
                        writable: false,
                    },
                ],
                name: 'pools',
            },
        ],
        { definedTypes: [definedStruct('PoolA', { mint: 'pubkey' }), definedStruct('PoolB', { mint: 'pubkey' })] },
    );

    expect(node.extraArguments).toHaveLength(2);

    // Each prefixed vault must reference its own input, not one fused `mint`.
    expect(firstSeedInputName(node, 'poolsVaultA')).toBeDefined();
    expect(firstSeedInputName(node, 'poolsVaultA')).not.toBe(firstSeedInputName(node, 'poolsVaultB'));
});

test('declares a distinct input when every name candidate for a data-field seed aliases a serialized arg', () => {
    const node = ix(
        'update',
        [
            { name: 'pool', signer: false, writable: false },
            {
                name: 'vault',
                pda: { seeds: [{ account: 'Pool', kind: 'account', path: 'pool.amount' }] },
                signer: false,
                writable: false,
            },
        ],
        {
            args: [
                { name: 'amount', type: 'u64' },
                { name: 'pool_amount', type: 'u64' },
            ],
            definedTypes: [definedStruct('Pool', { amount: 'u64' })],
        },
    );

    const extras = node.extraArguments ?? [];
    expect(extras).toHaveLength(1);
    expect(['amount', 'poolAmount']).not.toContain(extras[0]?.name);
    expect(firstSeedInputName(node, 'vault')).toBe(extras[0]?.name);
});

test('keeps one input for a field read by two PDAs when one PDA also has a within-PDA collision', () => {
    const node = ix(
        'process',
        [
            { name: 'pool', signer: false, writable: false },
            { name: 'other', signer: false, writable: false },
            {
                name: 'vault1',
                pda: {
                    seeds: [
                        { account: 'Pool', kind: 'account', path: 'pool.mint' },
                        { account: 'Other', kind: 'account', path: 'other.mint' },
                    ],
                },
                signer: false,
                writable: false,
            },
            {
                name: 'vault2',
                pda: { seeds: [{ account: 'Pool', kind: 'account', path: 'pool.mint' }] },
                signer: false,
                writable: false,
            },
        ],
        { definedTypes: [definedStruct('Pool', { mint: 'pubkey' }), definedStruct('Other', { mint: 'pubkey' })] },
    );

    // pool.mint (one field, read by both PDAs) + other.mint = two inputs; three would mean pool.mint split.
    expect(node.extraArguments).toHaveLength(2);
    expect(seedArgNames(node, 'vault2')).toHaveLength(1);
    expect(seedArgNames(node, 'vault1')).toContain(seedArgNames(node, 'vault2')[0]);
});

test('gives distinct inputs to distinct fields when a qualified name matches another field bare leaf', () => {
    const node = ix(
        'process',
        [
            { name: 'pool', signer: false, writable: false },
            { name: 'other', signer: false, writable: false },
            { name: 'config', signer: false, writable: false },
            {
                name: 'vault_a',
                pda: { seeds: [{ account: 'Pool', kind: 'account', path: 'pool.mint' }] },
                signer: false,
                writable: false,
            },
            {
                name: 'vault_b',
                pda: { seeds: [{ account: 'Other', kind: 'account', path: 'other.mint' }] },
                signer: false,
                writable: false,
            },
            {
                name: 'vault_c',
                pda: { seeds: [{ account: 'Config', kind: 'account', path: 'config.pool_mint' }] },
                signer: false,
                writable: false,
            },
        ],
        {
            definedTypes: [
                definedStruct('Pool', { mint: 'pubkey' }),
                definedStruct('Other', { mint: 'pubkey' }),
                definedStruct('Config', { pool_mint: 'pubkey' }),
            ],
        },
    );

    expect(node.extraArguments).toHaveLength(3);
    expect(firstSeedInputName(node, 'vaultA')).not.toBe(firstSeedInputName(node, 'vaultC'));
});

test('keeps one input for a field read by a top-level PDA and a prefixed-group PDA', () => {
    const node = ix(
        'process',
        [
            { name: 'pool', signer: false, writable: false },
            { name: 'shared', signer: false, writable: false },
            {
                name: 'vault_top',
                pda: { seeds: [{ account: 'Pool', kind: 'account', path: 'pool.mint' }] },
                signer: false,
                writable: false,
            },
            {
                accounts: [
                    { name: 'shared', signer: false, writable: false },
                    {
                        name: 'vault_nested',
                        pda: { seeds: [{ account: 'Pool', kind: 'account', path: 'pool.mint' }] },
                        signer: false,
                        writable: false,
                    },
                ],
                name: 'nested',
            },
        ],
        { definedTypes: [definedStruct('Pool', { mint: 'pubkey' })] },
    );

    const seedInputNames = new Set(node.accounts.flatMap(a => seedArgNames(node, a.name)));
    expect(node.extraArguments).toHaveLength(1);
    expect(seedInputNames.size).toBe(1);
});

test('keeps one input for a field used as two identical seeds in one PDA', () => {
    const node = ix(
        'process',
        [
            { name: 'pool', signer: false, writable: false },
            {
                name: 'vault',
                pda: {
                    seeds: [
                        { account: 'Pool', kind: 'account', path: 'pool.mint' },
                        { account: 'Pool', kind: 'account', path: 'pool.mint' },
                    ],
                },
                signer: false,
                writable: false,
            },
        ],
        { definedTypes: [definedStruct('Pool', { mint: 'pubkey' })] },
    );

    expect(node.extraArguments).toHaveLength(1);
});

test('keeps a data-field seed input distinct from a sibling bare-account seed sharing its leaf', () => {
    const node = ix(
        'process',
        [
            { name: 'pool', signer: false, writable: false },
            { name: 'mint', signer: false, writable: false },
            {
                name: 'vault',
                pda: {
                    seeds: [
                        { account: 'Pool', kind: 'account', path: 'pool.mint' },
                        { kind: 'account', path: 'mint' },
                    ],
                },
                signer: false,
                writable: false,
            },
        ],
        { definedTypes: [definedStruct('Pool', { mint: 'pubkey' })] },
    );

    const vault = node.accounts.find(a => a.name === 'vault')?.defaultValue;
    const seedInputNames = isNode(vault, 'pdaValueNode')
        ? vault.seeds.flatMap(s => (isNode(s.value, ['argumentValueNode', 'accountValueNode']) ? [s.value.name] : []))
        : [];

    expect(new Set(seedInputNames).size).toBe(seedInputNames.length);
});

test('synthesizes correctly-typed extraArguments when intra-PDA dedup collides with an ungrouped sibling', () => {
    const node = ix(
        'process',
        [
            { name: 'pool', signer: false, writable: false },
            { name: 'reward', signer: false, writable: false },
            { name: 'config', signer: false, writable: false },
            {
                name: 'vault',
                pda: {
                    seeds: [
                        { account: 'Pool', kind: 'account', path: 'pool.mint' },
                        { account: 'Reward', kind: 'account', path: 'reward.mint' },
                        { account: 'Config', kind: 'account', path: 'config.pool_mint' },
                    ],
                },
                signer: false,
                writable: false,
            },
        ],
        {
            definedTypes: [
                definedStruct('Pool', { mint: 'pubkey' }),
                definedStruct('Reward', { mint: 'pubkey' }),
                definedStruct('Config', { pool_mint: 'u64' }),
            ],
        },
    );

    const vault = node.accounts.find(a => a.name === 'vault')?.defaultValue;
    assertIsNode(vault, 'pdaValueNode');
    assertIsNode(vault.pda, 'pdaNode');
    const typeByName = new Map((node.extraArguments ?? []).map(a => [a.name, a.type]));

    // All-variable seeds: pdaNode.seeds and pdaValueNode.seeds align by index.
    vault.pda.seeds.forEach((seed, i) => {
        if (!isNode(seed, 'variablePdaSeedNode')) return;
        const value = vault.seeds[i]?.value;
        if (!isNode(value, 'argumentValueNode')) return;
        expect(typeByName.get(value.name)).toEqual(seed.type);
    });
});

test('it gives two PDAs in different groups distinct extra args for distinct prefixed accounts', () => {
    const pool = (name: string) => ({
        accounts: [
            { name: 'pool', signer: false, writable: false },
            {
                name: 'derived',
                pda: { seeds: [{ account: 'Pool', kind: 'account', path: 'pool.mint' }] },
                signer: false,
                writable: false,
            },
        ],
        name,
    });
    const node = ix('process', [pool('groupA'), pool('groupB')], {
        definedTypes: [definedStruct('Pool', { mint: 'pubkey' })],
    });

    const names = (node.extraArguments ?? []).map(a => a.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBe(2);
});

test('it gives an account-data tuple-index seed an identifier-shaped (non-digit) extra argument', () => {
    const node = ix(
        'tupleSeed',
        [
            { name: 'config', signer: false, writable: false },
            {
                name: 'derived',
                pda: { seeds: [{ account: 'Config', kind: 'account', path: 'config.tup.0' }] },
                signer: false,
                writable: false,
            },
        ],
        { definedTypes: [definedStruct('Config', { tup: { fields: ['u64'], kind: 'struct' } })] },
    );

    const dv = node.accounts[1].defaultValue;
    assertIsNode(dv, 'pdaValueNode');
    for (const seedValue of dv.seeds) {
        if (isNode(seedValue.value, 'argumentValueNode')) expect(seedValue.value.name).not.toMatch(/^\d/);
    }
    for (const arg of node.extraArguments ?? []) expect(arg.name).not.toMatch(/^\d/);
});

test('each cross-group derived PDA seeds from its own group field, regardless of position', () => {
    const side = (name: string, field: string) => ({
        accounts: [
            { name: 'pool', signer: false, writable: false },
            {
                name: 'derived',
                pda: { seeds: [{ account: 'Pool', kind: 'account', path: `pool.${field}` }] },
                signer: false,
                writable: false,
            },
        ],
        name,
    });
    const node = ix('process', [side('groupA', 'first'), side('groupB', 'second')], {
        definedTypes: [definedStruct('Pool', { first: 'pubkey', second: 'pubkey' })],
    });

    const seedNamesPerPda = node.accounts.flatMap(a =>
        isNode(a.defaultValue, 'pdaValueNode')
            ? [a.defaultValue.seeds.map(s => (isNode(s.value, 'argumentValueNode') ? s.value.name : null))]
            : [],
    );
    expect(seedNamesPerPda).toEqual([['first'], ['second']]);
    expect((node.extraArguments ?? []).map(a => a.name).sort()).toEqual(['first', 'second']);
});
