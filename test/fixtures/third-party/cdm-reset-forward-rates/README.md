# CDM reset history and forward curves

[Sources and checksums](sources.json) pin the CDM 7.9.0 declarations and their
dependency closure. Identical source slices are read from the billing fixture
and verified against the checksum in this manifest. The pinned CDM sources
declare the two interfaces and supply the original `FxMarkToMarket` body.

The [17 cases](cases.json) cover exact reset dates, separate rate record dates,
preserved observations, absent and ambiguous records, and interpolation over
[supplied dated curves](curves.json). Exact quotes are returned directly. Other
maturities require distinct quotes on both sides. The caller supplies data in
the applicable quote convention and resolves the payout's maturity before
interpolation.

Six multi-quote numerical cases were checked against
[Strata 1.7.0 `CurveInterpolators.LINEAR`](https://github.com/OpenGamma/Strata/blob/v1.7.0/modules/market/src/main/java/com/opengamma/strata/market/curve/interpolator/LinearCurveInterpolator.java)
using sorted calendar-day coordinates. The
[published market jar](https://repo.maven.apache.org/maven2/com/opengamma/strata/strata-market/1.7.0/strata-market-1.7.0.jar)
has SHA-256 `c05bf61e5c49fc412d223e0ab4bcfd4f413aa3a6b7681dcd9e33d4f54904f902`.
Strict TypeScript and standalone Python execute the installed Rune sources, as
well as the original CDM mark-to-market caller on an interpolated rate.
