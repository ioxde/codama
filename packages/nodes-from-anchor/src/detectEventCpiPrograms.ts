import { logWarn } from '@codama/errors';
import { CamelCaseString, InstructionAccountNode, isNode, PdaNode, ProgramNode, RootNode } from '@codama/nodes';
import { getUtf8Codec } from '@solana/codecs';

import { encodeBytesValue } from './encodeBytesValue';

export function detectEventCpiPrograms(root: RootNode): CamelCaseString[] {
    return [root.program, ...root.additionalPrograms].filter(programHasEventCpi).map(p => p.name);
}

function programHasEventCpi(program: ProgramNode): boolean {
    return program.instructions.some(ix => {
        const authority = ix.accounts.find(isEventAuthorityLikeAccount);
        if (!authority) return false;
        if (!ix.accounts.some(a => a.name === ('program' as CamelCaseString))) {
            logWarn(`Skipping event CPI detection for "${program.name}::${ix.name}": missing "program" account.`);
            return false;
        }
        // v00 parser does not populate PDA defaultValue — silent (vs. seed-mismatch warn) because absence is expected.
        if (!authority.defaultValue) return false;
        if (!accountHasEventAuthoritySeed(authority, program)) {
            logWarn(
                `Skipping event CPI detection for "${program.name}::${ix.name}": event_authority PDA seed mismatch.`,
            );
            return false;
        }
        return true;
    });
}

function isEventAuthorityLikeAccount(account: InstructionAccountNode): boolean {
    return (
        account.name === ('eventAuthority' as CamelCaseString) &&
        account.isSigner !== true &&
        account.isWritable === false
    );
}

function accountHasEventAuthoritySeed(account: InstructionAccountNode, program: ProgramNode): boolean {
    if (!isNode(account.defaultValue, 'pdaValueNode')) return false;

    const pdaRef = account.defaultValue.pda;
    const pda: PdaNode | undefined = isNode(pdaRef, 'pdaNode')
        ? pdaRef
        : program.pdas.find(p => p.name === pdaRef.name);
    if (!pda || pda.seeds.length !== 1) return false;

    const first = pda.seeds[0];
    if (!isNode(first, 'constantPdaSeedNode')) return false;
    if (!isNode(first.value, 'bytesValueNode')) return false;

    const actual = encodeBytesValue(first.value);
    const expected = getUtf8Codec().encode('__event_authority');
    return actual.length === expected.length && actual.every((b, i) => b === expected[i]);
}
