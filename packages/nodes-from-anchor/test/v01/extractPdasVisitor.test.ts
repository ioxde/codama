import {
    accountValueNode,
    argumentValueNode,
    constantPdaSeedNodeFromBytes,
    instructionAccountNode,
    instructionArgumentNode,
    instructionNode,
    numberTypeNode,
    pdaLinkNode,
    pdaNode,
    pdaSeedValueNode,
    pdaValueNode,
    programNode,
    publicKeyTypeNode,
    variablePdaSeedNode,
} from '@codama/nodes';
import { expect, test, vi } from 'vitest';

import { extractPdasFromProgram } from '../../src/extractPdasVisitor';

function makeProgram(instructions: ReturnType<typeof instructionNode>[]) {
    return programNode({
        instructions,
        name: 'testProgram',
        publicKey: '1111',
    });
}

test('it extracts a single PDA to program level', () => {
    const program = makeProgram([
        instructionNode({
            accounts: [
                instructionAccountNode({
                    defaultValue: pdaValueNode(
                        pdaNode({
                            name: 'myPda',
                            seeds: [constantPdaSeedNodeFromBytes('base58', 'F9bS')],
                        }),
                        [],
                    ),
                    isSigner: false,
                    isWritable: false,
                    name: 'myPda',
                }),
            ],
            name: 'myInstruction',
        }),
    ]);

    const result = extractPdasFromProgram(program);

    expect(result.pdas).toEqual([
        pdaNode({
            name: 'myPda',
            seeds: [constantPdaSeedNodeFromBytes('base58', 'F9bS')],
        }),
    ]);
    expect(result.instructions[0].accounts[0].defaultValue).toEqual(pdaValueNode(pdaLinkNode('myPda'), []));
});

test('it deduplicates the same PDA across two instructions', () => {
    const seeds = [constantPdaSeedNodeFromBytes('base58', 'F9bS'), variablePdaSeedNode('owner', publicKeyTypeNode())];
    const program = makeProgram([
        instructionNode({
            accounts: [
                instructionAccountNode({
                    defaultValue: pdaValueNode(pdaNode({ name: 'myPda', seeds }), [
                        pdaSeedValueNode('owner', accountValueNode('owner')),
                    ]),
                    isSigner: false,
                    isWritable: false,
                    name: 'myPda',
                }),
                instructionAccountNode({ isSigner: false, isWritable: false, name: 'owner' }),
            ],
            name: 'instructionA',
        }),
        instructionNode({
            accounts: [
                instructionAccountNode({
                    defaultValue: pdaValueNode(pdaNode({ name: 'myPda', seeds }), [
                        pdaSeedValueNode('owner', accountValueNode('owner')),
                    ]),
                    isSigner: false,
                    isWritable: false,
                    name: 'myPda',
                }),
                instructionAccountNode({ isSigner: false, isWritable: false, name: 'owner' }),
            ],
            name: 'instructionB',
        }),
    ]);

    const result = extractPdasFromProgram(program);

    // Only one PDA extracted.
    expect(result.pdas).toHaveLength(1);
    expect(result.pdas[0].name).toBe('myPda');

    // Both instructions use pdaLinkNode.
    for (const ix of result.instructions) {
        const account = ix.accounts[0];
        expect(account.defaultValue).toEqual(
            pdaValueNode(pdaLinkNode('myPda'), [pdaSeedValueNode('owner', accountValueNode('owner'))]),
        );
    }
});

test('it handles name collisions with different seeds by suffixing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const program = makeProgram([
        instructionNode({
            accounts: [
                instructionAccountNode({
                    defaultValue: pdaValueNode(
                        pdaNode({
                            name: 'authority',
                            seeds: [constantPdaSeedNodeFromBytes('base58', 'F9bS')],
                        }),
                        [],
                    ),
                    isSigner: false,
                    isWritable: false,
                    name: 'authority',
                }),
            ],
            name: 'instructionA',
        }),
        instructionNode({
            accounts: [
                instructionAccountNode({
                    defaultValue: pdaValueNode(
                        pdaNode({
                            name: 'authority',
                            seeds: [constantPdaSeedNodeFromBytes('base58', 'AAAA')],
                        }),
                        [],
                    ),
                    isSigner: false,
                    isWritable: false,
                    name: 'authority',
                }),
            ],
            name: 'instructionB',
        }),
    ]);

    const result = extractPdasFromProgram(program);

    expect(result.pdas).toHaveLength(2);
    expect(result.pdas[0].name).toBe('authority');
    expect(result.pdas[1].name).toBe('instructionBAuthority');
    expect(warnSpy).toHaveBeenCalledOnce();

    warnSpy.mockRestore();
});

test('it excludes foreign-program PDAs', () => {
    const program = makeProgram([
        instructionNode({
            accounts: [
                instructionAccountNode({
                    defaultValue: pdaValueNode(
                        pdaNode({
                            name: 'ata',
                            programId: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
                            seeds: [constantPdaSeedNodeFromBytes('base58', 'F9bS')],
                        }),
                        [],
                    ),
                    isSigner: false,
                    isWritable: false,
                    name: 'ata',
                }),
            ],
            name: 'myInstruction',
        }),
    ]);

    const result = extractPdasFromProgram(program);

    expect(result.pdas).toEqual([]);
    // Account is unchanged (still inline pdaNode).
    expect(result.instructions[0].accounts[0].defaultValue).toEqual(
        pdaValueNode(
            pdaNode({
                name: 'ata',
                programId: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
                seeds: [constantPdaSeedNodeFromBytes('base58', 'F9bS')],
            }),
            [],
        ),
    );
    // Nothing changed on the node at all.
    expect(result).toEqual(program);
});

test('it keeps dynamic programId on pdaValueNode, not on PdaNode', () => {
    const program = makeProgram([
        instructionNode({
            accounts: [
                instructionAccountNode({
                    defaultValue: pdaValueNode(
                        pdaNode({
                            name: 'dynamicPda',
                            seeds: [variablePdaSeedNode('owner', publicKeyTypeNode())],
                        }),
                        [pdaSeedValueNode('owner', accountValueNode('owner'))],
                        accountValueNode('tokenProgram'),
                    ),
                    isSigner: false,
                    isWritable: false,
                    name: 'dynamicPda',
                }),
                instructionAccountNode({ isSigner: false, isWritable: false, name: 'owner' }),
                instructionAccountNode({ isSigner: false, isWritable: false, name: 'tokenProgram' }),
            ],
            name: 'myInstruction',
        }),
    ]);

    const result = extractPdasFromProgram(program);

    // PdaNode has no programId.
    expect(result.pdas[0].programId).toBeUndefined();

    // pdaValueNode still has the dynamic programId.
    const defaultValue = result.instructions[0].accounts[0].defaultValue;
    expect(defaultValue).toEqual(
        pdaValueNode(
            pdaLinkNode('dynamicPda'),
            [pdaSeedValueNode('owner', accountValueNode('owner'))],
            accountValueNode('tokenProgram'),
        ),
    );
});

test('it deduplicates same seeds with different account names using first name', () => {
    const seeds = [constantPdaSeedNodeFromBytes('base58', 'F9bS'), variablePdaSeedNode('owner', publicKeyTypeNode())];
    const program = makeProgram([
        instructionNode({
            accounts: [
                instructionAccountNode({
                    defaultValue: pdaValueNode(pdaNode({ name: 'authority', seeds }), [
                        pdaSeedValueNode('owner', accountValueNode('owner')),
                    ]),
                    isSigner: false,
                    isWritable: false,
                    name: 'authority',
                }),
                instructionAccountNode({ isSigner: false, isWritable: false, name: 'owner' }),
            ],
            name: 'instructionA',
        }),
        instructionNode({
            accounts: [
                instructionAccountNode({
                    defaultValue: pdaValueNode(pdaNode({ name: 'admin', seeds }), [
                        pdaSeedValueNode('owner', accountValueNode('owner')),
                    ]),
                    isSigner: false,
                    isWritable: false,
                    name: 'admin',
                }),
                instructionAccountNode({ isSigner: false, isWritable: false, name: 'owner' }),
            ],
            name: 'instructionB',
        }),
    ]);

    const result = extractPdasFromProgram(program);

    expect(result.pdas).toHaveLength(1);
    expect(result.pdas[0].name).toBe('authority');

    // Both instructions link to the first-encountered name.
    expect(result.instructions[0].accounts[0].defaultValue).toEqual(
        pdaValueNode(pdaLinkNode('authority'), [pdaSeedValueNode('owner', accountValueNode('owner'))]),
    );
    expect(result.instructions[1].accounts[0].defaultValue).toEqual(
        pdaValueNode(pdaLinkNode('authority'), [pdaSeedValueNode('owner', accountValueNode('owner'))]),
    );
});

test('it preserves existing program-level PDAs', () => {
    const existingPda = pdaNode({
        name: 'existingPda',
        seeds: [constantPdaSeedNodeFromBytes('base58', 'ZZZZ')],
    });
    const program = programNode({
        instructions: [
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: pdaValueNode(
                            pdaNode({ name: 'newPda', seeds: [constantPdaSeedNodeFromBytes('base58', 'F9bS')] }),
                            [],
                        ),
                        isSigner: false,
                        isWritable: false,
                        name: 'newPda',
                    }),
                ],
                name: 'myInstruction',
            }),
        ],
        name: 'testProgram',
        pdas: [existingPda],
        publicKey: '1111',
    });

    const result = extractPdasFromProgram(program);

    expect(result.pdas).toHaveLength(2);
    expect(result.pdas[0]).toEqual(existingPda);
    expect(result.pdas[1].name).toBe('newPda');
});

test('it returns empty pdas when no PDA accounts exist', () => {
    const program = makeProgram([
        instructionNode({
            accounts: [
                instructionAccountNode({ isSigner: false, isWritable: false, name: 'owner' }),
                instructionAccountNode({ isSigner: false, isWritable: false, name: 'payer' }),
            ],
            name: 'myInstruction',
        }),
    ]);

    const result = extractPdasFromProgram(program);
    expect(result.pdas).toEqual([]);
    // Nothing changed on the node at all.
    expect(result).toEqual(program);
});

test('it deduplicates byte-equivalent PDAs with different variable seed names', () => {
    const program = makeProgram([
        instructionNode({
            accounts: [
                instructionAccountNode({
                    defaultValue: pdaValueNode(
                        pdaNode({
                            name: 'thing',
                            seeds: [
                                constantPdaSeedNodeFromBytes('base58', 'F9bS'),
                                variablePdaSeedNode('baseMint', publicKeyTypeNode()),
                                variablePdaSeedNode('quoteMint', publicKeyTypeNode()),
                            ],
                        }),
                        [
                            pdaSeedValueNode('baseMint', accountValueNode('baseMint')),
                            pdaSeedValueNode('quoteMint', accountValueNode('quoteMint')),
                        ],
                    ),
                    isSigner: false,
                    isWritable: false,
                    name: 'thing',
                }),
                instructionAccountNode({ isSigner: false, isWritable: false, name: 'baseMint' }),
                instructionAccountNode({ isSigner: false, isWritable: false, name: 'quoteMint' }),
            ],
            name: 'initThing',
        }),
        instructionNode({
            accounts: [
                instructionAccountNode({
                    defaultValue: pdaValueNode(
                        pdaNode({
                            name: 'thing',
                            seeds: [
                                constantPdaSeedNodeFromBytes('base58', 'F9bS'),
                                variablePdaSeedNode('tokenMint', publicKeyTypeNode()),
                                variablePdaSeedNode('rewardMint', publicKeyTypeNode()),
                            ],
                        }),
                        [
                            pdaSeedValueNode('tokenMint', accountValueNode('tokenMint')),
                            pdaSeedValueNode('rewardMint', argumentValueNode('rewardMint')),
                        ],
                    ),
                    isSigner: false,
                    isWritable: false,
                    name: 'thing',
                }),
                instructionAccountNode({ isSigner: false, isWritable: false, name: 'tokenMint' }),
            ],
            arguments: [instructionArgumentNode({ name: 'rewardMint', type: publicKeyTypeNode() })],
            name: 'useThing',
        }),
    ]);

    const result = extractPdasFromProgram(program);

    // One canonical PDA, first-encountered seed names win.
    expect(result.pdas).toHaveLength(1);
    expect(result.pdas[0].name).toBe('thing');
    expect(result.pdas[0].seeds[1]).toEqual(variablePdaSeedNode('baseMint', publicKeyTypeNode()));
    expect(result.pdas[0].seeds[2]).toEqual(variablePdaSeedNode('quoteMint', publicKeyTypeNode()));

    // initThing's bindings already match the canonical PDA — no rewrite.
    expect(result.instructions[0].accounts[0].defaultValue).toEqual(
        pdaValueNode(pdaLinkNode('thing'), [
            pdaSeedValueNode('baseMint', accountValueNode('baseMint')),
            pdaSeedValueNode('quoteMint', accountValueNode('quoteMint')),
        ]),
    );

    // useThing's seed labels are rewritten to match the canonical PDA.
    expect(result.instructions[1].accounts[0].defaultValue).toEqual(
        pdaValueNode(pdaLinkNode('thing'), [
            pdaSeedValueNode('baseMint', accountValueNode('tokenMint')),
            pdaSeedValueNode('quoteMint', argumentValueNode('rewardMint')),
        ]),
    );
});

test('it deduplicates PDAs with interleaved constant and variable seeds', () => {
    const program = makeProgram([
        instructionNode({
            accounts: [
                instructionAccountNode({
                    defaultValue: pdaValueNode(
                        pdaNode({
                            name: 'pool',
                            seeds: [
                                constantPdaSeedNodeFromBytes('base58', 'F9bS'),
                                variablePdaSeedNode('mintA', publicKeyTypeNode()),
                                constantPdaSeedNodeFromBytes('base58', 'AAAA'),
                                variablePdaSeedNode('mintB', publicKeyTypeNode()),
                            ],
                        }),
                        [
                            pdaSeedValueNode('mintA', accountValueNode('mintA')),
                            pdaSeedValueNode('mintB', accountValueNode('mintB')),
                        ],
                    ),
                    isSigner: false,
                    isWritable: false,
                    name: 'pool',
                }),
                instructionAccountNode({ isSigner: false, isWritable: false, name: 'mintA' }),
                instructionAccountNode({ isSigner: false, isWritable: false, name: 'mintB' }),
            ],
            name: 'createPool',
        }),
        instructionNode({
            accounts: [
                instructionAccountNode({
                    defaultValue: pdaValueNode(
                        pdaNode({
                            name: 'pool',
                            seeds: [
                                constantPdaSeedNodeFromBytes('base58', 'F9bS'),
                                variablePdaSeedNode('tokenX', publicKeyTypeNode()),
                                constantPdaSeedNodeFromBytes('base58', 'AAAA'),
                                variablePdaSeedNode('tokenY', publicKeyTypeNode()),
                            ],
                        }),
                        [
                            pdaSeedValueNode('tokenX', accountValueNode('tokenX')),
                            pdaSeedValueNode('tokenY', accountValueNode('tokenY')),
                        ],
                    ),
                    isSigner: false,
                    isWritable: false,
                    name: 'pool',
                }),
                instructionAccountNode({ isSigner: false, isWritable: false, name: 'tokenX' }),
                instructionAccountNode({ isSigner: false, isWritable: false, name: 'tokenY' }),
            ],
            name: 'swapPool',
        }),
    ]);

    const result = extractPdasFromProgram(program);

    expect(result.pdas).toHaveLength(1);
    expect(result.pdas[0].name).toBe('pool');
    expect(result.pdas[0].seeds[1]).toEqual(variablePdaSeedNode('mintA', publicKeyTypeNode()));
    expect(result.pdas[0].seeds[3]).toEqual(variablePdaSeedNode('mintB', publicKeyTypeNode()));

    // swapPool's seed labels are rewritten to match the canonical PDA.
    expect(result.instructions[1].accounts[0].defaultValue).toEqual(
        pdaValueNode(pdaLinkNode('pool'), [
            pdaSeedValueNode('mintA', accountValueNode('tokenX')),
            pdaSeedValueNode('mintB', accountValueNode('tokenY')),
        ]),
    );
});

test('it still distinguishes PDAs that differ in seed type even if names match', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const program = makeProgram([
        instructionNode({
            accounts: [
                instructionAccountNode({
                    defaultValue: pdaValueNode(
                        pdaNode({
                            name: 'thing',
                            seeds: [
                                constantPdaSeedNodeFromBytes('base58', 'F9bS'),
                                variablePdaSeedNode('owner', publicKeyTypeNode()),
                            ],
                        }),
                        [pdaSeedValueNode('owner', accountValueNode('owner'))],
                    ),
                    isSigner: false,
                    isWritable: false,
                    name: 'thing',
                }),
                instructionAccountNode({ isSigner: false, isWritable: false, name: 'owner' }),
            ],
            name: 'instructionA',
        }),
        instructionNode({
            accounts: [
                instructionAccountNode({
                    defaultValue: pdaValueNode(
                        pdaNode({
                            name: 'thing',
                            seeds: [
                                constantPdaSeedNodeFromBytes('base58', 'F9bS'),
                                variablePdaSeedNode('owner', numberTypeNode('u64')),
                            ],
                        }),
                        [pdaSeedValueNode('owner', argumentValueNode('owner'))],
                    ),
                    isSigner: false,
                    isWritable: false,
                    name: 'thing',
                }),
            ],
            arguments: [instructionArgumentNode({ name: 'owner', type: numberTypeNode('u64') })],
            name: 'instructionB',
        }),
    ]);

    const result = extractPdasFromProgram(program);

    expect(result.pdas).toHaveLength(2);
    expect(result.pdas[0].name).toBe('thing');
    expect(result.pdas[1].name).toBe('instructionBThing');
    expect(warnSpy).toHaveBeenCalledOnce();

    warnSpy.mockRestore();
});
