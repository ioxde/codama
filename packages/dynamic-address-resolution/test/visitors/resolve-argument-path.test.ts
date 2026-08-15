import { camelCase } from 'codama';
import { describe, expect, test } from 'vitest';

import { resolveArgumentPathValue, tryResolveArgumentPathValue } from '../../src/visitors/resolve-argument-path';

const path = (...segments: string[]) => segments.map(camelCase);

describe('tryResolveArgumentPathValue', () => {
    test('resolves a field of a plain struct value', () => {
        expect(tryResolveArgumentPathValue({ terms: { amount: 1_500_000n } }, path('terms', 'amount'))).toBe(
            1_500_000n,
        );
    });

    test('resolves an array element by numeric index', () => {
        expect(tryResolveArgumentPathValue({ tiers: [6, 9] }, path('tiers', '1'))).toBe(9);
    });

    test('resolves a field inside a Some-wrapped struct', () => {
        // The `Some` wrapper is a codec artefact, so the path carries no `value` segment.
        const value = { __option: 'Some', value: { decimals: 6 } };
        expect(tryResolveArgumentPathValue(value, path('decimals'))).toBe(6);
    });

    test('resolves through nested Some wrappers along a multi-segment path', () => {
        const value = { __option: 'Some', value: { terms: { __option: 'Some', value: { amount: 42n } } } };
        expect(tryResolveArgumentPathValue(value, path('terms', 'amount'))).toBe(42n);
    });

    test('unwraps a Some-wrapped leaf', () => {
        const value = { decimals: { __option: 'Some', value: 6 } };
        expect(tryResolveArgumentPathValue(value, path('decimals'))).toBe(6);
    });

    test('reads a None along the path as absent', () => {
        expect(tryResolveArgumentPathValue({ __option: 'None' }, path('decimals'))).toBeUndefined();
    });

    test('reads a None leaf as absent', () => {
        const value = { decimals: { __option: 'None' } };
        expect(tryResolveArgumentPathValue(value, path('decimals'))).toBeUndefined();
    });
});

describe('resolveArgumentPathValue', () => {
    test('resolves a field inside a Some-wrapped struct', () => {
        const value = { __option: 'Some', value: { decimals: 6 } };
        expect(resolveArgumentPathValue(value, path('decimals'), camelCase('planData'), camelCase('transfer'))).toBe(6);
    });

    test('throws ARGUMENT_MISSING when the path descends through a None', () => {
        expect(() =>
            resolveArgumentPathValue(
                { __option: 'None' },
                path('terms', 'decimals'),
                camelCase('planData'),
                camelCase('transfer'),
            ),
        ).toThrow(/Missing argument \[planData\]/);
    });

    test('renders the dotted reference through the argumentPath error context', () => {
        // The dotted suffix travels in `argumentPath`; `argumentName` stays a bare camelCase name.
        expect(() => resolveArgumentPathValue({ a: 5 }, path('a', 'b'), camelCase('input'), camelCase('ix'))).toThrow(
            'Invalid argument input [input.a]: [5]. Expected [an object or array to read "b"].',
        );
    });

    test('renders an out-of-bounds index with the visited path in the reference', () => {
        expect(() => resolveArgumentPathValue([7], path('1'), camelCase('pair'), camelCase('ix'))).toThrow(
            'Invalid argument input [pair]: [[7]]. Expected [an array with index 1].',
        );
    });
});
