import {
    CODAMA_ERROR__DYNAMIC_CLIENT__ARGUMENT_MISSING,
    CODAMA_ERROR__DYNAMIC_CLIENT__INVALID_ARGUMENT_INPUT,
    isCodamaError,
} from '@codama/errors';
import { camelCase } from 'codama';
import { describe, expect, expectTypeOf, test } from 'vitest';

import { formatValueType, isObjectRecord, safeStringify } from '../../src/shared/util';
import { resolveArgumentPathValue, tryResolveArgumentPathValue } from '../../src/visitors/resolve-argument-path';

describe('isObjectRecord', () => {
    test('should return true for plain objects', () => {
        expect(isObjectRecord({})).toBe(true);
        expect(isObjectRecord({ key: 'value' })).toBe(true);
    });

    test('should narrow type to Record<string, unknown>', () => {
        const value: unknown = { key: 'value' };
        if (isObjectRecord(value)) {
            expectTypeOf(value).toExtend<Record<string, unknown>>();
        }
    });

    test('should return false for null', () => {
        expect(isObjectRecord(null)).toBe(false);
    });

    test('should return false for arrays', () => {
        expect(isObjectRecord([1, 2, 3])).toBe(false);
    });

    test('should return false for primitives', () => {
        expect(isObjectRecord('string')).toBe(false);
        expect(isObjectRecord(42)).toBe(false);
        expect(isObjectRecord(true)).toBe(false);
        expect(isObjectRecord(undefined)).toBe(false);
    });

    test('should return false for class instances', () => {
        expect(isObjectRecord(new Date())).toBe(false);
        expect(isObjectRecord(new Map())).toBe(false);
    });

    test('should return false for Uint8Array', () => {
        expect(isObjectRecord(new Uint8Array([1, 2]))).toBe(false);
    });
});

describe('formatValueType', () => {
    test('should return "null" for null', () => {
        expect(formatValueType(null)).toBe('null');
    });

    test('should return array description with length', () => {
        expect(formatValueType([1, 2, 3])).toBe('array (length 3)');
        expect(formatValueType([])).toBe('array (length 0)');
    });

    test('should return Uint8Array description with length', () => {
        expect(formatValueType(new Uint8Array([1, 2]))).toBe('Uint8Array (length 2)');
        expect(formatValueType(new Uint8Array())).toBe('Uint8Array (length 0)');
    });

    test('should return "object" for plain objects', () => {
        expect(formatValueType({ key: 'value' })).toBe('object');
    });

    test('should return "object" for class instances', () => {
        expect(formatValueType(new Date())).toBe('object');
    });

    test('should return typeof for primitives', () => {
        expect(formatValueType('hello')).toBe('string');
        expect(formatValueType(42)).toBe('number');
        expect(formatValueType(true)).toBe('boolean');
        expect(formatValueType(undefined)).toBe('undefined');
        expect(formatValueType(42n)).toBe('bigint');
    });
});

describe('safeStringify', () => {
    test('should stringify plain objects', () => {
        expect(safeStringify({ a: 1 })).toBe('{"a":1}');
    });

    test('should stringify arrays', () => {
        expect(safeStringify([1, 2, 3])).toBe('[1,2,3]');
    });

    test('should stringify primitives', () => {
        expect(safeStringify('hello')).toBe('"hello"');
        expect(safeStringify(42)).toBe('42');
        expect(safeStringify(null)).toBe('null');
        expect(safeStringify(true)).toBe('true');
    });

    test('should convert BigInt to string', () => {
        expect(safeStringify(42n)).toBe('"42"');
        expect(safeStringify({ amount: 1000n })).toBe('{"amount":"1000"}');
    });

    test('should return non-serializable object for circular references', () => {
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        expect(safeStringify(circular)).toBe('non-serializable object');
    });

    test('should always return a string', () => {
        expectTypeOf(safeStringify).returns.toBeString();
    });
});

describe('resolveArgumentPathValue', () => {
    test('resolves a nested struct field value', () => {
        expect(
            resolveArgumentPathValue({ threshold: 7 }, [camelCase('threshold')], camelCase('config'), camelCase('ix')),
        ).toBe(7);
    });

    test('should walk through an array via numeric path segment', () => {
        // Root arg is `pair`, sub-path is `['1']`; the resolver indexes the tuple/array value.
        const rootValue = [7, 9];
        expect(resolveArgumentPathValue(rootValue, [camelCase('1')], camelCase('pair'), camelCase('ix'))).toBe(9);
    });

    test('throws ARGUMENT_MISSING (a user-facing error) when an intermediate value is absent', () => {
        const error = captureThrow(() =>
            resolveArgumentPathValue(undefined, [camelCase('threshold')], camelCase('config'), camelCase('ix')),
        );
        expect(isCodamaError(error, CODAMA_ERROR__DYNAMIC_CLIENT__ARGUMENT_MISSING)).toBe(true);
    });

    test('throws a user-facing INVALID_ARGUMENT_INPUT (not an internal invariant) when indexing past a too-short tuple', () => {
        // The declared type validated index 1 against a 2-tuple, but the user passed a 1-element array.
        const error = captureThrow(() =>
            resolveArgumentPathValue([7], [camelCase('1')], camelCase('pair'), camelCase('ix')),
        );
        expect(isCodamaError(error, CODAMA_ERROR__DYNAMIC_CLIENT__INVALID_ARGUMENT_INPUT)).toBe(true);
    });

    test('throws a user-facing INVALID_ARGUMENT_INPUT (not an internal invariant) when descending into a non-object', () => {
        // Reachable from caller-supplied argumentsInput (a primitive where a struct is declared), so
        // it's a user error, not an internal invariant.
        const error = captureThrow(() =>
            resolveArgumentPathValue(5, [camelCase('field')], camelCase('input'), camelCase('ix')),
        );
        expect(isCodamaError(error, CODAMA_ERROR__DYNAMIC_CLIENT__INVALID_ARGUMENT_INPUT)).toBe(true);
    });
});

describe('tryResolveArgumentPathValue', () => {
    test('resolves a present nested value', () => {
        expect(tryResolveArgumentPathValue({ threshold: 7 }, [camelCase('threshold')])).toBe(7);
    });

    test('returns undefined when the root value is absent', () => {
        expect(tryResolveArgumentPathValue(undefined, [camelCase('threshold')])).toBeUndefined();
    });

    test('returns undefined when an intermediate path segment is absent', () => {
        expect(tryResolveArgumentPathValue({}, [camelCase('inner'), camelCase('flag')])).toBeUndefined();
    });

    test('returns undefined (never throws) when a tuple index is out of bounds', () => {
        expect(tryResolveArgumentPathValue([7], [camelCase('1')])).toBeUndefined();
    });

    test('returns undefined (never throws) when descending into a non-object', () => {
        expect(tryResolveArgumentPathValue(5, [camelCase('field')])).toBeUndefined();
    });
});

function captureThrow(fn: () => unknown): unknown {
    try {
        fn();
    } catch (error) {
        return error;
    }
    throw new Error('Expected function to throw, but it did not.');
}
