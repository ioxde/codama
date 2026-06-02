import { isNode, type PdaNode, type RootNode } from 'codama';

export type CollectedPdaNode = {
    pdaNode: PdaNode;
    // Set when this PDA has a dynamic programId; standalone callers must supply `programAddress`.
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

    for (const ix of root.program.instructions) {
        for (const acc of ix.accounts) {
            if (!acc.defaultValue || !isNode(acc.defaultValue, 'pdaValueNode')) continue;
            const pdaRef = acc.defaultValue.pda;
            const runtime = acc.defaultValue.programId !== undefined;

            if (isNode(pdaRef, 'pdaNode')) {
                const entry = pdas.get(pdaRef.name);
                if (!entry) {
                    pdas.set(pdaRef.name, { pdaNode: pdaRef, requiresProgramAddress: runtime });
                } else if (runtime) {
                    entry.requiresProgramAddress = true;
                }
            } else if (isNode(pdaRef, 'pdaLinkNode') && runtime) {
                const entry = pdas.get(pdaRef.name);
                if (entry) entry.requiresProgramAddress = true;
            }
        }
    }

    return pdas;
}
