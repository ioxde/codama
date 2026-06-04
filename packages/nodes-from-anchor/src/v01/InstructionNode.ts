import {
    argumentValueNode,
    bytesTypeNode,
    camelCase,
    fieldDiscriminatorNode,
    fixedSizeTypeNode,
    InstructionAccountNode,
    instructionAccountNode,
    InstructionArgumentNode,
    instructionArgumentNode,
    InstructionNode,
    instructionNode,
    isNode,
    pdaSeedValueNode,
    pdaValueNode,
    TypeNode,
} from '@codama/nodes';

import { getAnchorDiscriminatorV01 } from '../discriminators';
import type { IdlV01Instruction, IdlV01InstructionAccount, IdlV01InstructionAccountItem, IdlV01TypeDef } from './idl';
import {
    LoweredInstructionAccountV01,
    lowerInstructionAccountsV01,
    minimalDistinctSuffixNames,
    stampPinnedAddresses,
} from './InstructionAccountNode';
import { instructionArgumentNodeFromAnchorV01 } from './InstructionArgumentNode';
import { seedLeafName } from './PdaSeedNode';
import type { GenericsV01 } from './unwrapGenerics';

export function instructionNodeFromAnchorV01(
    idl: IdlV01Instruction,
    idlTypes: IdlV01TypeDef[] = [],
    generics: GenericsV01,
): InstructionNode {
    const name = idl.name;
    let dataArguments = idl.args.map(arg => instructionArgumentNodeFromAnchorV01(arg, generics));

    const discriminatorField = instructionArgumentNode({
        defaultValue: getAnchorDiscriminatorV01(idl.discriminator),
        defaultValueStrategy: 'omitted',
        name: 'discriminator',
        type: fixedSizeTypeNode(bytesTypeNode(), idl.discriminator.length),
    });
    dataArguments = [discriminatorField, ...dataArguments];
    const discriminators = [fieldDiscriminatorNode('discriminator')];

    const lowered = lowerInstructionAccountsV01(idl.accounts ?? [], dataArguments, undefined, idlTypes, generics);
    const argumentNames = new Set(dataArguments.map(arg => arg.name));
    const accounts = stampPinnedAddresses(disambiguateCrossPdaSeedInputs(lowered, idl.accounts ?? [], argumentNames));
    const extraArguments = collectExtraArguments(accounts, argumentNames);

    return instructionNode({
        accounts,
        arguments: dataArguments,
        discriminators,
        docs: idl.docs ?? [],
        extraArguments: extraArguments.length > 0 ? extraArguments : undefined,
        name: camelCase(name),
        optionalAccountStrategy: 'programId',
    });
}

// Account-data-field PDA seeds need a caller input that isn't serialized. Deduped across PDAs.
function collectExtraArguments(
    accounts: InstructionAccountNode[],
    argumentNames: Set<string>,
): InstructionArgumentNode[] {
    const seen = new Set<string>();
    const extraArguments: InstructionArgumentNode[] = [];

    for (const account of accounts) {
        const defaultValue = account.defaultValue;
        if (!isNode(defaultValue, 'pdaValueNode') || !isNode(defaultValue.pda, 'pdaNode')) continue;

        const seedTypes = new Map<string, TypeNode>();
        for (const seed of defaultValue.pda.seeds) {
            if (isNode(seed, 'variablePdaSeedNode')) seedTypes.set(seed.name, seed.type);
        }

        for (const seedValue of defaultValue.seeds) {
            const value = seedValue.value;
            // Path-bearing args reference an existing root arg, not a new input to synthesize.
            if (!isNode(value, 'argumentValueNode') || (value.path && value.path.length > 0)) continue;
            // Name is the (possibly cross-PDA-qualified) value name; type is keyed by the seed's leaf name.
            const argName = value.name;
            const type = seedTypes.get(seedValue.name);
            if (argumentNames.has(argName) || seen.has(argName)) continue;
            if (!type) continue;
            seen.add(argName);
            extraArguments.push(instructionArgumentNode({ name: argName, type }));
        }
    }

    return extraArguments;
}

// One input per distinct IDL path across the instruction's PDAs. Renames only the
// argumentValueNode -- seed definition names stay so cross-instruction PDA merging is stable.
function disambiguateCrossPdaSeedInputs(
    lowered: LoweredInstructionAccountV01[],
    idlAccounts: IdlV01InstructionAccountItem[],
    argumentNames: ReadonlySet<string>,
): InstructionAccountNode[] {
    const scopes = collectScopes(idlAccounts);

    type Entry = { accountIndex: number; parts: string[]; source: string; valueIndex: number };
    const entries: Entry[] = [];
    lowered.forEach(({ account, groups, node }, accountIndex) => {
        const dv = node.defaultValue;
        if (!isNode(dv, 'pdaValueNode') || !isNode(dv.pda, 'pdaNode')) return;
        const paths = pdaSeedSourcePaths(account, groups, scopes);
        if (!paths) return;
        dv.seeds.forEach((seedValue, valueIndex) => {
            const value = seedValue.value;
            if (!isNode(value, 'argumentValueNode') || (value.path && value.path.length > 0)) return;
            const parts = paths[valueIndex];
            // length < 2 is a bare account or single arg, not a synthesized data input.
            if (!parts || parts.length < 2) return;
            entries.push({ accountIndex, parts, source: parts.join('.'), valueIndex });
        });
    });
    if (entries.length === 0) return lowered.map(l => l.node);

    // Reserve names globally so a qualified name in one bucket can't collide with a bare leaf in another.
    const partsBySource = new Map<string, string[]>();
    for (const entry of entries) partsBySource.set(entry.source, entry.parts);
    const sourcesByLeaf = new Map<string, string[]>();
    for (const [source, parts] of partsBySource) {
        const leaf = seedLeafName(parts);
        const bucket = sourcesByLeaf.get(leaf) ?? [];
        bucket.push(source);
        sourcesByLeaf.set(leaf, bucket);
    }
    const nameBySource = new Map<string, string>();
    // Reserve bare-account seed names too: they share the resolver's per-PDA dependency
    // map, so a collision would resolve to the account address instead of the stored field.
    const used = new Set(argumentNames);
    for (const { node } of lowered) {
        const dv = node.defaultValue;
        if (!isNode(dv, 'pdaValueNode')) continue;
        for (const seedValue of dv.seeds) {
            if (isNode(seedValue.value, 'accountValueNode')) used.add(seedValue.value.name);
        }
    }
    for (const [leaf, sources] of sourcesByLeaf) {
        // Lone source with a free leaf keeps the leaf; otherwise qualify with the shortest distinct suffix.
        if (sources.length === 1 && !used.has(leaf)) {
            used.add(leaf);
            nameBySource.set(sources[0], leaf);
            continue;
        }
        const names = minimalDistinctSuffixNames(
            sources.map(source => partsBySource.get(source)),
            undefined,
            used,
        );
        sources.forEach((source, i) => {
            const name = names[i];
            if (!name) return;
            used.add(name);
            nameBySource.set(source, name);
        });
    }

    const renames = new Map<string, string>();
    for (const entry of entries) {
        const name = nameBySource.get(entry.source);
        if (name) renames.set(`${entry.accountIndex}#${entry.valueIndex}`, name);
    }

    return lowered.map(({ node }, accountIndex) => {
        const dv = node.defaultValue;
        if (!isNode(dv, 'pdaValueNode') || !isNode(dv.pda, 'pdaNode')) return node;
        let changed = false;
        const seeds = dv.seeds.map((seedValue, valueIndex) => {
            const name = renames.get(`${accountIndex}#${valueIndex}`);
            const inner = seedValue.value;
            if (!name || !isNode(inner, 'argumentValueNode') || name === inner.name) return seedValue;
            changed = true;
            return pdaSeedValueNode(seedValue.name, argumentValueNode(name, inner.path));
        });
        if (!changed) return node;
        return instructionAccountNode({ ...node, defaultValue: pdaValueNode(dv.pda, seeds, dv.programId) });
    });
}

// camelCased source-path parts of each non-const PDA seed, aligned with pdaValueNode `seeds`.
// First segment is resolved against Anchor scoping so sibling groups with a local `pool`
// produce distinct sources (tokenSide.pool vs quoteSide.pool).
function pdaSeedSourcePaths(
    account: IdlV01InstructionAccount,
    groups: readonly string[],
    scopes: ReadonlyMap<string, ReadonlySet<string>>,
): (string[] | undefined)[] | undefined {
    if (!account.pda) return undefined;
    return account.pda.seeds
        .filter(seed => seed.kind !== 'const')
        .map(seed => {
            if (seed.kind !== 'account' && seed.kind !== 'arg') return undefined;
            const pathParts = seed.path.split('.');
            const scopePrefix = seed.kind === 'account' ? resolveAccountScope(pathParts[0], groups, scopes) : [];
            return [...scopePrefix, ...pathParts].map(camelCase);
        });
}

function resolveAccountScope(
    accountName: string,
    groups: readonly string[],
    scopes: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
    for (let depth = groups.length; depth >= 0; depth--) {
        const key = groups.slice(0, depth).join('.');
        if (scopes.get(key)?.has(accountName)) {
            return groups.slice(0, depth);
        }
    }
    return [];
}

// Dotted group-path -> accounts defined directly in that scope; empty key = top level.
function collectScopes(items: IdlV01InstructionAccountItem[]): ReadonlyMap<string, ReadonlySet<string>> {
    const scopes = new Map<string, Set<string>>();
    const walk = (entries: IdlV01InstructionAccountItem[], groups: string[]) => {
        const key = groups.join('.');
        const bucket = scopes.get(key) ?? new Set<string>();
        scopes.set(key, bucket);
        for (const item of entries) {
            if ('accounts' in item) walk(item.accounts, [...groups, item.name]);
            else bucket.add(item.name);
        }
    };
    walk(items, []);
    return scopes;
}
