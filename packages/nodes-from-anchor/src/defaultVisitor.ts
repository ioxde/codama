import { assertIsNode, Node, RootNode } from '@codama/nodes';
import {
    deduplicateIdenticalDefinedTypesVisitor,
    flattenInstructionDataArgumentsVisitor,
    getCommonInstructionAccountDefaultRules,
    rootNodeVisitor,
    setFixedAccountSizesVisitor,
    setInstructionAccountDefaultValuesVisitor,
    transformU8ArraysToBytesVisitor,
    unwrapInstructionArgsDefinedTypesVisitor,
    visit,
    Visitor,
} from '@codama/visitors';

import { normalizeCpiEventsOverrides, validateCpiEventsOverrides } from './cpiEventsOptions';
import { detectEventCpiPrograms } from './detectEventCpiPrograms';
import { extractPdasVisitor } from './extractPdasVisitor';
import {
    ANCHOR_EVENT_CPI_DISCRIMINATOR,
    wrapEventsWithCpiDiscriminatorVisitor,
} from './wrapEventsWithCpiDiscriminatorVisitor';

export type DefaultVisitorOptions = {
    cpiEventsByProgram?: Record<string, readonly string[]>;
};

export function defaultVisitor(options: DefaultVisitorOptions = {}) {
    return rootNodeVisitor(currentRoot => {
        let root: RootNode = currentRoot;
        const updateRoot = (visitor: Visitor<Node | null, 'rootNode'>) => {
            const newRoot = visit(root, visitor);
            assertIsNode(newRoot, 'rootNode');
            root = newRoot;
        };

        // PDAs.
        updateRoot(extractPdasVisitor());

        // Defined types.
        updateRoot(deduplicateIdenticalDefinedTypesVisitor());

        // Accounts.
        updateRoot(setFixedAccountSizesVisitor());

        // Instructions.
        updateRoot(setInstructionAccountDefaultValuesVisitor(getCommonInstructionAccountDefaultRules()));
        updateRoot(unwrapInstructionArgsDefinedTypesVisitor());
        updateRoot(flattenInstructionDataArgumentsVisitor());

        // Extras.
        updateRoot(transformU8ArraysToBytesVisitor());

        // Anchor event CPI.
        const eventCpiPrograms = detectEventCpiPrograms(root);
        const normalizedOverrides = normalizeCpiEventsOverrides(options.cpiEventsByProgram);
        if (normalizedOverrides) {
            validateCpiEventsOverrides(root, eventCpiPrograms, normalizedOverrides);
        }
        const eventsByProgram: Record<string, readonly string[] | null> = {};
        for (const programName of eventCpiPrograms) {
            const override = normalizedOverrides?.[programName];
            if (override === undefined) {
                eventsByProgram[programName] = null;
            } else if (override.length > 0) {
                eventsByProgram[programName] = override;
            }
        }
        if (Object.keys(eventsByProgram).length > 0) {
            updateRoot(
                wrapEventsWithCpiDiscriminatorVisitor({
                    discriminator: ANCHOR_EVENT_CPI_DISCRIMINATOR,
                    eventsByProgram,
                }),
            );
        }

        return root;
    });
}
