# CDM code-list loading

The pinned CDM 7.9.0 archive contains 229 source JSON files, including a
scheme directory and a currency record without codes. Publication prepares 228
named lists with usable identification. The generated targets use the same
prepared data in standalone exports and Studio Prototype.

The fixture preserves original CDM resources, the handwritten Java loader, the
relevant Rune source slices and upstream license and notice files. The
[upstream Java test](https://github.com/finos/common-domain-model/blob/0f1f99aef829c23910476981bb91256544cb8569/examples/src/test/java/org/finos/cdm/example/codelist/LoadCodeListTest.java)
requires unknown domains to fail. The targets preserve that behavior, along
with case-insensitive domains and case-sensitive code matching.

The port returns the currency identification with an empty array, where Java
throws while reading the missing array. It uses the version from the pinned
filename when an otherwise usable list omits a version required by Rune. A
present version retains its original spelling. The scheme directory has no
usable identification and stays unavailable.

The same option-type bytes also supply an explicitly mapped Rune enum. The
Prototype journey selects the enum's wire value and calls the preserved upstream
validator. Neither path fetches scheme URIs.

Run the optional JDK 21 oracle with
`python3 scripts/verify-code-list-loader.py --cache-dir /path/to/oracle-cache`.
The verifier checks the source and Maven artifact hashes and records the deliberate
differences alongside the parity cases.
