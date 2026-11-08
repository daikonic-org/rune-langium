# CDM decimal rounding reference

`sources.json` pins unmodified declaration slices from CDM 7.9.0 and Rune 10.15.3,
with the same source cohort as the implementation inventory. Original CDM and
Rune license/notice files accompany the slices. `java/RoundToPrecisionImpl.java`,
`RoundToNearestImpl.java`, `RoundToSignificantFiguresImpl.java` and their tests are
the handwritten references, retained byte for byte. Generated Java supplies
runtime/validation plumbing only.

`cases.json` records 309 cases: the original 168 precision cases, 60 increment
cases and 81 significant-figure cases. The original expectations are unchanged.
Cases cover the handwritten Java examples, signed directions/ties, carries,
zero, small/large exponents, safe integer limits, subnormal values and large no-op
counts. Twelve increment cases preserve Java's exact-division errors. Successful
new cases retain the full Java decimal as `referenceValue` and its `referenceScale`
separately from the finite target-number `expected` result. JSON decimal tokens
are parsed exactly before reaching Java.

```sh
python3 scripts/verify-rounding.py --cache-dir /tmp/rune-rounding
```

Python and JDK 21+ are needed only for this optional check. The shared verifier
checksums the Maven artifacts and the identical handwritten source in the source
JAR. Normal tests run offline against these expectations. No JVM is shipped.

The curated implementations are language-specific: TypeScript shares decimal
coefficient parsing and BigInt quotient rounding; Python shares an isolated
standard-library decimal context and uses exact `fractions.Fraction` arithmetic
for increments. `Up` means away from zero, `Down` toward zero and `Nearest` uses half-up
ties. This matches the reference's
[`BigDecimal.setScale`](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/math/BigDecimal.html#setScale(int,java.math.RoundingMode))
and [`RoundingMode`](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/math/RoundingMode.html)
rules for the supported numeric profile. Significant-figure rounding follows
`BigDecimal.round(MathContext)`. Increment rounding first requires an exactly
terminating quotient, then rounds to an integer and multiplies by the increment:
`RoundToNearest(1, 3, Up)` fails rather than returning an approximate answer.

The generated API remains `number`/`float`: it rounds the canonical decimal text
of an existing finite target number, then returns a target number. It cannot
preserve arbitrary BigDecimal input precision or trailing-zero formatting. Both
`removeTrailingZeros` values therefore have the same numeric output; the Java
scale observations are reference evidence, not a target formatting promise.
Inputs must have finite numbers, safe integer counts and supported directions;
precision also requires its boolean flag. Rune's `NonNegativePrecision`,
`PositiveNearest` and `NonZeroSignificantFigures` conditions remain active.
Java-only null bypasses, zero/unlimited significant figures and negative scales
are outside the required-input contract. Results exceeding the finite target
range fail explicitly instead of returning infinity. Separate target tests cover
invalid inputs, normalized negative zero, unchanged Python global context and
huge no-op counts without asking Java to allocate a huge scale.
The Python context also pins its traps, flags, exponent limits and clamp settings.
The full corpus runs with hostile `DefaultContext` settings, checking that both
the defaults and caller's active context remain unchanged.

Strict TypeScript tests exercise all three layouts, standalone Python uses the
same corpus, publication tests round-trip all three implementation payloads and
verify authored Rune override precedence. The managed Studio worker executes
signed ties, subnormals and exact-division failures. Prototype browser journeys
check desktop/390px enum selection, successful results, arithmetic errors,
all three Rune guards, accessibility and viewport fit.
