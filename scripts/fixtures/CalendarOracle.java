// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import cdm.base.datetime.AdjustableDate;
import cdm.base.datetime.AdjustableOrRelativeDate;
import cdm.base.datetime.AdjustedRelativeDateOffset;
import cdm.base.datetime.BusinessDayAdjustments;
import cdm.base.datetime.BusinessDayConventionEnum;
import cdm.base.datetime.functions.AddDays;
import cdm.base.datetime.functions.DateDifference;
import cdm.base.datetime.functions.DayOfWeek;
import cdm.base.datetime.functions.LeapYearDateDifference;
import cdm.base.datetime.functions.ResolveAdjustableDate;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.inject.Guice;
import com.rosetta.model.lib.records.Date;
import org.finos.cdm.CdmRuntimeModule;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Locale;
import java.util.Map;

/** Run the handwritten defaults from the pinned CDM binary through the normal bindings. */
class CalendarOracle {
    private static Date date(JsonNode value) {
        return value.isMissingNode() || value.isNull() ? null : Date.of(LocalDate.parse(value.asText()));
    }

    private static String dateText(Date value) {
        var date = value.toLocalDate();
        int year = date.getYear();
        if (year >= 0 && year <= 9999) return date.toString();
        return String.format(Locale.ROOT, "%c%06d-%02d-%02d", year < 0 ? '-' : '+', Math.abs(year),
            date.getMonthValue(), date.getDayOfMonth());
    }

    private static AdjustableOrRelativeDate adjustment(JsonNode value) {
        var result = AdjustableOrRelativeDate.builder();
        if (value.hasNonNull("adjustableDate")) {
            var item = value.get("adjustableDate");
            var adjusted = item.path("adjustedDate");
            var absolute = AdjustableDate.builder().setUnadjustedDate(date(item.path("unadjustedDate")));
            if (item.hasNonNull("adjustedDate"))
                absolute.setAdjustedDateValue(date(adjusted.isObject() ? adjusted.path("value") : adjusted));
            var convention = item.path("dateAdjustments").path("businessDayConvention");
            if (!convention.isMissingNode()) absolute.setDateAdjustments(BusinessDayAdjustments.builder()
                .setBusinessDayConvention(BusinessDayConventionEnum.fromDisplayName(convention.asText())).build());
            result.setAdjustableDate(absolute.build());
        }
        if (value.hasNonNull("relativeDate")) {
            var relative = value.get("relativeDate");
            result.setRelativeDate(AdjustedRelativeDateOffset.builder()
                .setAdjustedDate(date(relative.path("adjustedDate"))).build());
        }
        return result.build();
    }

    public static void main(String[] args) throws Exception {
        var mapper = new ObjectMapper();
        var cases = mapper.readTree(System.in);
        var bindings = Guice.createInjector(new CdmRuntimeModule());
        var add = bindings.getInstance(AddDays.class);
        var difference = bindings.getInstance(DateDifference.class);
        var leapDifference = bindings.getInstance(LeapYearDateDifference.class);
        var weekday = bindings.getInstance(DayOfWeek.class);
        var resolve = bindings.getInstance(ResolveAdjustableDate.class);
        var results = new ArrayList<Map<String, JsonNode>>();
        for (var test : cases) {
            var input = test.get("inputs");
            Object value = switch (test.get("function").asText()) {
                case "AddDays" -> add.evaluate(date(input.path("inputDate")), input.get("numDays").intValue());
                case "DateDifference" -> difference.evaluate(date(input.path("firstDate")), date(input.path("secondDate")));
                case "LeapYearDateDifference" -> leapDifference.evaluate(date(input.path("firstDate")), date(input.path("secondDate")));
                case "DayOfWeek" -> weekday.evaluate(date(input.path("date"))).name();
                case "ResolveAdjustableDate" -> resolve.evaluate(adjustment(input.get("adjustableOrRelativeDate")));
                default -> throw new IllegalArgumentException(test.toString());
            };
            if (value instanceof Date date) value = dateText(date);
            results.add(Map.of("id", test.get("id"), "value", mapper.valueToTree(value)));
        }
        System.out.println(mapper.writeValueAsString(results));
    }
}
