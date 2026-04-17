import { CODAMA_ERROR__VISITORS__INVALID_CPI_DISCRIMINATOR_TYPE, CodamaError } from '@codama/errors';
import {
    assertIsNode,
    bytesTypeNode,
    bytesValueNode,
    camelCase,
    CamelCaseString,
    constantDiscriminatorNode,
    ConstantValueNode,
    constantValueNode,
    DiscriminatorNode,
    EventFraming,
    EventNode,
    eventNode,
    fieldDiscriminatorNode,
    fixedSizeTypeNode,
    hiddenPrefixTypeNode,
    isNode,
    programNode,
    sizeDiscriminatorNode,
} from '@codama/nodes';
import { bottomUpTransformerVisitor } from '@codama/visitors';

import { encodeBytesValue } from './encodeBytesValue';

// anchor-lang EVENT_IX_TAG_LE (lang/src/event.rs).
export const ANCHOR_EVENT_CPI_DISCRIMINATOR = [228, 69, 165, 46, 81, 203, 154, 29] as const;

export type AnchorEventCpiFraming = EventFraming & { readonly kind: 'anchorEventCpi' };

export const anchorEventCpiFraming: AnchorEventCpiFraming = Object.freeze({
    kind: 'anchorEventCpi',
    sharedConstantName: 'anchorEventCpiDiscriminator' as CamelCaseString,
});

export type WrapEventsWithCpiDiscriminatorOptions = {
    discriminator: ConstantValueNode | ReadonlyArray<number>;
    /** Per-program filter. Omit to wrap every event of every program. When provided,
     *  programs without an entry are left untouched; map a program name to `null` to
     *  wrap all of its events, to a list to wrap only those, or to `[]` to skip it. */
    eventsByProgram?: Record<string, readonly string[] | null>;
};

export function wrapEventsWithCpiDiscriminatorVisitor(options: WrapEventsWithCpiDiscriminatorOptions) {
    const cpiConstant = normalizeDiscriminator(options.discriminator);
    const cpiSize = getFixedByteSize(cpiConstant);
    const filter = options.eventsByProgram
        ? new Map(
              Object.entries(options.eventsByProgram).map(([k, v]) => [
                  camelCase(k),
                  v === null ? null : new Set(v.map(camelCase)),
              ]),
          )
        : null;

    return bottomUpTransformerVisitor([
        {
            select: '[programNode]',
            transform: node => {
                assertIsNode(node, 'programNode');
                if (node.events.length === 0) return node;

                let allowed: Set<string> | null;
                if (filter) {
                    if (!filter.has(node.name)) return node;
                    allowed = filter.get(node.name) ?? null;
                    if (allowed && allowed.size === 0) return node;
                } else {
                    allowed = null;
                }

                const newEvents = node.events.map(event => {
                    if (allowed && !allowed.has(event.name)) return event;
                    return wrapEvent(event, cpiConstant, cpiSize);
                });

                return programNode({ ...node, events: newEvents });
            },
        },
    ]);
}

function wrapEvent(event: EventNode, cpiConstant: ConstantValueNode, cpiSize: number): EventNode {
    if (event.framing?.kind === 'anchorEventCpi') return event;

    if (isNode(event.data, 'hiddenPrefixTypeNode') && event.data.prefix.length > 0) {
        if (beginsWithCpi(event.data.prefix[0], cpiConstant)) {
            return eventNode({ ...event, framing: anchorEventCpiFraming });
        }
    }

    const newData = isNode(event.data, 'hiddenPrefixTypeNode')
        ? hiddenPrefixTypeNode(event.data.type, [cpiConstant, ...event.data.prefix])
        : hiddenPrefixTypeNode(event.data, [cpiConstant]);

    const shifted = (event.discriminators ?? []).map(d => shiftDiscriminator(d, cpiSize));
    const newDiscriminators: DiscriminatorNode[] = [constantDiscriminatorNode(cpiConstant, 0), ...shifted];

    return eventNode({ ...event, data: newData, discriminators: newDiscriminators, framing: anchorEventCpiFraming });
}

function normalizeDiscriminator(input: ConstantValueNode | ReadonlyArray<number>): ConstantValueNode {
    if ('kind' in input) return input;
    const base16 = input.reduce((s, b) => s + b.toString(16).padStart(2, '0'), '');
    return constantValueNode(fixedSizeTypeNode(bytesTypeNode(), input.length), bytesValueNode('base16', base16));
}

function getFixedByteSize(constant: ConstantValueNode): number {
    if (!isNode(constant.type, 'fixedSizeTypeNode')) {
        throw new CodamaError(CODAMA_ERROR__VISITORS__INVALID_CPI_DISCRIMINATOR_TYPE, { kind: constant.type.kind });
    }
    if (!isNode(constant.type.type, 'bytesTypeNode')) {
        throw new CodamaError(CODAMA_ERROR__VISITORS__INVALID_CPI_DISCRIMINATOR_TYPE, {
            kind: `fixedSizeTypeNode<${constant.type.type.kind}>`,
        });
    }
    return constant.type.size;
}

function beginsWithCpi(first: ConstantValueNode, cpi: ConstantValueNode): boolean {
    if (!isNode(first.value, 'bytesValueNode') || !isNode(cpi.value, 'bytesValueNode')) return false;
    const a = encodeBytesValue(first.value);
    const b = encodeBytesValue(cpi.value);
    return a.length >= b.length && b.every((byte, i) => byte === a[i]);
}

function shiftDiscriminator(d: DiscriminatorNode, by: number): DiscriminatorNode {
    switch (d.kind) {
        case 'constantDiscriminatorNode':
            return constantDiscriminatorNode(d.constant, d.offset + by);
        case 'fieldDiscriminatorNode':
            return fieldDiscriminatorNode(d.name, d.offset + by);
        case 'sizeDiscriminatorNode':
            return sizeDiscriminatorNode(d.size + by);
    }
}
