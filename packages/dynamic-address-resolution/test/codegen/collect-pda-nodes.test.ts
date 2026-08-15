import {
    accountValueNode,
    constantPdaSeedNodeFromString,
    instructionAccountNode,
    instructionNode,
    pdaLinkNode,
    pdaNode,
    pdaValueNode,
    programNode,
    publicKeyTypeNode,
    rootNode,
    variablePdaSeedNode,
} from 'codama';
import { describe, expect, test } from 'vitest';

import { collectPdaNodeDetailsFromIdl, collectPdaNodesFromIdl } from '../../src/codegen/collect-pda-nodes';
import { makeRoot } from '../test-utils';

describe('collectPdaNodesFromIdl', () => {
    test('should collect inline PDA from instruction account default', () => {
        const inline = pdaNode({
            name: 'inline',
            seeds: [variablePdaSeedNode('mint', publicKeyTypeNode())],
        });
        const root = makeRoot([
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: pdaValueNode(inline),
                        isSigner: false,
                        isWritable: false,
                        name: 'acc',
                    }),
                ],
                name: 'test',
            }),
        ]);

        const map = collectPdaNodesFromIdl(root);
        expect(map.size).toBe(1);
        expect(map.get('inline')).toBe(inline);
    });

    test('should prefer program.pdas over inline duplicate of the same name', () => {
        const topLevel = pdaNode({
            name: 'shared',
            seeds: [constantPdaSeedNodeFromString('utf8', 'top')],
        });
        const inline = pdaNode({
            name: 'shared',
            seeds: [constantPdaSeedNodeFromString('utf8', 'inline')],
        });

        const root = rootNode(
            programNode({
                instructions: [
                    instructionNode({
                        accounts: [
                            instructionAccountNode({
                                defaultValue: pdaValueNode(inline),
                                isSigner: false,
                                isWritable: false,
                                name: 'acc',
                            }),
                        ],
                        name: 'test',
                    }),
                ],
                name: 'program',
                pdas: [topLevel],
                publicKey: '11111111111111111111111111111111',
            }),
        );

        const map = collectPdaNodesFromIdl(root);
        expect(map.size).toBe(1);
        expect(map.get('shared')).toBe(topLevel);
    });

    test('should prefer the duplicate definition with the most variable seeds', () => {
        const narrow = pdaNode({
            name: 'shared',
            seeds: [constantPdaSeedNodeFromString('utf8', 'shared'), variablePdaSeedNode('mint', publicKeyTypeNode())],
        });
        const wide = pdaNode({
            name: 'shared',
            seeds: [
                variablePdaSeedNode('mint', publicKeyTypeNode()),
                variablePdaSeedNode('owner', publicKeyTypeNode()),
            ],
        });
        const root = makeRoot([
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: pdaValueNode(narrow),
                        isSigner: false,
                        isWritable: false,
                        name: 'narrowAcc',
                    }),
                ],
                name: 'narrowIx',
            }),
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: pdaValueNode(wide),
                        isSigner: false,
                        isWritable: false,
                        name: 'wideAcc',
                    }),
                ],
                name: 'wideIx',
            }),
        ]);

        const map = collectPdaNodesFromIdl(root);
        expect(map.size).toBe(1);
        expect(map.get('shared')).toBe(wide);
    });

    // ioxde fork: the wide-first order too — the narrow-first case alone lets a last-wins implementation pass.
    test('should prefer the definition with the most variable seeds when the wide one comes first', () => {
        const wide = pdaNode({
            name: 'shared',
            seeds: [
                variablePdaSeedNode('mint', publicKeyTypeNode()),
                variablePdaSeedNode('owner', publicKeyTypeNode()),
            ],
        });
        const narrow = pdaNode({
            name: 'shared',
            seeds: [constantPdaSeedNodeFromString('utf8', 'shared'), variablePdaSeedNode('mint', publicKeyTypeNode())],
        });
        const root = makeRoot([
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: pdaValueNode(wide),
                        isSigner: false,
                        isWritable: false,
                        name: 'wideAcc',
                    }),
                ],
                name: 'wideIx',
            }),
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: pdaValueNode(narrow),
                        isSigner: false,
                        isWritable: false,
                        name: 'narrowAcc',
                    }),
                ],
                name: 'narrowIx',
            }),
        ]);

        const map = collectPdaNodesFromIdl(root);
        expect(map.size).toBe(1);
        expect(map.get('shared')).toBe(wide);
    });
});

describe('collectPdaNodeDetailsFromIdl', () => {
    // ioxde fork: `requiresProgramAddress` drives the generated `config: { programAddress }` param.
    test('should require a program address for an inline PDA referenced with a runtime program ID', () => {
        const inline = pdaNode({
            name: 'inline',
            seeds: [variablePdaSeedNode('mint', publicKeyTypeNode())],
        });
        const root = makeRoot([
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: pdaValueNode(inline, [], accountValueNode('programRef')),
                        isSigner: false,
                        isWritable: false,
                        name: 'acc',
                    }),
                    instructionAccountNode({ isSigner: false, isWritable: false, name: 'programRef' }),
                ],
                name: 'test',
            }),
        ]);

        expect(collectPdaNodeDetailsFromIdl(root).get('inline')?.requiresProgramAddress).toBe(true);
    });

    test('should require a program address for a linked PDA referenced with a runtime program ID', () => {
        const linked = pdaNode({
            name: 'linked',
            seeds: [variablePdaSeedNode('mint', publicKeyTypeNode())],
        });
        const root = rootNode(
            programNode({
                instructions: [
                    instructionNode({
                        accounts: [
                            instructionAccountNode({
                                defaultValue: pdaValueNode(pdaLinkNode('linked'), [], accountValueNode('programRef')),
                                isSigner: false,
                                isWritable: false,
                                name: 'acc',
                            }),
                            instructionAccountNode({ isSigner: false, isWritable: false, name: 'programRef' }),
                        ],
                        name: 'test',
                    }),
                ],
                name: 'program',
                pdas: [linked],
                publicKey: '11111111111111111111111111111111',
            }),
        );

        expect(collectPdaNodeDetailsFromIdl(root).get('linked')?.requiresProgramAddress).toBe(true);
    });

    test('should not require a program address when the PDA pins its own program ID', () => {
        const pinned = pdaNode({
            name: 'pinned',
            programId: '11111111111111111111111111111111',
            seeds: [variablePdaSeedNode('mint', publicKeyTypeNode())],
        });
        const root = makeRoot([
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: pdaValueNode(pinned, [], accountValueNode('programRef')),
                        isSigner: false,
                        isWritable: false,
                        name: 'acc',
                    }),
                    instructionAccountNode({ isSigner: false, isWritable: false, name: 'programRef' }),
                ],
                name: 'test',
            }),
        ]);

        expect(collectPdaNodeDetailsFromIdl(root).get('pinned')?.requiresProgramAddress).toBe(false);
    });

    test('should not require a program address when no reference supplies a runtime program ID', () => {
        const inline = pdaNode({
            name: 'inline',
            seeds: [variablePdaSeedNode('mint', publicKeyTypeNode())],
        });
        const root = makeRoot([
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: pdaValueNode(inline),
                        isSigner: false,
                        isWritable: false,
                        name: 'acc',
                    }),
                ],
                name: 'test',
            }),
        ]);

        expect(collectPdaNodeDetailsFromIdl(root).get('inline')?.requiresProgramAddress).toBe(false);
    });

    // ioxde fork: computing `requiresProgramAddress` during the merge instead of after it inverts these cases.
    test('should clear the flag when a pinned variant wins the merge', () => {
        const unpinned = pdaNode({
            name: 'vault',
            seeds: [variablePdaSeedNode('mint', publicKeyTypeNode())],
        });
        const pinnedWider = pdaNode({
            name: 'vault',
            programId: '11111111111111111111111111111111',
            seeds: [
                variablePdaSeedNode('mint', publicKeyTypeNode()),
                variablePdaSeedNode('owner', publicKeyTypeNode()),
            ],
        });
        const root = makeRoot([
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: pdaValueNode(unpinned, [], accountValueNode('programRef')),
                        isSigner: false,
                        isWritable: false,
                        name: 'acc',
                    }),
                    instructionAccountNode({ isSigner: false, isWritable: false, name: 'programRef' }),
                ],
                name: 'runtimeIx',
            }),
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: pdaValueNode(pinnedWider),
                        isSigner: false,
                        isWritable: false,
                        name: 'acc',
                    }),
                ],
                name: 'pinnedIx',
            }),
        ]);

        const entry = collectPdaNodeDetailsFromIdl(root).get('vault');
        expect(entry?.pdaNode).toBe(pinnedWider);
        expect(entry?.requiresProgramAddress).toBe(false);
    });

    test('should keep the flag when an unpinned variant wins the merge over a pinned use-site', () => {
        const pinned = pdaNode({
            name: 'vault',
            programId: '11111111111111111111111111111111',
            seeds: [variablePdaSeedNode('mint', publicKeyTypeNode())],
        });
        const unpinnedWider = pdaNode({
            name: 'vault',
            seeds: [
                variablePdaSeedNode('mint', publicKeyTypeNode()),
                variablePdaSeedNode('owner', publicKeyTypeNode()),
            ],
        });
        const root = makeRoot([
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: pdaValueNode(pinned, [], accountValueNode('programRef')),
                        isSigner: false,
                        isWritable: false,
                        name: 'acc',
                    }),
                    instructionAccountNode({ isSigner: false, isWritable: false, name: 'programRef' }),
                ],
                name: 'runtimeIx',
            }),
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: pdaValueNode(unpinnedWider),
                        isSigner: false,
                        isWritable: false,
                        name: 'acc',
                    }),
                ],
                name: 'widerIx',
            }),
        ]);

        const entry = collectPdaNodeDetailsFromIdl(root).get('vault');
        expect(entry?.pdaNode).toBe(unpinnedWider);
        expect(entry?.requiresProgramAddress).toBe(true);
    });

    // ioxde fork: the opposite instruction order — one order alone lets a per-use-site implementation pass.
    test('should keep the flag clear when the unpinned variant loses the merge, whichever order it appears in', () => {
        const pinnedWider = pdaNode({
            name: 'vault',
            programId: '11111111111111111111111111111111',
            seeds: [
                variablePdaSeedNode('mint', publicKeyTypeNode()),
                variablePdaSeedNode('owner', publicKeyTypeNode()),
            ],
        });
        const unpinned = pdaNode({
            name: 'vault',
            seeds: [variablePdaSeedNode('mint', publicKeyTypeNode())],
        });
        const root = makeRoot([
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: pdaValueNode(pinnedWider),
                        isSigner: false,
                        isWritable: false,
                        name: 'acc',
                    }),
                ],
                name: 'pinnedIx',
            }),
            instructionNode({
                accounts: [
                    instructionAccountNode({
                        defaultValue: pdaValueNode(unpinned, [], accountValueNode('programRef')),
                        isSigner: false,
                        isWritable: false,
                        name: 'acc',
                    }),
                    instructionAccountNode({ isSigner: false, isWritable: false, name: 'programRef' }),
                ],
                name: 'runtimeIx',
            }),
        ]);

        const entry = collectPdaNodeDetailsFromIdl(root).get('vault');
        expect(entry?.pdaNode).toBe(pinnedWider);
        expect(entry?.requiresProgramAddress).toBe(false);
    });
});
