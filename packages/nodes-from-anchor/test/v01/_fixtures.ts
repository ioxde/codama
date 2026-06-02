import { type InstructionNode, isNode } from '@codama/nodes';

import { GenericsV01, instructionNodeFromAnchorV01 } from '../../src';

export const generics = {} as GenericsV01;

type IxIdl = Parameters<typeof instructionNodeFromAnchorV01>[0];
type DefinedTypes = NonNullable<Parameters<typeof instructionNodeFromAnchorV01>[1]>;

// Compact Anchor struct/tuple defined-type. `fields` is a record `{ fieldName: type }`, or — for an
// Anchor tuple-struct — an array of bare type strings (e.g. `['pubkey', 'u64']`).
export function definedStruct(
    name: string,
    fields: Record<string, unknown> | readonly unknown[],
): DefinedTypes[number] {
    const built = Array.isArray(fields)
        ? fields
        : Object.entries(fields).map(([fieldName, type]) => ({ name: fieldName, type }));
    return { name, type: { fields: built, kind: 'struct' } } as DefinedTypes[number];
}

// Build an instruction node from a compact spec (args/discriminator/definedTypes default to empty).
export function ix(
    name: string,
    accounts: IxIdl['accounts'],
    opts: { args?: IxIdl['args']; definedTypes?: DefinedTypes; discriminator?: IxIdl['discriminator'] } = {},
): InstructionNode {
    return instructionNodeFromAnchorV01(
        { accounts, args: opts.args ?? [], discriminator: opts.discriminator ?? [0, 0, 0, 0, 0, 0, 0, 0], name },
        opts.definedTypes ?? [],
        generics,
    );
}

// The argumentValueNode names of an account's resolved-PDA seeds (skips account/const seeds).
export function seedArgNames(node: InstructionNode, accountName: string): string[] {
    const dv = node.accounts.find(a => a.name === accountName)?.defaultValue;
    return isNode(dv, 'pdaValueNode')
        ? dv.seeds.flatMap(s => (isNode(s.value, 'argumentValueNode') ? [s.value.name] : []))
        : [];
}

// The argumentValueNode name of an account's first PDA seed value, if any.
export function firstSeedInputName(node: InstructionNode, accountName: string): string | undefined {
    const dv = node.accounts.find(a => a.name === accountName)?.defaultValue;
    const value = isNode(dv, 'pdaValueNode') ? dv.seeds[0]?.value : undefined;
    return isNode(value, 'argumentValueNode') ? value.name : undefined;
}
