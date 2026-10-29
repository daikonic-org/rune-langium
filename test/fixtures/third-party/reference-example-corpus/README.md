# Complete reference example corpus

`sources.json` pins complete upstream repository archives by commit and SHA-256:
CDM 7.8.0, FpML 3.8.0 and Rune DSL 10.15.1. Archives retain original bytes,
headers, licenses and notices. They are fetched into ignored build output and
extracted only in an owned temporary directory; no upstream files are rewritten.
The corpus retains the upstream licenses, independent of authored Studio code.

Run `pnpm run verify:reference-examples` after building the workspace dependencies.
The report enumerates all JSON and XML paths, including payloads in documentation,
serialization outputs and those linked from execution catalogs. Shared codecs and
linked decoders check imports; known empty upstream files are asserted individually.
Rootless objects, collection payloads, Java-only functions and XML are reported
explicitly when additional binding or codec support is needed. Discovery counts
and unexpected Rune payloads outside known roots fail CI.

Execution catalogs use upstream `*-execution-descriptor.json` field names and
resource-relative paths. The same schema and binding reader drive Studio and CI.
