import {
    assertIsNode,
    definedTypeNode,
    enumStructVariantTypeNode,
    enumTupleVariantTypeNode,
    enumTypeNode,
    enumVariantDisplayNode,
    numberTypeNode,
    programNode,
    rootNode,
    structFieldTypeNode,
    structTypeNode,
    tupleTypeNode,
} from '@codama/nodes';
import { visit } from '@codama/visitors-core';
import { expect, test } from 'vitest';

import { unwrapTupleEnumWithSingleStructVisitor } from '../src';

test('it preserves variant discriminators and displays when unwrapping tuple variants', () => {
    // Given an enum whose tuple variant wraps a single struct and carries a discriminator and display.
    const node = rootNode(
        programNode({
            definedTypes: [
                definedTypeNode({
                    name: 'myEnum',
                    type: enumTypeNode([
                        enumTupleVariantTypeNode(
                            'move',
                            tupleTypeNode([
                                structTypeNode([structFieldTypeNode({ name: 'x', type: numberTypeNode('u8') })]),
                            ]),
                            42,
                            { display: enumVariantDisplayNode({ label: 'Move' }) },
                        ),
                    ]),
                }),
            ],
            name: 'myProgram',
            publicKey: '1111',
        }),
    );

    // When we unwrap tuple variants containing a single struct.
    const result = visit(node, unwrapTupleEnumWithSingleStructVisitor());

    // Then the unwrapped struct variant keeps the discriminator and display metadata.
    assertIsNode(result, 'rootNode');
    expect((result.program.definedTypes ?? [])[0].type).toStrictEqual(
        enumTypeNode([
            enumStructVariantTypeNode(
                'move',
                structTypeNode([structFieldTypeNode({ name: 'x', type: numberTypeNode('u8') })]),
                42,
                { display: enumVariantDisplayNode({ label: 'Move' }) },
            ),
        ]),
    );
});
