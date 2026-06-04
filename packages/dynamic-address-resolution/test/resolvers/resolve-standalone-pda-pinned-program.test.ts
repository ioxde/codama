import { type IdlV01, rootNodeFromAnchor } from '@codama/nodes-from-anchor';
import { expect, test } from 'vitest';

import { resolveStandalonePda } from '../../src';

// Trimmed from Raydium launchpad's migrate_to_amm: amm_authority is a PDA of the
// address-pinned amm_program, so standalone resolution must derive under that address.
const idl: IdlV01 = {
    address: 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj',
    instructions: [
        {
            accounts: [
                {
                    name: 'amm_authority',
                    pda: {
                        program: { kind: 'account', path: 'amm_program' },
                        // utf8 "amm authority"
                        seeds: [
                            { kind: 'const', value: [97, 109, 109, 32, 97, 117, 116, 104, 111, 114, 105, 116, 121] },
                        ],
                    },
                },
                { address: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', name: 'amm_program' },
            ],
            args: [],
            discriminator: [1, 2, 3, 4, 5, 6, 7, 8],
            name: 'migrate_to_amm',
        },
    ],
    metadata: { name: 'raydium_launchpad', spec: '0.1.0', version: '1.0.0' },
};

test('it derives a pinned-program PDA under the pinned program, standalone', async () => {
    const root = rootNodeFromAnchor(idl);

    // The pinned PDA must still be hoisted to program level.
    const ammAuthority = root.program.pdas.find(p => p.name === 'ammAuthority');
    expect(ammAuthority).toBeDefined();

    // Raydium V4 authority: findProgramAddress(["amm authority"], 675kPX…).
    const [address] = await resolveStandalonePda(root, ammAuthority!);
    expect(address).toBe('5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1');
});
