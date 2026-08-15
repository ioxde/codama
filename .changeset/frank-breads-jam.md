---
'@codama/dynamic-instructions': minor
---

Support nested argument fields in `interpolatedIntent` placeholders. A `data` placeholder can now dot into a field below the named argument — `${data.plan.amount}` — walking struct fields by name and tuple/array items by numeric index, following `definedTypeLinkNode`s (with cross-program owner-path rebasing) and unwrapping options along the way, so the leaf's display metadata (e.g. amount scaling) applies inside the sentence. This mirrors the nested addressing of `ArgumentValueNode.path`, which every other consumer already honours, and additionally accepts array indices since array items share one type.

The grammar stays asymmetric: `accounts` placeholders take a single name, since accounts have no nested structure and a dotted accounts token would camelCase-fold into another account's name. The failure policy is unchanged and applies to nested paths too — any placeholder that is malformed or does not resolve (including a nested path crossing a `None` option) makes the whole sentence `null`, falling back to the field list.

Injection collection follows the template: a nested amount addressed by a placeholder counts as surfaced, so its injected inputs (e.g. a mint's `decimals`) mark their backing members consumed for the `whenInjected` skip rule, and the offline-dictionary planner pre-fetches the accounts they read. A malformed template surfaces nothing, since the sentence it would have produced is dropped wholesale.
