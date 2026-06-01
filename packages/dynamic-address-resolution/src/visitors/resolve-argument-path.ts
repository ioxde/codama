import {
    CODAMA_ERROR__DYNAMIC_CLIENT__ARGUMENT_MISSING,
    CODAMA_ERROR__DYNAMIC_CLIENT__INVALID_ARGUMENT_INPUT,
    CODAMA_ERROR__DYNAMIC_CLIENT__INVARIANT_VIOLATION,
    CODAMA_ERROR__LINKED_NODE_NOT_FOUND,
    CodamaError,
} from '@codama/errors';
import type { CamelCaseString, RootNode, TypeNode } from 'codama';
import { isNode } from 'codama';

import { isObjectRecord, safeStringify } from '../shared/util';

/**
 * Format a path array as the `argumentPath` suffix expected by ARGUMENT_MISSING error context.
 * Empty/missing path → "" (so the error message renders just the argument name).
 */
function pathSuffix(path: readonly CamelCaseString[]): string {
    return path.length > 0 ? `.${path.join('.')}` : '';
}

/**
 * Walks `path` through a top-level instruction-arg type to the leaf field's typeNode.
 * Descends through structTypeNode fields and resolves definedTypeLinkNode along the way.
 * Throws INVARIANT_VIOLATION if the path doesn't resolve through a struct field.
 */
export function resolveArgumentPathType(
    rootType: TypeNode,
    path: readonly CamelCaseString[],
    root: RootNode,
    argumentName: CamelCaseString,
): TypeNode {
    let current = rootType;
    const visited: CamelCaseString[] = [];
    for (const segment of path) {
        current = unwrapDefinedTypeLink(current, root);
        if (!isNode(current, 'structTypeNode')) {
            throw new CodamaError(CODAMA_ERROR__DYNAMIC_CLIENT__INVARIANT_VIOLATION, {
                message: `Cannot walk argument path "${argumentName}${pathSuffix([...visited, segment])}": expected structTypeNode at "${argumentName}${pathSuffix(visited)}", got ${current.kind}.`,
            });
        }
        const field = current.fields.find(f => f.name === segment);
        if (!field) {
            throw new CodamaError(CODAMA_ERROR__DYNAMIC_CLIENT__INVARIANT_VIOLATION, {
                message: `Argument path "${argumentName}${pathSuffix([...visited, segment])}" does not exist: struct has no field "${segment}".`,
            });
        }
        current = field.type;
        visited.push(segment);
    }
    return current;
}

/**
 * Result of walking a sub-path. `resolved` holds the leaf value; the failure variants say why the
 * walk stopped, so callers can treat it as fatal (strict resolution) or "not present" (lenient).
 * `visited` is the path consumed before the failing segment.
 */
type ArgumentPathWalk =
    | {
          readonly kind: 'notObject';
          readonly segment: CamelCaseString;
          readonly value: unknown;
          readonly visited: readonly CamelCaseString[];
      }
    | { readonly kind: 'missing'; readonly visited: readonly CamelCaseString[] }
    | { readonly kind: 'resolved'; readonly value: unknown };

/**
 * Walks `path` through an argument value, descending into struct fields by name. Returns a result
 * instead of throwing so both resolvers below share one copy of the descent logic.
 */
function walkArgumentPathValue(rootValue: unknown, path: readonly CamelCaseString[]): ArgumentPathWalk {
    let current = rootValue;
    const visited: CamelCaseString[] = [];
    for (const segment of path) {
        if (current === undefined || current === null) {
            return { kind: 'missing', visited: [...visited] };
        }
        if (!isObjectRecord(current)) {
            return { kind: 'notObject', segment, value: current, visited: [...visited] };
        }
        current = current[segment];
        visited.push(segment);
    }
    return { kind: 'resolved', value: current };
}

/**
 * Resolves `path` to the leaf value where it's required (PDA seeds, account defaults). Throws
 * ARGUMENT_MISSING if an intermediate or leaf is absent, or INVALID_ARGUMENT_INPUT if a value's shape
 * contradicts the declared type (a primitive where a struct is expected). Both come from
 * caller-supplied `argumentsInput`, so they're user errors, not internal invariants.
 */
export function resolveArgumentPathValue(
    rootValue: unknown,
    path: readonly CamelCaseString[],
    argumentName: CamelCaseString,
    instructionName: CamelCaseString,
): unknown {
    const walk = walkArgumentPathValue(rootValue, path);
    if (walk.kind === 'resolved') return walk.value;
    if (walk.kind === 'missing') {
        throw new CodamaError(CODAMA_ERROR__DYNAMIC_CLIENT__ARGUMENT_MISSING, {
            argumentName,
            argumentPath: pathSuffix(walk.visited),
            instructionName,
        });
    }
    throw new CodamaError(CODAMA_ERROR__DYNAMIC_CLIENT__INVALID_ARGUMENT_INPUT, {
        argumentName,
        expectedType: `an object at "${argumentName}${pathSuffix(walk.visited)}" to read "${walk.segment}"`,
        value: safeStringify(walk.value),
    });
}

/**
 * Lenient counterpart to {@link resolveArgumentPathValue}, for cases where a non-resolved value is
 * "not present" rather than an error (e.g. a conditional's condition). Returns `undefined` for any
 * path that doesn't fully resolve; never throws.
 */
export function tryResolveArgumentPathValue(rootValue: unknown, path: readonly CamelCaseString[]): unknown {
    const walk = walkArgumentPathValue(rootValue, path);
    return walk.kind === 'resolved' ? walk.value : undefined;
}

function unwrapDefinedTypeLink(node: TypeNode, root: RootNode, seen: Set<CamelCaseString> = new Set()): TypeNode {
    if (!isNode(node, 'definedTypeLinkNode')) return node;
    if (seen.has(node.name)) {
        throw new CodamaError(CODAMA_ERROR__DYNAMIC_CLIENT__INVARIANT_VIOLATION, {
            message: `Circular definedTypeLinkNode chain encountered while resolving argument path through "${node.name}".`,
        });
    }
    seen.add(node.name);
    const definedType = root.program.definedTypes.find(dt => dt.name === node.name);
    if (!definedType) {
        throw new CodamaError(CODAMA_ERROR__LINKED_NODE_NOT_FOUND, {
            kind: 'definedTypeLinkNode',
            linkNode: node,
            name: node.name,
            path: [],
        });
    }
    return unwrapDefinedTypeLink(definedType.type, root, seen);
}

export { pathSuffix as formatArgumentPathSuffix };
