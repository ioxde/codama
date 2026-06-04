import {
    accountValueNode,
    constantPdaSeedNode,
    type InstructionAccountNode,
    instructionAccountNode,
    instructionNode,
    pdaNode,
    pdaSeedValueNode,
    pdaValueNode,
    programNode,
    publicKeyTypeNode,
    publicKeyValueNode,
    rootNode,
    variablePdaSeedNode,
} from 'codama';
import { expect, test } from 'vitest';

import { type CollectedPdaNode, collectPdaNodes } from '../../../src/program-client/collect-pdas';

const AMM_PROGRAM = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

const rootWith = (...accountsPerIx: InstructionAccountNode[][]) =>
    rootNode(
        programNode({
            instructions: accountsPerIx.map((accounts, i) => instructionNode({ accounts, name: `ix${i}` })),
            name: 'test',
            publicKey: 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj',
            version: '1.0.0',
        }),
    );

test('an inline pinned pdaNode with a runtime program ref does not require a programAddress', () => {
    const account = instructionAccountNode({
        defaultValue: pdaValueNode(
            pdaNode({
                name: 'ammAuthority',
                programId: AMM_PROGRAM,
                seeds: [constantPdaSeedNode(publicKeyTypeNode(), publicKeyValueNode(TOKEN_PROGRAM))],
            }),
            [],
            accountValueNode('ammProgram'),
        ),
        isSigner: false,
        isWritable: false,
        name: 'ammAuthority',
    });

    const entry = collectPdaNodes(rootWith([account])).get('ammAuthority');
    expect(entry?.requiresProgramAddress).toBe(false);
});

test('an inline unpinned pdaNode with a runtime program ref requires a programAddress', () => {
    const account = instructionAccountNode({
        defaultValue: pdaValueNode(
            pdaNode({
                name: 'ammAuthority',
                seeds: [constantPdaSeedNode(publicKeyTypeNode(), publicKeyValueNode(TOKEN_PROGRAM))],
            }),
            [],
            accountValueNode('ammProgram'),
        ),
        isSigner: false,
        isWritable: false,
        name: 'ammAuthority',
    });

    const entry = collectPdaNodes(rootWith([account])).get('ammAuthority');
    expect(entry?.requiresProgramAddress).toBe(true);
});

// pump.fun's associated_bonding_curve: one instruction bakes a seed as a constant, another
// keeps it variable. The variable definition wins in either instruction order.
const generalVariant = () =>
    instructionAccountNode({
        defaultValue: pdaValueNode(
            pdaNode({
                name: 'vault',
                seeds: [
                    variablePdaSeedNode('owner', publicKeyTypeNode()),
                    variablePdaSeedNode('tokenProgram', publicKeyTypeNode()),
                ],
            }),
            [
                pdaSeedValueNode('owner', accountValueNode('owner')),
                pdaSeedValueNode('tokenProgram', accountValueNode('tokenProgram')),
            ],
        ),
        isSigner: false,
        isWritable: false,
        name: 'vault',
    });

const specializedVariant = () =>
    instructionAccountNode({
        defaultValue: pdaValueNode(
            pdaNode({
                name: 'vault',
                seeds: [
                    variablePdaSeedNode('owner', publicKeyTypeNode()),
                    constantPdaSeedNode(publicKeyTypeNode(), publicKeyValueNode(TOKEN_PROGRAM)),
                ],
            }),
            [pdaSeedValueNode('owner', accountValueNode('owner'))],
        ),
        isSigner: false,
        isWritable: false,
        name: 'vault',
    });

const variableSeedNames = (entry: CollectedPdaNode) =>
    entry.pdaNode.seeds.flatMap(s => (s.kind === 'variablePdaSeedNode' ? [s.name] : []));

test('it registers the most general definition when the general variant comes first', () => {
    const entry = collectPdaNodes(rootWith([generalVariant()], [specializedVariant()])).get('vault');
    expect(variableSeedNames(entry!)).toEqual(['owner', 'tokenProgram']);
});

test('it registers the most general definition when the specialized variant comes first', () => {
    const entry = collectPdaNodes(rootWith([specializedVariant()], [generalVariant()])).get('vault');
    expect(variableSeedNames(entry!)).toEqual(['owner', 'tokenProgram']);
});

// requiresProgramAddress is computed from the merged definition, not from individual use sites.
const unpinnedRuntimeVariant = () =>
    instructionAccountNode({
        defaultValue: pdaValueNode(
            pdaNode({ name: 'authority', seeds: [variablePdaSeedNode('owner', publicKeyTypeNode())] }),
            [pdaSeedValueNode('owner', accountValueNode('owner'))],
            accountValueNode('ammProgram'),
        ),
        isSigner: false,
        isWritable: false,
        name: 'authority',
    });

const pinnedGeneralVariant = () =>
    instructionAccountNode({
        defaultValue: pdaValueNode(
            pdaNode({
                name: 'authority',
                programId: AMM_PROGRAM,
                seeds: [
                    variablePdaSeedNode('owner', publicKeyTypeNode()),
                    variablePdaSeedNode('mint', publicKeyTypeNode()),
                ],
            }),
            [pdaSeedValueNode('owner', accountValueNode('owner')), pdaSeedValueNode('mint', accountValueNode('mint'))],
            accountValueNode('ammProgram'),
        ),
        isSigner: false,
        isWritable: false,
        name: 'authority',
    });

test('a pinned variant that wins the merge clears requiresProgramAddress', () => {
    const entry = collectPdaNodes(rootWith([unpinnedRuntimeVariant()], [pinnedGeneralVariant()])).get('authority');
    expect(entry?.pdaNode.programId).toBe(AMM_PROGRAM);
    expect(entry?.requiresProgramAddress).toBe(false);
});

test('an unpinned variant that loses the merge does not reinstate requiresProgramAddress', () => {
    const entry = collectPdaNodes(rootWith([pinnedGeneralVariant()], [unpinnedRuntimeVariant()])).get('authority');
    expect(entry?.pdaNode.programId).toBe(AMM_PROGRAM);
    expect(entry?.requiresProgramAddress).toBe(false);
});

test('a runtime ref on a pinned use-site still requires an address when an unpinned variant wins the merge', () => {
    const pinnedRuntimeSpecialized = instructionAccountNode({
        defaultValue: pdaValueNode(
            pdaNode({
                name: 'authority',
                programId: AMM_PROGRAM,
                seeds: [variablePdaSeedNode('owner', publicKeyTypeNode())],
            }),
            [pdaSeedValueNode('owner', accountValueNode('owner'))],
            accountValueNode('ammProgram'),
        ),
        isSigner: false,
        isWritable: false,
        name: 'authority',
    });
    const unpinnedGeneral = instructionAccountNode({
        defaultValue: pdaValueNode(
            pdaNode({
                name: 'authority',
                seeds: [
                    variablePdaSeedNode('owner', publicKeyTypeNode()),
                    variablePdaSeedNode('mint', publicKeyTypeNode()),
                ],
            }),
            [pdaSeedValueNode('owner', accountValueNode('owner')), pdaSeedValueNode('mint', accountValueNode('mint'))],
        ),
        isSigner: false,
        isWritable: false,
        name: 'authority',
    });

    const entry = collectPdaNodes(rootWith([pinnedRuntimeSpecialized], [unpinnedGeneral])).get('authority');
    expect(entry?.pdaNode.programId).toBeUndefined();
    expect(entry?.requiresProgramAddress).toBe(true);
});
