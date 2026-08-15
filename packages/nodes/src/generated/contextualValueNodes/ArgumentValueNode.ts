import type { ArgumentValueNode } from '@codama/node-types';
import { camelCase } from '../../shared';

// ioxde fork: `path` addresses a nested struct field — `argumentValueNode('plan_data', ['plan_id'])`
// is `planData.planId`. An omitted or empty path yields no `path` field, never `path: []`.
/** Refers to a named argument of the surrounding instruction. */
export function argumentValueNode(name: string, path?: readonly string[]): ArgumentValueNode {
    return Object.freeze({
        kind: 'argumentValueNode',

        // Data.
        name: camelCase(name),
        // ioxde fork: see the `path` parameter above.
        ...(path !== undefined && path.length > 0 && { path: Object.freeze(path.map(camelCase)) }),
    });
}
