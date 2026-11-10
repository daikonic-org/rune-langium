# Business calendars

`BusinessCenterHolidays` and `GetNonBusinessDates` are editable Rune overrides
over one curated calendar snapshot. The snapshot comes from
[Strata 2.12.78](https://github.com/tradingtechnologies/Strata/tree/4268382ba38cad9f08cad64774afb21111c8ba54).
It carries 44,000 holiday dates for 25 of the 210 codes in the pinned CDM 7.9.0
business-center list. The CDM release supplies an empty Java provider. Strata
supplies the calendar data, including its own dates and weekly rules.

`BusinessCenterHolidays` returns the holiday records in the selected snapshot,
excluding its recurring weekend days. A center without a verified calendar
raises `SupportedBusinessCenter`. The return type is a date list, so the
published range belongs to the calendar data. Callers of upstream `IsHoliday`
must use that list within its published coverage.

`GetNonBusinessDates` requires either a period or explicit dates. Periods use
both adjusted endpoints, inclusive, following the adjacent CDM observation-date
workflows. The function preserves the order and duplicates of an explicit list,
combines closures across centers, and uses Saturday/Sunday when no centers are
supplied. Budapest has a Sunday-only weekend rule with explicit Saturday
closures. Missing or reversed period endpoints, unknown centers, dates outside
any requested calendar's window, and an empty result fail named conditions.
The last condition enforces the CDM `1..*` output.

The snapshot covers 1950–2099 for most centers, 1997–2099 for TARGET, and
2005–2079 for Bangkok. Later published revisions can contain different dates.
The snapshot stores nearby dates in pairs of day offsets to fit standalone
exports. Publication copies the shared `PinnedHolidayCalendar` source and its
license and notice into the project, together with both overrides. A project can supply
its own full calendar records by editing that lookup.

The [pinned fixture](../../test/fixtures/third-party/cdm-business-calendars/README.md)
records the exact inputs and verification commands. The JVM checks the snapshot
and tests only. Generated TypeScript, Python, and Prototype evaluate the
installed Rune sources.
