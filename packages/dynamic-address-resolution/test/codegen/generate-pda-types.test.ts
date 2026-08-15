import {
    accountValueNode,
    constantPdaSeedNodeFromString,
    instructionAccountNode,
    instructionNode,
    pdaNode,
    pdaValueNode,
    programNode,
    publicKeyTypeNode,
    rootNode,
    stringTypeNode,
    variablePdaSeedNode,
} from 'codama';
import { describe, expect, test } from 'vitest';

import { generatePdaTypes } from '../../src/codegen/generate-pda-types';

describe('generatePdaTypes', () => {
    test('should return null mapTypeName when there are no PDAs', () => {
        const root = rootNode(
            programNode({
                instructions: [],
                name: 'noPdaProgram',
                publicKey: '11111111111111111111111111111111',
            }),
        );
        const { mapTypeName, typeBlock } = generatePdaTypes(root);
        expect(mapTypeName).toBeNull();
        expect(typeBlock).toBe('');
    });

    test('should emit seed types and aggregate map for PDAs', () => {
        const pda = pdaNode({
            name: 'config',
            seeds: [
                constantPdaSeedNodeFromString('utf8', 'config'),
                variablePdaSeedNode('authority', publicKeyTypeNode()),
            ],
        });
        const root = rootNode(
            programNode({
                instructions: [],
                name: 'myProgram',
                pdas: [pda],
                publicKey: '11111111111111111111111111111111',
            }),
        );
        const { mapTypeName, typeBlock } = generatePdaTypes(root);
        expect(mapTypeName).toBe('MyProgramPdas');
        expect(typeBlock).toContain('export type ConfigPdaSeeds');
        expect(typeBlock).toContain('authority: Address;');
        expect(typeBlock).toContain('export type MyProgramPdas');
        expect(typeBlock).toContain('config: (seeds: ConfigPdaSeeds) => Promise<ProgramDerivedAddress>;');
    });

    test('should discover inline PDAs on instruction account defaults', () => {
        const inlinePda = pdaNode({
            name: 'inline',
            seeds: [variablePdaSeedNode('mint', publicKeyTypeNode())],
        });
        const root = rootNode(
            programNode({
                instructions: [
                    instructionNode({
                        accounts: [
                            instructionAccountNode({
                                defaultValue: pdaValueNode(inlinePda),
                                isSigner: false,
                                isWritable: true,
                                name: 'inlineAccount',
                            }),
                        ],
                        name: 'doThing',
                    }),
                ],
                name: 'inlineProgram',
                publicKey: '11111111111111111111111111111111',
            }),
        );
        const { mapTypeName, typeBlock } = generatePdaTypes(root);
        expect(mapTypeName).toBe('InlineProgramPdas');
        expect(typeBlock).toContain('export type InlinePdaSeeds');
        expect(typeBlock).toContain('inline: (seeds: InlinePdaSeeds) => Promise<ProgramDerivedAddress>;');
    });

    test('should emit seedless variant for PDAs with only constant seeds', () => {
        const pda = pdaNode({
            name: 'fixed',
            seeds: [constantPdaSeedNodeFromString('utf8', 'fixed')],
        });
        const root = rootNode(
            programNode({
                instructions: [],
                name: 'fixedProgram',
                pdas: [pda],
                publicKey: '11111111111111111111111111111111',
            }),
        );
        const { typeBlock } = generatePdaTypes(root);
        expect(typeBlock).not.toContain('FixedPdaSeeds');
        expect(typeBlock).toContain('fixed: (seeds?: Record<string, unknown>) => Promise<ProgramDerivedAddress>;');
    });

    test('should use string seed type', () => {
        const pda = pdaNode({
            name: 'named',
            seeds: [variablePdaSeedNode('label', stringTypeNode('utf8'))],
        });
        const root = rootNode(
            programNode({
                instructions: [],
                name: 'namedProgram',
                pdas: [pda],
                publicKey: '11111111111111111111111111111111',
            }),
        );
        const { typeBlock } = generatePdaTypes(root);
        expect(typeBlock).toContain('label: string;');
    });

    describe('emitProgramAddressConfig', () => {
        const runtimeProgramIdRoot = (pda: ReturnType<typeof pdaNode>) =>
            rootNode(
                programNode({
                    instructions: [
                        instructionNode({
                            accounts: [
                                instructionAccountNode({
                                    defaultValue: pdaValueNode(pda, [], accountValueNode('programRef')),
                                    isSigner: false,
                                    isWritable: true,
                                    name: 'acc',
                                }),
                                instructionAccountNode({ isSigner: false, isWritable: false, name: 'programRef' }),
                            ],
                            name: 'doThing',
                        }),
                    ],
                    name: 'runtimeProgram',
                    publicKey: '11111111111111111111111111111111',
                }),
            );

        const unpinned = pdaNode({
            name: 'vault',
            seeds: [variablePdaSeedNode('mint', publicKeyTypeNode())],
        });

        test('should omit the config parameter by default', () => {
            const { typeBlock } = generatePdaTypes(runtimeProgramIdRoot(unpinned));
            expect(typeBlock).toContain('vault: (seeds: VaultPdaSeeds) => Promise<ProgramDerivedAddress>;');
            expect(typeBlock).not.toContain('programAddress');
        });

        test('should emit the config parameter for a PDA with a runtime program ID when enabled', () => {
            const { typeBlock } = generatePdaTypes(runtimeProgramIdRoot(unpinned), {
                emitProgramAddressConfig: true,
            });
            expect(typeBlock).toContain(
                'vault: (seeds: VaultPdaSeeds, config: { programAddress: Address }) => Promise<ProgramDerivedAddress>;',
            );
        });

        test('should omit the config parameter for a PDA that pins its own program ID', () => {
            const pinned = pdaNode({
                name: 'vault',
                programId: '11111111111111111111111111111111',
                seeds: [variablePdaSeedNode('mint', publicKeyTypeNode())],
            });
            const { typeBlock } = generatePdaTypes(runtimeProgramIdRoot(pinned), {
                emitProgramAddressConfig: true,
            });
            expect(typeBlock).toContain('vault: (seeds: VaultPdaSeeds) => Promise<ProgramDerivedAddress>;');
            expect(typeBlock).not.toContain('programAddress');
        });
    });

    test('should widen seed types to the duplicate definition with the most variable seeds', () => {
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
        const root = rootNode(
            programNode({
                instructions: [
                    instructionNode({
                        accounts: [
                            instructionAccountNode({
                                defaultValue: pdaValueNode(narrow),
                                isSigner: false,
                                isWritable: true,
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
                                isWritable: true,
                                name: 'wideAcc',
                            }),
                        ],
                        name: 'wideIx',
                    }),
                ],
                name: 'sharedProgram',
                publicKey: '11111111111111111111111111111111',
            }),
        );

        const { typeBlock } = generatePdaTypes(root);
        expect(typeBlock).toContain('mint: Address;');
        expect(typeBlock).toContain('owner: Address;');
    });
});
