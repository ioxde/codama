import { isNode, type PdaNode, type RootNode } from 'codama';

// Instructions can inline the same PDA with different seed shapes. Keep the definition with
// the most variable seeds: it can also derive the variants that baked a seed as a constant.
function variableSeedCount(pda: PdaNode): number {
    return pda.seeds.filter(seed => isNode(seed, 'variablePdaSeedNode')).length;
}

export type CollectedPdaNode = {
    pdaNode: PdaNode;
    // True when the programId is only known at runtime, so standalone callers
    // must pass `programAddress`.
    requiresProgramAddress: boolean;
};

/**
 * Collects unique PDA definitions from the IDL.
 *
 * Scans both `root.program.pdas` (registered PDAs) and inline
 * `pdaValueNode > pdaNode` definitions inside instruction account
 * `defaultValue` nodes. Deduplicates by PDA name.
 */
export function collectPdaNodes(root: RootNode): Map<string, CollectedPdaNode> {
    const pdas = new Map<string, CollectedPdaNode>();

    for (const pda of root.program.pdas) {
        pdas.set(pda.name, { pdaNode: pda, requiresProgramAddress: false });
    }

    const runtimeRefs = new Set<string>();
    for (const ix of root.program.instructions) {
        for (const acc of ix.accounts) {
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

    // Computed after the merge so the flag is based on the final definition: a pinned
    // programId makes the PDA derivable without a caller-supplied address.
    for (const [name, entry] of pdas) {
        entry.requiresProgramAddress = runtimeRefs.has(name) && !entry.pdaNode.programId;
    }

    return pdas;
}
