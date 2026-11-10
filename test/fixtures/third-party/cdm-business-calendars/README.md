# CDM business calendars

The source slice preserves the pinned CDM 7.9.0 declarations, the original
business-center list, and the empty Java provider. The independent calendar
reference is Strata 2.12.78 at commit `4268382ba38cad9f08cad64774afb21111c8ba54`.
The published calendar rules and data are in `GlobalHolidayCalendars.java`
and `META-INF/com/opengamma/strata/config/base/HolidayCalendarData.ini` in the
checksum-pinned source JAR. The Rune bundle preserves the JAR's license and
notice bytes.

The extractor checks the stored holiday dates, weekly rules and working-day
exceptions against Strata's public `isHoliday` method for every day in each
published window. The generated targets compare digests for all 25 full holiday
lists and run date-list, period, and missing-data cases. Boundary and cardinality
cases follow the CDM declaration and the documented adapter rules.

```sh
python3 scripts/verify-strata-holidays.py --cache-dir /tmp/rune-strata-holiday-oracle
pnpm --filter @rune-langium/project-runtime exec vitest run test/business-calendars.test.ts
```

Pass `--write` to regenerate the editable Rune data and the expected case
results after reviewing a source update. Normal builds and tests use the
checked-in snapshot.
