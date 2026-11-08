# CDM decimal precision rounding reference

`sources.json` pins unmodified declaration slices from CDM 7.9.0 and Rune 10.15.3,
with the same source cohort as the implementation inventory. Original CDM and
Rune license/notice files accompany the slices. `java/RoundToPrecisionImpl.java`
and its test are the handwritten reference, retained byte for byte. Generated
Java supplies runtime/validation plumbing only.

`cases.json` records 168 valid-input cases and the Java result's scale. Cases cover
all three directions and both trailing-zero flags, original Java examples,
positive/negative decimal ties, carries, zero, small/large exponents, safe integer
limits, the smallest subnormal number and precision 1000. The independent oracle
checks both numeric decimal results and reference scales against the published
CDM binding. JSON decimal tokens are parsed exactly, avoiding a second binary
floating-point conversion before Java receives them.

```sh
python3 scripts/verify-rounding.py --cache-dir /tmp/rune-rounding
```

Python and JDK 21+ are needed only for this optional check. The shared verifier
checksums the Maven artifacts and the identical handwritten source in the source
JAR. Normal tests run offline against these expectations. No JVM is shipped.

The curated implementation is language-specific: TypeScript uses a decimal
coefficient and BigInt remainder; Python uses a local standard-library decimal
context. `Up` means away from zero, `Down` toward zero and `Nearest` uses half-up
ties. This matches the reference's
[`BigDecimal.setScale`](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/math/BigDecimal.html#setScale(int,java.math.RoundingMode))
and [`RoundingMode`](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/math/RoundingMode.html)
rules for the supported numeric profile.

The generated API remains `number`/`float`: it rounds the canonical decimal text
of an existing finite target number, then returns a target number. It cannot
preserve arbitrary BigDecimal input precision or trailing-zero formatting. Both
`removeTrailingZeros` values therefore have the same numeric output; the Java
scale observations are reference evidence, not a target formatting promise.
Inputs must have a finite value, nonnegative safe integer precision, supported
direction and boolean flag. Rune's `NonNegativePrecision` precondition remains
active; Java-only nullable inputs and negative-scale behavior are outside that
required-input contract. Separate target tests cover invalid inputs, normalized
negative zero, unchanged Python global context and huge no-op precisions without
asking Java to allocate a huge scale.

Strict TypeScript tests exercise all three layouts, standalone Python uses the
same corpus, publication tests round-trip the verified implementation payload,
and the managed Studio worker executes signed ties/subnormals and the Rune
precondition. Prototype browser journeys check desktop/390px form enum selection,
execution, accessibility and viewport fit.
