import { logWarn } from '@codama/errors';
import {
    AccountValueNode,
    ArgumentValueNode,
    argumentValueNode,
    camelCase,
    InstructionAccountNode,
    instructionAccountNode,
    InstructionArgumentNode,
    isNode,
    pdaNode,
    PdaSeedNode,
    PdaSeedValueNode,
    pdaSeedValueNode,
    PdaValueNode,
    pdaValueNode,
    PublicKeyValueNode,
    publicKeyValueNode,
    variablePdaSeedNode,
} from '@codama/nodes';

import { IdlV01InstructionAccount, IdlV01InstructionAccountItem, IdlV01Pda, IdlV01Seed, IdlV01TypeDef } from './idl';
import { pdaSeedNodeFromAnchorV01, seedSuffixName } from './PdaSeedNode';
import type { GenericsV01 } from './unwrapGenerics';

function hasDuplicateAccountNames(idl: IdlV01InstructionAccountItem[]): boolean {
    const seenNames = new Set<string>();

    function checkDuplicates(items: IdlV01InstructionAccountItem[]): boolean {
        for (const item of items) {
            if ('accounts' in item) {
                if (checkDuplicates(item.accounts)) {
                    return true;
                }
            } else {
                const name = camelCase(item.name ?? '');
                if (seenNames.has(name)) {
                    return true;
                }
                seenNames.add(name);
            }
        }
        return false;
    }

    return checkDuplicates(idl);
}

export type LoweredInstructionAccountV01 = {
    account: IdlV01InstructionAccount;
    groups: readonly string[];
    node: InstructionAccountNode;
};

// Depth-first lowering that keeps each node paired with its source IDL leaf and the chain of
// containing group names, so downstream passes never re-flatten the tree to recover that link.
export function lowerInstructionAccountsV01(
    idl: IdlV01InstructionAccountItem[],
    instructionArguments: InstructionArgumentNode[],
    prefix?: string,
    idlTypes: IdlV01TypeDef[] = [],
    generics: GenericsV01 = { constArgs: {}, typeArgs: {}, types: {} },
    groups: readonly string[] = [],
): LoweredInstructionAccountV01[] {
    const shouldPrefix = prefix !== undefined || hasDuplicateAccountNames(idl);

    return idl.flatMap(account =>
        'accounts' in account
            ? lowerInstructionAccountsV01(
                  account.accounts,
                  instructionArguments,
                  shouldPrefix ? (prefix ? `${prefix}_${account.name}` : account.name) : undefined,
                  idlTypes,
                  generics,
                  [...groups, account.name],
              )
            : [
                  {
                      account,
                      groups,
                      node: instructionAccountNodeFromAnchorV01(
                          account,
                          instructionArguments,
                          shouldPrefix ? prefix : undefined,
                          idlTypes,
                          generics,
                      ),
                  },
              ],
    );
}

export function instructionAccountNodesFromAnchorV01(
    idl: IdlV01InstructionAccountItem[],
    instructionArguments: InstructionArgumentNode[],
    prefix?: string,
    idlTypes: IdlV01TypeDef[] = [],
    generics: GenericsV01 = { constArgs: {}, typeArgs: {}, types: {} },
): InstructionAccountNode[] {
    return lowerInstructionAccountsV01(idl, instructionArguments, prefix, idlTypes, generics).map(l => l.node);
}

export function instructionAccountNodeFromAnchorV01(
    idl: IdlV01InstructionAccount,
    instructionArguments: InstructionArgumentNode[],
    prefix?: string,
    idlTypes: IdlV01TypeDef[] = [],
    generics: GenericsV01 = { constArgs: {}, typeArgs: {}, types: {} },
): InstructionAccountNode {
    const isOptional = idl.optional ?? false;
    const docs = idl.docs ?? [];
    const isSigner = idl.signer ?? false;
    const isWritable = idl.writable ?? false;
    const name = prefix ? `${prefix}_${idl.name ?? ''}` : (idl.name ?? '');
    let defaultValue: PdaValueNode | PublicKeyValueNode | undefined;
    if (idl.address) {
        defaultValue = publicKeyValueNode(idl.address, name);
    } else if (idl.pda) {
        defaultValue = resolvePdaDefaultValue(idl.pda, name, instructionArguments, prefix, idlTypes, generics);
    }

    return instructionAccountNode({
        defaultValue,
        docs,
        isOptional,
        isSigner,
        isWritable,
        name,
    });
}

function resolvePdaDefaultValue(
    pda: IdlV01Pda,
    name: string,
    instructionArguments: InstructionArgumentNode[],
    prefix: string | undefined,
    idlTypes: IdlV01TypeDef[],
    generics: GenericsV01,
): PdaValueNode | undefined {
    // `seeds::program` -> const lowers to pdaNode.programId; account/arg ref lowers to
    // pdaValueNode.programId for runtime resolution. Unresolvable refs drop the defaultValue.
    let programId: string | undefined;
    let runtimeProgramRef: AccountValueNode | ArgumentValueNode | undefined;
    if (pda.program) {
        const resolved = resolveProgramRef(pda.program, instructionArguments, prefix, idlTypes, generics);
        if (!resolved) {
            logWarn(`Skipping PDA for account "${name}": program seed could not be resolved.`);
            return undefined;
        }
        programId = resolved.programId;
        runtimeProgramRef = resolved.runtimeProgramRef;
    }

    const seeds = resolveSeeds(pda.seeds, instructionArguments, prefix, idlTypes, generics);
    if (!seeds) return undefined;

    // Only bare-address self-seeds are circular; data-field self-seeds lower to caller inputs.
    const camelName = camelCase(name);
    const isSelfReferential = seeds.values.some(
        sv => isNode(sv.value, 'accountValueNode') && sv.value.name === camelName,
    );
    if (isSelfReferential) {
        logWarn(`Skipping PDA for account "${name}": a seed references the account itself.`);
        return undefined;
    }

    return pdaValueNode(pdaNode({ name, programId, seeds: seeds.definitions }), seeds.values, runtimeProgramRef);
}

function resolveProgramRef(
    program: IdlV01Seed,
    instructionArguments: InstructionArgumentNode[],
    prefix: string | undefined,
    idlTypes: IdlV01TypeDef[],
    generics: GenericsV01,
): { programId?: string; runtimeProgramRef?: AccountValueNode | ArgumentValueNode } | undefined {
    const result = pdaSeedNodeFromAnchorV01(program, instructionArguments, prefix, idlTypes, generics);
    if (!result) return undefined;

    if (
        isNode(result.definition, 'constantPdaSeedNode') &&
        isNode(result.definition.value, 'bytesValueNode') &&
        result.definition.value.encoding === 'base58'
    ) {
        return { programId: result.definition.value.data };
    }

    if (result.value && isNode(result.value.value, ['accountValueNode', 'argumentValueNode'])) {
        return { runtimeProgramRef: result.value.value };
    }

    return undefined;
}

type LoweredSeed = Readonly<{ definition: PdaSeedNode; value?: PdaSeedValueNode }>;

function resolveSeeds(
    seeds: IdlV01Seed[],
    instructionArguments: InstructionArgumentNode[],
    prefix: string | undefined,
    idlTypes: IdlV01TypeDef[],
    generics: GenericsV01,
): { definitions: PdaSeedNode[]; values: PdaSeedValueNode[] } | undefined {
    const results = seeds.map(seed => pdaSeedNodeFromAnchorV01(seed, instructionArguments, prefix, idlTypes, generics));
    if (!results.every((r): r is NonNullable<typeof r> => r != null)) {
        return undefined;
    }

    const deconflicted = deconflictSeedNames(results, seeds, prefix);
    return {
        definitions: deconflicted.map(r => r.definition),
        values: deconflicted.flatMap(r => (r.value ? [r.value] : [])),
    };
}

// Seeds resolve by name, so siblings sharing a leaf (pool.mint + quote.mint -> `mint`)
// collapse onto one input. Qualify colliders with the shortest trailing path that disambiguates.
function deconflictSeedNames(results: LoweredSeed[], seeds: IdlV01Seed[], prefix: string | undefined): LoweredSeed[] {
    const indicesByName = new Map<string, number[]>();
    results.forEach((r, i) => {
        if (isNode(r.definition, 'variablePdaSeedNode')) {
            const indices = indicesByName.get(r.definition.name) ?? [];
            indices.push(i);
            indicesByName.set(r.definition.name, indices);
        }
    });

    // Renames must not collide with a sibling's name: seed.name-keyed type lookups
    // downstream assume one type per name. Reserve singletons first, then each group's picks.
    const reserved = new Set<string>();
    for (const [name, indices] of indicesByName) {
        if (indices.length === 1) reserved.add(name);
    }

    const renames = new Map<number, string>();
    for (const indices of indicesByName.values()) {
        if (indices.length <= 1) continue;
        const names = minimalDistinctSuffixNames(
            indices.map(i => seedPathParts(seeds[i])),
            prefix,
            reserved,
        );
        indices.forEach((i, k) => {
            const name = names[k];
            const def = results[i].definition;
            if (name && isNode(def, 'variablePdaSeedNode') && name !== def.name) renames.set(i, name);
        });
        for (const name of names) if (name) reserved.add(name);
    }

    return results.map((r, i) => {
        const name = renames.get(i);
        return name ? renameSeed(r, name) : r;
    });
}

// Shortest camelCased trailing-segment names that are distinct and absent from `reserved`.
// Paths with no dotted source yield undefined (caller keeps the leaf).
export function minimalDistinctSuffixNames(
    paths: (readonly string[] | undefined)[],
    prefix: string | undefined,
    reserved: ReadonlySet<string> = new Set(),
): (string | undefined)[] {
    const maxLen = Math.max(0, ...paths.map(p => p?.length ?? 0));
    for (let k = 1; k <= maxLen; k++) {
        const names = paths.map(p => (p ? seedSuffixName(p, k, prefix) : undefined));
        const resolved = names.filter((n): n is string => n !== undefined);
        const distinct = new Set(resolved).size === resolved.length;
        if (distinct && resolved.every(n => !reserved.has(n))) return names;
    }
    // No suffix length is fully distinct and free of `reserved`; append counters to the longest suffix.
    const used = new Set(reserved);
    return paths.map(p => {
        if (!p) return undefined;
        const base = seedSuffixName(p, maxLen, prefix);
        let name = base;
        for (let n = 2; used.has(name); n++) name = `${base}${n}`;
        used.add(name);
        return name;
    });
}

function seedPathParts(seed: IdlV01Seed): string[] | undefined {
    if (seed.kind !== 'account' && seed.kind !== 'arg') return undefined;
    return seed.path.split('.');
}

function renameSeed(result: LoweredSeed, newName: string): LoweredSeed {
    const def = result.definition;
    if (!isNode(def, 'variablePdaSeedNode')) return result;
    const definition = variablePdaSeedNode(newName, def.type);
    if (!result.value) return { definition };

    // Bare-account values point at real account names and stay as-is. Arg values under #992:
    //  - path-bearing (nested root-arg reference): `name` IS the real root argument the resolver
    //    looks up, so it must NOT be renamed; only the outer seed identity is disambiguated.
    //  - path-less (synthesized account-data-field input): `name` is the input name itself, so it
    //    is renamed to stay paired with the collected extraArgument.
    const inner = result.value.value;
    const renamedInner =
        isNode(inner, 'argumentValueNode') && !(inner.path && inner.path.length > 0)
            ? argumentValueNode(newName, inner.path)
            : inner;
    return { definition, value: pdaSeedValueNode(newName, renamedInner) };
}
