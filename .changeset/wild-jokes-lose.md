---
'@codama/dynamic-codecs': patch
'@codama/dynamic-instructions': patch
---

Harden instruction displays against wrong or hostile on-chain data

- Enum codecs now honour explicit variant discriminators. The codec was purely positional while the display layer matched decoded numbers against `variant.discriminator`, so an enum whose discriminators diverge from variant order displayed the wrong variant name — encoding `confirm` could render "Cancel". Scalar enums encode/decode by wire discriminator (`discriminator ?? position`), data enums map their union index to the wire discriminator, and `enumValueNode` constants resolve to the wire discriminator.
- An account whose bytes do not decode against its linked layout no longer throws out of the display context's `resolveAccountData` — it degrades to `null` so the affected field renders raw instead of the whole display dying, mirroring how `parseData` treats bytes that identify but do not decode.
- Amount scaling now bounds `decimals` at 30. The scale resolves from account state an attacker can control; `2^64 - 1` previously threw a `RangeError` out of `padStart` and killed the display, and `255` rendered a ~250-digit string. Out-of-range scales degrade to the marked `(raw)` form.
- Trailing account metas now render in the fallback list even when the instruction declares no remaining-accounts groups — most IDLs declare none, and the accounts the user signs over must not vanish. With nothing to label them they render under the generic "Remaining Accounts" label.
- `interpolatedIntent` templates are handled at least as safely when malformed as when unresolvable: any `${...}` token the placeholder grammar does not accept (including multi-segment paths and dangling `${`) suppresses the sentence instead of surviving verbatim. Interpolated values are sanitised — control characters and Unicode line separators collapse to a space and values are capped at 120 code points — so a decoded string argument cannot forge extra display lines inside the signing sentence.
