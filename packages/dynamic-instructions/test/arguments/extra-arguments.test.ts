import {
    instructionArgumentNode,
    instructionNode,
    numberTypeNode,
    programNode,
    publicKeyTypeNode,
    rootNode,
} from 'codama';
import { describe, expect, test } from 'vitest';

import { createArgumentsInputValidator, encodeInstructionArguments } from '../../src/arguments';

const PROGRAM = '11111111111111111111111111111111';
const rootWith = (ix: ReturnType<typeof instructionNode>) =>
    rootNode(programNode({ instructions: [ix], name: 'test', publicKey: PROGRAM }));

test('a non-serialized extra argument is excluded from the encoded instruction data', () => {
    const ix = instructionNode({
        arguments: [instructionArgumentNode({ name: 'amount', type: numberTypeNode('u64') })],
        extraArguments: [instructionArgumentNode({ name: 'ownerKey', type: publicKeyTypeNode() })],
        name: 'foo',
    });

    const encoded = encodeInstructionArguments(rootWith(ix), ix, { amount: 5n, ownerKey: PROGRAM });

    expect(encoded).toEqual(new Uint8Array([5, 0, 0, 0, 0, 0, 0, 0]));
});

test('the arguments validator admits a resolution-only extra argument', () => {
    const ix = instructionNode({
        arguments: [instructionArgumentNode({ name: 'amount', type: numberTypeNode('u64') })],
        extraArguments: [instructionArgumentNode({ name: 'ownerKey', type: publicKeyTypeNode() })],
        name: 'foo',
    });

    const validate = createArgumentsInputValidator(rootWith(ix), ix);

    expect(() => validate({ amount: 5n, ownerKey: PROGRAM })).not.toThrow();
});

// extraArguments are optional here -- when a caller manually supplies the auto-derived account,
// the corresponding extraArgument can be omitted. Presence checks belong at the instruction-builder
// layer, which sees both argumentsInput and accountsInput.
describe('extraArguments are type-checked when present', () => {
    const root = rootNode(programNode({ name: 'test', publicKey: PROGRAM }));
    const validatorFor = (extra: ReturnType<typeof instructionArgumentNode>) =>
        createArgumentsInputValidator(
            root,
            instructionNode({
                arguments: [instructionArgumentNode({ name: 'amount', type: numberTypeNode('u8') })],
                extraArguments: [extra],
                name: 'doThing',
            }),
        );

    test('rejects a wrongly-typed extraArgument value', () => {
        const validate = validatorFor(instructionArgumentNode({ name: 'postCount', type: numberTypeNode('u64') }));
        expect(() => validate({ amount: 1, postCount: 'not-a-number' })).toThrow(/postCount/);
    });

    test('rejects a wrongly-typed pubkey extraArgument value', () => {
        const validate = validatorFor(instructionArgumentNode({ name: 'authority', type: publicKeyTypeNode() }));
        expect(() => validate({ amount: 1, authority: 12345 })).toThrow(/authority/);
    });

    test('accepts a missing extraArgument (manually-supplied account case)', () => {
        const validate = validatorFor(instructionArgumentNode({ name: 'postCount', type: numberTypeNode('u64') }));
        expect(() => validate({ amount: 1 })).not.toThrow();
    });
});
