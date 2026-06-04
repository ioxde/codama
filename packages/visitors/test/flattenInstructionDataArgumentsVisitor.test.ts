import {
    accountValueNode,
    argumentValueNode,
    assertIsNode,
    instructionAccountNode,
    instructionArgumentNode,
    instructionNode,
    pdaLinkNode,
    pdaSeedValueNode,
    pdaValueNode,
    programNode,
    publicKeyTypeNode,
    rootNode,
    structFieldTypeNode,
    structTypeNode,
} from '@codama/nodes';
import { visit } from '@codama/visitors-core';
import { expect, test } from 'vitest';

import { flattenInstructionDataArgumentsVisitor } from '../src';

test('it keeps the remaining path when rewriting references deeper than the lifted field', () => {
    // Given a PDA seed referencing a nested field of a struct argument (`args.inner.myField`).
    const instruction = instructionNode({
        accounts: [
            instructionAccountNode({
                defaultValue: pdaValueNode(pdaLinkNode('pda'), [
                    pdaSeedValueNode('myField', argumentValueNode('args', ['inner', 'myField'])),
                ]),
                isSigner: false,
                isWritable: true,
                name: 'pda',
            }),
        ],
        arguments: [
            instructionArgumentNode({
                name: 'args',
                type: structTypeNode([
                    structFieldTypeNode({
                        name: 'inner',
                        type: structTypeNode([structFieldTypeNode({ name: 'myField', type: publicKeyTypeNode() })]),
                    }),
                ]),
            }),
        ],
        name: 'myInstruction',
    });
    const node = rootNode(programNode({ instructions: [instruction], name: 'myProgram', publicKey: '1111' }));

    // When the instruction data arguments are flattened.
    const result = visit(node, flattenInstructionDataArgumentsVisitor());

    // Then we expect the reference to point at `inner` and keep the rest of the path,
    // and `inner` to survive as a top-level struct argument (one-level flattening).
    assertIsNode(result, 'rootNode');
    const account = result.program.instructions[0].accounts[0];
    expect(account.defaultValue).toStrictEqual(
        pdaValueNode(pdaLinkNode('pda'), [pdaSeedValueNode('myField', argumentValueNode('inner', ['myField']))]),
    );
    expect(result.program.instructions[0].arguments.map(argument => argument.name)).toStrictEqual(['inner']);
});

test('it rewrites PDA seed references to struct argument fields lifted by flattening', () => {
    // Given a PDA seed referencing a field of a struct argument (`args.myField`).
    const node = rootNode(
        programNode({
            instructions: [
                instructionNode({
                    accounts: [
                        instructionAccountNode({
                            defaultValue: pdaValueNode(pdaLinkNode('pda'), [
                                pdaSeedValueNode('myField', argumentValueNode('args', ['myField'])),
                                pdaSeedValueNode('authority', accountValueNode('authority')),
                            ]),
                            isSigner: false,
                            isWritable: true,
                            name: 'pda',
                        }),
                        instructionAccountNode({ isSigner: false, isWritable: false, name: 'authority' }),
                    ],
                    arguments: [
                        instructionArgumentNode({
                            name: 'args',
                            type: structTypeNode([structFieldTypeNode({ name: 'myField', type: publicKeyTypeNode() })]),
                        }),
                    ],
                    name: 'myInstruction',
                }),
            ],
            name: 'myProgram',
            publicKey: '1111',
        }),
    );

    // When the instruction data arguments are flattened.
    const result = visit(node, flattenInstructionDataArgumentsVisitor());

    // Then we expect the struct field to be lifted as a top-level argument and the seed to reference it.
    expect(result).toStrictEqual(
        rootNode(
            programNode({
                instructions: [
                    instructionNode({
                        accounts: [
                            instructionAccountNode({
                                defaultValue: pdaValueNode(pdaLinkNode('pda'), [
                                    pdaSeedValueNode('myField', argumentValueNode('myField')),
                                    pdaSeedValueNode('authority', accountValueNode('authority')),
                                ]),
                                isSigner: false,
                                isWritable: true,
                                name: 'pda',
                            }),
                            instructionAccountNode({ isSigner: false, isWritable: false, name: 'authority' }),
                        ],
                        arguments: [instructionArgumentNode({ name: 'myField', type: publicKeyTypeNode() })],
                        name: 'myInstruction',
                    }),
                ],
                name: 'myProgram',
                publicKey: '1111',
            }),
        ),
    );
});

test('it throws when a flattened struct argument is referenced as a whole', () => {
    // Given a PDA seed referencing the struct argument itself rather than one of its fields.
    const node = rootNode(
        programNode({
            instructions: [
                instructionNode({
                    accounts: [
                        instructionAccountNode({
                            defaultValue: pdaValueNode(pdaLinkNode('pda'), [
                                pdaSeedValueNode('data', argumentValueNode('args')),
                            ]),
                            isSigner: false,
                            isWritable: true,
                            name: 'pda',
                        }),
                    ],
                    arguments: [
                        instructionArgumentNode({
                            name: 'args',
                            type: structTypeNode([structFieldTypeNode({ name: 'myField', type: publicKeyTypeNode() })]),
                        }),
                    ],
                    name: 'myInstruction',
                }),
            ],
            name: 'myProgram',
            publicKey: '1111',
        }),
    );

    // When the instruction data arguments are flattened, then we expect the following error to be thrown.
    expect(() => visit(node, flattenInstructionDataArgumentsVisitor())).toThrow(
        /Cannot flatten the struct argument \[args\] of the \[myInstruction\] instruction/,
    );
});

test('it does not rewrite references inside sub-instructions', () => {
    // Given a parent with a flattened struct argument `args` and a sub-instruction whose
    // own (non-struct) argument is also named `args` and is legitimately referenced as a whole.
    const subInstruction = instructionNode({
        accounts: [
            instructionAccountNode({
                defaultValue: argumentValueNode('args'),
                isSigner: false,
                isWritable: false,
                name: 'target',
            }),
        ],
        arguments: [instructionArgumentNode({ name: 'args', type: publicKeyTypeNode() })],
        name: 'mySubInstruction',
    });
    const node = rootNode(
        programNode({
            instructions: [
                instructionNode({
                    arguments: [
                        instructionArgumentNode({
                            name: 'args',
                            type: structTypeNode([structFieldTypeNode({ name: 'myField', type: publicKeyTypeNode() })]),
                        }),
                    ],
                    name: 'myInstruction',
                    subInstructions: [subInstruction],
                }),
            ],
            name: 'myProgram',
            publicKey: '1111',
        }),
    );

    // When the instruction data arguments are flattened, then we expect the sub-instruction's
    // own `args` reference to be left untouched.
    const result = visit(node, flattenInstructionDataArgumentsVisitor());
    assertIsNode(result, 'rootNode');
    const sub = result.program.instructions[0].subInstructions![0];
    expect(sub.accounts[0].defaultValue).toStrictEqual(argumentValueNode('args'));
    expect(sub.arguments.map(argument => argument.name)).toStrictEqual(['args']);
});
