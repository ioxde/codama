import {
    accountValueNode,
    argumentValueNode,
    assertIsNode,
    constantPdaSeedNodeFromBytes,
    definedTypeLinkNode,
    type InstructionAccountNode,
    instructionAccountNode,
    instructionArgumentNode,
    isNode,
    numberTypeNode,
    pdaNode,
    pdaSeedValueNode,
    pdaValueNode,
    publicKeyTypeNode,
    publicKeyValueNode,
    structFieldTypeNode,
    structTypeNode,
    variablePdaSeedNode,
} from '@codama/nodes';
import { getBase58Codec } from '@solana/codecs';
import { expect, test } from 'vitest';

import {
    IdlV01InstructionAccountItem,
    instructionAccountNodeFromAnchorV01,
    instructionAccountNodesFromAnchorV01,
} from '../../src';

// Narrow an account's defaultValue to a lifted PDA (pdaValueNode wrapping an inline pdaNode).
function liftedPda(account: InstructionAccountNode | undefined) {
    const dv = account?.defaultValue;
    assertIsNode(dv, 'pdaValueNode');
    assertIsNode(dv.pda, 'pdaNode');
    return dv as typeof dv & { pda: Extract<typeof dv.pda, { kind: 'pdaNode' }> };
}

test('it creates instruction account nodes', () => {
    const node = instructionAccountNodeFromAnchorV01(
        {
            docs: ['my docs'],
            name: 'MyInstructionAccount',
            optional: true,
            signer: false,
            writable: true,
        },
        [],
    );

    expect(node).toEqual(
        instructionAccountNode({
            docs: ['my docs'],
            isOptional: true,
            isSigner: false,
            isWritable: true,
            name: 'myInstructionAccount',
        }),
    );
});

test('it flattens nested instruction accounts without prefixing when no duplicates exist', () => {
    const nodes = instructionAccountNodesFromAnchorV01(
        [
            { name: 'accountA', signer: false, writable: false },
            {
                accounts: [
                    {
                        name: 'account_b',
                        signer: false,
                        writable: true,
                    },
                    {
                        name: 'account_c',
                        pda: {
                            seeds: [
                                {
                                    kind: 'const',
                                    value: [0, 1, 2, 3],
                                },
                                {
                                    kind: 'account',
                                    path: 'account_b',
                                },
                                {
                                    kind: 'arg',
                                    path: 'amount',
                                },
                            ],
                        },
                        signer: true,
                        writable: false,
                    },
                    {
                        address: '11111111111111111111111111111111',
                        name: 'system_program',
                    },
                ],
                name: 'nested',
            },
            { name: 'account_d', signer: true, writable: true },
        ],
        [instructionArgumentNode({ name: 'amount', type: numberTypeNode('u8') })],
    );

    expect(nodes).toEqual([
        instructionAccountNode({ isSigner: false, isWritable: false, name: 'accountA' }),
        instructionAccountNode({ isSigner: false, isWritable: true, name: 'accountB' }),
        instructionAccountNode({
            defaultValue: pdaValueNode(
                pdaNode({
                    name: 'accountC',
                    seeds: [
                        constantPdaSeedNodeFromBytes('base58', '1Ldp'),
                        variablePdaSeedNode('accountB', publicKeyTypeNode()),
                        variablePdaSeedNode('amount', numberTypeNode('u8')),
                    ],
                }),
                [
                    pdaSeedValueNode('accountB', accountValueNode('accountB')),
                    pdaSeedValueNode('amount', argumentValueNode('amount')),
                ],
            ),
            isSigner: true,
            isWritable: false,
            name: 'accountC',
        }),
        instructionAccountNode({
            defaultValue: publicKeyValueNode('11111111111111111111111111111111', 'systemProgram'),
            isSigner: false,
            isWritable: false,
            name: 'systemProgram',
        }),
        instructionAccountNode({ isSigner: true, isWritable: true, name: 'accountD' }),
    ]);
});

test('it prevents duplicate names by prefixing nested accounts with different parent names', () => {
    const nodes = instructionAccountNodesFromAnchorV01(
        [
            {
                accounts: [
                    { name: 'mint', signer: false, writable: false },
                    { name: 'authority', signer: true, writable: false },
                ],
                name: 'tokenProgram',
            },
            {
                accounts: [
                    { name: 'mint', signer: false, writable: true },
                    { name: 'metadata', signer: false, writable: true },
                ],
                name: 'nftProgram',
            },
        ],
        [],
    );

    expect(nodes).toEqual([
        instructionAccountNode({ isSigner: false, isWritable: false, name: 'tokenProgramMint' }),
        instructionAccountNode({ isSigner: true, isWritable: false, name: 'tokenProgramAuthority' }),
        instructionAccountNode({ isSigner: false, isWritable: true, name: 'nftProgramMint' }),
        instructionAccountNode({ isSigner: false, isWritable: true, name: 'nftProgramMetadata' }),
    ]);
});

test('it handles nested accounts with more complex duplicate scenarios', () => {
    const nodes = instructionAccountNodesFromAnchorV01(
        [
            { name: 'authority', signer: true, writable: false },
            {
                accounts: [
                    { name: 'mint', signer: false, writable: false },
                    { name: 'vault', signer: false, writable: true },
                    { name: 'authority', signer: false, writable: false },
                ],
                name: 'sourceProgram',
            },
            {
                accounts: [
                    { name: 'mint', signer: false, writable: false },
                    { name: 'escrow', signer: false, writable: true },
                    { name: 'metadata', signer: false, writable: true },
                ],
                name: 'destinationProgram',
            },
        ],
        [],
    );

    expect(nodes).toEqual([
        instructionAccountNode({ isSigner: true, isWritable: false, name: 'authority' }),
        instructionAccountNode({ isSigner: false, isWritable: false, name: 'sourceProgramMint' }),
        instructionAccountNode({ isSigner: false, isWritable: true, name: 'sourceProgramVault' }),
        instructionAccountNode({ isSigner: false, isWritable: false, name: 'sourceProgramAuthority' }),
        instructionAccountNode({ isSigner: false, isWritable: false, name: 'destinationProgramMint' }),
        instructionAccountNode({ isSigner: false, isWritable: true, name: 'destinationProgramEscrow' }),
        instructionAccountNode({ isSigner: false, isWritable: true, name: 'destinationProgramMetadata' }),
    ]);
});

test('it handles depth-2 nested accounts with naming conflicts', () => {
    const items = [
        { name: 'authority', signer: true, writable: false },
        {
            accounts: [
                { name: 'mint', signer: false, writable: false },
                { name: 'vault', signer: false, writable: true },
                { name: 'authority', signer: false, writable: false },
                {
                    accounts: [
                        { name: 'authority', signer: false, writable: true },
                        { name: 'mint', signer: false, writable: false },
                    ],
                    name: 'deepProgram',
                },
            ],
            name: 'sourceProgram',
        },
        {
            accounts: [
                { name: 'mint', signer: false, writable: false },
                { name: 'escrow', signer: false, writable: true },
                { name: 'metadata', signer: false, writable: true },
            ],
            name: 'destinationProgram',
        },
    ] as unknown as IdlV01InstructionAccountItem[];

    const nodes = instructionAccountNodesFromAnchorV01(items, []);

    expect(nodes).toEqual([
        instructionAccountNode({ isSigner: true, isWritable: false, name: 'authority' }),
        instructionAccountNode({ isSigner: false, isWritable: false, name: 'sourceProgramMint' }),
        instructionAccountNode({ isSigner: false, isWritable: true, name: 'sourceProgramVault' }),
        instructionAccountNode({ isSigner: false, isWritable: false, name: 'sourceProgramAuthority' }),
        instructionAccountNode({ isSigner: false, isWritable: true, name: 'sourceProgramDeepProgramAuthority' }),
        instructionAccountNode({ isSigner: false, isWritable: false, name: 'sourceProgramDeepProgramMint' }),
        instructionAccountNode({ isSigner: false, isWritable: false, name: 'destinationProgramMint' }),
        instructionAccountNode({ isSigner: false, isWritable: true, name: 'destinationProgramEscrow' }),
        instructionAccountNode({ isSigner: false, isWritable: true, name: 'destinationProgramMetadata' }),
    ]);
});

test('it correctly prefixes PDA seed account references in nested groups', () => {
    const nodes = instructionAccountNodesFromAnchorV01(
        [
            {
                accounts: [
                    { name: 'mint', signer: false, writable: false },
                    {
                        name: 'vault',
                        pda: {
                            seeds: [{ kind: 'account', path: 'mint' }],
                        },
                        signer: false,
                        writable: true,
                    },
                ],
                name: 'tokenProgram',
            },
            {
                accounts: [
                    { name: 'mint', signer: false, writable: false },
                    {
                        name: 'escrow',
                        pda: {
                            seeds: [{ kind: 'account', path: 'mint' }],
                        },
                        signer: false,
                        writable: true,
                    },
                ],
                name: 'nftProgram',
            },
        ],
        [],
    );

    expect(nodes).toEqual([
        instructionAccountNode({ isSigner: false, isWritable: false, name: 'tokenProgramMint' }),
        instructionAccountNode({
            defaultValue: pdaValueNode(
                pdaNode({
                    name: 'tokenProgramVault',
                    seeds: [variablePdaSeedNode('tokenProgramMint', publicKeyTypeNode())],
                }),
                [pdaSeedValueNode('tokenProgramMint', accountValueNode('tokenProgramMint'))],
            ),
            isSigner: false,
            isWritable: true,
            name: 'tokenProgramVault',
        }),
        instructionAccountNode({ isSigner: false, isWritable: false, name: 'nftProgramMint' }),
        instructionAccountNode({
            defaultValue: pdaValueNode(
                pdaNode({
                    name: 'nftProgramEscrow',
                    seeds: [variablePdaSeedNode('nftProgramMint', publicKeyTypeNode())],
                }),
                [pdaSeedValueNode('nftProgramMint', accountValueNode('nftProgramMint'))],
            ),
            isSigner: false,
            isWritable: true,
            name: 'nftProgramEscrow',
        }),
    ]);
});

test('it correctly prefixes nested account seed paths in nested groups', () => {
    const nodes = instructionAccountNodesFromAnchorV01(
        [
            {
                accounts: [
                    { name: 'mint', signer: false, writable: false },
                    {
                        name: 'vault',
                        pda: {
                            seeds: [{ account: 'mint', kind: 'account', path: 'mint.authority' }],
                        },
                        signer: false,
                        writable: true,
                    },
                ],
                name: 'tokenProgram',
            },
            {
                accounts: [
                    { name: 'mint', signer: false, writable: false },
                    {
                        name: 'escrow',
                        pda: {
                            seeds: [{ account: 'mint', kind: 'account', path: 'mint.authority' }],
                        },
                        signer: false,
                        writable: true,
                    },
                ],
                name: 'nftProgram',
            },
        ],
        [],
        undefined,
        [{ name: 'mint', type: { fields: [{ name: 'authority', type: 'pubkey' }], kind: 'struct' } }],
    );

    expect(nodes).toEqual([
        instructionAccountNode({ isSigner: false, isWritable: false, name: 'tokenProgramMint' }),
        instructionAccountNode({
            defaultValue: pdaValueNode(
                pdaNode({
                    name: 'tokenProgramVault',
                    seeds: [variablePdaSeedNode('tokenProgramAuthority', publicKeyTypeNode())],
                }),
                [pdaSeedValueNode('tokenProgramAuthority', argumentValueNode('tokenProgramAuthority'))],
            ),
            isSigner: false,
            isWritable: true,
            name: 'tokenProgramVault',
        }),
        instructionAccountNode({ isSigner: false, isWritable: false, name: 'nftProgramMint' }),
        instructionAccountNode({
            defaultValue: pdaValueNode(
                pdaNode({
                    name: 'nftProgramEscrow',
                    seeds: [variablePdaSeedNode('nftProgramAuthority', publicKeyTypeNode())],
                }),
                [pdaSeedValueNode('nftProgramAuthority', argumentValueNode('nftProgramAuthority'))],
            ),
            isSigner: false,
            isWritable: true,
            name: 'nftProgramEscrow',
        }),
    ]);
});

test('it skips PDA when nested account type cannot be resolved from idlTypes', () => {
    const nodes = instructionAccountNodesFromAnchorV01(
        [
            {
                name: 'somePdaAccount',
                pda: {
                    seeds: [
                        {
                            account: 'mint',
                            kind: 'account',
                            path: 'mint.authority',
                        },
                    ],
                },
                signer: false,
                writable: false,
            },
        ],
        [],
    );

    expect(nodes).toEqual([
        instructionAccountNode({
            isSigner: false,
            isWritable: false,
            name: 'somePdaAccount',
        }),
    ]);
});

test('it resolves PDA seeds with nested arg paths', () => {
    const nodes = instructionAccountNodesFromAnchorV01(
        [
            {
                name: 'my_pda',
                pda: {
                    seeds: [
                        { kind: 'const', value: [0, 1, 2, 3] },
                        { kind: 'arg', path: 'args.owner' },
                        { kind: 'arg', path: 'args.amount' },
                    ],
                },
                signer: false,
                writable: false,
            },
        ],
        [
            instructionArgumentNode({
                name: 'args',
                type: structTypeNode([
                    structFieldTypeNode({ name: 'owner', type: publicKeyTypeNode() }),
                    structFieldTypeNode({ name: 'amount', type: numberTypeNode('u64') }),
                ]),
            }),
        ],
    );

    expect(nodes).toEqual([
        instructionAccountNode({
            defaultValue: pdaValueNode(
                pdaNode({
                    name: 'myPda',
                    seeds: [
                        constantPdaSeedNodeFromBytes('base58', '1Ldp'),
                        variablePdaSeedNode('owner', publicKeyTypeNode()),
                        variablePdaSeedNode('amount', numberTypeNode('u64')),
                    ],
                }),
                [
                    pdaSeedValueNode('owner', argumentValueNode('args', ['owner'])),
                    pdaSeedValueNode('amount', argumentValueNode('args', ['amount'])),
                ],
            ),
            isSigner: false,
            isWritable: false,
            name: 'myPda',
        }),
    ]);
});

test('it resolves PDA default values when account seeds have nested paths', () => {
    const nodes = instructionAccountNodesFromAnchorV01(
        [
            {
                name: 'somePdaAccount',
                pda: {
                    seeds: [
                        { kind: 'arg', path: 'args.owner' },
                        { account: 'mint', kind: 'account', path: 'mint.authority' },
                    ],
                },
                signer: false,
                writable: false,
            },
        ],
        [
            instructionArgumentNode({
                name: 'args',
                type: structTypeNode([structFieldTypeNode({ name: 'owner', type: publicKeyTypeNode() })]),
            }),
        ],
        undefined,
        [{ name: 'mint', type: { fields: [{ name: 'authority', type: 'pubkey' }], kind: 'struct' } }],
    );

    expect(nodes).toEqual([
        instructionAccountNode({
            defaultValue: pdaValueNode(
                pdaNode({
                    name: 'somePdaAccount',
                    seeds: [
                        variablePdaSeedNode('owner', publicKeyTypeNode()),
                        variablePdaSeedNode('authority', publicKeyTypeNode()),
                    ],
                }),
                [
                    pdaSeedValueNode('owner', argumentValueNode('args', ['owner'])),
                    pdaSeedValueNode('authority', argumentValueNode('authority')),
                ],
            ),
            isSigner: false,
            isWritable: false,
            name: 'somePdaAccount',
        }),
    ]);
});

test('it ignores PDA default values when nested arg paths are unresolvable', () => {
    const nodes = instructionAccountNodesFromAnchorV01(
        [
            {
                name: 'somePdaAccount',
                pda: {
                    seeds: [
                        { kind: 'const', value: [0, 1, 2, 3] },
                        { kind: 'arg', path: 'args.owner' },
                    ],
                },
                signer: false,
                writable: false,
            },
        ],
        [
            instructionArgumentNode({
                name: 'args',
                type: definedTypeLinkNode('UnknownType'),
            }),
        ],
    );

    expect(nodes).toEqual([
        instructionAccountNode({
            isSigner: false,
            isWritable: false,
            name: 'somePdaAccount',
        }),
    ]);
});

test('it handles PDAs with a constant program id', () => {
    const nodes = instructionAccountNodesFromAnchorV01(
        [
            {
                name: 'program_data',
                pda: {
                    program: {
                        kind: 'const',
                        value: [
                            2, 168, 246, 145, 78, 136, 161, 176, 226, 16, 21, 62, 247, 99, 174, 43, 0, 194, 185, 61, 22,
                            193, 36, 210, 192, 83, 122, 16, 4, 128, 0, 0,
                        ],
                    },
                    seeds: [
                        {
                            kind: 'const',
                            value: [
                                166, 175, 151, 238, 166, 67, 87, 148, 114, 209, 13, 88, 186, 228, 206, 197, 182, 71,
                                129, 195, 206, 236, 229, 223, 184, 60, 97, 249, 63, 92, 203, 27,
                            ],
                        },
                    ],
                },
            },
        ],
        [],
    );

    expect(nodes).toEqual([
        instructionAccountNode({
            defaultValue: pdaValueNode(
                pdaNode({
                    name: 'programData',
                    programId: 'BPFLoaderUpgradeab1e11111111111111111111111',
                    seeds: [constantPdaSeedNodeFromBytes('base58', 'CDfyUBS8ZuL1L3kEy6mHVyAx1s9E97KNAwTfMfvhCriN')],
                }),
                [],
            ),
            isSigner: false,
            isWritable: false,
            name: 'programData',
        }),
    ]);
});

test('it lifts a PDA whose program is a bare account ref by carrying it on pdaValueNode.programId', () => {
    const nodes = instructionAccountNodesFromAnchorV01(
        [
            { address: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', name: 'token_program' },
            { name: 'owner', signer: false, writable: false },
            { name: 'mint', signer: false, writable: false },
            {
                name: 'x',
                pda: {
                    program: { kind: 'account', path: 'token_program' },
                    seeds: [
                        { kind: 'account', path: 'owner' },
                        { kind: 'account', path: 'token_program' },
                        { kind: 'account', path: 'mint' },
                    ],
                },
                signer: false,
                writable: false,
            },
        ],
        [],
    );

    const dv = liftedPda(nodes.find(n => n.name === 'x'));
    expect(dv.pda.programId).toBeUndefined();
    expect(dv.programId).toEqual(accountValueNode('tokenProgram'));
});

test('it resolves a duplicate bare-account seed in a local PDA to the real account, not a renamed phantom one', () => {
    const nodes = instructionAccountNodesFromAnchorV01(
        [
            { name: 'state_account', signer: false, writable: true },
            { name: 'mint', signer: false, writable: false },
            {
                name: 'derived',
                pda: {
                    seeds: [
                        { kind: 'account', path: 'state_account' },
                        { kind: 'account', path: 'mint' },
                        { kind: 'account', path: 'mint' },
                    ],
                },
                signer: false,
                writable: false,
            },
        ],
        [],
    );

    const dv = nodes.find(n => n.name === 'derived')?.defaultValue;
    if (!isNode(dv, 'pdaValueNode')) {
        throw new Error('expected derived to be a pdaValueNode');
    }
    const accountTargets = dv.seeds.flatMap(s => (isNode(s.value, 'accountValueNode') ? [s.value.name] : []));
    expect(accountTargets).toEqual(['stateAccount', 'mint', 'mint']);
});

test('it handles PDAs with a program id that points to another account', () => {
    const nodes = instructionAccountNodesFromAnchorV01(
        [
            {
                name: 'my_pda',
                pda: {
                    program: { kind: 'account', path: 'my_program' },
                    seeds: [],
                },
            },
        ],
        [],
    );

    expect(nodes).toEqual([
        instructionAccountNode({
            defaultValue: pdaValueNode(
                pdaNode({
                    name: 'myPda',
                    seeds: [],
                }),
                [],
                accountValueNode('myProgram'),
            ),
            isSigner: false,
            isWritable: false,
            name: 'myPda',
        }),
    ]);
});

test('it resolves PDA default values when program seed has a nested path', () => {
    const nodes = instructionAccountNodesFromAnchorV01(
        [
            {
                name: 'my_pda',
                pda: {
                    program: { kind: 'arg', path: 'config.programId' },
                    seeds: [{ kind: 'const', value: [0, 1, 2, 3] }],
                },
                signer: false,
                writable: false,
            },
        ],
        [
            instructionArgumentNode({
                name: 'config',
                type: structTypeNode([structFieldTypeNode({ name: 'programId', type: publicKeyTypeNode() })]),
            }),
        ],
    );

    expect(nodes).toEqual([
        instructionAccountNode({
            defaultValue: pdaValueNode(
                pdaNode({
                    name: 'myPda',
                    seeds: [constantPdaSeedNodeFromBytes('base58', '1Ldp')],
                }),
                [],
                argumentValueNode('config', ['programId']),
            ),
            isSigner: false,
            isWritable: false,
            name: 'myPda',
        }),
    ]);
});

test('it handles PDAs with self-referential seeds', () => {
    const nodes = instructionAccountNodesFromAnchorV01(
        [
            {
                name: 'vault',
                pda: {
                    seeds: [
                        { kind: 'const', value: [1, 2, 3] },
                        { kind: 'account', path: 'vault' },
                    ],
                },
                signer: false,
                writable: false,
            },
            {
                name: 'guard',
                pda: {
                    seeds: [
                        { kind: 'const', value: [1, 2, 3] },
                        { account: 'GuardV1', kind: 'account', path: 'guard.mint' },
                    ],
                },
                signer: false,
                writable: false,
            },
            {
                name: 'my_guard',
                pda: {
                    seeds: [
                        { kind: 'const', value: [1, 2, 3] },
                        { account: 'GuardV1', kind: 'account', path: 'my_guard.mint' },
                    ],
                },
                signer: false,
                writable: false,
            },
        ],
        [],
        undefined,
        [{ name: 'GuardV1', type: { fields: [{ name: 'mint', type: 'pubkey' }], kind: 'struct' } }],
    );

    // Bare self-refs are skipped (truly circular); data-field self-refs are rescued because the
    // caller supplies the field.
    expect(nodes).toEqual([
        instructionAccountNode({
            isSigner: false,
            isWritable: false,
            name: 'vault',
        }),
        instructionAccountNode({
            defaultValue: pdaValueNode(
                pdaNode({
                    name: 'guard',
                    seeds: [
                        constantPdaSeedNodeFromBytes('base58', 'Ldp'),
                        variablePdaSeedNode('mint', publicKeyTypeNode()),
                    ],
                }),
                [pdaSeedValueNode('mint', argumentValueNode('mint'))],
            ),
            isSigner: false,
            isWritable: false,
            name: 'guard',
        }),
        instructionAccountNode({
            defaultValue: pdaValueNode(
                pdaNode({
                    name: 'myGuard',
                    seeds: [
                        constantPdaSeedNodeFromBytes('base58', 'Ldp'),
                        variablePdaSeedNode('mint', publicKeyTypeNode()),
                    ],
                }),
                [pdaSeedValueNode('mint', argumentValueNode('mint'))],
            ),
            isSigner: false,
            isWritable: false,
            name: 'myGuard',
        }),
    ]);
});

test('it handles account data paths of length 2', () => {
    const nodes = instructionAccountNodesFromAnchorV01(
        [
            {
                name: 'somePdaAccount',
                pda: {
                    seeds: [
                        {
                            account: 'mint',
                            kind: 'account',
                            path: 'mint.authority',
                        },
                    ],
                },
                signer: false,
                writable: false,
            },
        ],
        [],
        undefined,
        [{ name: 'mint', type: { fields: [{ name: 'authority', type: 'pubkey' }], kind: 'struct' } }],
    );

    expect(nodes).toEqual([
        instructionAccountNode({
            defaultValue: pdaValueNode(
                pdaNode({
                    name: 'somePdaAccount',
                    seeds: [variablePdaSeedNode('authority', publicKeyTypeNode())],
                }),
                [pdaSeedValueNode('authority', argumentValueNode('authority'))],
            ),
            isSigner: false,
            isWritable: false,
            name: 'somePdaAccount',
        }),
    ]);
});

test('it gives colliding account paths (mint.key field vs mint_key account) distinct seed names in one PDA', () => {
    const nodes = instructionAccountNodesFromAnchorV01(
        [
            {
                name: 'somePdaAccount',
                pda: {
                    seeds: [
                        { account: 'Mint', kind: 'account', path: 'mint.key' },
                        { kind: 'account', path: 'mint_key' },
                    ],
                },
                signer: false,
                writable: false,
            },
        ],
        [],
        undefined,
        [{ name: 'Mint', type: { fields: [{ name: 'key', type: 'pubkey' }], kind: 'struct' } }],
    );

    const defaultValue = nodes[0].defaultValue;
    const seeds = isNode(defaultValue, 'pdaValueNode') ? defaultValue.seeds : [];
    const seedNames = seeds.map(seed => seed.name);

    expect(seeds.length).toBe(2);
    expect(new Set(seedNames).size).toBe(seedNames.length);
});

test('it lifts a PDA whose program seed reads an account-data field as a caller-supplied arg ref', () => {
    const nodes = instructionAccountNodesFromAnchorV01(
        [
            {
                name: 'my_pda',
                pda: {
                    program: { account: 'Config', kind: 'account', path: 'config.program_id' },
                    seeds: [{ kind: 'const', value: [0, 1, 2, 3] }],
                },
                signer: false,
                writable: false,
            },
        ],
        [],
        undefined,
        [{ name: 'Config', type: { fields: [{ name: 'program_id', type: 'pubkey' }], kind: 'struct' } }],
    );

    const dv = liftedPda(nodes[0]);
    expect(dv.pda.programId).toBeUndefined();
    expect(dv.programId).toEqual(argumentValueNode('programId'));
});

test('it disambiguates seeds that share a leaf name within one PDA', () => {
    const nodes = instructionAccountNodesFromAnchorV01(
        [
            {
                name: 'derived',
                pda: {
                    seeds: [
                        { account: 'Pool', kind: 'account', path: 'pool.mint' },
                        { account: 'Other', kind: 'account', path: 'other.mint' },
                    ],
                },
                signer: false,
                writable: false,
            },
        ],
        [],
        undefined,
        [
            { name: 'Pool', type: { fields: [{ name: 'mint', type: 'pubkey' }], kind: 'struct' } },
            { name: 'Other', type: { fields: [{ name: 'mint', type: 'pubkey' }], kind: 'struct' } },
        ],
    );

    const defaultValue = nodes[0].defaultValue;
    const pda =
        isNode(defaultValue, 'pdaValueNode') && isNode(defaultValue.pda, 'pdaNode') ? defaultValue.pda : undefined;
    const seedNames = (pda?.seeds ?? []).filter(s => isNode(s, 'variablePdaSeedNode')).map(s => s.name);
    expect(seedNames).toEqual(['poolMint', 'otherMint']);
});

test('one-segment qualification leaves a residual collision when the parent segment also matches', () => {
    const nodes = instructionAccountNodesFromAnchorV01(
        [
            {
                name: 'derived',
                pda: {
                    seeds: [
                        { account: 'AccountA', kind: 'account', path: 'a.b.mint' },
                        { account: 'AccountC', kind: 'account', path: 'c.b.mint' },
                    ],
                },
                signer: false,
                writable: false,
            },
        ],
        [],
        undefined,
        [
            {
                name: 'AccountA',
                type: { fields: [{ name: 'b', type: { defined: { name: 'Inner' } } }], kind: 'struct' },
            },
            {
                name: 'AccountC',
                type: { fields: [{ name: 'b', type: { defined: { name: 'Inner' } } }], kind: 'struct' },
            },
            { name: 'Inner', type: { fields: [{ name: 'mint', type: 'pubkey' }], kind: 'struct' } },
        ],
    );

    const defaultValue = nodes[0].defaultValue;
    const pda =
        isNode(defaultValue, 'pdaValueNode') && isNode(defaultValue.pda, 'pdaNode') ? defaultValue.pda : undefined;
    const seedNames = (pda?.seeds ?? []).filter(s => isNode(s, 'variablePdaSeedNode')).map(s => s.name);
    expect(new Set(seedNames).size).toBe(seedNames.length);
});

// Foreign-program PDA lift covers every program-ref shape: a const program bakes into
// pdaNode.programId (static); an account/arg ref rides pdaValueNode.programId (resolved at runtime).
const ARBITRARY_PROGRAM_A = 'Fp9BaR1uHdjbX9P5bP5n7m7vV6L9D2u5W3o6mZRz8YxA';
const ARBITRARY_PROGRAM_B = 'Q9TmL3xZ7nC4kRpW8sV5jH2gK6dF1bN8yM4xP3aE7uVw';

test('it bakes an arbitrary const program address into pdaNode.programId', () => {
    const programBytes = Array.from(getBase58Codec().encode(ARBITRARY_PROGRAM_A));
    const [derived] = instructionAccountNodesFromAnchorV01(
        [
            {
                name: 'derived',
                pda: { program: { kind: 'const', value: programBytes }, seeds: [{ kind: 'const', value: [1, 2, 3] }] },
                signer: false,
                writable: false,
            },
        ],
        [],
    );
    const dv = liftedPda(derived);
    expect(dv.pda.programId).toBe(ARBITRARY_PROGRAM_A);
    expect(dv.programId).toBeUndefined();
});

test('it carries an account-ref program as a symbolic ref, not the fixed address', () => {
    const nodes = instructionAccountNodesFromAnchorV01(
        [
            { address: ARBITRARY_PROGRAM_B, name: 'someProgram' },
            {
                name: 'derived',
                pda: {
                    program: { kind: 'account', path: 'someProgram' },
                    seeds: [{ kind: 'const', value: [1, 2, 3] }],
                },
                signer: false,
                writable: false,
            },
        ],
        [],
    );
    // The account carries an `address`, but codama keeps the symbolic ref so the resolver looks it
    // up at call time -- fixed addresses must not be statically baked in.
    const dv = liftedPda(nodes.find(n => n.name === 'derived'));
    expect(dv.pda.programId).toBeUndefined();
    expect(dv.programId).toEqual(accountValueNode('someProgram'));
});

test('instructionAccountNodeFromAnchorV01 (singular API) lifts a foreign-program PDA via the same path', () => {
    const node = instructionAccountNodeFromAnchorV01(
        {
            name: 'ataPda',
            pda: {
                program: { kind: 'account', path: 'associatedTokenProgram' },
                seeds: [{ kind: 'const', value: [1, 2, 3] }],
            },
            signer: false,
            writable: false,
        },
        [],
    );
    const dv = liftedPda(node);
    expect(dv.pda.programId).toBeUndefined();
    expect(dv.programId).toEqual(accountValueNode('associatedTokenProgram'));
});

test('it carries an arg-ref program (flat name) on pdaValueNode.programId', () => {
    const nodes = instructionAccountNodesFromAnchorV01(
        [
            {
                name: 'derived',
                pda: { program: { kind: 'arg', path: 'someArg' }, seeds: [{ kind: 'const', value: [1, 2, 3] }] },
                signer: false,
                writable: false,
            },
        ],
        [instructionArgumentNode({ name: 'someArg', type: publicKeyTypeNode() })],
    );
    const dv = liftedPda(nodes[0]);
    expect(dv.pda.programId).toBeUndefined();
    expect(dv.programId).toEqual(argumentValueNode('someArg'));
});

test('it drops the defaultValue for a dotted account-ref program with no type info', () => {
    const nodes = instructionAccountNodesFromAnchorV01(
        [
            { name: 'pool', signer: false, writable: false },
            {
                name: 'derived',
                pda: {
                    program: { kind: 'account', path: 'pool.programId' },
                    seeds: [{ kind: 'const', value: [1, 2, 3] }],
                },
                signer: false,
                writable: false,
            },
        ],
        [],
    );
    expect(nodes.find(n => n.name === 'derived')?.defaultValue).toBeUndefined();
});

test('a local PDA (no seeds::program) keeps its defaultValue', () => {
    const [local] = instructionAccountNodesFromAnchorV01(
        [{ name: 'local', pda: { seeds: [{ kind: 'const', value: [1, 2, 3] }] }, signer: false, writable: false }],
        [],
    );
    expect(isNode(local.defaultValue, 'pdaValueNode')).toBe(true);
});
