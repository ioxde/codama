import { argumentValueNode } from 'codama';
import { describe, expect, test } from 'vitest';

import { makeVisitor } from './condition-node-value-test-utils';

describe('condition-node-value: visitArgumentValue', () => {
    test('should return argument value', async () => {
        const visitor = makeVisitor({ argumentsInput: { amount: 42 } });
        const result = await visitor.visitArgumentValue(argumentValueNode('amount'));
        expect(result).toBe(42);
    });

    test('should return undefined for missing argument', async () => {
        const visitor = makeVisitor({ argumentsInput: {} });
        const result = await visitor.visitArgumentValue(argumentValueNode('amount'));
        expect(result).toBeUndefined();
    });

    test('should resolve nested struct field value via path', async () => {
        const visitor = makeVisitor({ argumentsInput: { config: { threshold: 7 } } });
        const result = await visitor.visitArgumentValue(argumentValueNode('config', ['threshold']));
        expect(result).toBe(7);
    });

    test('returns undefined (→ ifFalse) when the root condition arg is absent, instead of throwing', async () => {
        // An unresolved condition must take the ifFalse branch, same as a null account value or a
        // missing resolver. It must not throw and abort resolution.
        const visitor = makeVisitor({ argumentsInput: {} });
        const result = await visitor.visitArgumentValue(argumentValueNode('config', ['threshold']));
        expect(result).toBeUndefined();
    });

    test('returns undefined (→ ifFalse) when an intermediate condition path segment is absent', async () => {
        const visitor = makeVisitor({ argumentsInput: { config: {} } });
        const result = await visitor.visitArgumentValue(argumentValueNode('config', ['inner', 'threshold']));
        expect(result).toBeUndefined();
    });
});
