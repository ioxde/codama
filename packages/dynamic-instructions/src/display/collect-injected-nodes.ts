import { getLastNodeFromPath, type InjectedValueNode, isNode, type Node, type NodePath, type TypeNode } from 'codama';

import { collectNestedDataPlaceholders } from './interpolate-intent';
import { resolveDisplayType, resolveDisplayTypePath } from './resolve-display-type';
import type { DisplayContext } from './types';

type BaseDisplayContext = Omit<DisplayContext, 'consumedMemberNames'>;

/**
 * Mirrors everything an instruction actually surfaces: `list-fallback.ts`'s flatten-aware walk plus the leaves the
 * intent template dots into (`interpolate-intent.ts`). If either drifts, the consumed-member gate and the offline
 * dictionary disagree with what the user sees. Duplicates are not pruned; both callers deduplicate.
 */
export function collectInjectedNodes(displayContext: BaseDisplayContext): InjectedValueNode[] {
    const instructionPath = displayContext.parsedInstruction.path;
    const instruction = getLastNodeFromPath(instructionPath);
    const instructionArguments = instruction.arguments ?? [];

    const fromArguments = instructionArguments.flatMap(argument =>
        collectMemberInjectedNodes(
            argument.type,
            argument.display?.flatten ?? false,
            [...instructionPath, argument],
            displayContext,
        ),
    );

    const fromTemplate = collectNestedDataPlaceholders(instruction.display?.interpolatedIntent).flatMap(
        ({ name, segments }) => {
            const argument = instructionArguments.find(arg => arg.name === name);
            if (!argument) return [];
            const leaf = resolveDisplayTypePath(
                argument.type,
                [...instructionPath, argument],
                segments,
                displayContext,
            );
            return leaf ? collectMemberInjectedNodes(leaf.type, false, leaf.ownerPath, displayContext) : [];
        },
    );

    return [...fromArguments, ...fromTemplate];
}

// Amount displays carry the injectable inputs; a flattened struct surfaces its direct fields, so we
// recurse one level into those. `ownerPath` locates the type so nested links resolve in the right program.
function collectMemberInjectedNodes(
    type: TypeNode,
    flatten: boolean,
    ownerPath: NodePath,
    displayContext: BaseDisplayContext,
): InjectedValueNode[] {
    const resolved = resolveDisplayType(type, ownerPath, displayContext);
    if (isNode(resolved.type, 'numberTypeNode') && resolved.type.display?.kind === 'amountNumberDisplayNode') {
        return [resolved.type.display.decimals, resolved.type.display.unit].filter(isInjectedValueNode);
    }
    if (flatten && isNode(resolved.type, 'structTypeNode')) {
        return (resolved.type.fields ?? []).flatMap(field =>
            collectMemberInjectedNodes(field.type, false, [...resolved.ownerPath, field], displayContext),
        );
    }
    return [];
}

/** Narrows an optional injectable input to an `injectedValueNode`. */
function isInjectedValueNode(input: Node | undefined): input is InjectedValueNode {
    return input !== undefined && isNode(input, 'injectedValueNode');
}
