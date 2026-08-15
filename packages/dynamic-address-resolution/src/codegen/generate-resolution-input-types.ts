import { type DefinedTypeNode, type InstructionNode, type RootNode } from 'codama';

import { OPTIONAL_NODE_KINDS } from '../shared/nodes';
import { codamaTypeToTS } from './codama-type-to-ts';
import { collectResolverNames } from './collect-resolver-names';
import { getResolutionRefs } from './get-resolution-refs';
import { isAccountAutoResolvable } from './is-account-auto-resolvable';

/**
 * Local non-exported declaration of `ResolverFn` emitted into generated files
 * that contain at least one `${Name}Resolvers` block. The structural shape
 * must remain identical to the runtime `ResolverFn` exported from
 * `@codama/dynamic-address-resolution`; a type-level test in this package
 * locks the two together.
 *
 * @internal Exported only for a drift test that pins this string to the
 * runtime `ResolverFn` type. Do not consume from downstream codegen — call
 * `generateResolutionInputTypes` instead, which inlines this declaration
 * into the emitted output.
 */
export const RESOLVER_FN_DECLARATION =
    'type ResolverFn<TArgumentsInput, TAccountsInput> = (argumentsInput: TArgumentsInput, accountsInput: TAccountsInput) => Promise<unknown>;\n\n';

/**
 * Emits the input types required for address resolution of each instruction —
 * `${Name}Args`, `${Name}Accounts`, `${Name}Resolvers`.
 *
 * These types live in this package because address resolution
 * (PDAs, defaults, resolver functions) operates on them.
 */
export function generateResolutionInputTypes(idl: RootNode): string {
    const definedTypes = idl.program.definedTypes ?? [];
    const hasAnyResolvers = (idl.program.instructions ?? []).some(ix => getResolutionRefs(ix).hasResolvers);
    let output = hasAnyResolvers ? RESOLVER_FN_DECLARATION : '';
    for (const ix of idl.program.instructions ?? []) {
        output += generateTypeBlockForInstruction(ix, definedTypes);
    }
    return output;
}

function generateTypeBlockForInstruction(ix: InstructionNode, definedTypes: DefinedTypeNode[]): string {
    const refs = getResolutionRefs(ix);
    let output = '';

    if (refs.argsRef) {
        output += generateArgsBlock(refs.argsRef, ix, definedTypes);
    }

    if ((ix.accounts ?? []).length > 0) {
        output += `export type ${refs.accountsRef} = {\n`;
        for (const acc of ix.accounts ?? []) {
            const omittable = isAccountAutoResolvable(acc) ? '?' : '';
            const type = acc.isOptional ? 'Address | null' : 'Address';
            output += `    ${acc.name}${omittable}: ${type};\n`;
        }
        output += '};\n\n';
        output += `export type ${refs.accountsWithDataRef} = ${refs.accountsRef} & Record<string, Address | null | undefined>;\n\n`;
    } else {
        // No IDL-declared accounts: emit the strict and loose forms independently.
        output += `export type ${refs.accountsRef} = Record<string, never>;\n\n`;
        output += `export type ${refs.accountsWithDataRef} = Record<string, Address | null | undefined>;\n\n`;
    }

    if (refs.resolversRef) {
        const resolverArgsRef = refs.argsRef ?? 'Record<string, unknown>';
        output += `export type ${refs.resolversRef} = {\n`;
        for (const name of collectResolverNames(ix)) {
            output += `    ${name}: ResolverFn<${resolverArgsRef}, ${refs.accountsRef}>;\n`;
        }
        output += '};\n\n';
    }

    return output;
}

function generateArgsBlock(argsRef: string, ix: InstructionNode, definedTypes: DefinedTypeNode[]): string {
    const args = (ix.arguments ?? []).filter(arg => arg.defaultValueStrategy !== 'omitted');
    // extraArguments are always optional: only required when the account they derive is not passed
    // directly, which this type cannot see. Must match the args validator.
    const extraArguments = ix.extraArguments ?? [];
    const emitted = new Set<string>([...args, ...extraArguments].map(arg => arg.name));

    let output = `export type ${argsRef} = {\n`;
    for (const arg of args) {
        const tsType = codamaTypeToTS(arg.type, definedTypes);
        const isOptional = OPTIONAL_NODE_KINDS.includes(arg.type.kind);
        const sep = isOptional ? '?:' : ':';
        output += `    ${arg.name}${sep} ${tsType};\n`;
    }
    for (const arg of extraArguments) {
        output += `    ${arg.name}?: ${codamaTypeToTS(arg.type, definedTypes)};\n`;
    }
    output += generateRemainingAccountKeys(ix, emitted);
    output += '};\n\n';
    return output;
}

type VirtualRootLeaf = { optional: boolean; path: readonly string[] };

// Only roots absent from both `arguments` and `extraArguments` may contribute a key; re-emitting a
// declared root duplicates it and the generated type stops compiling. A declared root's requiredness
// comes from its serialized type, not the group's `isOptional`.
function generateRemainingAccountKeys(ix: InstructionNode, emitted: ReadonlySet<string>): string {
    const roots = new Map<string, VirtualRootLeaf[]>();
    for (const ra of ix.remainingAccounts ?? []) {
        if (ra.value.kind !== 'argumentValueNode' || emitted.has(ra.value.name)) continue;
        const leaves = roots.get(ra.value.name) ?? [];
        leaves.push({ optional: Boolean(ra.isOptional), path: ra.value.path ?? [] });
        roots.set(ra.value.name, leaves);
    }

    let output = '';
    for (const [name, leaves] of roots) {
        const sep = leaves.every(leaf => leaf.optional) ? '?:' : ':';
        output += `    ${name}${sep} ${virtualRootType(leaves)};\n`;
    }
    return output;
}

// A node addressed both as a leaf (`['x']`) and as a container (`['x', 'y']`) renders as an intersection:
// the runtime resolves every group's path independently and requires `Address[]` at each leaf.
function virtualRootType(leaves: VirtualRootLeaf[]): string {
    const nested = leaves.filter(leaf => leaf.path.length > 0);
    if (nested.length === 0) return 'Address[]';
    const treeType = renderPathTree(buildPathTree(nested));
    return nested.length < leaves.length ? `Address[] & ${treeType}` : treeType;
}

type PathTree = Map<string, { children: PathTree | null; optional: boolean; terminal: boolean }>;

function buildPathTree(leaves: VirtualRootLeaf[]): PathTree {
    const root: PathTree = new Map();
    for (const leaf of leaves) {
        let tree = root;
        for (let index = 0; index < leaf.path.length; index++) {
            const segment = leaf.path[index];
            const isLast = index === leaf.path.length - 1;
            let entry = tree.get(segment);
            if (!entry) {
                entry = { children: null, optional: leaf.optional, terminal: false };
                tree.set(segment, entry);
            }
            entry.optional = entry.optional && leaf.optional;
            if (isLast) {
                entry.terminal = true;
            } else {
                entry.children ??= new Map();
                tree = entry.children;
            }
        }
    }
    return root;
}

function renderPathTree(tree: PathTree): string {
    const fields = [...tree].map(([name, entry]) => {
        const nested = entry.children === null ? null : renderPathTree(entry.children);
        const type = nested === null ? 'Address[]' : entry.terminal ? `Address[] & ${nested}` : nested;
        return `${name}${entry.optional ? '?' : ''}: ${type}`;
    });
    return `{ ${fields.join('; ')} }`;
}
