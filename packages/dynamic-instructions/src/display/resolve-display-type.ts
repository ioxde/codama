import {
    type DefinedTypeNode,
    getLastNodeFromPath,
    isNode,
    type NodePath,
    resolveNestedTypeNode,
    type TypeNode,
} from 'codama';

import type { DisplayContext } from './types';

/** A type resolved through its display links, paired with the path to where it now lives. */
export type ResolvedDisplayType = {
    /** The path locating the resolved type's owner, used to resolve any links nested within it. */
    readonly ownerPath: NodePath;
    /** The resolved type, with wrappers stripped and links followed. */
    readonly type: TypeNode;
};

/**
 * Resolves nested type wrappers, follows `definedTypeLinkNode`s to their underlying types, and
 * unwraps option types to their item — presentation belongs to the value inside the option, and
 * the value formatter unwraps the corresponding `Option` values symmetrically. Shared by the value
 * formatter, the fallback list, and consumed-member collection so links resolve identically
 * everywhere.
 *
 * Links are resolved by their full path (`ownerPath` plus the link), so the linkable dictionary
 * targets the program each link appears in. When a link is followed, the returned `ownerPath` is
 * rebased onto the resolved defined type so links nested within it — possibly in another program —
 * resolve from the correct location. Since links and options can now interleave (e.g. a recursive
 * type reaching itself through an option), already-followed links are tracked to terminate cycles.
 */
export function resolveDisplayType(
    type: TypeNode,
    ownerPath: NodePath,
    displayContext: Omit<DisplayContext, 'consumedMemberNames'>,
): ResolvedDisplayType {
    let resolvedType = resolveNestedTypeNode(type);
    let resolvedOwnerPath = ownerPath;
    const followedLinks = new Set<DefinedTypeNode>();

    for (;;) {
        if (
            isNode(resolvedType, 'optionTypeNode') ||
            isNode(resolvedType, 'remainderOptionTypeNode') ||
            isNode(resolvedType, 'zeroableOptionTypeNode')
        ) {
            resolvedType = resolveNestedTypeNode(resolvedType.item);
            continue;
        }
        if (isNode(resolvedType, 'definedTypeLinkNode')) {
            const definedTypePath = displayContext.resolveDefinedType([...resolvedOwnerPath, resolvedType]);
            if (!definedTypePath) break;
            const definedType = getLastNodeFromPath<DefinedTypeNode>(definedTypePath);
            if (followedLinks.has(definedType)) break;
            followedLinks.add(definedType);
            resolvedOwnerPath = definedTypePath;
            resolvedType = resolveNestedTypeNode(definedType.type);
            continue;
        }
        break;
    }

    return { ownerPath: resolvedOwnerPath, type: resolvedType };
}

/**
 * Segment syntax mirrors `ArgumentValueNode.path`, extended to array indices. Only the value walk
 * bounds-checks an array index, since every item shares one type; the leaf type comes back unresolved.
 */
export function resolveDisplayTypePath(
    type: TypeNode,
    ownerPath: NodePath,
    segments: readonly string[],
    displayContext: Omit<DisplayContext, 'consumedMemberNames'>,
): ResolvedDisplayType | null {
    let current: ResolvedDisplayType = { ownerPath, type };
    for (const segment of segments) {
        const resolved = resolveDisplayType(current.type, current.ownerPath, displayContext);
        if (isNode(resolved.type, 'structTypeNode')) {
            const field = (resolved.type.fields ?? []).find(f => f.name === segment);
            if (!field) return null;
            current = { ownerPath: [...resolved.ownerPath, field], type: field.type };
            continue;
        }
        if (isNode(resolved.type, 'tupleTypeNode')) {
            const items = resolved.type.items ?? [];
            const index = Number(segment);
            if (!Number.isInteger(index) || index < 0 || index >= items.length) return null;
            current = { ownerPath: resolved.ownerPath, type: items[index] };
            continue;
        }
        if (isNode(resolved.type, 'arrayTypeNode')) {
            const index = Number(segment);
            if (!Number.isInteger(index) || index < 0) return null;
            current = { ownerPath: resolved.ownerPath, type: resolved.type.item };
            continue;
        }
        return null;
    }
    return current;
}
