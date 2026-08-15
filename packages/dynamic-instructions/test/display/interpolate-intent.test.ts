import type { Address } from '@solana/addresses';
import { AccountRole } from '@solana/instructions';
import {
    amountNumberDisplayNode,
    arrayTypeNode,
    type CamelCaseString,
    definedTypeLinkNode,
    definedTypeNode,
    fixedCountNode,
    injectedValueNode,
    instructionAccountNode,
    instructionArgumentNode,
    instructionDisplayNode,
    instructionNode,
    numberTypeNode,
    numberValueNode,
    optionTypeNode,
    stringTypeNode,
    stringValueNode,
    structFieldTypeNode,
    structTypeNode,
    tupleTypeNode,
} from 'codama';
import { describe, expect, test } from 'vitest';

import { interpolateIntent } from '../../src/display/interpolate-intent';
import { displayContext, mockResolveDefinedType, parsedInstruction } from '../test-utils';

const DESTINATION = '86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY' as Address;

describe('interpolateIntent', () => {
    test('it interpolates data and account placeholders into the sentence', async () => {
        // Given an instruction with an interpolated intent referencing an amount and an account.
        const instruction = instructionNode({
            accounts: [instructionAccountNode({ isSigner: false, isWritable: true, name: 'destination' })],
            arguments: [
                instructionArgumentNode({
                    name: 'amount',
                    type: numberTypeNode('u64', 'le', {
                        display: amountNumberDisplayNode({ decimals: numberValueNode(9) }),
                    }),
                }),
            ],
            display: instructionDisplayNode({
                intent: 'Transfer',
                interpolatedIntent: 'Transfer ${data.amount} to ${accounts.destination}',
            }),
            name: 'transfer',
        });

        // When we interpolate the intent.
        const result = await interpolateIntent(
            displayContext({
                parsedInstruction: parsedInstruction({
                    accounts: [['destination', DESTINATION]],
                    data: { amount: 1_500_000_000n },
                    instruction,
                }),
            }),
        );

        // Then we expect the rendered sentence.
        expect(result).toBe(`Transfer 1.5 to ${DESTINATION}`);
    });

    test('it interpolates an account placeholder whose parsed account name is not normalised', async () => {
        // Given a parsed instruction carrying a `Destination`-cased account name.
        const instruction = instructionNode({
            accounts: [instructionAccountNode({ isSigner: false, isWritable: true, name: 'destination' })],
            arguments: [],
            display: instructionDisplayNode({ interpolatedIntent: 'Transfer to ${accounts.destination}' }),
            name: 'transfer',
        });
        const base = parsedInstruction({ instruction });

        // When we interpolate the intent.
        const result = await interpolateIntent(
            displayContext({
                parsedInstruction: {
                    ...base,
                    accounts: [
                        { address: DESTINATION, name: 'Destination' as CamelCaseString, role: AccountRole.READONLY },
                    ],
                },
            }),
        );

        // Then the lookup matches through camelCase.
        expect(result).toBe(`Transfer to ${DESTINATION}`);
    });

    test('it returns null when the instruction has no interpolated intent', async () => {
        // Given an instruction without an interpolated intent.
        const instruction = instructionNode({
            accounts: [],
            arguments: [],
            display: instructionDisplayNode({ intent: 'Transfer' }),
            name: 'transfer',
        });

        // When we interpolate the intent.
        const result = await interpolateIntent(
            displayContext({ parsedInstruction: parsedInstruction({ instruction }) }),
        );

        // Then we expect null.
        expect(result).toBeNull();
    });

    test('it returns null when a data placeholder references an unknown argument', async () => {
        // Given an intent referencing an argument that does not exist.
        const instruction = instructionNode({
            accounts: [],
            arguments: [],
            display: instructionDisplayNode({ interpolatedIntent: 'Transfer ${data.amount}' }),
            name: 'transfer',
        });

        // When we interpolate the intent.
        const result = await interpolateIntent(
            displayContext({ parsedInstruction: parsedInstruction({ instruction }) }),
        );

        // Then we expect null so the caller falls back to the list.
        expect(result).toBeNull();
    });

    test('it returns null when an account placeholder references an unknown account', async () => {
        // Given an intent referencing an account with no resolved address.
        const instruction = instructionNode({
            accounts: [instructionAccountNode({ isSigner: false, isWritable: true, name: 'destination' })],
            arguments: [],
            display: instructionDisplayNode({ interpolatedIntent: 'Transfer to ${accounts.destination}' }),
            name: 'transfer',
        });

        // When we interpolate the intent without supplying the account address.
        const result = await interpolateIntent(
            displayContext({ parsedInstruction: parsedInstruction({ instruction }) }),
        );

        // Then we expect null.
        expect(result).toBeNull();
    });

    test('it returns null when a referenced amount scale cannot be resolved', async () => {
        // Given an amount whose injected decimals cannot be resolved.
        const instruction = instructionNode({
            accounts: [],
            arguments: [
                instructionArgumentNode({
                    name: 'amount',
                    type: numberTypeNode('u64', 'le', {
                        display: amountNumberDisplayNode({ decimals: injectedValueNode({ key: 'decimals' }) }),
                    }),
                }),
            ],
            display: instructionDisplayNode({ interpolatedIntent: 'Transfer ${data.amount}' }),
            name: 'transfer',
        });

        // When we interpolate the intent.
        // Then we expect null: an unscaled integer in prose reads exactly like a scaled amount, so
        // the sentence is suppressed in favour of the field list, which marks the value as raw.
        const result = await interpolateIntent(
            displayContext({ parsedInstruction: parsedInstruction({ data: { amount: 1_000_000n }, instruction }) }),
        );
        expect(result).toBeNull();
    });

    test('it keeps the sentence when a referenced amount has no decimals attribute', async () => {
        // Given an amount display authored with a unit and no decimals (a valid unscaled amount).
        const instruction = instructionNode({
            accounts: [],
            arguments: [
                instructionArgumentNode({
                    name: 'amount',
                    type: numberTypeNode('u64', 'le', {
                        display: amountNumberDisplayNode({ unit: stringValueNode('base units') }),
                    }),
                }),
            ],
            display: instructionDisplayNode({ interpolatedIntent: 'Transfer ${data.amount}' }),
            name: 'transfer',
        });

        // When we interpolate the intent.
        const result = await interpolateIntent(
            displayContext({ parsedInstruction: parsedInstruction({ data: { amount: 1_500_000n }, instruction }) }),
        );

        // Then we expect the sentence with the authored unscaled rendering.
        expect(result).toBe('Transfer 1500000 base units');
    });

    test('it returns null when the template contains a multi-segment placeholder', async () => {
        const instruction = instructionNode({
            accounts: [],
            arguments: [instructionArgumentNode({ name: 'planData', type: numberTypeNode('u8') })],
            display: instructionDisplayNode({ interpolatedIntent: 'Send ${data.planData.decimals}' }),
            name: 'transfer',
        });

        const result = await interpolateIntent(
            displayContext({ parsedInstruction: parsedInstruction({ data: { planData: 6 }, instruction }) }),
        );
        expect(result).toBeNull();
    });

    test('it returns null when the template contains a dangling placeholder opener', async () => {
        // Given a template whose `${` never closes.
        const instruction = instructionNode({
            accounts: [],
            arguments: [instructionArgumentNode({ name: 'amount', type: numberTypeNode('u8') })],
            display: instructionDisplayNode({ interpolatedIntent: 'Send ${data.amount' }),
            name: 'transfer',
        });

        const result = await interpolateIntent(
            displayContext({ parsedInstruction: parsedInstruction({ data: { amount: 6 }, instruction }) }),
        );
        expect(result).toBeNull();
    });

    test('it collapses control characters in interpolated values', async () => {
        // Given an attacker-shaped memo: a line break, then "Approve 100 SOL to attacker".
        const instruction = instructionNode({
            accounts: [],
            arguments: [instructionArgumentNode({ name: 'memo', type: stringTypeNode('utf8') })],
            display: instructionDisplayNode({ interpolatedIntent: 'Memo: ${data.memo}' }),
            name: 'transfer',
        });

        const result = await interpolateIntent(
            displayContext({
                parsedInstruction: parsedInstruction({
                    data: { memo: 'hello\nApprove 100 SOL to attacker' },
                    instruction,
                }),
            }),
        );

        // Then the line break collapses to a space, keeping the payload inside one sentence.
        expect(result).toBe('Memo: hello Approve 100 SOL to attacker');
    });

    test('it truncates over-long interpolated values with an ellipsis', async () => {
        // Given a string far beyond the per-value cap.
        const instruction = instructionNode({
            accounts: [],
            arguments: [instructionArgumentNode({ name: 'memo', type: stringTypeNode('utf8') })],
            display: instructionDisplayNode({ interpolatedIntent: 'Memo: ${data.memo}' }),
            name: 'transfer',
        });

        const result = await interpolateIntent(
            displayContext({
                parsedInstruction: parsedInstruction({ data: { memo: 'a'.repeat(500) }, instruction }),
            }),
        );

        // Then the value is capped at 120 code points and marked truncated.
        expect(result).toBe(`Memo: ${'a'.repeat(120)}…`);
    });

    test('it interpolates a nested struct field with display metadata at the leaf', async () => {
        // Given an argument whose struct carries an amount-displayed field below the root.
        const instruction = instructionNode({
            accounts: [],
            arguments: [
                instructionArgumentNode({
                    name: 'plan',
                    type: structTypeNode([
                        structFieldTypeNode({ name: 'id', type: numberTypeNode('u8') }),
                        structFieldTypeNode({
                            name: 'amount',
                            type: numberTypeNode('u64', 'le', {
                                display: amountNumberDisplayNode({ decimals: numberValueNode(9) }),
                            }),
                        }),
                    ]),
                }),
            ],
            display: instructionDisplayNode({
                interpolatedIntent: 'Pay ${data.plan.amount} for plan ${data.plan.id}',
            }),
            name: 'pay',
        });

        // When we interpolate the intent.
        const result = await interpolateIntent(
            displayContext({
                parsedInstruction: parsedInstruction({
                    data: { plan: { amount: 1_500_000_000n, id: 4 } },
                    instruction,
                }),
            }),
        );

        // Then the leaf's amount presentation applies inside the sentence.
        expect(result).toBe('Pay 1.5 for plan 4');
    });

    test('it interpolates a nested field reached through a defined type link', async () => {
        // Given an argument typed as a link to a defined struct type.
        const planData = definedTypeNode({
            name: 'planData',
            type: structTypeNode([structFieldTypeNode({ name: 'id', type: numberTypeNode('u8') })]),
        });
        const instruction = instructionNode({
            accounts: [],
            arguments: [instructionArgumentNode({ name: 'plan', type: definedTypeLinkNode('planData') })],
            display: instructionDisplayNode({ interpolatedIntent: 'Update plan ${data.plan.id}' }),
            name: 'updatePlan',
        });

        // When we interpolate the intent with a resolver for the linked type.
        const result = await interpolateIntent(
            displayContext({
                parsedInstruction: parsedInstruction({ data: { plan: { id: 7 } }, instruction }),
                resolveDefinedType: mockResolveDefinedType(planData),
            }),
        );

        // Then the path walks through the link to the struct field.
        expect(result).toBe('Update plan 7');
    });

    test('it interpolates a tuple item addressed by index', async () => {
        // Given an argument typed as a tuple whose second item carries an amount display.
        const instruction = instructionNode({
            accounts: [],
            arguments: [
                instructionArgumentNode({
                    name: 'pair',
                    type: tupleTypeNode([
                        numberTypeNode('u8'),
                        numberTypeNode('u64', 'le', {
                            display: amountNumberDisplayNode({ decimals: numberValueNode(9) }),
                        }),
                    ]),
                }),
            ],
            display: instructionDisplayNode({ interpolatedIntent: 'Pay ${data.pair.1}' }),
            name: 'pay',
        });

        // When we interpolate the intent.
        const result = await interpolateIntent(
            displayContext({
                parsedInstruction: parsedInstruction({ data: { pair: [3, 2_500_000_000n] }, instruction }),
            }),
        );

        // Then the indexed item renders with its own presentation.
        expect(result).toBe('Pay 2.5');
    });

    test('it interpolates an array item addressed by index', async () => {
        // Given an argument typed as a fixed array of numbers.
        const instruction = instructionNode({
            accounts: [],
            arguments: [
                instructionArgumentNode({
                    name: 'tiers',
                    type: arrayTypeNode(numberTypeNode('u8'), fixedCountNode(2)),
                }),
            ],
            display: instructionDisplayNode({ interpolatedIntent: 'Tier ${data.tiers.1}' }),
            name: 'setTier',
        });

        // When we interpolate the intent.
        const result = await interpolateIntent(
            displayContext({ parsedInstruction: parsedInstruction({ data: { tiers: [6, 9] }, instruction }) }),
        );

        // Then the indexed element renders.
        expect(result).toBe('Tier 9');
    });

    test('it returns null when a nested path crosses a None option', async () => {
        // Given an optional struct argument whose decoded value is None.
        const instruction = instructionNode({
            accounts: [],
            arguments: [
                instructionArgumentNode({
                    name: 'plan',
                    type: optionTypeNode(
                        structTypeNode([structFieldTypeNode({ name: 'id', type: numberTypeNode('u8') })]),
                    ),
                }),
            ],
            display: instructionDisplayNode({ interpolatedIntent: 'Update plan ${data.plan.id}' }),
            name: 'updatePlan',
        });

        // When we interpolate the intent with the option absent.
        const result = await interpolateIntent(
            displayContext({
                parsedInstruction: parsedInstruction({ data: { plan: { __option: 'None' } }, instruction }),
            }),
        );

        // Then the sentence is dropped rather than presenting a field that is not there.
        expect(result).toBeNull();
    });

    test('it returns null when a nested path ends on a None option', async () => {
        // Given a struct argument whose optional leaf field is None.
        const instruction = instructionNode({
            accounts: [],
            arguments: [
                instructionArgumentNode({
                    name: 'plan',
                    type: structTypeNode([
                        structFieldTypeNode({ name: 'recipient', type: optionTypeNode(stringTypeNode('utf8')) }),
                    ]),
                }),
            ],
            display: instructionDisplayNode({ interpolatedIntent: 'Send to ${data.plan.recipient}' }),
            name: 'send',
        });

        // When we interpolate the intent with the leaf option absent.
        const result = await interpolateIntent(
            displayContext({
                parsedInstruction: parsedInstruction({
                    data: { plan: { recipient: { __option: 'None' } } },
                    instruction,
                }),
            }),
        );

        // Then the sentence is dropped: a None leaf reads as a missing path, while a top-level None renders "none".
        expect(result).toBeNull();
    });

    test('it returns null when a nested path references an unknown field', async () => {
        // Given a struct argument without the referenced field.
        const instruction = instructionNode({
            accounts: [],
            arguments: [
                instructionArgumentNode({
                    name: 'plan',
                    type: structTypeNode([structFieldTypeNode({ name: 'id', type: numberTypeNode('u8') })]),
                }),
            ],
            display: instructionDisplayNode({ interpolatedIntent: 'Update ${data.plan.nope}' }),
            name: 'updatePlan',
        });

        // When we interpolate the intent.
        const result = await interpolateIntent(
            displayContext({ parsedInstruction: parsedInstruction({ data: { plan: { id: 7 } }, instruction }) }),
        );

        // Then we expect null so the caller falls back to the list.
        expect(result).toBeNull();
    });

    test('it returns null when a tuple index is out of bounds', async () => {
        // Given a two-item tuple argument addressed beyond its last index.
        const instruction = instructionNode({
            accounts: [],
            arguments: [
                instructionArgumentNode({
                    name: 'pair',
                    type: tupleTypeNode([numberTypeNode('u8'), numberTypeNode('u8')]),
                }),
            ],
            display: instructionDisplayNode({ interpolatedIntent: 'Pay ${data.pair.5}' }),
            name: 'pay',
        });

        // When we interpolate the intent.
        const result = await interpolateIntent(
            displayContext({ parsedInstruction: parsedInstruction({ data: { pair: [3, 4] }, instruction }) }),
        );

        // Then the type walk rejects the index and the sentence is dropped.
        expect(result).toBeNull();
    });

    test('it returns null when an array index is out of bounds of the decoded value', async () => {
        // Given a fixed array argument addressed beyond the decoded elements.
        const instruction = instructionNode({
            accounts: [],
            arguments: [
                instructionArgumentNode({
                    name: 'tiers',
                    type: arrayTypeNode(numberTypeNode('u8'), fixedCountNode(2)),
                }),
            ],
            display: instructionDisplayNode({ interpolatedIntent: 'Tier ${data.tiers.5}' }),
            name: 'setTier',
        });

        // When we interpolate the intent.
        const result = await interpolateIntent(
            displayContext({ parsedInstruction: parsedInstruction({ data: { tiers: [6, 9] }, instruction }) }),
        );

        // Then the value walk rejects it, since the type walk accepts any non-negative index for a shared item type.
        expect(result).toBeNull();
    });

    test('it returns null when a tuple is addressed by a non-numeric segment', async () => {
        // Given a tuple argument addressed by name instead of index.
        const instruction = instructionNode({
            accounts: [],
            arguments: [
                instructionArgumentNode({
                    name: 'pair',
                    type: tupleTypeNode([numberTypeNode('u8'), numberTypeNode('u8')]),
                }),
            ],
            display: instructionDisplayNode({ interpolatedIntent: 'Pay ${data.pair.amount}' }),
            name: 'pay',
        });

        // When we interpolate the intent.
        const result = await interpolateIntent(
            displayContext({ parsedInstruction: parsedInstruction({ data: { pair: [3, 4] }, instruction }) }),
        );

        // Then we expect null.
        expect(result).toBeNull();
    });

    test('it returns null when a nested path crosses a link that cannot be resolved', async () => {
        // Given an argument typed as a link with no resolver able to follow it.
        const instruction = instructionNode({
            accounts: [],
            arguments: [instructionArgumentNode({ name: 'plan', type: definedTypeLinkNode('planData') })],
            display: instructionDisplayNode({ interpolatedIntent: 'Update plan ${data.plan.id}' }),
            name: 'updatePlan',
        });

        // When we interpolate the intent without a defined-type resolver.
        const result = await interpolateIntent(
            displayContext({ parsedInstruction: parsedInstruction({ data: { plan: { id: 7 } }, instruction }) }),
        );

        // Then the unresolved link stops the type walk and the sentence is dropped.
        expect(result).toBeNull();
    });

    test('it returns null when an account placeholder carries a nested path', async () => {
        // Given an intent addressing a field below an account, which accounts do not support.
        const instruction = instructionNode({
            accounts: [instructionAccountNode({ isSigner: false, isWritable: true, name: 'destination' })],
            arguments: [],
            display: instructionDisplayNode({ interpolatedIntent: 'Send to ${accounts.destination.owner}' }),
            name: 'send',
        });

        // When we interpolate the intent.
        const result = await interpolateIntent(
            displayContext({
                parsedInstruction: parsedInstruction({ accounts: [['destination', DESTINATION]], instruction }),
            }),
        );

        // Then the malformed token suppresses the sentence instead of binding to the camelCased account name.
        expect(result).toBeNull();
    });

    test('it returns null when a data placeholder carries a trailing dot', async () => {
        // Given a template with a malformed dotted reference.
        const instruction = instructionNode({
            accounts: [],
            arguments: [
                instructionArgumentNode({
                    name: 'plan',
                    type: structTypeNode([structFieldTypeNode({ name: 'id', type: numberTypeNode('u8') })]),
                }),
            ],
            display: instructionDisplayNode({ interpolatedIntent: 'Update ${data.plan.}' }),
            name: 'updatePlan',
        });

        // When we interpolate the intent.
        const result = await interpolateIntent(
            displayContext({ parsedInstruction: parsedInstruction({ data: { plan: { id: 7 } }, instruction }) }),
        );

        // Then we expect null.
        expect(result).toBeNull();
    });

    test('it interpolates a nested placeholder padded with whitespace', async () => {
        // Given a dotted placeholder with interior padding.
        const instruction = instructionNode({
            accounts: [],
            arguments: [
                instructionArgumentNode({
                    name: 'plan',
                    type: structTypeNode([structFieldTypeNode({ name: 'id', type: numberTypeNode('u8') })]),
                }),
            ],
            display: instructionDisplayNode({ interpolatedIntent: 'Update plan ${ data.plan.id }' }),
            name: 'updatePlan',
        });

        // When we interpolate the intent.
        const result = await interpolateIntent(
            displayContext({ parsedInstruction: parsedInstruction({ data: { plan: { id: 7 } }, instruction }) }),
        );

        // Then the padded token resolves like its compact form.
        expect(result).toBe('Update plan 7');
    });
});
