import { logWarn } from '@codama/errors';
import {
    assertIsNode,
    camelCase,
    type CamelCaseString,
    instructionAccountNode,
    type InstructionNode,
    instructionNode,
    isNode,
    isNodeFilter,
    pdaLinkNode,
    type PdaNode,
    pdaNode,
    pdaSeedValueNode,
    type ProgramNode,
    programNode,
    variablePdaSeedNode,
} from '@codama/nodes';
import { bottomUpTransformerVisitor, getUniqueHashStringVisitor, visit, type Visitor } from '@codama/visitors';

type Fingerprint = string;

function pdaFingerprint(pda: PdaNode, hashVisitor: Visitor<string>): Fingerprint {
    // Normalize variable seed names to positional ids so byte-equivalent PDAs hash identically.
    const normalizedSeeds = pda.seeds.map((seed, index) =>
        isNode(seed, 'variablePdaSeedNode') ? variablePdaSeedNode(`seed${index}`, seed.type) : seed,
    );
    return visit(pdaNode({ ...pda, name: '', seeds: normalizedSeeds }), hashVisitor);
}

function getUniquePdaName(name: CamelCaseString, usedNames: Set<CamelCaseString>): CamelCaseString {
    if (!usedNames.has(name)) return name;
    let suffix = 2;
    let candidate = camelCase(`${name}${suffix}`);
    while (usedNames.has(candidate)) {
        suffix++;
        candidate = camelCase(`${name}${suffix}`);
    }
    return candidate;
}

export function extractPdasVisitor() {
    return bottomUpTransformerVisitor([
        {
            select: '[programNode]',
            transform: node => {
                assertIsNode(node, 'programNode');
                return extractPdasFromProgram(node);
            },
        },
    ]);
}

export function extractPdasFromProgram(program: ProgramNode): ProgramNode {
    const hashVisitor = getUniqueHashStringVisitor();
    const pdaMap = new Map<Fingerprint, PdaNode>();
    const usedNames = new Set<CamelCaseString>(program.pdas.map(p => p.name));
    const nameToFingerprint = new Map<CamelCaseString, Fingerprint>();

    const rewrittenInstructions = program.instructions.map(instruction => {
        const rewrittenAccounts = instruction.accounts.map(account => {
            if (
                !account.defaultValue ||
                !isNode(account.defaultValue, 'pdaValueNode') ||
                !isNode(account.defaultValue.pda, 'pdaNode')
            ) {
                return account;
            }

            const pda = account.defaultValue.pda;
            if (pda.programId && pda.programId !== program.publicKey) return account;

            const fingerprint = pdaFingerprint(pda, hashVisitor);

            if (!pdaMap.has(fingerprint)) {
                let resolvedName = pda.name;
                const existingFingerprint = nameToFingerprint.get(resolvedName);

                if (existingFingerprint !== undefined && existingFingerprint !== fingerprint) {
                    resolvedName = camelCase(`${instruction.name}_${pda.name}`);
                    logWarn(
                        `PDA name collision: "${pda.name}" has different seeds across instructions. ` +
                            `Renaming to "${resolvedName}".`,
                    );
                }

                resolvedName = getUniquePdaName(resolvedName, usedNames);

                usedNames.add(resolvedName);
                nameToFingerprint.set(resolvedName, fingerprint);
                pdaMap.set(fingerprint, pdaNode({ ...pda, name: resolvedName }));
            }

            const extractedPda = pdaMap.get(fingerprint)!;

            // Rewrite seed value labels to match the canonical PDA's variable seed names.
            const canonicalSeedNames = extractedPda.seeds.filter(isNodeFilter('variablePdaSeedNode')).map(s => s.name);
            const localSeedNames = pda.seeds.filter(isNodeFilter('variablePdaSeedNode')).map(s => s.name);
            const localToCanonical = new Map(localSeedNames.map((local, i) => [local, canonicalSeedNames[i]]));
            const alignedSeeds = account.defaultValue.seeds.map(seed => {
                const canonical = localToCanonical.get(seed.name);
                return canonical && canonical !== seed.name ? pdaSeedValueNode(canonical, seed.value) : seed;
            });

            const defaultValue = {
                ...account.defaultValue,
                pda: pdaLinkNode(extractedPda.name),
                seeds: alignedSeeds,
            };
            return instructionAccountNode({ ...account, defaultValue });
        });

        return instructionNode({
            ...instruction,
            accounts: rewrittenAccounts,
        }) as InstructionNode;
    });

    return programNode({
        ...program,
        instructions: rewrittenInstructions,
        pdas: [...program.pdas, ...pdaMap.values()],
    });
}
