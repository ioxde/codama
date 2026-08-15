---
'@codama/visitors': patch
---

Preserve enum variant `discriminator` and `display` when renaming variants via `updateDefinedTypesVisitor` and when unwrapping tuple variants via `unwrapTupleEnumWithSingleStructVisitor`. Both previously rebuilt the variant node without them, silently changing the variant's wire value back to its positional index.
