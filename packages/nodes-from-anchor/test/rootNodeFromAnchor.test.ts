import {
    CODAMA_ERROR__ANCHOR__CPI_EVENTS_DUPLICATE_PROGRAM,
    CODAMA_ERROR__ANCHOR__CPI_EVENTS_UNKNOWN_EVENT,
    CODAMA_ERROR__ANCHOR__CPI_EVENTS_UNKNOWN_PROGRAM,
    CodamaError,
} from '@codama/errors';
import {
    assertIsNode,
    bytesTypeNode,
    bytesValueNode,
    constantDiscriminatorNode,
    constantPdaSeedNode,
    constantValueNode,
    fixedSizeTypeNode,
    instructionAccountNode,
    instructionNode,
    pdaNode,
    pdaValueNode,
    programNode,
    rootNode,
} from '@codama/nodes';
import { visit } from '@codama/visitors';
import { getUtf8Codec } from '@solana/codecs';
import { expect, test, vi } from 'vitest';

import {
    ANCHOR_EVENT_CPI_DISCRIMINATOR,
    defaultVisitor,
    detectEventCpiPrograms,
    IdlV01,
    rootNodeFromAnchor,
    rootNodeFromAnchorV01,
} from '../src';

const utf8 = (s: string) => Array.from(getUtf8Codec().encode(s));
const cpiPrefix = () =>
    constantValueNode(fixedSizeTypeNode(bytesTypeNode(), 8), bytesValueNode('base16', 'e445a52e51cb9a1d'));
const eventDisc = (hex: string) =>
    constantValueNode(fixedSizeTypeNode(bytesTypeNode(), 8), bytesValueNode('base16', hex));

const EVENT_AUTHORITY_SEED_BYTES = utf8('__event_authority');

test('it creates root nodes from IDL version 0.0', () => {
    const node = rootNodeFromAnchor({
        instructions: [],
        metadata: { address: '1111' },
        name: 'myProgram',
        version: '1.2.3',
    });

    expect(node).toEqual(
        rootNode(programNode({ name: 'myProgram', origin: 'anchor', publicKey: '1111', version: '1.2.3' })),
    );
});

test('ANCHOR_EVENT_CPI_DISCRIMINATOR matches the anchor-lang EVENT_IX_TAG_LE constant', () => {
    expect([...ANCHOR_EVENT_CPI_DISCRIMINATOR]).toStrictEqual([228, 69, 165, 46, 81, 203, 154, 29]);
});

const eventCpiIdl = (name = 'myProgram'): IdlV01 => ({
    address: '1111',
    events: [{ discriminator: [246, 28, 6, 87, 251, 45, 50, 42], name: 'MyEvent' }],
    instructions: [
        {
            accounts: [
                {
                    name: 'event_authority',
                    pda: { seeds: [{ kind: 'const', value: EVENT_AUTHORITY_SEED_BYTES }] },
                },
                { name: 'program' },
            ],
            args: [],
            discriminator: [1, 2, 3, 4, 5, 6, 7, 8],
            name: 'doThing',
        },
    ],
    metadata: { name, spec: '0.1.0', version: '1.2.3' },
    types: [{ name: 'MyEvent', type: { fields: [{ name: 'amount', type: 'u32' }], kind: 'struct' } }],
});

const plainIdl = (name = 'otherProgram'): IdlV01 => ({
    address: '2222',
    events: [{ discriminator: [10, 20, 30, 40, 50, 60, 70, 80], name: 'OtherEvent' }],
    instructions: [],
    metadata: { name, spec: '0.1.0', version: '1.2.3' },
    types: [{ name: 'OtherEvent', type: { fields: [{ name: 'amount', type: 'u32' }], kind: 'struct' } }],
});

const eventCpiIdlMulti = (name = 'myProgram'): IdlV01 => ({
    ...eventCpiIdl(name),
    events: [
        { discriminator: [246, 28, 6, 87, 251, 45, 50, 42], name: 'MyEvent' },
        { discriminator: [100, 101, 102, 103, 104, 105, 106, 107], name: 'EventB' },
        { discriminator: [200, 201, 202, 203, 204, 205, 206, 207], name: 'EventC' },
    ],
    types: [
        { name: 'MyEvent', type: { fields: [{ name: 'amount', type: 'u32' }], kind: 'struct' } },
        { name: 'EventB', type: { fields: [{ name: 'amount', type: 'u64' }], kind: 'struct' } },
        { name: 'EventC', type: { fields: [{ name: 'amount', type: 'u16' }], kind: 'struct' } },
    ],
});

test('wraps detected emit_cpi! events with the CPI discriminator', () => {
    const result = rootNodeFromAnchor(eventCpiIdl());

    assertIsNode(result, 'rootNode');
    const event = result.program.events[0];
    assertIsNode(event.data, 'hiddenPrefixTypeNode');
    const myEventDisc = eventDisc('f61c0657fb2d322a');

    expect(event.framing?.kind).toBe('anchorEventCpi');
    expect(event.data.prefix).toStrictEqual([cpiPrefix(), myEventDisc]);
    expect(event.discriminators).toStrictEqual([
        constantDiscriminatorNode(cpiPrefix(), 0),
        constantDiscriminatorNode(myEventDisc, 8),
    ]);
});

test('leaves events unwrapped when no event_authority account is present', () => {
    const idl = eventCpiIdl();
    idl.instructions[0].accounts = [{ name: 'payer', signer: true, writable: true }];

    const result = rootNodeFromAnchor(idl);

    assertIsNode(result, 'rootNode');
    expect(result.program.events[0].framing).toBeUndefined();
    expect(result.program.events[0].discriminators).toStrictEqual([
        constantDiscriminatorNode(eventDisc('f61c0657fb2d322a'), 0),
    ]);
});

test('only wraps programs that actually use event CPI', () => {
    const result = visit(
        rootNodeFromAnchorV01(eventCpiIdl('primaryProgram'), [plainIdl('plainProgram')]),
        defaultVisitor(),
    );
    assertIsNode(result, 'rootNode');

    expect(result.program.events[0].framing?.kind).toBe('anchorEventCpi');
    expect(result.program.events[0].discriminators).toStrictEqual([
        constantDiscriminatorNode(cpiPrefix(), 0),
        constantDiscriminatorNode(eventDisc('f61c0657fb2d322a'), 8),
    ]);
    expect(result.additionalPrograms[0].events[0].framing).toBeUndefined();
    expect(result.additionalPrograms[0].events[0].discriminators).toStrictEqual([
        constantDiscriminatorNode(eventDisc('0a141e28323c4650'), 0),
    ]);
});

test('wraps the additional program when it is the one using event CPI', () => {
    const result = visit(
        rootNodeFromAnchorV01(plainIdl('plainProgram'), [eventCpiIdl('cpiProgram')]),
        defaultVisitor(),
    );
    assertIsNode(result, 'rootNode');

    expect(result.program.events[0].framing).toBeUndefined();
    expect(result.program.events[0].discriminators).toStrictEqual([
        constantDiscriminatorNode(eventDisc('0a141e28323c4650'), 0),
    ]);
    expect(result.additionalPrograms[0].events[0].framing?.kind).toBe('anchorEventCpi');
    expect(result.additionalPrograms[0].events[0].discriminators).toStrictEqual([
        constantDiscriminatorNode(cpiPrefix(), 0),
        constantDiscriminatorNode(eventDisc('f61c0657fb2d322a'), 8),
    ]);
});

test('rootNodeFromAnchorV01 does not wrap events on its own', () => {
    const result = rootNodeFromAnchorV01(eventCpiIdl());

    assertIsNode(result, 'rootNode');
    expect(result.program.events[0].discriminators).toStrictEqual([
        constantDiscriminatorNode(eventDisc('f61c0657fb2d322a'), 0),
    ]);
});

test('cpiEvents wraps only the listed events within a detected program', () => {
    const result = rootNodeFromAnchor(eventCpiIdlMulti(), { cpiEvents: ['MyEvent'] });

    assertIsNode(result, 'rootNode');
    const [myEvent, eventB, eventC] = result.program.events;

    expect(myEvent.framing?.kind).toBe('anchorEventCpi');
    expect(myEvent.discriminators).toStrictEqual([
        constantDiscriminatorNode(cpiPrefix(), 0),
        constantDiscriminatorNode(eventDisc('f61c0657fb2d322a'), 8),
    ]);
    expect(eventB.framing).toBeUndefined();
    expect(eventB.discriminators).toStrictEqual([constantDiscriminatorNode(eventDisc('6465666768696a6b'), 0)]);
    expect(eventC.framing).toBeUndefined();
    expect(eventC.discriminators).toStrictEqual([constantDiscriminatorNode(eventDisc('c8c9cacbcccdcecf'), 0)]);
});

test('cpiEvents with an empty array opts a detected program out of wrapping', () => {
    const result = rootNodeFromAnchor(eventCpiIdl(), { cpiEvents: [] });

    assertIsNode(result, 'rootNode');
    expect(result.program.events[0].framing).toBeUndefined();
    expect(result.program.events[0].discriminators).toStrictEqual([
        constantDiscriminatorNode(eventDisc('f61c0657fb2d322a'), 0),
    ]);
});

test('cpiEvents event names are normalized to camelCase', () => {
    const result = rootNodeFromAnchor(eventCpiIdlMulti(), { cpiEvents: ['my_event'] });

    assertIsNode(result, 'rootNode');
    const [myEvent, eventB] = result.program.events;
    expect(myEvent.framing?.kind).toBe('anchorEventCpi');
    expect(myEvent.discriminators).toStrictEqual([
        constantDiscriminatorNode(cpiPrefix(), 0),
        constantDiscriminatorNode(eventDisc('f61c0657fb2d322a'), 8),
    ]);
    expect(eventB.framing).toBeUndefined();
    expect(eventB.discriminators).toStrictEqual([constantDiscriminatorNode(eventDisc('6465666768696a6b'), 0)]);
});

test('omitting a program from cpiEventsByProgram keeps default auto-wrap behavior', () => {
    const result = visit(
        rootNodeFromAnchorV01(eventCpiIdl('primaryProgram'), [eventCpiIdl('additionalProgram')]),
        defaultVisitor({ cpiEventsByProgram: { primaryProgram: [] } }),
    );
    assertIsNode(result, 'rootNode');

    expect(result.program.events[0].framing).toBeUndefined();
    expect(result.program.events[0].discriminators).toStrictEqual([
        constantDiscriminatorNode(eventDisc('f61c0657fb2d322a'), 0),
    ]);
    expect(result.additionalPrograms[0].events[0].framing?.kind).toBe('anchorEventCpi');
    expect(result.additionalPrograms[0].events[0].discriminators).toStrictEqual([
        constantDiscriminatorNode(cpiPrefix(), 0),
        constantDiscriminatorNode(eventDisc('f61c0657fb2d322a'), 8),
    ]);
});

test('throws on unknown program in cpiEventsByProgram', () => {
    expect(() =>
        visit(rootNodeFromAnchorV01(eventCpiIdl()), defaultVisitor({ cpiEventsByProgram: { typo: ['MyEvent'] } })),
    ).toThrow(
        new CodamaError(CODAMA_ERROR__ANCHOR__CPI_EVENTS_UNKNOWN_PROGRAM, {
            detectedPrograms: ['myProgram'],
            programName: 'typo',
        }),
    );
});

test('throws on unknown event in cpiEvents', () => {
    expect(() => rootNodeFromAnchor(eventCpiIdl(), { cpiEvents: ['TotallyFake'] })).toThrow(
        new CodamaError(CODAMA_ERROR__ANCHOR__CPI_EVENTS_UNKNOWN_EVENT, {
            availableEvents: ['myEvent'],
            eventName: 'totallyFake',
            programName: 'myProgram',
        }),
    );
});

test('throws when cpiEventsByProgram references a program without event CPI', () => {
    expect(() =>
        visit(
            rootNodeFromAnchorV01(eventCpiIdl('primaryProgram'), [plainIdl('plainProgram')]),
            defaultVisitor({ cpiEventsByProgram: { plainProgram: [] } }),
        ),
    ).toThrow(
        new CodamaError(CODAMA_ERROR__ANCHOR__CPI_EVENTS_UNKNOWN_PROGRAM, {
            detectedPrograms: ['primaryProgram'],
            programName: 'plainProgram',
        }),
    );
});

test('throws when cpiEvents is supplied for an IDL with no event-CPI programs', () => {
    expect(() => rootNodeFromAnchor(plainIdl(), { cpiEvents: ['OtherEvent'] })).toThrow(
        new CodamaError(CODAMA_ERROR__ANCHOR__CPI_EVENTS_UNKNOWN_PROGRAM, {
            detectedPrograms: [],
            programName: 'otherProgram',
        }),
    );
});

test('throws on duplicate cpiEventsByProgram keys that normalize to the same name', () => {
    expect(() =>
        visit(
            rootNodeFromAnchorV01(eventCpiIdl()),
            defaultVisitor({ cpiEventsByProgram: { myProgram: ['MyEvent'], my_program: ['MyEvent'] } }),
        ),
    ).toThrow(
        new CodamaError(CODAMA_ERROR__ANCHOR__CPI_EVENTS_DUPLICATE_PROGRAM, {
            normalizedName: 'myProgram',
            originalNames: ['myProgram', 'my_program'],
        }),
    );
});

test('reports every conflicting key when three or more keys normalize to the same name', () => {
    expect(() =>
        visit(
            rootNodeFromAnchorV01(eventCpiIdl()),
            defaultVisitor({
                cpiEventsByProgram: {
                    'My-Program': ['MyEvent'],
                    myProgram: ['MyEvent'],
                    my_program: ['MyEvent'],
                },
            }),
        ),
    ).toThrow(
        new CodamaError(CODAMA_ERROR__ANCHOR__CPI_EVENTS_DUPLICATE_PROGRAM, {
            normalizedName: 'myProgram',
            originalNames: ['My-Program', 'myProgram', 'my_program'],
        }),
    );
});

test('rejects an event_authority PDA whose seed is not __event_authority', () => {
    const idl = withEventAuthoritySeeds([{ kind: 'const', value: utf8('some_other_seed') }]);
    const result = rootNodeFromAnchor(idl);
    assertIsNode(result, 'rootNode');
    expect(result.program.events[0].framing).toBeUndefined();
    expect(result.program.events[0].discriminators).toStrictEqual([
        constantDiscriminatorNode(eventDisc('f61c0657fb2d322a'), 0),
    ]);
});

test('rejects an event_authority PDA with __event_authority plus an extra seed', () => {
    const idl = withEventAuthoritySeeds([
        { kind: 'const', value: EVENT_AUTHORITY_SEED_BYTES },
        { kind: 'const', value: utf8('extra') },
    ]);
    const result = rootNodeFromAnchor(idl);
    assertIsNode(result, 'rootNode');
    expect(result.program.events[0].framing).toBeUndefined();
    expect(result.program.events[0].discriminators).toStrictEqual([
        constantDiscriminatorNode(eventDisc('f61c0657fb2d322a'), 0),
    ]);
});

test('warns when event_authority is present but the program account is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const idl: IdlV01 = {
        ...eventCpiIdl(),
        instructions: [
            {
                accounts: [
                    {
                        name: 'event_authority',
                        pda: { seeds: [{ kind: 'const', value: EVENT_AUTHORITY_SEED_BYTES }] },
                    },
                ],
                args: [],
                discriminator: [1, 2, 3, 4, 5, 6, 7, 8],
                name: 'doThing',
            },
        ],
    };

    rootNodeFromAnchor(idl);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('missing "program" account'));
    warn.mockRestore();
});

test('warns when event_authority PDA does not use the __event_authority seed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    rootNodeFromAnchor(withEventAuthoritySeeds([{ kind: 'const', value: utf8('some_other_seed') }]));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('event_authority PDA seed mismatch'));
    warn.mockRestore();
});

test('detects when the __event_authority seed is base16-encoded', () => {
    const root = rootNode(
        programNode({
            instructions: [
                instructionNode({
                    accounts: [
                        instructionAccountNode({
                            defaultValue: pdaValueNode(
                                pdaNode({
                                    name: 'eventAuthority',
                                    seeds: [
                                        constantPdaSeedNode(
                                            bytesTypeNode(),
                                            bytesValueNode('base16', '5f5f6576656e745f617574686f72697479'),
                                        ),
                                    ],
                                }),
                            ),
                            isSigner: false,
                            isWritable: false,
                            name: 'eventAuthority',
                        }),
                        instructionAccountNode({ isSigner: false, isWritable: false, name: 'program' }),
                    ],
                    name: 'doThing',
                }),
            ],
            name: 'myProgram',
            publicKey: '1111',
        }),
    );

    expect(detectEventCpiPrograms(root)).toStrictEqual(['myProgram']);
});

function withEventAuthoritySeeds(seeds: { kind: 'const'; value: number[] }[]): IdlV01 {
    return {
        ...eventCpiIdl(),
        instructions: [
            {
                accounts: [{ name: 'event_authority', pda: { seeds } }, { name: 'program' }],
                args: [],
                discriminator: [1, 2, 3, 4, 5, 6, 7, 8],
                name: 'doThing',
            },
        ],
    };
}
