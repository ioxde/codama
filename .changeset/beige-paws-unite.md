---
'@codama/dynamic-address-resolution': minor
'@codama/dynamic-instructions': minor
'@codama/errors': minor
---

Honour nested argument paths outside the resolution visitors

`ArgumentValueNode` carries an optional `path` addressing a field below its named argument, but the instruction builder, the argument validator, the resolution-input codegen and the display layer all read `node.name` alone and ignored it. Each of those now walks the path, sharing the lenient walker and path formatter that the PDA-seed, account-default and condition visitors already use — `tryResolveArgumentPathValue` and `formatArgumentPathSuffix` are exported from `@codama/dynamic-address-resolution` for that purpose. The walker also unwraps Kit `Option` wrappers along the way: `Some` is transparent to a path and `None` reads as absent, matching how the display layer already unwraps option types and values.

Concretely: instruction displays resolve a path-bearing reference to its nested value instead of degrading to `null`; remaining-accounts groups read their addresses from the nested field and take their label from its leaf segment; and the arguments validator strips a remaining-accounts reference from the validated input exactly when its root is _virtual_ — absent from the declared arguments and extraArguments — whether or not the reference bears a path, so a declared struct root stays validated and a virtual object root is no longer rejected as an unknown key.

The resolution-input codegen emits a remaining-accounts key only when its root is virtual: declared roots are already emitted under their real type, whether the reference is path-less or path-bearing, so neither form can produce a duplicate key. A path-bearing virtual root gets an object type synthesised from its paths (`groups: { signers: Address[] }`), merged across groups sharing the root and optional when every group reading it is optional. A declared root's requiredness stays governed by its serialized type: the validator and the codec require the field even when the group is optional, so the emitted type keeps it required.

Errors raised from these paths carry the reference precisely: `INVALID_ARGUMENT_INPUT` gains a required `argumentPath` context field mirroring `ARGUMENT_MISSING`, so `argumentName` keeps its bare camelCase contract while messages render the dotted reference (`data.signers`). `@codama/dynamic-instructions` also adds `ES2022.Error` to its `lib` — without it `ErrorOptions` was unresolvable inside `@codama/errors`' declarations and, under `skipLibCheck`, the whole error-context parameter silently degraded to a shape the compiler never enforced.

Members surfaced through the provide/inject graph are recorded under their qualified `argument.field` name. A `whenInjected` skip rule fires on the rendered member it is attached to when that member or anything nested below it was consumed — the fallback list renders two levels (top-level members and the first-level fields of flattened structs), so deeper references are hidden by the rendered surface containing them, and skip metadata below a rendered surface never fires. Consumers building a `DisplayContext` by hand must key `consumedMemberNames` the same way.
