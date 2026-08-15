import {
    assertIsNode,
    definedTypeNode,
    enumEmptyVariantTypeNode,
    enumStructVariantTypeNode,
    enumTupleVariantTypeNode,
    enumTypeNode,
    enumVariantDisplayNode,
    numberTypeNode,
    programNode,
    structFieldTypeNode,
    structTypeNode,
    tupleTypeNode,
} from '@codama/nodes';
import { visit } from '@codama/visitors-core';
import { expect, test } from 'vitest';

import { updateDefinedTypesVisitor } from '../src';

test('it preserves variant discriminators and displays when renaming enum variants', () => {
    // Given an enum whose variants carry explicit discriminators and display metadata.
    const node = programNode({
        definedTypes: [
            definedTypeNode({
                name: 'myEnum',
                type: enumTypeNode([
                    enumEmptyVariantTypeNode('uninitialized', 7, {
                        display: enumVariantDisplayNode({ label: 'Uninitialized' }),
                    }),
                    enumStructVariantTypeNode(
                        'move',
                        structTypeNode([structFieldTypeNode({ name: 'x', type: numberTypeNode('u8') })]),
                        42,
                    ),
                    enumTupleVariantTypeNode('flip', tupleTypeNode([numberTypeNode('u8')]), 99),
                ]),
            }),
        ],
        name: 'myProgram',
        publicKey: '1111',
    });

    // When we rename all three variants.
    const result = visit(
        node,
        updateDefinedTypesVisitor({
            myEnum: { data: { flip: 'reverse', move: 'translate', uninitialized: 'idle' } },
        }),
    );

    // Then the renamed variants keep their discriminators and display metadata.
    assertIsNode(result, 'programNode');
    expect((result.definedTypes ?? [])[0].type).toStrictEqual(
        enumTypeNode([
            enumEmptyVariantTypeNode('idle', 7, {
                display: enumVariantDisplayNode({ label: 'Uninitialized' }),
            }),
            enumStructVariantTypeNode(
                'translate',
                structTypeNode([structFieldTypeNode({ name: 'x', type: numberTypeNode('u8') })]),
                42,
            ),
            enumTupleVariantTypeNode('reverse', tupleTypeNode([numberTypeNode('u8')]), 99),
        ]),
    );
});
