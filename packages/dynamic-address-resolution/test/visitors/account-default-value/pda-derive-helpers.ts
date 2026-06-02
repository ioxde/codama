import { type Address, getProgramDerivedAddress } from '@solana/addresses';
import type { PdaValueNode } from 'codama';
import { expect } from 'vitest';

import { makeVisitor } from './account-default-value-test-utils';

type Seeds = Parameters<typeof getProgramDerivedAddress>[0]['seeds'];

// Derive the expected PDA off-chain, then assert the visitor resolves the same address.
export async function expectVisitorDerivesPda(
    node: PdaValueNode,
    overrides: Parameters<typeof makeVisitor>[0],
    programAddress: Address,
    seeds: Seeds,
): Promise<void> {
    const [expected] = await getProgramDerivedAddress({ programAddress, seeds });
    expect(await makeVisitor(overrides).visitPdaValue(node)).toBe(expected);
}
