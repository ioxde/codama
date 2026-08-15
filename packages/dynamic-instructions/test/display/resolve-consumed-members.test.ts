import type { Address } from '@solana/addresses';
import {
    accountFieldValueNode,
    accountValueNode,
    amountNumberDisplayNode,
    argumentValueNode,
    injectedValueNode,
    instructionArgumentNode,
    instructionDisplayNode,
    instructionNode,
    numberTypeNode,
    numberValueNode,
    optionTypeNode,
    providedNode,
    stringValueNode,
    structFieldDisplayNode,
    structFieldTypeNode,
    structTypeNode,
} from 'codama';
import { describe, expect, test, vi } from 'vitest';

import { resolveConsumedMemberNames } from '../../src/display/resolve-consumed-members';
import { accountFixture, displayContext, mintAccountNode, mockFetch, parsedInstruction } from '../test-utils';

const MINT = '86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY' as Address;

/** An `amount` argument that injects `decimals` and `symbol` from the surrounding providers. */
function amountArgument() {
    return instructionArgumentNode({
        name: 'amount',
        type: numberTypeNode('u64', 'le', {
            display: amountNumberDisplayNode({
                decimals: injectedValueNode({ key: 'decimals' }),
                unit: injectedValueNode({ key: 'symbol' }),
            }),
        }),
    });
}

describe('resolveConsumedMemberNames', () => {
    test('it marks an account consumed when its field is injected and resolves', async () => {
        // Given `decimals` injected from the mint account's field, with the mint fetchable.
        const instruction = instructionNode({
            accounts: [],
            arguments: [amountArgument()],
            name: 'transfer',
            provides: [providedNode('decimals', accountFieldValueNode({ account: 'mint', path: 'decimals' }))],
        });

        // When we resolve the consumed members.
        const mint = accountFixture(mintAccountNode(), { decimals: 6 });
        const consumed = await resolveConsumedMemberNames(
            displayContext({
                fetchAccount: mockFetch([[MINT, mint.encoded]]),
                parsedInstruction: parsedInstruction({ accounts: [['mint', MINT]], instruction }),
                provides: new Map(instruction.provides?.map(p => [p.name, p]) ?? []),
                resolveAccountData: mint.resolveAccountData,
            }),
        );

        // Then the mint is marked consumed.
        expect(consumed).toEqual(new Set(['mint']));
    });

    test('it does not mark an account consumed when its field cannot resolve', async () => {
        // Given the same injection but no fetchAccount (offline).
        const instruction = instructionNode({
            accounts: [],
            arguments: [amountArgument()],
            name: 'transfer',
            provides: [providedNode('decimals', accountFieldValueNode({ account: 'mint', path: 'decimals' }))],
        });

        // When we resolve the consumed members without fetching.
        const consumed = await resolveConsumedMemberNames(
            displayContext({
                parsedInstruction: parsedInstruction({ accounts: [['mint', MINT]], instruction }),
                provides: new Map(instruction.provides?.map(p => [p.name, p]) ?? []),
            }),
        );

        // Then nothing is consumed because the field could not be read.
        expect(consumed).toEqual(new Set());
    });

    test('it marks an account consumed through an accountValueNode provider', async () => {
        // Given `symbol` injected by referencing the mint account directly.
        const instruction = instructionNode({
            accounts: [],
            arguments: [amountArgument()],
            name: 'transfer',
            provides: [
                providedNode('decimals', stringValueNode('6')),
                providedNode('symbol', accountValueNode('mint')),
            ],
        });

        // When we resolve the consumed members.
        const consumed = await resolveConsumedMemberNames(
            displayContext({
                parsedInstruction: parsedInstruction({ accounts: [['mint', MINT]], instruction }),
                provides: new Map(instruction.provides?.map(p => [p.name, p]) ?? []),
            }),
        );

        // Then the mint is consumed via the account reference.
        expect(consumed).toEqual(new Set(['mint']));
    });

    test('it marks an account consumed by an amount nested in a flattened struct field', async () => {
        // Given an `amount` (injecting `decimals`) nested inside a flattened struct argument.
        const instruction = instructionNode({
            accounts: [],
            arguments: [
                instructionArgumentNode({
                    display: structFieldDisplayNode({ flatten: true }),
                    name: 'order',
                    type: structTypeNode([
                        structFieldTypeNode({
                            name: 'amount',
                            type: numberTypeNode('u64', 'le', {
                                display: amountNumberDisplayNode({ decimals: injectedValueNode({ key: 'decimals' }) }),
                            }),
                        }),
                    ]),
                }),
            ],
            name: 'transfer',
            provides: [providedNode('decimals', accountFieldValueNode({ account: 'mint', path: 'decimals' }))],
        });

        // When we resolve the consumed members.
        const mint = accountFixture(mintAccountNode(), { decimals: 6 });
        const consumed = await resolveConsumedMemberNames(
            displayContext({
                fetchAccount: mockFetch([[MINT, mint.encoded]]),
                parsedInstruction: parsedInstruction({ accounts: [['mint', MINT]], instruction }),
                provides: new Map(instruction.provides?.map(p => [p.name, p]) ?? []),
                resolveAccountData: mint.resolveAccountData,
            }),
        );

        // Then the mint is consumed even though the injecting amount is nested in a struct.
        expect(consumed).toEqual(new Set(['mint']));
    });

    test('it does not mark an account consumed by an amount nested in a non-flattened struct', async () => {
        // Given the same nested amount, but in a struct the argument does NOT flatten — so the
        // struct renders as a single raw value and the nested amount is never surfaced.
        const instruction = instructionNode({
            accounts: [],
            arguments: [
                instructionArgumentNode({
                    name: 'order',
                    type: structTypeNode([
                        structFieldTypeNode({
                            name: 'amount',
                            type: numberTypeNode('u64', 'le', {
                                display: amountNumberDisplayNode({ decimals: injectedValueNode({ key: 'decimals' }) }),
                            }),
                        }),
                    ]),
                }),
            ],
            name: 'transfer',
            provides: [providedNode('decimals', accountFieldValueNode({ account: 'mint', path: 'decimals' }))],
        });

        // When we resolve the consumed members, with the mint fully fetchable.
        const mint = accountFixture(mintAccountNode(), { decimals: 6 });
        const consumed = await resolveConsumedMemberNames(
            displayContext({
                fetchAccount: mockFetch([[MINT, mint.encoded]]),
                parsedInstruction: parsedInstruction({ accounts: [['mint', MINT]], instruction }),
                provides: new Map(instruction.provides?.map(p => [p.name, p]) ?? []),
                resolveAccountData: mint.resolveAccountData,
            }),
        );

        // Then the mint stays visible: its decimals were never displayed, so it is not consumed.
        expect(consumed).toEqual(new Set());
    });

    test('it marks an account consumed by a nested amount addressed by the intent template', async () => {
        // Given a nested amount in a non-flattened struct, surfaced only by the intent template dotting into it.
        const instruction = instructionNode({
            accounts: [],
            arguments: [
                instructionArgumentNode({
                    name: 'order',
                    type: structTypeNode([
                        structFieldTypeNode({
                            name: 'amount',
                            type: numberTypeNode('u64', 'le', {
                                display: amountNumberDisplayNode({ decimals: injectedValueNode({ key: 'decimals' }) }),
                            }),
                        }),
                    ]),
                }),
            ],
            display: instructionDisplayNode({ interpolatedIntent: 'Pay ${data.order.amount}' }),
            name: 'transfer',
            provides: [providedNode('decimals', accountFieldValueNode({ account: 'mint', path: 'decimals' }))],
        });

        // When we resolve the consumed members, with the mint fully fetchable.
        const mint = accountFixture(mintAccountNode(), { decimals: 6 });
        const consumed = await resolveConsumedMemberNames(
            displayContext({
                fetchAccount: mockFetch([[MINT, mint.encoded]]),
                parsedInstruction: parsedInstruction({ accounts: [['mint', MINT]], instruction }),
                provides: new Map(instruction.provides?.map(p => [p.name, p]) ?? []),
                resolveAccountData: mint.resolveAccountData,
            }),
        );

        // Then the mint is consumed: its decimals back the amount the sentence displays.
        expect(consumed).toEqual(new Set(['mint']));
    });

    test('it does not mark an account consumed by a template-addressed amount when the template is malformed', async () => {
        // Given an intent template dotting into the nested amount, but carrying a dangling opener.
        const instruction = instructionNode({
            accounts: [],
            arguments: [
                instructionArgumentNode({
                    name: 'order',
                    type: structTypeNode([
                        structFieldTypeNode({
                            name: 'amount',
                            type: numberTypeNode('u64', 'le', {
                                display: amountNumberDisplayNode({ decimals: injectedValueNode({ key: 'decimals' }) }),
                            }),
                        }),
                    ]),
                }),
            ],
            display: instructionDisplayNode({ interpolatedIntent: 'Pay ${data.order.amount} to ${broken' }),
            name: 'transfer',
            provides: [providedNode('decimals', accountFieldValueNode({ account: 'mint', path: 'decimals' }))],
        });

        // When we resolve the consumed members, with the mint fully fetchable.
        const mint = accountFixture(mintAccountNode(), { decimals: 6 });
        const consumed = await resolveConsumedMemberNames(
            displayContext({
                fetchAccount: mockFetch([[MINT, mint.encoded]]),
                parsedInstruction: parsedInstruction({ accounts: [['mint', MINT]], instruction }),
                provides: new Map(instruction.provides?.map(p => [p.name, p]) ?? []),
                resolveAccountData: mint.resolveAccountData,
            }),
        );

        // Then the mint stays visible: the sentence is dropped, so its decimals never display.
        expect(consumed).toEqual(new Set());
    });

    test('it returns an empty set when no display value injects anything', async () => {
        // Given an amount that uses literal decimals (no injection).
        const instruction = instructionNode({
            accounts: [],
            arguments: [
                instructionArgumentNode({
                    name: 'amount',
                    type: numberTypeNode('u64', 'le', {
                        display: amountNumberDisplayNode({ decimals: numberValueNode(6) }),
                    }),
                }),
            ],
            name: 'transfer',
        });

        // When we resolve the consumed members.
        const consumed = await resolveConsumedMemberNames(
            displayContext({ parsedInstruction: parsedInstruction({ instruction }) }),
        );

        // Then nothing is consumed.
        expect(consumed).toEqual(new Set());
    });

    test('it marks a top-level argument consumed by its plain name', async () => {
        // Given `decimals` provided by a path-less argument reference.
        const instruction = instructionNode({
            accounts: [],
            arguments: [amountArgument(), instructionArgumentNode({ name: 'decimals', type: numberTypeNode('u8') })],
            name: 'transfer',
            provides: [providedNode('decimals', argumentValueNode('decimals'))],
        });

        const consumed = await resolveConsumedMemberNames(
            displayContext({
                parsedInstruction: parsedInstruction({ data: { decimals: 6 }, instruction }),
                provides: new Map(instruction.provides?.map(p => [p.name, p]) ?? []),
            }),
        );
        expect(consumed).toEqual(new Set(['decimals']));
    });

    test('it marks a nested argument field consumed by its dotted reference, not its root', async () => {
        // Given `decimals` provided by a reference to a field of the `planData` struct.
        const instruction = instructionNode({
            accounts: [],
            arguments: [
                amountArgument(),
                instructionArgumentNode({
                    name: 'planData',
                    type: structTypeNode([structFieldTypeNode({ name: 'decimals', type: numberTypeNode('u8') })]),
                }),
            ],
            name: 'transfer',
            provides: [providedNode('decimals', argumentValueNode('planData', ['decimals']))],
        });

        const consumed = await resolveConsumedMemberNames(
            displayContext({
                parsedInstruction: parsedInstruction({ data: { planData: { decimals: 6 } }, instruction }),
                provides: new Map(instruction.provides?.map(p => [p.name, p]) ?? []),
            }),
        );

        // Then only the nested field is consumed — the root struct still has unsurfaced siblings.
        expect(consumed).toEqual(new Set(['planData.decimals']));
    });

    test('it marks a nested field of an option-wrapped struct argument consumed', async () => {
        // Given a path into a struct argument decoded as `Option<Struct>`.
        const instruction = instructionNode({
            accounts: [],
            arguments: [
                amountArgument(),
                instructionArgumentNode({
                    name: 'planData',
                    type: optionTypeNode(
                        structTypeNode([structFieldTypeNode({ name: 'decimals', type: numberTypeNode('u8') })]),
                    ),
                }),
            ],
            name: 'transfer',
            provides: [providedNode('decimals', argumentValueNode('planData', ['decimals']))],
        });

        const consumed = await resolveConsumedMemberNames(
            displayContext({
                parsedInstruction: parsedInstruction({
                    data: { planData: { __option: 'Some', value: { decimals: 6 } } },
                    instruction,
                }),
                provides: new Map(instruction.provides?.map(p => [p.name, p]) ?? []),
            }),
        );

        // Then the injection resolves through the option wrapper and consumes the nested field.
        expect(consumed).toEqual(new Set(['planData.decimals']));
    });

    test('it marks an account consumed through an injection fallback', async () => {
        // Given `decimals` has no provider but falls back to injecting `mintDecimals`, itself the
        // mint's account field. The value resolves through the fallback, so the mint is consumed.
        const instruction = instructionNode({
            accounts: [],
            arguments: [
                instructionArgumentNode({
                    name: 'amount',
                    type: numberTypeNode('u64', 'le', {
                        display: amountNumberDisplayNode({
                            decimals: injectedValueNode({
                                fallback: injectedValueNode({ key: 'mintDecimals' }),
                                key: 'decimals',
                            }),
                        }),
                    }),
                }),
            ],
            name: 'transfer',
            provides: [providedNode('mintDecimals', accountFieldValueNode({ account: 'mint', path: 'decimals' }))],
        });

        // When we resolve the consumed members with the mint fetchable.
        const mint = accountFixture(mintAccountNode(), { decimals: 6 });
        const consumed = await resolveConsumedMemberNames(
            displayContext({
                fetchAccount: mockFetch([[MINT, mint.encoded]]),
                parsedInstruction: parsedInstruction({ accounts: [['mint', MINT]], instruction }),
                provides: new Map(instruction.provides?.map(p => [p.name, p]) ?? []),
                resolveAccountData: mint.resolveAccountData,
            }),
        );

        // Then the mint (reached through the fallback) is consumed.
        expect(consumed).toEqual(new Set(['mint']));
    });

    test('it marks an account consumed through a provider chain', async () => {
        // Given `decimals` provided by re-injecting `mintDecimals`, itself the mint's account field.
        const instruction = instructionNode({
            accounts: [],
            arguments: [amountArgument()],
            name: 'transfer',
            provides: [
                providedNode('decimals', injectedValueNode({ key: 'mintDecimals' })),
                providedNode('mintDecimals', accountFieldValueNode({ account: 'mint', path: 'decimals' })),
            ],
        });

        // When we resolve the consumed members with the mint fetchable.
        const mint = accountFixture(mintAccountNode(), { decimals: 6 });
        const consumed = await resolveConsumedMemberNames(
            displayContext({
                fetchAccount: mockFetch([[MINT, mint.encoded]]),
                parsedInstruction: parsedInstruction({ accounts: [['mint', MINT]], instruction }),
                provides: new Map(instruction.provides?.map(p => [p.name, p]) ?? []),
                resolveAccountData: mint.resolveAccountData,
            }),
        );

        // Then the mint (reached through the chain) is consumed.
        expect(consumed).toEqual(new Set(['mint']));
    });

    test('it fetches an account once when the same key is injected into several slots', async () => {
        // Given two amounts both injecting the SAME `decimals` key, backed by one account field.
        const amount = (name: string) =>
            instructionArgumentNode({
                name,
                type: numberTypeNode('u64', 'le', {
                    display: amountNumberDisplayNode({ decimals: injectedValueNode({ key: 'decimals' }) }),
                }),
            });
        const instruction = instructionNode({
            accounts: [],
            arguments: [amount('inputAmount'), amount('outputAmount')],
            name: 'swap',
            provides: [providedNode('decimals', accountFieldValueNode({ account: 'mint', path: 'decimals' }))],
        });

        // When we resolve the consumed members, counting fetches.
        const mint = accountFixture(mintAccountNode(), { decimals: 6 });
        const fetchAccount = vi.fn(mockFetch([[MINT, mint.encoded]]));
        const consumed = await resolveConsumedMemberNames(
            displayContext({
                fetchAccount,
                parsedInstruction: parsedInstruction({
                    accounts: [['mint', MINT]],
                    data: { inputAmount: 1n, outputAmount: 2n },
                    instruction,
                }),
                provides: new Map(instruction.provides?.map(p => [p.name, p]) ?? []),
                resolveAccountData: mint.resolveAccountData,
            }),
        );

        // Then the mint is consumed and the duplicated injection collapsed to a single fetch.
        expect(consumed).toEqual(new Set(['mint']));
        expect(fetchAccount).toHaveBeenCalledOnce();
    });

    test('it does not mark a fallback-resolved account consumed when it cannot resolve', async () => {
        // Given the same fallback-to-account-field injection but offline (no fetchAccount).
        const instruction = instructionNode({
            accounts: [],
            arguments: [
                instructionArgumentNode({
                    name: 'amount',
                    type: numberTypeNode('u64', 'le', {
                        display: amountNumberDisplayNode({
                            decimals: injectedValueNode({
                                fallback: injectedValueNode({ key: 'mintDecimals' }),
                                key: 'decimals',
                            }),
                        }),
                    }),
                }),
            ],
            name: 'transfer',
            provides: [providedNode('mintDecimals', accountFieldValueNode({ account: 'mint', path: 'decimals' }))],
        });

        // When we resolve without fetching.
        const consumed = await resolveConsumedMemberNames(
            displayContext({
                parsedInstruction: parsedInstruction({ accounts: [['mint', MINT]], instruction }),
                provides: new Map(instruction.provides?.map(p => [p.name, p]) ?? []),
            }),
        );

        // Then the mint stays visible: the field could not be read.
        expect(consumed).toEqual(new Set());
    });

    test('it terminates on a cyclic provider chain instead of recursing forever', async () => {
        // Given `decimals` provided by re-injecting itself: a cycle the selection walk must break.
        const instruction = instructionNode({
            accounts: [],
            arguments: [amountArgument()],
            name: 'transfer',
            provides: [providedNode('decimals', injectedValueNode({ key: 'decimals' }))],
        });

        // When we resolve the consumed members.
        const consumed = await resolveConsumedMemberNames(
            displayContext({
                parsedInstruction: parsedInstruction({ accounts: [['mint', MINT]], instruction }),
                provides: new Map(instruction.provides?.map(p => [p.name, p]) ?? []),
            }),
        );

        // Then the walk terminates and nothing is consumed.
        expect(consumed).toEqual(new Set());
    });
});
