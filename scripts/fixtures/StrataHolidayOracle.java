// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
package com.opengamma.strata.basics.date;

import com.opengamma.strata.basics.ReferenceData;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.Collection;
import java.util.HexFormat;
import java.util.stream.Collectors;

/** Extract the exact center codes, published windows, and exceptions from Strata. */
public class StrataHolidayOracle {
    private static String dayNumbers(Collection<LocalDate> dates) {
        return dates.stream().mapToLong(LocalDate::toEpochDay).mapToObj(Long::toString)
            .collect(Collectors.joining(","));
    }

    public static void main(String[] args) throws Exception {
        var references = ReferenceData.standard();
        for (String center : Files.readAllLines(Path.of(args[0]))) {
            var entry = references.findValue(HolidayCalendarId.of(center));
            if (!(entry.orElse(null) instanceof ImmutableHolidayCalendar calendar)) continue;

            // The GlobalHolidayCalendars rules cover 1950–2099, except TARGET.
            // HolidayCalendarData.ini explicitly supplies 2005–2079 for Bangkok.
            int firstYear = switch (center) {
                case "EUTA" -> 1997;
                case "THBA" -> 2005;
                default -> 1950;
            };
            int lastYear = center.equals("THBA") ? 2079 : 2099;
            var first = LocalDate.of(firstYear, 1, 1);
            var last = LocalDate.of(lastYear, 12, 31);
            var weekends = calendar.getWeekendDays();
            var holidays = calendar.getHolidays();
            var workingDays = calendar.getWorkingDays();
            for (var day = first; !day.isAfter(last); day = day.plusDays(1)) {
                boolean closed = holidays.contains(day) ||
                    (weekends.contains(day.getDayOfWeek()) && !workingDays.contains(day));
                if (closed != calendar.isHoliday(day))
                    throw new IllegalStateException("Strata calendar extraction differs for " + center + " " + day);
            }
            if (holidays.stream().anyMatch(d -> d.isBefore(first) || d.isAfter(last)) ||
                workingDays.stream().anyMatch(d -> d.isBefore(first) || d.isAfter(last)))
                throw new IllegalStateException("Published exceptions exceed the coverage for " + center);
            String weekdayNumbers = weekends.stream().mapToInt(DayOfWeek::getValue).sorted()
                .mapToObj(Integer::toString).collect(Collectors.joining(","));
            String isoDates = holidays.stream().map(LocalDate::toString).collect(Collectors.joining("\n"));
            String digest = HexFormat.of().formatHex(
                MessageDigest.getInstance("SHA-256").digest(isoDates.getBytes(StandardCharsets.UTF_8))
            );
            System.out.printf("%s\t%d\t%d\t%s\t%s\t%s\t%s%n", center, first.toEpochDay(), last.toEpochDay(),
                weekdayNumbers, dayNumbers(holidays), dayNumbers(workingDays), digest);
        }
    }
}
