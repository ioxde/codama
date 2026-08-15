import {
    enumEmptyVariantTypeNode,
    enumStructVariantTypeNode,
    enumTupleVariantTypeNode,
    EnumTypeNode,
    enumTypeNode,
    EnumVariantTypeNode,
    isNode,
    structFieldTypeNode,
    StructTypeNode,
    structTypeNode,
} from '@codama/nodes';

export function renameStructNode(node: StructTypeNode, map: Record<string, string>): StructTypeNode {
    return structTypeNode(
        (node.fields ?? []).map(field =>
            map[field.name] ? structFieldTypeNode({ ...field, name: map[field.name] }) : field,
        ),
    );
}

export function renameEnumNode(node: EnumTypeNode, map: Record<string, string>): EnumTypeNode {
    return enumTypeNode(
        (node.variants ?? []).map(variant =>
            map[variant.name] ? renameEnumVariant(variant, map[variant.name]) : variant,
        ),
        { ...node },
    );
}

function renameEnumVariant(variant: EnumVariantTypeNode, newName: string) {
    // Carry `discriminator` and `display` through; dropping the discriminator changes the variant's wire value.
    if (isNode(variant, 'enumStructVariantTypeNode')) {
        return enumStructVariantTypeNode(newName, variant.struct, variant.discriminator, { display: variant.display });
    }
    if (isNode(variant, 'enumTupleVariantTypeNode')) {
        return enumTupleVariantTypeNode(newName, variant.tuple, variant.discriminator, { display: variant.display });
    }
    return enumEmptyVariantTypeNode(newName, variant.discriminator, { display: variant.display });
}
