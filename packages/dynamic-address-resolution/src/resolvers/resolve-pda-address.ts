import {
    CODAMA_ERROR__DYNAMIC_CLIENT__INVARIANT_VIOLATION,
    CODAMA_ERROR__DYNAMIC_CLIENT__NODE_REFERENCE_NOT_FOUND,
    CODAMA_ERROR__LINKED_NODE_NOT_FOUND,
    CODAMA_ERROR__UNEXPECTED_NODE_KIND,
    CODAMA_ERROR__UNRECOGNIZED_NODE_KIND,
    CodamaError,
} from '@codama/errors';
import type { Address, ProgramDerivedAddress } from '@solana/addresses';
import { address, getProgramDerivedAddress } from '@solana/addresses';
import type { ReadonlyUint8Array } from '@solana/codecs';
import type { Node, PdaNode, PdaSeedValueNode, PdaValueNode, RegisteredPdaSeedNode, VariablePdaSeedNode } from 'codama';
import { isNode, visitOrElse } from 'codama';

import type { AccountsInput, ArgumentsInput, ResolverFnInput, ResolversInput } from '../shared/types';
import { getMaybeNodeKind } from '../shared/util';
import { createPdaSeedValueVisitor, PDA_SEED_VALUE_SUPPORTED_NODE_KINDS } from '../visitors/pda-seed-value';
import { tryResolveArgumentPathValue } from '../visitors/resolve-argument-path';
import { resolveAccountValueNodeAddress } from './resolve-account-value-node-address';
import type { BaseResolutionContext } from './types';

export type ResolvePDAAddressContext<
    TAccounts extends AccountsInput = AccountsInput,
    TArgs extends ArgumentsInput = ArgumentsInput,
    TResolvers extends ResolverFnInput = ResolversInput,
> = BaseResolutionContext<TAccounts, TArgs, TResolvers> & {
    pdaValueNode: PdaValueNode;
};

/**
 * Derives a PDA from a PdaValueNode.
 * Encodes each seed (ConstantPdaSeedNode and VariablePdaSeedNode) into bytes and computes the address.
 */
export async function resolvePDAAddress<
    TAccounts extends AccountsInput = AccountsInput,
    TArgs extends ArgumentsInput = ArgumentsInput,
    TResolvers extends ResolverFnInput = ResolversInput,
>({
    root,
    ixNode,
    argumentsInput,
    accountsInput,
    pdaValueNode,
    resolutionPath,
    resolversInput,
}: ResolvePDAAddressContext<TAccounts, TArgs, TResolvers>): Promise<ProgramDerivedAddress | null> {
    if (!isNode(pdaValueNode, 'pdaValueNode')) {
        throw new CodamaError(CODAMA_ERROR__UNEXPECTED_NODE_KIND, {
            expectedKinds: ['pdaValueNode'],
            kind: getMaybeNodeKind(pdaValueNode),
            node: pdaValueNode,
        });
    }

    const pdaNode = resolvePdaNode(pdaValueNode, root.program.pdas);
    // Priority: dynamic programId (cross-program PDA) > pdaNode constant > local program.
    const runtimeProgramId = await resolveRuntimeProgramId(
        pdaValueNode.programId,
        ixNode,
        accountsInput,
        argumentsInput,
        root,
        resolutionPath,
        resolversInput,
    );
    const programId = address(runtimeProgramId ?? pdaNode.programId ?? root.program.publicKey);

    // Pair variable seeds to values by name; duplicate-named seeds are consumed in order.
    const valuesByName = new Map<string, PdaSeedValueNode[]>();
    for (const seedValue of pdaValueNode.seeds) {
        const bucket = valuesByName.get(seedValue.name);
        if (bucket) bucket.push(seedValue);
        else valuesByName.set(seedValue.name, [seedValue]);
    }
    const pairedSeedValues = pdaNode.seeds.map(seedNode =>
        seedNode.kind === 'variablePdaSeedNode' ? valuesByName.get(seedNode.name)?.shift() : undefined,
    );

    const seedValues = await Promise.all(
        pdaNode.seeds.map(async (seedNode, index) => {
            if (seedNode.kind === 'constantPdaSeedNode') {
                return await resolveConstantPdaSeed({
                    accountsInput,
                    argumentsInput,
                    ixNode,
                    programId,
                    resolutionPath,
                    resolversInput,
                    root,
                    seedNode,
                });
            }

            if (seedNode.kind === 'variablePdaSeedNode') {
                const variableSeedValueNode = pairedSeedValues[index];

                if (!variableSeedValueNode) {
                    // Drained bucket = value count mismatch; missing bucket = no reference.
                    if (valuesByName.has(seedNode.name)) {
                        throw new CodamaError(CODAMA_ERROR__DYNAMIC_CLIENT__INVARIANT_VIOLATION, {
                            message: `PDA seed "${seedNode.name}" at position ${index} of [${ixNode.name}] had no supplied value; duplicate-named seeds exhausted the bucket.`,
                        });
                    }
                    throw new CodamaError(CODAMA_ERROR__DYNAMIC_CLIENT__NODE_REFERENCE_NOT_FOUND, {
                        instructionName: ixNode.name,
                        referencedName: seedNode.name,
                    });
                }

                return await resolveVariablePdaSeed({
                    accountsInput,
                    argumentsInput,
                    ixNode,
                    programId,
                    resolutionPath,
                    resolversInput,
                    root,
                    seedNode,
                    variableSeedValueNode,
                });
            }

            throw new CodamaError(CODAMA_ERROR__UNRECOGNIZED_NODE_KIND, {
                kind: getMaybeNodeKind(seedNode) ?? 'unknown',
            });
        }),
    );

    return await getProgramDerivedAddress({
        programAddress: programId,
        seeds: seedValues,
    });
}

function resolvePdaNode(pdaDefaultValue: PdaValueNode, pdas: PdaNode[]): PdaNode {
    if (isNode(pdaDefaultValue.pda, 'pdaLinkNode')) {
        const linkedPda = pdas.find(p => p.name === pdaDefaultValue.pda.name);
        if (!linkedPda) {
            throw new CodamaError(CODAMA_ERROR__LINKED_NODE_NOT_FOUND, {
                kind: 'pdaLinkNode',
                linkNode: pdaDefaultValue.pda,
                name: pdaDefaultValue.pda.name,
                path: [],
            });
        }
        return linkedPda;
    }

    if (isNode(pdaDefaultValue.pda, 'pdaNode')) {
        return pdaDefaultValue.pda;
    }

    throw new CodamaError(CODAMA_ERROR__UNEXPECTED_NODE_KIND, {
        expectedKinds: ['pdaLinkNode', 'pdaNode'],
        kind: getMaybeNodeKind(pdaDefaultValue.pda),
        node: pdaDefaultValue.pda,
    });
}

type ResolvePdaSeedContext<
    TAccounts extends AccountsInput = AccountsInput,
    TArgs extends ArgumentsInput = ArgumentsInput,
    TResolvers extends ResolverFnInput = ResolversInput,
> = BaseResolutionContext<TAccounts, TArgs, TResolvers> & {
    programId: Address;
    seedNode: VariablePdaSeedNode;
    variableSeedValueNode: PdaSeedValueNode;
};
function resolveVariablePdaSeed<
    TAccounts extends AccountsInput = AccountsInput,
    TArgs extends ArgumentsInput = ArgumentsInput,
    TResolvers extends ResolverFnInput = ResolversInput,
>({
    accountsInput,
    argumentsInput,
    ixNode,
    programId,
    resolutionPath,
    resolversInput,
    root,
    seedNode,
    variableSeedValueNode,
}: ResolvePdaSeedContext<TAccounts, TArgs, TResolvers>): Promise<ReadonlyUint8Array> {
    if (!isNode(variableSeedValueNode, 'pdaSeedValueNode')) {
        throw new CodamaError(CODAMA_ERROR__UNEXPECTED_NODE_KIND, {
            expectedKinds: ['pdaSeedValueNode'],
            kind: getMaybeNodeKind(variableSeedValueNode),
            node: variableSeedValueNode as Node,
        });
    }

    const visitor = createPdaSeedValueVisitor({
        accountsInput,
        argumentsInput,
        ixNode,
        programId,
        resolutionPath,
        resolversInput,
        root,
        seedTypeNode: seedNode.type,
    });

    return visitOrElse(variableSeedValueNode.value, visitor, node => {
        throw new CodamaError(CODAMA_ERROR__UNEXPECTED_NODE_KIND, {
            expectedKinds: [...PDA_SEED_VALUE_SUPPORTED_NODE_KINDS],
            kind: node.kind,
            node,
        });
    });
}

type ResolveConstantPdaSeedContext<
    TAccounts extends AccountsInput = AccountsInput,
    TArgs extends ArgumentsInput = ArgumentsInput,
    TResolvers extends ResolverFnInput = ResolversInput,
> = BaseResolutionContext<TAccounts, TArgs, TResolvers> & {
    programId: Address;
    seedNode: RegisteredPdaSeedNode;
};
function resolveConstantPdaSeed<
    TAccounts extends AccountsInput = AccountsInput,
    TArgs extends ArgumentsInput = ArgumentsInput,
    TResolvers extends ResolverFnInput = ResolversInput,
>({
    accountsInput,
    argumentsInput,
    ixNode,
    programId,
    resolutionPath,
    resolversInput,
    root,
    seedNode,
}: ResolveConstantPdaSeedContext<TAccounts, TArgs, TResolvers>): Promise<ReadonlyUint8Array> {
    if (!isNode(seedNode, 'constantPdaSeedNode')) {
        throw new CodamaError(CODAMA_ERROR__UNEXPECTED_NODE_KIND, {
            expectedKinds: ['constantPdaSeedNode'],
            kind: seedNode.kind,
            node: seedNode,
        });
    }

    const visitor = createPdaSeedValueVisitor({
        accountsInput,
        argumentsInput,
        ixNode,
        programId,
        resolutionPath,
        resolversInput,
        root,
        seedTypeNode: seedNode.type,
    });
    return visitOrElse(seedNode.value, visitor, node => {
        throw new CodamaError(CODAMA_ERROR__UNEXPECTED_NODE_KIND, {
            expectedKinds: [...PDA_SEED_VALUE_SUPPORTED_NODE_KINDS],
            kind: node.kind,
            node,
        });
    });
}

async function resolveRuntimeProgramId(
    programIdRef: PdaValueNode['programId'],
    ixNode: ResolvePDAAddressContext['ixNode'],
    accountsInput: ResolvePDAAddressContext['accountsInput'],
    argumentsInput: ResolvePDAAddressContext['argumentsInput'],
    root: ResolvePDAAddressContext['root'],
    resolutionPath: ResolvePDAAddressContext['resolutionPath'],
    resolversInput: ResolvePDAAddressContext['resolversInput'],
): Promise<string | undefined> {
    if (!programIdRef) return undefined;
    if (isNode(programIdRef, 'accountValueNode')) {
        const resolved = await resolveAccountValueNodeAddress(programIdRef, {
            accountsInput: accountsInput ?? {},
            argumentsInput: argumentsInput ?? {},
            ixNode,
            resolutionPath,
            resolversInput,
            root,
        });
        return resolved ?? undefined;
    }
    if (isNode(programIdRef, 'argumentValueNode')) {
        const rootArg = argumentsInput?.[programIdRef.name];
        // The dynamic programId is an optional override; an unresolved arg falls back to the pdaNode
        // constant / local program (see the caller's `?? pdaNode.programId ?? ...`). Resolve leniently
        // so a missing nested arg returns undefined instead of aborting derivation.
        const value =
            programIdRef.path && programIdRef.path.length > 0
                ? tryResolveArgumentPathValue(rootArg, programIdRef.path)
                : rootArg;
        return typeof value === 'string' ? value : undefined;
    }
    return undefined;
}
