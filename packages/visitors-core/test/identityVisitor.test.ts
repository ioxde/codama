import {
    accountValueNode,
    assertIsNode,
    enumEmptyVariantTypeNode,
    enumStructVariantTypeNode,
    enumTupleVariantTypeNode,
    enumVariantDisplayNode,
    numberTypeNode,
    pdaLinkNode,
    pdaValueNode,
    publicKeyTypeNode,
    structFieldTypeNode,
    structTypeNode,
    tupleTypeNode,
} from '@codama/nodes';
import { expect, test } from 'vitest';

import { identityVisitor, interceptVisitor, visit } from '../src';

test('it visits all nodes and returns different instances of the same nodes', () => {
    // Given the following 3-nodes tree.
    const node = tupleTypeNode([numberTypeNode('u32'), publicKeyTypeNode()]);

    // When we visit it using the identity visitor.
    const result = visit(node, identityVisitor());

    // Then we get the same tree back.
    expect(result).toEqual(node);

    // But the nodes are different instances.
    expect(result).not.toBe(node);
    assertIsNode(result, 'tupleTypeNode');
    expect((result.items ?? [])[0]).not.toBe((node.items ?? [])[0]);
    expect((result.items ?? [])[1]).not.toBe((node.items ?? [])[1]);
});

// identityVisitor must preserve programId, else a cross-program PDA's dynamic ref is lost downstream.
test('it preserves the program id of a pda value node', () => {
    const node = pdaValueNode(pdaLinkNode('associatedToken'), [], accountValueNode('tokenProgram'));
    const result = visit(node, identityVisitor());
    expect(result).toEqual(node);
});

test('it cascades null up when a programId child visit returns null', () => {
    const node = pdaValueNode(pdaLinkNode('associatedToken'), [], accountValueNode('tokenProgram'));
    const visitor = identityVisitor();
    visitor.visitAccountValue = () => null;
    expect(visit(node, visitor)).toBeNull();
});

test('it preserves discriminator and display on an enum struct variant that keeps its payload', () => {
    const node = enumStructVariantTypeNode(
        'cancel',
        structTypeNode([structFieldTypeNode({ name: 'x', type: numberTypeNode('u8') })]),
        7,
        { display: enumVariantDisplayNode({ label: 'Cancel order' }) },
    );
    const result = visit(node, identityVisitor());
    expect(result).toEqual(node);
});

test('it preserves discriminator and display when downgrading a struct variant to an empty variant', () => {
    // Given a struct variant whose only field visits away, forcing the downgrade.
    const node = enumStructVariantTypeNode(
        'cancel',
        structTypeNode([structFieldTypeNode({ name: 'x', type: publicKeyTypeNode() })]),
        7,
        { display: enumVariantDisplayNode({ label: 'Cancel order' }) },
    );
    const visitor = identityVisitor();
    visitor.visitPublicKeyType = () => null;

    const result = visit(node, visitor);
    expect(result).toEqual(
        enumEmptyVariantTypeNode('cancel', 7, { display: enumVariantDisplayNode({ label: 'Cancel order' }) }),
    );
});

test('it preserves discriminator and display when downgrading a tuple variant to an empty variant', () => {
    // Given a tuple variant whose only item visits away, forcing the downgrade.
    const node = enumTupleVariantTypeNode('cancel', tupleTypeNode([publicKeyTypeNode()]), 3, {
        display: enumVariantDisplayNode({ label: 'Cancel order' }),
    });
    const visitor = identityVisitor();
    visitor.visitPublicKeyType = () => null;

    const result = visit(node, visitor);
    expect(result).toEqual(
        enumEmptyVariantTypeNode('cancel', 3, { display: enumVariantDisplayNode({ label: 'Cancel order' }) }),
    );
});

test('it can remove nodes by returning null', () => {
    // Given the following 3-nodes tree.
    const node = tupleTypeNode([numberTypeNode('u32'), publicKeyTypeNode()]);

    // And given an identity visitor overidden to remove all public key nodes.
    const visitor = identityVisitor();
    visitor.visitPublicKeyType = () => null;

    // When we visit it using that visitor.
    const result = visit(node, visitor);

    // Then we expect the following tree back.
    expect(result).toEqual(tupleTypeNode([numberTypeNode('u32')]));
});

test('it can create partial visitors', () => {
    // Given the following 3-nodes tree.
    const node = tupleTypeNode([numberTypeNode('u32'), publicKeyTypeNode()]);

    // And an identity visitor that only supports 2 of these nodes
    // whilst using an interceptor to record the events that happened.
    const events: string[] = [];
    const visitor = interceptVisitor(identityVisitor({ keys: ['tupleTypeNode', 'numberTypeNode'] }), (node, next) => {
        events.push(`visiting:${node.kind}`);
        return next(node);
    });

    // When we visit the tree using that visitor.
    const result = visit(node, visitor);

    // Then we still get the full tree back as different instances.
    expect(result).toEqual(node);
    expect(result).not.toBe(node);
    assertIsNode(result, 'tupleTypeNode');
    expect((result.items ?? [])[0]).not.toBe((node.items ?? [])[0]);
    expect((result.items ?? [])[1]).not.toBe((node.items ?? [])[1]);

    // But the unsupported node was not visited.
    expect(events).toEqual(['visiting:tupleTypeNode', 'visiting:numberTypeNode']);

    // And the unsupported node cannot be visited.
    // @ts-expect-error PublicKeyTypeNode is not supported.
    expect(() => visit(publicKeyTypeNode(), visitor)).toThrow();
});
