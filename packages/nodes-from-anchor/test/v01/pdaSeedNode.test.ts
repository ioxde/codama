import {
    accountValueNode,
    argumentValueNode,
    arrayTypeNode,
    assertIsNode,
    bytesTypeNode,
    constantPdaSeedNodeFromBytes,
    definedTypeLinkNode,
    instructionArgumentNode,
    numberTypeNode,
    pdaSeedValueNode,
    prefixedCountNode,
    publicKeyTypeNode,
    sizePrefixTypeNode,
    stringTypeNode,
    structFieldTypeNode,
    structTypeNode,
    tupleTypeNode,
    type TypeNode,
    variablePdaSeedNode,
} from '@codama/nodes';
import { expect, test } from 'vitest';

import { minimalDistinctSuffixNames, pdaSeedNodeFromAnchorV01 } from '../../src';
import { definedStruct } from './_fixtures';

test('it creates a PdaSeedNode from a const Anchor seed', () => {
    const nodes = pdaSeedNodeFromAnchorV01({ kind: 'const', value: [11, 57, 246, 240] }, []);

    expect(nodes?.definition).toEqual(constantPdaSeedNodeFromBytes('base58', 'HeLLo'));
    expect(nodes?.value).toBeUndefined();
});

test('it creates a PdaSeedNode from an account Anchor seed', () => {
    const nodes = pdaSeedNodeFromAnchorV01({ kind: 'account', path: 'authority' }, []);

    expect(nodes?.definition).toEqual(variablePdaSeedNode('authority', publicKeyTypeNode()));
    expect(nodes?.value).toEqual(pdaSeedValueNode('authority', accountValueNode('authority')));
});

test('it creates a PdaSeedNode from an arg Anchor seed', () => {
    const nodes = pdaSeedNodeFromAnchorV01({ kind: 'arg', path: 'capacity' }, [
        instructionArgumentNode({ name: 'capacity', type: numberTypeNode('u64') }),
    ]);

    expect(nodes?.definition).toEqual(variablePdaSeedNode('capacity', numberTypeNode('u64')));
    expect(nodes?.value).toEqual(pdaSeedValueNode('capacity', argumentValueNode('capacity')));
});

test('it resolves nested arg path from inline struct type', () => {
    const nodes = pdaSeedNodeFromAnchorV01({ kind: 'arg', path: 'args.owner' }, [
        instructionArgumentNode({
            name: 'args',
            type: structTypeNode([
                structFieldTypeNode({ name: 'owner', type: publicKeyTypeNode() }),
                structFieldTypeNode({ name: 'amount', type: numberTypeNode('u64') }),
            ]),
        }),
    ]);

    // Seed name is the field leaf; the value carries the full path for resolution from the root arg.
    expect(nodes?.definition).toEqual(variablePdaSeedNode('owner', publicKeyTypeNode()));
    expect(nodes?.value).toEqual(pdaSeedValueNode('owner', argumentValueNode('args', ['owner'])));
});

test('it resolves nested arg path from defined type link', () => {
    const nodes = pdaSeedNodeFromAnchorV01(
        { kind: 'arg', path: 'args.amount' },
        [instructionArgumentNode({ name: 'args', type: definedTypeLinkNode('MyArgs') })],
        undefined,
        [{ name: 'MyArgs', type: { fields: [{ name: 'amount', type: 'u64' }], kind: 'struct' } }],
    );

    expect(nodes?.definition).toEqual(variablePdaSeedNode('amount', numberTypeNode('u64')));
    expect(nodes?.value).toEqual(pdaSeedValueNode('amount', argumentValueNode('args', ['amount'])));
});

test('it names deeply nested arg seeds by their leaf field', () => {
    const instructionArgs = [
        instructionArgumentNode({
            name: 'input',
            type: structTypeNode([
                structFieldTypeNode({ name: 'seedEnum', type: numberTypeNode('u8') }),
                structFieldTypeNode({
                    name: 'innerStruct',
                    type: structTypeNode([structFieldTypeNode({ name: 'seedEnum', type: numberTypeNode('u8') })]),
                }),
            ]),
        }),
    ];

    const shallow = pdaSeedNodeFromAnchorV01({ kind: 'arg', path: 'input.seed_enum' }, instructionArgs);
    const deep = pdaSeedNodeFromAnchorV01({ kind: 'arg', path: 'input.inner_struct.seed_enum' }, instructionArgs);

    expect(shallow?.definition).toEqual(variablePdaSeedNode('seedEnum', numberTypeNode('u8')));
    expect(deep?.definition).toEqual(variablePdaSeedNode('seedEnum', numberTypeNode('u8')));
});

test('it returns undefined for unresolvable nested arg type', () => {
    const result = pdaSeedNodeFromAnchorV01({ kind: 'arg', path: 'args.owner' }, [
        instructionArgumentNode({ name: 'args', type: definedTypeLinkNode('UnknownType') }),
    ]);

    expect(result).toBeUndefined();
});

test('it unwraps a trailing defined-type link into the seed slot leaf type', () => {
    const nodes = pdaSeedNodeFromAnchorV01(
        { kind: 'arg', path: 'args.role' },
        [
            instructionArgumentNode({
                name: 'args',
                type: structTypeNode([structFieldTypeNode({ name: 'role', type: definedTypeLinkNode('Role') })]),
            }),
        ],
        undefined,
        [{ name: 'Role', type: { kind: 'enum', variants: [{ name: 'admin' }, { name: 'user' }] } }],
    );

    const definition = nodes?.definition;
    assertIsNode(definition, 'variablePdaSeedNode');
    expect(definition.name).toBe('role');
    expect(definition.type.kind).toBe('enumTypeNode');
    expect(nodes?.value).toEqual(pdaSeedValueNode('role', argumentValueNode('args', ['role'])));
});

test('it bails out of nested arg resolution on a cyclic defined-type chain', () => {
    const result = pdaSeedNodeFromAnchorV01(
        { kind: 'arg', path: 'args.owner' },
        [instructionArgumentNode({ name: 'args', type: definedTypeLinkNode('A') })],
        undefined,
        [
            { name: 'A', type: { kind: 'alias', value: { defined: { name: 'B' } } } },
            { name: 'B', type: { kind: 'alias', value: { defined: { name: 'A' } } } },
        ],
    );

    expect(result).toBeUndefined();
});

test('it throws for nested arg path when root argument is missing', () => {
    expect(() => pdaSeedNodeFromAnchorV01({ kind: 'arg', path: 'args.owner' }, [])).toThrow();
});

test('it resolves nested account path from type def', () => {
    const noPrefix = pdaSeedNodeFromAnchorV01(
        { account: 'Mint', kind: 'account', path: 'mint.authority' },
        [],
        undefined,
        [{ name: 'Mint', type: { fields: [{ name: 'authority', type: 'pubkey' }], kind: 'struct' } }],
    );
    const withPrefix = pdaSeedNodeFromAnchorV01(
        { account: 'Mint', kind: 'account', path: 'mint.authority' },
        [],
        'token',
        [{ name: 'Mint', type: { fields: [{ name: 'authority', type: 'pubkey' }], kind: 'struct' } }],
    );

    // A nested-account-group prefix combines with the leaf, not the full path.
    expect(noPrefix?.definition).toEqual(variablePdaSeedNode('authority', publicKeyTypeNode()));
    expect(noPrefix?.value).toEqual(pdaSeedValueNode('authority', argumentValueNode('authority')));
    expect(withPrefix?.definition).toEqual(variablePdaSeedNode('tokenAuthority', publicKeyTypeNode()));
    expect(withPrefix?.value).toEqual(pdaSeedValueNode('tokenAuthority', argumentValueNode('tokenAuthority')));
});

test('it returns undefined for unresolvable nested account path', () => {
    const result = pdaSeedNodeFromAnchorV01(
        { account: 'UnknownType', kind: 'account', path: 'mint.authority' },
        [],
        undefined,
        [],
    );

    expect(result).toBeUndefined();
});

test('it resolves nested arg path through inline tuple type', () => {
    const nodes = pdaSeedNodeFromAnchorV01({ kind: 'arg', path: 'foo.0' }, [
        instructionArgumentNode({
            name: 'foo',
            type: tupleTypeNode([publicKeyTypeNode(), numberTypeNode('u64')]),
        }),
    ]);

    expect(nodes?.definition).toEqual(variablePdaSeedNode('foo0', publicKeyTypeNode()));
    expect(nodes?.value).toEqual(pdaSeedValueNode('foo0', argumentValueNode('foo', ['0'])));
});

test('it resolves nested path through tuple then struct (foo.0.bar)', () => {
    const nodes = pdaSeedNodeFromAnchorV01({ kind: 'arg', path: 'foo.0.bar' }, [
        instructionArgumentNode({
            name: 'foo',
            type: tupleTypeNode([structTypeNode([structFieldTypeNode({ name: 'bar', type: numberTypeNode('u8') })])]),
        }),
    ]);

    expect(nodes?.definition).toEqual(variablePdaSeedNode('bar', numberTypeNode('u8')));
    expect(nodes?.value).toEqual(pdaSeedValueNode('bar', argumentValueNode('foo', ['0', 'bar'])));
});

test('it does not produce a leading-digit seed name for consecutive tuple indices (x.0.0)', () => {
    // x.0.0 ends in two tuple indices; the name must reach the named ancestor `x` so it doesn't
    // start with a digit.
    const nodes = pdaSeedNodeFromAnchorV01({ kind: 'arg', path: 'x.0.0' }, [
        instructionArgumentNode({
            name: 'x',
            type: tupleTypeNode([tupleTypeNode([numberTypeNode('u8')])]),
        }),
    ]);

    assertIsNode(nodes?.definition, 'variablePdaSeedNode');
    expect(nodes.definition.name).not.toMatch(/^\d/);
});

test('it returns undefined for out-of-bounds tuple index', () => {
    const result = pdaSeedNodeFromAnchorV01({ kind: 'arg', path: 'foo.5' }, [
        instructionArgumentNode({
            name: 'foo',
            type: tupleTypeNode([publicKeyTypeNode()]),
        }),
    ]);

    expect(result).toBeUndefined();
});

test('it resolves nested account path through IDL tuple type def', () => {
    const nodes = pdaSeedNodeFromAnchorV01({ account: 'Pair', kind: 'account', path: 'pair.0' }, [], undefined, [
        { name: 'Pair', type: { fields: ['pubkey', 'u64'], kind: 'struct' } },
    ]);

    expect(nodes?.definition).toEqual(variablePdaSeedNode('pair0', publicKeyTypeNode()));
    expect(nodes?.value).toEqual(pdaSeedValueNode('pair0', argumentValueNode('pair0')));
});

test('it removes the string prefix from arg Anchor seeds', () => {
    const nodes = pdaSeedNodeFromAnchorV01({ kind: 'arg', path: 'identifier' }, [
        instructionArgumentNode({
            name: 'identifier',
            type: sizePrefixTypeNode(stringTypeNode('utf8'), numberTypeNode('u32')),
        }),
    ]);

    expect(nodes?.definition).toEqual(variablePdaSeedNode('identifier', stringTypeNode('utf8')));
    expect(nodes?.value).toEqual(pdaSeedValueNode('identifier', argumentValueNode('identifier')));
});

test('it keeps a single-segment account seed as the account address, never a caller input', () => {
    const nodes = pdaSeedNodeFromAnchorV01({ kind: 'account', path: 'mint' }, []);

    expect(nodes?.definition).toEqual(variablePdaSeedNode('mint', publicKeyTypeNode()));
    expect(nodes?.value).toEqual(pdaSeedValueNode('mint', accountValueNode('mint')));
});

// A nested account-data field seed binds to a caller-supplied input (leaf-named), never an account
// fetch; numeric/string/bytes leaf types are preserved (string/bytes drop their borsh length prefix).
// `desc` doubles as the test name and `defType` is asserted only when given (else value-only).
test.each<{
    account: string;
    defType?: TypeNode;
    desc: string;
    fields: Record<string, unknown>;
    leaf: string;
    path: string;
}>([
    {
        account: 'Pool',
        defType: numberTypeNode('u16'),
        desc: 'numeric pool.index (u16)',
        fields: { index: 'u16' },
        leaf: 'index',
        path: 'pool.index',
    },
    {
        account: 'NestedDataAccount',
        defType: numberTypeNode('u64'),
        desc: 'u64 nested_data_account.event_count',
        fields: { event_count: 'u64' },
        leaf: 'eventCount',
        path: 'nested_data_account.event_count',
    },
    {
        account: 'Config',
        defType: stringTypeNode('utf8'),
        desc: 'string config.name (length prefix stripped)',
        fields: { name: 'string' },
        leaf: 'name',
        path: 'config.name',
    },
    {
        account: 'Config',
        defType: bytesTypeNode(),
        desc: 'bytes config.blob (length prefix stripped)',
        fields: { blob: 'bytes' },
        leaf: 'blob',
        path: 'config.blob',
    },
    // Anchor emits `.key()` as the bare account name; the dotted form addresses the data field.
    { account: 'Mint', desc: 'pubkey mint.key (real field)', fields: { key: 'pubkey' }, leaf: 'key', path: 'mint.key' },
    {
        account: 'StateAccount',
        desc: 'pubkey state_account.owner_key',
        fields: { owner_key: 'pubkey' },
        leaf: 'ownerKey',
        path: 'state_account.owner_key',
    },
])('it sources account-data seed $desc from a caller input', ({ account, defType, fields, leaf, path }) => {
    const nodes = pdaSeedNodeFromAnchorV01({ account, kind: 'account', path }, [], undefined, [
        definedStruct(account, fields),
    ]);

    if (defType) expect(nodes?.definition).toEqual(variablePdaSeedNode(leaf, defType));
    expect(nodes?.value).toEqual(pdaSeedValueNode(leaf, argumentValueNode(leaf)));
});

test('it sources a deeper nested account-data path from a caller input', () => {
    const nodes = pdaSeedNodeFromAnchorV01(
        { account: 'Config', kind: 'account', path: 'config.inner.value' },
        [],
        undefined,
        [
            definedStruct('Config', { inner: { defined: { name: 'Inner' } } }),
            definedStruct('Inner', { value: 'pubkey' }),
        ],
    );

    expect(nodes?.value).toEqual(pdaSeedValueNode('value', argumentValueNode('value')));
});

test.each([
    { desc: 'sizePrefix bytes', type: sizePrefixTypeNode(bytesTypeNode(), numberTypeNode('u32')) },
    {
        desc: 'Vec<u8> (arrayTypeNode + prefixedCountNode)',
        type: arrayTypeNode(numberTypeNode('u8'), prefixedCountNode(numberTypeNode('u32'))),
    },
])('it removes the borsh length prefix from a $desc arg seed', ({ type }) => {
    const nodes = pdaSeedNodeFromAnchorV01({ kind: 'arg', path: 'payload' }, [
        instructionArgumentNode({ name: 'payload', type }),
    ]);

    expect(nodes?.definition).toEqual(variablePdaSeedNode('payload', bytesTypeNode()));
    expect(nodes?.value).toEqual(pdaSeedValueNode('payload', argumentValueNode('payload')));
});

test('it emits an i32 arg seed as default little-endian -- some on-chain seeds are BE but the IDL cannot say so', () => {
    const nodes = pdaSeedNodeFromAnchorV01({ kind: 'arg', path: 'data_group_lower_start_index' }, [
        instructionArgumentNode({ name: 'data_group_lower_start_index', type: numberTypeNode('i32') }),
    ]);

    expect(nodes?.definition).toEqual(variablePdaSeedNode('dataGroupLowerStartIndex', numberTypeNode('i32')));
});

test('it names an arg tuple-index seed after its parent', () => {
    const nodes = pdaSeedNodeFromAnchorV01({ kind: 'arg', path: 'data.0' }, [
        instructionArgumentNode({ name: 'data', type: tupleTypeNode([numberTypeNode('u64')]) }),
    ]);

    expect(nodes?.definition).toEqual(variablePdaSeedNode('data0', numberTypeNode('u64')));
    expect(nodes?.value).toEqual(pdaSeedValueNode('data0', argumentValueNode('data', ['0'])));
});

test('minimalDistinctSuffixNames pairs a trailing tuple index with its parent', () => {
    expect(minimalDistinctSuffixNames([['tup', '0']], undefined)).toEqual(['tup0']);

    const names = minimalDistinctSuffixNames(
        [
            ['foo', '0'],
            ['foo', '1'],
        ],
        undefined,
    );
    expect(names).toEqual(['foo0', 'foo1']);
    for (const name of names) expect(name).not.toMatch(/^\d/);
});
