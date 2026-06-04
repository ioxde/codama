import { assertIsNode, programNode } from '@codama/nodes';
import { getBase58Codec } from '@solana/codecs';
import { expect, test } from 'vitest';

import { extractPdasFromProgram } from '../../src';
import { ix } from './_fixtures';

const AMM_PROGRAM = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

const utf8 = (s: string) => Array.from(new TextEncoder().encode(s));
const b58 = (s: string) => Array.from(getBase58Codec().encode(s));

// Raydium-launchpad shape: `seeds::program` points at a sibling account with an Anchor
// `address` constraint. The address is stamped on the pdaNode; the ref stays on the pdaValueNode.
const pinnedIx = () =>
    ix('migrate_to_amm', [
        {
            name: 'amm_authority',
            pda: {
                program: { kind: 'account', path: 'amm_program' },
                seeds: [{ kind: 'const', value: utf8('amm authority') }],
            },
        },
        { address: AMM_PROGRAM, name: 'amm_program' },
    ]);

test('it stamps the pinned program of an address-constrained account ref onto the pdaNode', () => {
    const dv = pinnedIx().accounts.find(a => a.name === 'ammAuthority')?.defaultValue;
    assertIsNode(dv, 'pdaValueNode');
    assertIsNode(dv.pda, 'pdaNode');
    expect(dv.pda.programId).toBe(AMM_PROGRAM);
    expect(dv.programId).toEqual({ kind: 'accountValueNode', name: 'ammProgram' });
});

test('it still hoists pinned dynamic-program PDAs to program level', () => {
    const program = programNode({
        instructions: [pinnedIx()],
        name: 'raydium_launchpad',
        publicKey: 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj',
    });

    const result = extractPdasFromProgram(program);

    const pda = result.pdas.find(p => p.name === 'ammAuthority');
    expect(pda?.programId).toBe(AMM_PROGRAM);

    // The use site keeps the runtime ref and links to the hoisted node.
    const dv = result.instructions[0].accounts.find(a => a.name === 'ammAuthority')?.defaultValue;
    assertIsNode(dv, 'pdaValueNode');
    expect(dv.pda).toEqual({ kind: 'pdaLinkNode', name: 'ammAuthority' });
    expect(dv.programId).toEqual({ kind: 'accountValueNode', name: 'ammProgram' });
});

test('it leaves the pdaNode unstamped when the referenced program account has no address', () => {
    const node = ix('thaw', [
        {
            name: 'authority',
            pda: {
                program: { kind: 'account', path: 'token_program' },
                seeds: [{ kind: 'const', value: utf8('authority') }],
            },
        },
        { name: 'token_program' },
    ]);

    const dv = node.accounts.find(a => a.name === 'authority')?.defaultValue;
    assertIsNode(dv, 'pdaValueNode');
    assertIsNode(dv.pda, 'pdaNode');
    expect(dv.pda.programId).toBeUndefined();
    expect(dv.programId).toEqual({ kind: 'accountValueNode', name: 'tokenProgram' });
});

test('it keeps const-program (ATA) PDAs inline, byte-identical', () => {
    const ata = ix('create', [
        { name: 'owner' },
        { name: 'mint' },
        {
            name: 'token_account',
            pda: {
                program: { kind: 'const', value: b58(ATA_PROGRAM) },
                seeds: [
                    { kind: 'account', path: 'owner' },
                    { kind: 'const', value: b58(TOKEN_PROGRAM) },
                    { kind: 'account', path: 'mint' },
                ],
            },
        },
    ]);

    // A const program is set directly on the pdaNode; there is no runtime ref.
    const dv = ata.accounts.find(a => a.name === 'tokenAccount')?.defaultValue;
    assertIsNode(dv, 'pdaValueNode');
    assertIsNode(dv.pda, 'pdaNode');
    expect(dv.pda.programId).toBe(ATA_PROGRAM);
    expect(dv.programId).toBeUndefined();

    // extractPdasFromProgram leaves it untouched.
    const program = programNode({ instructions: [ata], name: 'test_program', publicKey: '1111' });
    expect(extractPdasFromProgram(program)).toEqual(program);
});
