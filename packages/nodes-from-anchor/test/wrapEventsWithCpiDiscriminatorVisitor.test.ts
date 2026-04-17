import { CODAMA_ERROR__VISITORS__INVALID_CPI_DISCRIMINATOR_TYPE, CodamaError } from '@codama/errors';
import {
    assertIsNode,
    bytesTypeNode,
    bytesValueNode,
    constantDiscriminatorNode,
    constantValueNode,
    EventNode,
    eventNode,
    fieldDiscriminatorNode,
    fixedSizeTypeNode,
    hiddenPrefixTypeNode,
    numberTypeNode,
    programNode,
    rootNode,
    sizeDiscriminatorNode,
    structFieldTypeNode,
    structTypeNode,
} from '@codama/nodes';
import { visit } from '@codama/visitors';
import { expect, test } from 'vitest';

import { anchorEventCpiFraming, wrapEventsWithCpiDiscriminatorVisitor } from '../src';

const ANCHOR_CPI_BYTES = [228, 69, 165, 46, 81, 203, 154, 29];

const cpi = () =>
    constantValueNode(fixedSizeTypeNode(bytesTypeNode(), 8), bytesValueNode('base16', 'e445a52e51cb9a1d'));
const disc = (hex: string) => constantValueNode(fixedSizeTypeNode(bytesTypeNode(), 8), bytesValueNode('base16', hex));
const struct = () => structTypeNode([structFieldTypeNode({ name: 'amount', type: numberTypeNode('u32') })]);
const wrapIn = (events: EventNode[], name = 'myProgram') => programNode({ events, name, publicKey: '1111' });

test('prepends the CPI prefix and shifts the existing discriminator offset', () => {
    const eventDisc = disc('f61c0657fb2d322a');
    const input = wrapIn([
        eventNode({
            data: hiddenPrefixTypeNode(struct(), [eventDisc]),
            discriminators: [constantDiscriminatorNode(eventDisc, 0)],
            name: 'myEvent',
        }),
    ]);

    const result = visit(input, wrapEventsWithCpiDiscriminatorVisitor({ discriminator: ANCHOR_CPI_BYTES }));

    assertIsNode(result, 'programNode');
    expect(result.events[0].framing?.kind).toBe('anchorEventCpi');
    expect(result.events[0].data).toStrictEqual(hiddenPrefixTypeNode(struct(), [cpi(), eventDisc]));
    expect(result.events[0].discriminators).toStrictEqual([
        constantDiscriminatorNode(cpi(), 0),
        constantDiscriminatorNode(eventDisc, 8),
    ]);
});

test('wraps events whose data is a plain struct', () => {
    const input = wrapIn([eventNode({ data: struct(), discriminators: [], name: 'plainEvent' })]);

    const result = visit(input, wrapEventsWithCpiDiscriminatorVisitor({ discriminator: ANCHOR_CPI_BYTES }));

    assertIsNode(result, 'programNode');
    expect(result.events[0].framing?.kind).toBe('anchorEventCpi');
    expect(result.events[0].data).toStrictEqual(hiddenPrefixTypeNode(struct(), [cpi()]));
    expect(result.events[0].discriminators).toStrictEqual([constantDiscriminatorNode(cpi(), 0)]);
});

test('shifts non-zero offsets of existing constant discriminators', () => {
    const inner = disc('deadbeefcafef00d');
    const input = wrapIn([
        eventNode({
            data: hiddenPrefixTypeNode(struct(), [inner]),
            discriminators: [constantDiscriminatorNode(inner, 12)],
            name: 'shifted',
        }),
    ]);

    const result = visit(input, wrapEventsWithCpiDiscriminatorVisitor({ discriminator: ANCHOR_CPI_BYTES }));

    assertIsNode(result, 'programNode');
    expect(result.events[0].discriminators).toStrictEqual([
        constantDiscriminatorNode(cpi(), 0),
        constantDiscriminatorNode(inner, 20),
    ]);
});

test('shifts field discriminator offsets', () => {
    const input = wrapIn([
        eventNode({ data: struct(), discriminators: [fieldDiscriminatorNode('kind', 0)], name: 'withField' }),
    ]);

    const result = visit(input, wrapEventsWithCpiDiscriminatorVisitor({ discriminator: ANCHOR_CPI_BYTES }));

    assertIsNode(result, 'programNode');
    expect(result.events[0].discriminators).toStrictEqual([
        constantDiscriminatorNode(cpi(), 0),
        fieldDiscriminatorNode('kind', 8),
    ]);
});

test('shifts size discriminators by the prefix length', () => {
    const input = wrapIn([
        eventNode({ data: struct(), discriminators: [sizeDiscriminatorNode(32)], name: 'withSize' }),
    ]);

    const result = visit(input, wrapEventsWithCpiDiscriminatorVisitor({ discriminator: ANCHOR_CPI_BYTES }));

    assertIsNode(result, 'programNode');
    expect(result.events[0].discriminators).toStrictEqual([
        constantDiscriminatorNode(cpi(), 0),
        sizeDiscriminatorNode(40),
    ]);
});

test('is idempotent when the framing tag is already set', () => {
    const eventDisc = disc('f61c0657fb2d322a');
    const alreadyWrapped = eventNode({
        data: hiddenPrefixTypeNode(struct(), [cpi(), eventDisc]),
        discriminators: [constantDiscriminatorNode(cpi(), 0), constantDiscriminatorNode(eventDisc, 8)],
        framing: anchorEventCpiFraming,
        name: 'myEvent',
    });
    const input = wrapIn([alreadyWrapped]);

    const result = visit(input, wrapEventsWithCpiDiscriminatorVisitor({ discriminator: ANCHOR_CPI_BYTES }));

    expect(result).toStrictEqual(input);
});

test('emitted framing carries the shared constant name', () => {
    const input = wrapIn([eventNode({ data: struct(), name: 'myEvent' })]);

    const result = visit(input, wrapEventsWithCpiDiscriminatorVisitor({ discriminator: ANCHOR_CPI_BYTES }));

    assertIsNode(result, 'programNode');
    expect(result.events[0].framing).toStrictEqual(anchorEventCpiFraming);
});

test('tags but does not re-wrap events whose first prefix already matches the CPI envelope', () => {
    const eventDisc = disc('f61c0657fb2d322a');
    const preWrappedNoTag = eventNode({
        data: hiddenPrefixTypeNode(struct(), [cpi(), eventDisc]),
        discriminators: [constantDiscriminatorNode(cpi(), 0), constantDiscriminatorNode(eventDisc, 8)],
        name: 'myEvent',
    });
    const input = wrapIn([preWrappedNoTag]);

    const result = visit(input, wrapEventsWithCpiDiscriminatorVisitor({ discriminator: ANCHOR_CPI_BYTES }));

    assertIsNode(result, 'programNode');
    expect(result.events[0].framing?.kind).toBe('anchorEventCpi');
    expect(result.events[0].data).toStrictEqual(preWrappedNoTag.data);
    expect(result.events[0].discriminators).toStrictEqual(preWrappedNoTag.discriminators);
});

test.each([
    ['base16 lowercase', cpi()],
    [
        'base16 uppercase',
        constantValueNode(fixedSizeTypeNode(bytesTypeNode(), 8), bytesValueNode('base16', 'E445A52E51CB9A1D')),
    ],
    ['base58', constantValueNode(fixedSizeTypeNode(bytesTypeNode(), 8), bytesValueNode('base58', 'fBXSauZxba4'))],
    ['base64', constantValueNode(fixedSizeTypeNode(bytesTypeNode(), 8), bytesValueNode('base64', '5EWlLlHLmh0='))],
])('tags a pre-wrapped event regardless of how the prefix is encoded (%s)', (_label, prefix) => {
    const eventDisc = disc('f61c0657fb2d322a');
    const preWrapped = eventNode({
        data: hiddenPrefixTypeNode(struct(), [prefix, eventDisc]),
        discriminators: [constantDiscriminatorNode(prefix, 0), constantDiscriminatorNode(eventDisc, 8)],
        name: 'myEvent',
    });
    const input = wrapIn([preWrapped]);

    const result = visit(input, wrapEventsWithCpiDiscriminatorVisitor({ discriminator: ANCHOR_CPI_BYTES }));

    assertIsNode(result, 'programNode');
    expect(result.events[0].framing?.kind).toBe('anchorEventCpi');
    expect(result.events[0].data).toStrictEqual(preWrapped.data);
    expect(result.events[0].discriminators).toStrictEqual(preWrapped.discriminators);
});

test('only wraps events listed under the program in eventsByProgram', () => {
    const discA = disc('aaaaaaaaaaaaaaaa');
    const discB = disc('bbbbbbbbbbbbbbbb');
    const eventA = eventNode({
        data: hiddenPrefixTypeNode(struct(), [discA]),
        discriminators: [constantDiscriminatorNode(discA, 0)],
        name: 'a',
    });
    const eventB = eventNode({
        data: hiddenPrefixTypeNode(struct(), [discB]),
        discriminators: [constantDiscriminatorNode(discB, 0)],
        name: 'b',
    });
    const program = wrapIn([eventA, eventB], 'p');

    const result = visit(
        program,
        wrapEventsWithCpiDiscriminatorVisitor({
            discriminator: ANCHOR_CPI_BYTES,
            eventsByProgram: { p: ['a'] },
        }),
    );

    assertIsNode(result, 'programNode');
    expect(result.events[0].framing?.kind).toBe('anchorEventCpi');
    expect(result.events[0].data).toStrictEqual(hiddenPrefixTypeNode(struct(), [cpi(), discA]));
    expect(result.events[1]).toStrictEqual(eventB);
    expect(result.events[1].framing).toBeUndefined();
});

test('only wraps programs listed in eventsByProgram', () => {
    const discA = disc('aaaaaaaaaaaaaaaa');
    const discB = disc('bbbbbbbbbbbbbbbb');
    const progA = programNode({
        events: [
            eventNode({
                data: hiddenPrefixTypeNode(struct(), [discA]),
                discriminators: [constantDiscriminatorNode(discA, 0)],
                name: 'evA',
            }),
        ],
        name: 'progA',
        publicKey: '1111',
    });
    const progB = programNode({
        events: [
            eventNode({
                data: hiddenPrefixTypeNode(struct(), [discB]),
                discriminators: [constantDiscriminatorNode(discB, 0)],
                name: 'evB',
            }),
        ],
        name: 'progB',
        publicKey: '2222',
    });
    const root = rootNode(progA, [progB]);

    const result = visit(
        root,
        wrapEventsWithCpiDiscriminatorVisitor({
            discriminator: ANCHOR_CPI_BYTES,
            eventsByProgram: { progA: null },
        }),
    );

    assertIsNode(result, 'rootNode');
    expect(result.program.events[0].framing?.kind).toBe('anchorEventCpi');
    expect(result.program.events[0].data).toStrictEqual(hiddenPrefixTypeNode(struct(), [cpi(), discA]));
    expect(result.additionalPrograms[0].events[0]).toStrictEqual(progB.events[0]);
    expect(result.additionalPrograms[0].events[0].framing).toBeUndefined();
});

test('throws when the pre-built discriminator has a non-fixed-size type', () => {
    const bad = constantValueNode(bytesTypeNode(), bytesValueNode('base16', 'e445a52e51cb9a1d'));

    expect(() => wrapEventsWithCpiDiscriminatorVisitor({ discriminator: bad })).toThrow(
        new CodamaError(CODAMA_ERROR__VISITORS__INVALID_CPI_DISCRIMINATOR_TYPE, { kind: 'bytesTypeNode' }),
    );
});

test('throws when the pre-built discriminator wraps a non-bytes type', () => {
    const bad = constantValueNode(fixedSizeTypeNode(numberTypeNode('u64'), 8), bytesValueNode('base16', '00'));

    expect(() => wrapEventsWithCpiDiscriminatorVisitor({ discriminator: bad })).toThrow(
        new CodamaError(CODAMA_ERROR__VISITORS__INVALID_CPI_DISCRIMINATOR_TYPE, {
            kind: 'fixedSizeTypeNode<numberTypeNode>',
        }),
    );
});

test('wraps only emit_cpi! events in a mixed program', () => {
    const discEmitA = disc('1111111111111111');
    const discCpiB = disc('2222222222222222');
    const discEmitC = disc('3333333333333333');
    const discCpiD = disc('4444444444444444');
    const mkEvent = (d: ReturnType<typeof disc>, name: string) =>
        eventNode({
            data: hiddenPrefixTypeNode(struct(), [d]),
            discriminators: [constantDiscriminatorNode(d, 0)],
            name,
        });

    const program = programNode({
        events: [
            mkEvent(discEmitA, 'emitA'),
            mkEvent(discCpiB, 'cpiB'),
            mkEvent(discEmitC, 'emitC'),
            mkEvent(discCpiD, 'cpiD'),
        ],
        name: 'mixed',
        publicKey: '1111',
    });

    const result = visit(
        program,
        wrapEventsWithCpiDiscriminatorVisitor({
            discriminator: ANCHOR_CPI_BYTES,
            eventsByProgram: { mixed: ['cpiB', 'cpiD'] },
        }),
    );

    assertIsNode(result, 'programNode');
    expect(result.events[0].framing).toBeUndefined();
    expect(result.events[0].data).toStrictEqual(hiddenPrefixTypeNode(struct(), [discEmitA]));
    expect(result.events[2].framing).toBeUndefined();
    expect(result.events[2].data).toStrictEqual(hiddenPrefixTypeNode(struct(), [discEmitC]));
    expect(result.events[1].framing?.kind).toBe('anchorEventCpi');
    expect(result.events[1].data).toStrictEqual(hiddenPrefixTypeNode(struct(), [cpi(), discCpiB]));
    expect(result.events[1].discriminators).toStrictEqual([
        constantDiscriminatorNode(cpi(), 0),
        constantDiscriminatorNode(discCpiB, 8),
    ]);
    expect(result.events[3].framing?.kind).toBe('anchorEventCpi');
    expect(result.events[3].data).toStrictEqual(hiddenPrefixTypeNode(struct(), [cpi(), discCpiD]));
    expect(result.events[3].discriminators).toStrictEqual([
        constantDiscriminatorNode(cpi(), 0),
        constantDiscriminatorNode(discCpiD, 8),
    ]);
});

test('accepts a pre-built ConstantValueNode for the discriminator', () => {
    const preBuilt = cpi();
    const eventDisc = disc('f61c0657fb2d322a');
    const input = wrapIn([
        eventNode({
            data: hiddenPrefixTypeNode(struct(), [eventDisc]),
            discriminators: [constantDiscriminatorNode(eventDisc, 0)],
            name: 'myEvent',
        }),
    ]);

    const result = visit(input, wrapEventsWithCpiDiscriminatorVisitor({ discriminator: preBuilt }));

    assertIsNode(result, 'programNode');
    expect(result.events[0].data).toStrictEqual(hiddenPrefixTypeNode(struct(), [preBuilt, eventDisc]));
    expect(result.events[0].discriminators).toStrictEqual([
        constantDiscriminatorNode(preBuilt, 0),
        constantDiscriminatorNode(eventDisc, 8),
    ]);
});

test('an empty eventsByProgram record matches no program', () => {
    const d = disc('aaaaaaaaaaaaaaaa');
    const event = eventNode({
        data: hiddenPrefixTypeNode(struct(), [d]),
        discriminators: [constantDiscriminatorNode(d, 0)],
        name: 'a',
    });
    const program = wrapIn([event], 'p');

    const result = visit(
        program,
        wrapEventsWithCpiDiscriminatorVisitor({ discriminator: ANCHOR_CPI_BYTES, eventsByProgram: {} }),
    );

    assertIsNode(result, 'programNode');
    expect(result.events[0]).toStrictEqual(event);
});

test('a program in eventsByProgram with no events is skipped', () => {
    const empty = programNode({ events: [], name: 'empty', publicKey: '1111' });

    const result = visit(
        empty,
        wrapEventsWithCpiDiscriminatorVisitor({
            discriminator: ANCHOR_CPI_BYTES,
            eventsByProgram: { empty: null },
        }),
    );

    assertIsNode(result, 'programNode');
    expect(result).toStrictEqual(empty);
});

test('an empty event list opts the program out', () => {
    const d = disc('aaaaaaaaaaaaaaaa');
    const event = eventNode({
        data: hiddenPrefixTypeNode(struct(), [d]),
        discriminators: [constantDiscriminatorNode(d, 0)],
        name: 'a',
    });
    const program = wrapIn([event], 'p');

    const result = visit(
        program,
        wrapEventsWithCpiDiscriminatorVisitor({
            discriminator: ANCHOR_CPI_BYTES,
            eventsByProgram: { p: [] },
        }),
    );

    assertIsNode(result, 'programNode');
    expect(result.events[0]).toStrictEqual(event);
});

test('leaves matching events untouched when filter excludes them', () => {
    const d = disc('aaaaaaaaaaaaaaaa');
    const event = eventNode({
        data: hiddenPrefixTypeNode(struct(), [d]),
        discriminators: [constantDiscriminatorNode(d, 0)],
        name: 'a',
    });
    const program = wrapIn([event], 'p');

    const result = visit(
        program,
        wrapEventsWithCpiDiscriminatorVisitor({
            discriminator: ANCHOR_CPI_BYTES,
            eventsByProgram: { p: ['nonexistent'] },
        }),
    );

    assertIsNode(result, 'programNode');
    expect(result.events[0]).toStrictEqual(event);
});
