---
'@codama/dynamic-address-resolution': patch
---

Emit `extraArguments` into the generated `${Name}Args` types

`nodes-from-anchor` synthesizes `extraArguments` for PDA seeds that read values absent from the serialized instruction data (dotted-account seeds such as `bonding_curve.creator_hash`), and the resolution runtime reads them from `argumentsInput` when deriving those accounts. The generated `${Name}Args` type omitted them entirely, so typed callers could neither satisfy auto-resolution (`ARGUMENT_MISSING` at build time) nor pass the value at all — it was an excess property. Each extra argument is now emitted as an optional key with its real type, and an instruction whose only inputs are extraArguments now gets an Args type of its own.
