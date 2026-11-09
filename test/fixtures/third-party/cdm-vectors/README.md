# CDM decimal vector reference

`sources.json` pins original declarations, handwritten Java implementations/tests,
the shared `ArithmeticOpImpl` helper and upstream legal notices from CDM 7.9.0
and Rune 10.15.3. Source bytes and Git/SHA-256 hashes are verified by the shared
fixture builder. These inputs retain their upstream licenses.

The 73-case corpus executes the published CDM default bindings, not a re-created
Java algorithm. `java-oracle.json` reuses the pinned artifact list in the rounding
corpus and separately verifies all three handwritten vector source files against
the source JAR. The JVM is test-only; it is absent from curated bundles.

`VectorOperation` pairs by position, pads the shorter vector with zero and preserves
the surviving order. Add/subtract/multiply/max/min are exact decimal operations.
Division rounds to **10 decimal places, HALF_EVEN**. A zero denominator, including
a padded zero, omits that pair, as the handwritten implementation does after
catching its arithmetic exception. It does not insert a zero or an error result.

`VectorGrowthOperation` returns the initial base followed by cumulative products.
Exact decimal state survives between steps, including when a public intermediate
result underflows and a later factor restores a representable value. Empty factors
return the initial base. At the Rune boundary, absent optional collections are
normalized to an empty list; Java-only null guards are not a distinct Rune input
state. A missing required base remains invalid.

Targets accept canonical finite `number`/`float` inputs and convert each public
result once. `referenceValues` preserve the JVM's exact decimal observations;
`expected` records their target numeric projection. Arbitrary BigDecimal precision,
scale and trailing-zero formatting are outside this API. Nonfinite inputs and
overflowing outputs fail explicitly. Python uses standard-library `Fraction` and
`itertools`, independent of mutable decimal context settings.

The corpus includes all upstream operation examples, signed/unequal/empty vectors,
decimal cancellation, repeating division, positive/negative half-even ties,
zero-divisor omission, subnormals, cumulative chains and underflow recovery.
Generated-code tests separately check invalid input and finite-result admission.

```bash
JAVA_BINARY=java python3 scripts/verify-vectors.py --cache-dir /tmp/rune-vector-oracle
```
