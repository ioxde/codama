import { isNode, type PdaNode, type RootNode } from 'codama';

export type CollectedPdaNode = {
    /** The winning definition when the same name is defined more than once. */
    pdaNode: PdaNode;
    /** True when the PDA cannot be derived without a caller-supplied program address. */
    requiresProgramAddress: boolean;
};

function variableSeedCount(pda: PdaNode): number {
    return (pda.seeds ?? []).filter(seed => isNode(seed, 'variablePdaSeedNode')).length;
}

/**
 * ioxde fork: keyed by PDA name; the definition with the most variable seeds wins — it can derive the
 * variants that baked a seed in as a constant. Ties keep the first seen, so an inline duplicate never
 * displaces an equally-specific `program.pdas` entry.
 */
export function collectPdaNodeDetailsFromIdl(idl: RootNode): Map<string, CollectedPdaNode> {
    const pdas = new Map<string, CollectedPdaNode>();

    for (const pda of idl.program.pdas ?? []) {
        pdas.set(pda.name, { pdaNode: pda, requiresProgramAddress: false });
    }

    // ioxde fork: recorded before the `pdaNode` guard below so `pdaLinkNode` references count too.
    const runtimeRefs = new Set<string>();
    for (const ix of idl.program.instructions ?? []) {
        for (const acc of ix.accounts ?? []) {
            if (!acc.defaultValue || !isNode(acc.defaultValue, 'pdaValueNode')) continue;
            const pdaRef = acc.defaultValue.pda;
            if (acc.defaultValue.programId !== undefined) runtimeRefs.add(pdaRef.name);

            if (!isNode(pdaRef, 'pdaNode')) continue;
            const entry = pdas.get(pdaRef.name);
            if (!entry) {
                pdas.set(pdaRef.name, { pdaNode: pdaRef, requiresProgramAddress: false });
            } else if (variableSeedCount(pdaRef) > variableSeedCount(entry.pdaNode)) {
                entry.pdaNode = pdaRef;
            }
        }
    }

    // ioxde fork: second pass — the flag must reflect the winning definition, not the use-site.
    for (const [name, entry] of pdas) {
        entry.requiresProgramAddress = runtimeRefs.has(name) && !entry.pdaNode.programId;
    }

    return pdas;
}

/** Definition-only projection of {@link collectPdaNodeDetailsFromIdl}, preserving its discovery order. */
export function collectPdaNodesFromIdl(idl: RootNode): Map<string, PdaNode> {
    const details = collectPdaNodeDetailsFromIdl(idl);
    return new Map([...details].map(([name, entry]) => [name, entry.pdaNode]));
}
