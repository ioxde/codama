import { tryResolveArgumentPathValue } from '@codama/dynamic-address-resolution';
import { camelCase, type CamelCaseString, getLastNodeFromPath } from 'codama';

import { formatArgumentValue } from './format-argument-value';
import { resolveDisplayTypePath } from './resolve-display-type';
import type { DisplayContext } from './types';

/**
 * A dotted `accounts` token stays malformed: `camelCase` folds `destination.owner` into
 * `destinationOwner` and binds the wrong account's address.
 */
const PLACEHOLDER_PATTERN =
    /\$\{\s*(?:data\.(?<dataRef>[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*)|accounts\.(?<accountName>[a-zA-Z0-9_]+))\s*\}/g;

/** Must match everything {@link PLACEHOLDER_PATTERN} does, or an unresolved `${...}` reaches the signing sentence. */
const ANY_PLACEHOLDER_PATTERN = /\$\{[^}]*\}/g;

/** A dotted `${data.<argument>.<field>}` placeholder split into its argument name and path segments (never empty). */
export type NestedDataPlaceholder = {
    readonly name: string;
    readonly segments: readonly string[];
};

/**
 * Top-level `${data.<argument>}` placeholders are excluded; the argument walk already covers them.
 * A malformed template yields nothing, since the sentence is dropped wholesale.
 */
export function collectNestedDataPlaceholders(template: string | undefined): NestedDataPlaceholder[] {
    if (template === undefined) return [];
    return (matchWellFormedPlaceholders(template) ?? []).flatMap(match => {
        const dataRef = match.groups?.['dataRef'];
        if (dataRef === undefined) return [];
        const [name, ...segments] = dataRef.split('.');
        return segments.length === 0 ? [] : [{ name, segments }];
    });
}

/**
 * Counting `${` openers is not redundant: {@link ANY_PLACEHOLDER_PATTERN} cannot match a dangling
 * `${` with no closing brace, so nothing else catches one.
 */
function matchWellFormedPlaceholders(template: string): RegExpMatchArray[] | null {
    const matches = [...template.matchAll(PLACEHOLDER_PATTERN)];
    const wellFormed = new Set(matches.map(([token]) => token));
    const anyTokens = template.match(ANY_PLACEHOLDER_PATTERN) ?? [];
    const openerCount = template.split('${').length - 1;
    if (anyTokens.length !== openerCount || anyTokens.some(token => !wellFormed.has(token))) return null;
    return matches;
}

/** Returns `null` — the caller falls back to the field list — for anything the sentence cannot state exactly. */
export async function interpolateIntent(displayContext: DisplayContext): Promise<string | null> {
    const instruction = getLastNodeFromPath(displayContext.parsedInstruction.path);
    const template = instruction.display?.interpolatedIntent;
    if (template === undefined) return null;

    const matches = matchWellFormedPlaceholders(template);
    if (matches === null) return null;
    const placeholders = matches.filter(([token], index, all) => all.findIndex(([other]) => other === token) === index);

    const resolved = await Promise.all(
        placeholders.map(async match => {
            return [match[0], await resolvePlaceholder(match, displayContext)] as const;
        }),
    );

    if (resolved.some(([, value]) => value === null)) return null;
    const replacements = new Map(resolved);

    return template.replace(PLACEHOLDER_PATTERN, match => replacements.get(match) ?? match);
}

async function resolvePlaceholder(match: RegExpMatchArray, displayContext: DisplayContext): Promise<string | null> {
    const dataRef = match.groups?.['dataRef'];
    if (dataRef !== undefined) return await resolveDataPlaceholder(dataRef, displayContext);

    const accountName = match.groups?.['accountName'];
    if (accountName === undefined) return null;
    // Parsed instructions built from bare JSON carry un-normalised account names; a miss here silently drops the sentence.
    const target = camelCase(accountName);
    const address = displayContext.parsedInstruction.accounts.find(
        account => camelCase(account.name) === target,
    )?.address;
    return address ? sanitizeInterpolatedValue(address) : null;
}

/**
 * A `None` anywhere along a nested path, leaf included, drops the sentence, unlike a top-level
 * `None`, which renders as `none`.
 */
async function resolveDataPlaceholder(dataRef: string, displayContext: DisplayContext): Promise<string | null> {
    const { data, path } = displayContext.parsedInstruction;
    const [name, ...segments] = dataRef.split('.');
    const instruction = getLastNodeFromPath(path);
    const argument = (instruction.arguments ?? []).find(arg => arg.name === name);
    const decodedData = data as Record<string, unknown>;
    if (!argument || !(name in decodedData)) return null;
    const ownerPath = [...path, argument];

    if (segments.length === 0) {
        const formatted = await formatArgumentValue(argument.type, ownerPath, decodedData[name], displayContext);
        return formatted.degraded ? null : sanitizeInterpolatedValue(formatted.text);
    }

    const leaf = resolveDisplayTypePath(argument.type, ownerPath, segments, displayContext);
    if (leaf === null) return null;
    const value = tryResolveArgumentPathValue(decodedData[name], segments as CamelCaseString[]);
    if (value === undefined) return null;
    const formatted = await formatArgumentValue(leaf.type, leaf.ownerPath, value, displayContext);
    return formatted.degraded ? null : sanitizeInterpolatedValue(formatted.text);
}

/** Upper bound in code points on one interpolated value, so a single field cannot dominate the sentence. */
const MAX_INTERPOLATED_VALUE_LENGTH = 120;

/**
 * Decoded string arguments are attacker-controlled, and one carrying line breaks or control
 * characters could forge what look like extra display lines inside the signing sentence.
 * Truncation counts code points, so a surrogate pair is never split.
 */
function sanitizeInterpolatedValue(value: string): string {
    // eslint-disable-next-line no-control-regex
    const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/gu, ' ');
    const points = [...cleaned];
    if (points.length <= MAX_INTERPOLATED_VALUE_LENGTH) return cleaned;
    return `${points.slice(0, MAX_INTERPOLATED_VALUE_LENGTH).join('')}…`;
}
