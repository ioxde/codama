import { pascalCase, type PdaNode, type RootNode, type VariablePdaSeedNode } from 'codama';

import { codamaTypeToTS } from './codama-type-to-ts';
import { type CollectedPdaNode, collectPdaNodeDetailsFromIdl } from './collect-pda-nodes';

export type GeneratePdaTypesOptions = {
    /**
     * ioxde fork: adds a required `config: { programAddress: Address }` to PDAs whose program ID is only
     * known at runtime, so callers cannot silently derive under the wrong program. The emitting file must
     * import `Address` from `@solana/addresses`.
     */
    emitProgramAddressConfig?: boolean;
};

/**
 * Generate `${Pda}PdaSeeds` types and the aggregate `${Program}Pdas` map type.
 */
export function generatePdaTypes(
    idl: RootNode,
    options: GeneratePdaTypesOptions = {},
): { mapTypeName: string | null; typeBlock: string } {
    const programName = pascalCase(idl.program.name);
    const definedTypes = idl.program.definedTypes ?? [];
    const pdaMap = collectPdaNodeDetailsFromIdl(idl);

    if (pdaMap.size === 0) {
        return { mapTypeName: null, typeBlock: '' };
    }

    let output = '';

    for (const [pdaName, { pdaNode }] of pdaMap) {
        const variableSeeds = getVariableSeedNodes(pdaNode);
        if (variableSeeds.length === 0) continue;
        const typeName = pascalCase(pdaName);
        output += `export type ${typeName}PdaSeeds = {\n`;
        for (const seed of variableSeeds) {
            const tsType = seed.type
                ? codamaTypeToTS(seed.type, definedTypes)
                : 'unknown/** missing type in variablePdaSeedNode */';
            output += `    ${seed.name}: ${tsType};\n`;
        }
        output += '};\n\n';
    }

    const mapTypeName = `${programName}Pdas`;
    output += `/**\n * Strongly-typed PDAs for ${programName}.\n */\n`;
    output += `export type ${mapTypeName} = {\n`;
    for (const [pdaName, entry] of pdaMap) {
        const typeName = pascalCase(pdaName);
        const seedsParam =
            getVariableSeedNodes(entry.pdaNode).length > 0
                ? `seeds: ${typeName}PdaSeeds`
                : `seeds?: Record<string, unknown>`;
        output += `    ${pdaName}: (${seedsParam}${getConfigParam(entry, options)}) => Promise<ProgramDerivedAddress>;\n`;
    }
    output += '};\n\n';

    return { mapTypeName, typeBlock: output };
}

function getConfigParam(entry: CollectedPdaNode, options: GeneratePdaTypesOptions): string {
    return options.emitProgramAddressConfig && entry.requiresProgramAddress
        ? `, config: { programAddress: Address }`
        : '';
}

function getVariableSeedNodes(pdaNode: PdaNode): VariablePdaSeedNode[] {
    return (pdaNode.seeds ?? []).filter(s => s.kind === 'variablePdaSeedNode');
}
