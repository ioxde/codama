import type { CamelCaseString } from '../../brands';

/** Refers to a named argument of the surrounding instruction. */
export interface ArgumentValueNode {
    readonly kind: 'argumentValueNode';

    // Data.
    /** The name of the referenced argument. */
    readonly name: CamelCaseString;
    // ioxde fork: nested field under the named argument; absent when empty, never `path: []`.
    readonly path?: readonly CamelCaseString[];
}
