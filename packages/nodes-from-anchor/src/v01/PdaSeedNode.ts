import {
    CODAMA_ERROR__ANCHOR__ARGUMENT_TYPE_MISSING,
    CODAMA_ERROR__ANCHOR__SEED_KIND_UNIMPLEMENTED,
    CodamaError,
    logWarn,
} from '@codama/errors';
import {
    accountValueNode,
    argumentValueNode,
    bytesTypeNode,
    camelCase,
    constantPdaSeedNodeFromBytes,
    InstructionArgumentNode,
    isNode,
    PdaSeedNode,
    PdaSeedValueNode,
    pdaSeedValueNode,
    publicKeyTypeNode,
    TypeNode,
    variablePdaSeedNode,
} from '@codama/nodes';
import { getBase58Codec } from '@solana/codecs';

import { IdlV01Seed, IdlV01TypeDef } from './idl';
import { typeNodeFromAnchorV01 } from './typeNodes';
import type { GenericsV01 } from './unwrapGenerics';

export function pdaSeedNodeFromAnchorV01(
    seed: IdlV01Seed,
    instructionArguments: InstructionArgumentNode[],
    prefix?: string,
    idlTypes: IdlV01TypeDef[] = [],
    generics: GenericsV01 = { constArgs: {}, typeArgs: {}, types: {} },
): Readonly<{ definition: PdaSeedNode; value?: PdaSeedValueNode }> | undefined {
    const kind = seed.kind;

    switch (kind) {
        case 'const':
            return {
                definition: constantPdaSeedNodeFromBytes('base58', getBase58Codec().decode(new Uint8Array(seed.value))),
            };
        case 'account': {
            const pathParts = seed.path.split('.');
            const [accountName] = pathParts;
            const prefixedAccountName = prefix ? `${prefix}_${accountName}` : accountName;

            if (pathParts.length > 1) {
                // Dotted paths read on-chain data the client can't fetch during derivation;
                // lower to a caller-supplied argumentValueNode with the type at the leaf.
                const accountTypeName = seed.account ?? accountName;
                const rootType = typeNodeFromAnchorV01({ defined: { name: accountTypeName } }, generics);
                const resolved = resolveNestedFieldType(rootType, pathParts.slice(1), idlTypes, generics);
                if (!resolved) {
                    logWarn(`Could not resolve nested account path "${seed.path}" for PDA seed.`);
                    return undefined;
                }
                const seedType = stripBorshLengthPrefix(resolved);
                const seedName = seedLeafName(pathParts, prefix);
                return {
                    definition: variablePdaSeedNode(seedName, seedType),
                    value: pdaSeedValueNode(seedName, argumentValueNode(seedName)),
                };
            }

            return {
                definition: variablePdaSeedNode(prefixedAccountName, publicKeyTypeNode()),
                value: pdaSeedValueNode(prefixedAccountName, accountValueNode(prefixedAccountName)),
            };
        }
        case 'arg': {
            const pathParts = seed.path.split('.');

            let argumentType: TypeNode;
            if (pathParts.length > 1) {
                const rootArgName = camelCase(pathParts[0]);
                const rootArgNode = instructionArguments.find(({ name }) => name === rootArgName);
                if (!rootArgNode) {
                    throw new CodamaError(CODAMA_ERROR__ANCHOR__ARGUMENT_TYPE_MISSING, { name: pathParts[0] });
                }
                const resolved = resolveNestedFieldType(rootArgNode.type, pathParts.slice(1), idlTypes, generics);
                if (!resolved) {
                    logWarn(`Could not resolve nested arg path "${seed.path}" for PDA seed.`);
                    return undefined;
                }
                argumentType = resolved;
            } else {
                const argumentName = camelCase(pathParts[0]);
                const argumentNode = instructionArguments.find(({ name }) => name === argumentName);
                if (!argumentNode) {
                    throw new CodamaError(CODAMA_ERROR__ANCHOR__ARGUMENT_TYPE_MISSING, { name: pathParts[0] });
                }
                argumentType = argumentNode.type;
            }

            // Anchor PDA seeds are unprefixed bytes (.as_ref()); strip any Borsh u32 length prefix.
            argumentType = stripBorshLengthPrefix(argumentType);

            // #992 convention: the argumentValueNode is keyed by the ROOT arg (pathParts[0]) and
            // carries the SUB-path (pathParts.slice(1)); the seed identity keeps its leaf-derived name.
            const seedName = seedLeafName(pathParts);
            const argValue =
                pathParts.length > 1
                    ? argumentValueNode(pathParts[0], pathParts.slice(1))
                    : argumentValueNode(seedName);
            return {
                definition: variablePdaSeedNode(seedName, argumentType),
                value: pdaSeedValueNode(seedName, argValue),
            };
        }
        default:
            throw new CodamaError(CODAMA_ERROR__ANCHOR__SEED_KIND_UNIMPLEMENTED, { kind });
    }
}

// Trailing-segment count to keep: at least `minLength`, widened past leading numeric segments so
// the name can't begin with a tuple index (x.0.0 -> 3, yielding `x00` rather than `00`).
function namedSuffixLength(parts: readonly string[], minLength: number): number {
    let length = Math.min(parts.length, Math.max(1, minLength));
    while (length < parts.length && /^\d+$/.test(parts[parts.length - length])) {
        length++;
    }
    return length;
}

// camelCased trailing segments of a seed path. `minLength` is the shortest suffix; callers raise
// it to disambiguate colliding seeds. `prefix`, when set, leads the name.
export function seedSuffixName(parts: readonly string[], minLength = 1, prefix?: string): string {
    const suffix = parts.slice(parts.length - namedSuffixLength(parts, minLength));
    return camelCase(prefix ? `${prefix}_${suffix.join('_')}` : suffix.join('_'));
}

// Shortest seed-path name: the leaf, widened only as far as a trailing tuple index requires.
export function seedLeafName(pathParts: readonly string[], prefix?: string): string {
    return seedSuffixName(pathParts, 1, prefix);
}

// Anchor PDA seeds are unprefixed bytes; drop the u32 length prefix Borsh adds to
// `bytes`/`string` and `Vec<u8>` or the derived address diverges.
function stripBorshLengthPrefix(type: TypeNode): TypeNode {
    if (
        isNode(type, 'sizePrefixTypeNode') &&
        isNode(type.prefix, 'numberTypeNode') &&
        type.prefix.format === 'u32' &&
        isNode(type.type, ['stringTypeNode', 'bytesTypeNode'])
    ) {
        return type.type;
    }
    if (
        isNode(type, 'arrayTypeNode') &&
        isNode(type.count, 'prefixedCountNode') &&
        isNode(type.count.prefix, 'numberTypeNode') &&
        type.count.prefix.format === 'u32' &&
        isNode(type.item, 'numberTypeNode') &&
        type.item.format === 'u8'
    ) {
        return bytesTypeNode();
    }
    return type;
}

function resolveNestedFieldType(
    parentType: TypeNode,
    pathParts: string[],
    idlTypes: IdlV01TypeDef[],
    generics: GenericsV01,
): TypeNode | undefined {
    let currentType: TypeNode | undefined = parentType;

    for (const fieldName of pathParts) {
        currentType = unwrapDefinedTypeLinks(currentType, idlTypes, generics);
        if (!currentType) return undefined;

        if (isNode(currentType, 'structTypeNode')) {
            const target = camelCase(fieldName);
            const field = currentType.fields.find(f => f.name === target);
            if (!field) return undefined;
            currentType = field.type;
            continue;
        }

        if (isNode(currentType, 'tupleTypeNode')) {
            const index = Number(fieldName);
            if (!Number.isInteger(index) || index < 0 || index >= currentType.items.length) return undefined;
            currentType = currentType.items[index];
            continue;
        }

        return undefined;
    }

    // Unwrap a trailing link so the returned leaf type matches the consumer's view.
    return unwrapDefinedTypeLinks(currentType, idlTypes, generics);
}

function unwrapDefinedTypeLinks(
    type: TypeNode,
    idlTypes: IdlV01TypeDef[],
    generics: GenericsV01,
): TypeNode | undefined {
    let current = type;
    const seen = new Set<string>();
    while (isNode(current, 'definedTypeLinkNode')) {
        const linkName = current.name;
        if (seen.has(linkName)) return undefined;
        seen.add(linkName);
        const typeDef = idlTypes.find(d => camelCase(d.name) === linkName);
        if (!typeDef) return undefined;
        current = typeNodeFromAnchorV01(typeDef.type, generics);
    }
    return current;
}
