import {
    CODAMA_ERROR__VISITORS__CANNOT_FLATTEN_STRUCT_REFERENCED_AS_A_WHOLE,
    CODAMA_ERROR__VISITORS__CANNOT_FLATTEN_STRUCT_WITH_CONFLICTING_ATTRIBUTES,
    CodamaError,
} from '@codama/errors';
import {
    argumentValueNode,
    assertIsNode,
    camelCase,
    InstructionArgumentNode,
    instructionArgumentNode,
    InstructionNode,
    instructionNode,
    isNode,
} from '@codama/nodes';
import { bottomUpTransformerVisitor, visit } from '@codama/visitors-core';

export function flattenInstructionDataArgumentsVisitor() {
    return bottomUpTransformerVisitor([
        {
            select: '[instructionNode]',
            transform: instruction => {
                assertIsNode(instruction, 'instructionNode');
                const flattenedRoots = new Set(
                    instruction.arguments.filter(node => isNode(node.type, 'structTypeNode')).map(node => node.name),
                );
                const flattened = instructionNode({
                    ...instruction,
                    arguments: flattenInstructionArguments(instruction.arguments),
                });
                return flattenedRoots.size > 0 ? rewriteLiftedArgumentReferences(flattened, flattenedRoots) : flattened;
            },
        },
    ]);
}

// Rewrites references into flattened struct arguments (e.g. PDA seeds): `args.foo.bar`
// becomes `foo.bar`. Whole-struct references have no rewrite target, so we throw.
function rewriteLiftedArgumentReferences(
    instruction: InstructionNode,
    flattenedRoots: ReadonlySet<string>,
): InstructionNode {
    // Sub-instructions have their own argument namespace; exclude them from the rewrite.
    const { subInstructions } = instruction;
    const rewritten = visit(
        instructionNode({ ...instruction, subInstructions: undefined }),
        bottomUpTransformerVisitor([
            {
                select: '[argumentValueNode]',
                transform: node => {
                    assertIsNode(node, 'argumentValueNode');
                    if (!flattenedRoots.has(node.name)) return node;
                    if (!node.path || node.path.length === 0) {
                        throw new CodamaError(CODAMA_ERROR__VISITORS__CANNOT_FLATTEN_STRUCT_REFERENCED_AS_A_WHOLE, {
                            argumentName: node.name,
                            instructionName: instruction.name,
                        });
                    }
                    return argumentValueNode(node.path[0], node.path.slice(1));
                },
            },
        ]),
    );
    assertIsNode(rewritten, 'instructionNode');
    return instructionNode({ ...rewritten, subInstructions });
}

export type FlattenInstructionArgumentsConfig = string[] | '*';

export const flattenInstructionArguments = (
    nodes: InstructionArgumentNode[],
    options: FlattenInstructionArgumentsConfig = '*',
): InstructionArgumentNode[] => {
    const camelCaseOptions = options === '*' ? options : options.map(camelCase);
    const shouldInline = (node: InstructionArgumentNode): boolean =>
        options === '*' || camelCaseOptions.includes(camelCase(node.name));
    const inlinedArguments = nodes.flatMap(node => {
        if (isNode(node.type, 'structTypeNode') && shouldInline(node)) {
            return node.type.fields.map(field => instructionArgumentNode({ ...field }));
        }
        return node;
    });

    const inlinedFieldsNames = inlinedArguments.map(arg => arg.name);
    const duplicates = inlinedFieldsNames.filter((e, i, a) => a.indexOf(e) !== i);
    const uniqueDuplicates = [...new Set(duplicates)];
    const hasConflictingNames = uniqueDuplicates.length > 0;

    if (hasConflictingNames) {
        throw new CodamaError(CODAMA_ERROR__VISITORS__CANNOT_FLATTEN_STRUCT_WITH_CONFLICTING_ATTRIBUTES, {
            conflictingAttributes: uniqueDuplicates,
        });
    }

    return hasConflictingNames ? nodes : inlinedArguments;
};
