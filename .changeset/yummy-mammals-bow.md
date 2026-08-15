---
'@codama/visitors-core': patch
'@codama/dynamic-instructions': patch
---

Preserve enum-variant metadata in `identityVisitor` and tighten display lookups

- `identityVisitor`'s enum-variant overrides no longer shed attributes the generated branch preserves: `discriminator` and `display` survive both the rebuild and the downgrade of an empty struct/tuple variant to `enumEmptyVariantTypeNode`, and the display node is walked like any other child.
- Remaining-accounts partitioning no longer lets the final group absorb whatever metas are left: every group takes only metas whose signer role matches its `isSigner` flag, and unattributable metas render under the generic "Remaining Accounts" label — a generic label over a confidently wrong one on a signing screen.
- Account-name lookups in the display resolver, the offline-dictionary planner, the intent interpolator, and the fallback account list compare through `camelCase`, matching the account-data resolver — parsed instructions built from bare JSON carry un-normalised names, which previously missed silently (dropping the interpolated sentence or an account row entirely).
- `formatStringValue` slices by Unicode code points instead of UTF-16 code units, so a slice boundary can no longer split a surrogate pair and emit U+FFFD.
