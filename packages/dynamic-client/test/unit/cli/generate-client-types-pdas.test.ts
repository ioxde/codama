import {
    accountValueNode,
    constantPdaSeedNode,
    type InstructionAccountNode,
    instructionAccountNode,
    instructionNode,
    type PdaNode,
    pdaNode,
    pdaValueNode,
    programNode,
    publicKeyTypeNode,
    publicKeyValueNode,
    type RootNode,
    rootNode,
    variablePdaSeedNode,
} from 'codama';
import { expect, test } from 'vitest';

import { generateClientTypes } from '../../../src/cli/commands/generate-client-types/generate-client-types';

const AMM_PROGRAM = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

const accountFor = (pda: PdaNode, runtimeProgramId: boolean): InstructionAccountNode =>
    instructionAccountNode({
        defaultValue: pdaValueNode(pda, [], runtimeProgramId ? accountValueNode('ammProgram') : undefined),
        isSigner: false,
        isWritable: false,
        name: pda.name,
    });

const rootWith = (...accounts: InstructionAccountNode[]): RootNode =>
    rootNode(
        programNode({
            instructions: [instructionNode({ accounts, name: 'doThing' })],
            name: 'probe',
            publicKey: 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj',
            version: '1.0.0',
        }),
    );

const pdaSignature = (root: RootNode, pdaName: string): string =>
    generateClientTypes(root)
        .split('\n')
        .find(line => line.trim().startsWith(`${pdaName}: (`))!
        .trim();

// ioxde fork: the only coverage of `emitProgramAddressConfig`; no checked-in IDL fixture exercises it.
test('an unpinned PDA referenced with a runtime program ID takes a required config', () => {
    const pda = pdaNode({ name: 'unpinnedAuthority', seeds: [variablePdaSeedNode('owner', publicKeyTypeNode())] });
    const signature = pdaSignature(rootWith(accountFor(pda, true)), 'unpinnedAuthority');

    expect(signature).toBe(
        'unpinnedAuthority: (seeds: UnpinnedAuthorityPdaSeeds, config: { programAddress: Address }) => Promise<ProgramDerivedAddress>;',
    );
});

test('a pinned PDA referenced with a runtime program ID does not take a config', () => {
    const pda = pdaNode({
        name: 'pinnedAuthority',
        programId: AMM_PROGRAM,
        seeds: [constantPdaSeedNode(publicKeyTypeNode(), publicKeyValueNode(TOKEN_PROGRAM))],
    });
    const signature = pdaSignature(rootWith(accountFor(pda, true)), 'pinnedAuthority');

    expect(signature).toBe('pinnedAuthority: (seeds?: Record<string, unknown>) => Promise<ProgramDerivedAddress>;');
});

test('an unpinned PDA with no runtime program reference does not take a config', () => {
    const pda = pdaNode({ name: 'plainAuthority', seeds: [variablePdaSeedNode('mint', publicKeyTypeNode())] });
    const signature = pdaSignature(rootWith(accountFor(pda, false)), 'plainAuthority');

    expect(signature).toBe('plainAuthority: (seeds: PlainAuthorityPdaSeeds) => Promise<ProgramDerivedAddress>;');
});

test('the generated file imports Address whenever PDAs are present', () => {
    const pda = pdaNode({ name: 'unpinnedAuthority', seeds: [variablePdaSeedNode('owner', publicKeyTypeNode())] });

    expect(generateClientTypes(rootWith(accountFor(pda, true)))).toContain(
        "import type { Address, ProgramDerivedAddress } from '@solana/addresses';",
    );
});
