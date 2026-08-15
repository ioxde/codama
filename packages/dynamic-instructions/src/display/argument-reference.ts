import { formatArgumentPathSuffix } from '@codama/dynamic-address-resolution';
import type { ArgumentValueNode } from 'codama';

// `consumedMemberNames` keys the `whenInjected` skip rule by root argument name plus every path
// segment (`planData.terms.decimals`). Only individually rendered members consult the rule, so
// metadata attached deeper than the rendered surface never fires.

/** Names the member an `argumentValueNode` refers to: `planData`, or `planData.planId` with a path. */
export function argumentReferenceName(node: ArgumentValueNode): string {
    return `${node.name}${formatArgumentPathSuffix(node.path ?? [])}`;
}

/** Names a flattened struct field `owner.field`, keeping same-named fields of other arguments distinct. */
export function qualifiedMemberName(owner: string, field: string): string {
    return `${owner}.${field}`;
}
