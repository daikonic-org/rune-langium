// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import cdm.base.datetime.AdjustableDate;
import cdm.base.datetime.AdjustableDates;
import cdm.base.datetime.AdjustableOrRelativeDate;
import cdm.base.datetime.AdjustableRelativeOrPeriodicDates;
import cdm.base.datetime.AdjustedRelativeDateOffset;
import cdm.base.datetime.BusinessDayAdjustments;
import cdm.base.datetime.BusinessDayConventionEnum;
import cdm.base.datetime.PeriodicDates;
import cdm.base.datetime.RelativeDates;
import cdm.base.datetime.functions.AddDays;
import cdm.base.datetime.functions.DateDifference;
import cdm.base.datetime.functions.DayOfWeek;
import cdm.base.datetime.functions.LeapYearDateDifference;
import cdm.base.datetime.functions.ResolveAdjustableDate;
import cdm.base.datetime.functions.ResolveAdjustableDates;
import cdm.ingest.fpml.confirmation.product.commodityoption.functions.CalculateCommodityCalculationPeriods;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.inject.Guice;
import com.rosetta.model.lib.records.Date;
import fpml.consolidated.com.CommodityCalculationPeriodsSchedule;
import fpml.consolidated.fpmlenum.PeriodExtendedEnum;
import org.finos.cdm.CdmRuntimeModule;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
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

    private static List<Date> dates(JsonNode values) {
        var result = new ArrayList<Date>();
        for (var value : values) result.add(date(value.isObject() ? value.path("value") : value));
        return result;
    }

    private static List<String> dateTexts(List<Date> values) {
        return values == null ? List.of() : values.stream().map(CalendarOracle::dateText).toList();
    }

    private static BusinessDayAdjustments convention(JsonNode value) {
        var name = value.path("dateAdjustments").path("businessDayConvention");
        return name.isMissingNode() ? null : BusinessDayAdjustments.builder()
            .setBusinessDayConvention(BusinessDayConventionEnum.fromDisplayName(name.asText())).build();
    }

    private static AdjustableOrRelativeDate adjustment(JsonNode value) {
        var result = AdjustableOrRelativeDate.builder();
        if (value.hasNonNull("adjustableDate")) {
            var item = value.get("adjustableDate");
            var adjusted = item.path("adjustedDate");
            var absolute = AdjustableDate.builder().setUnadjustedDate(date(item.path("unadjustedDate")));
            if (item.hasNonNull("adjustedDate"))
                absolute.setAdjustedDateValue(date(adjusted.isObject() ? adjusted.path("value") : adjusted));
            absolute.setDateAdjustments(convention(item));
            result.setAdjustableDate(absolute.build());
        }
        if (value.hasNonNull("relativeDate")) {
            var relative = value.get("relativeDate");
            result.setRelativeDate(AdjustedRelativeDateOffset.builder()
                .setAdjustedDate(date(relative.path("adjustedDate"))).build());
        }
        return result.build();
    }

    private static AdjustableRelativeOrPeriodicDates adjustments(JsonNode value) {
        var result = AdjustableRelativeOrPeriodicDates.builder();
        if (value.hasNonNull("adjustableDates")) {
            var item = value.get("adjustableDates");
            result.setAdjustableDates(AdjustableDates.builder()
                .setUnadjustedDate(dates(item.path("unadjustedDate")))
                .setAdjustedDateValue(dates(item.path("adjustedDate")))
                .setDateAdjustments(convention(item)).build());
        }
        if (value.hasNonNull("relativeDates")) result.setRelativeDates(RelativeDates.builder().build());
        if (value.hasNonNull("periodicDates")) result.setPeriodicDates(PeriodicDates.builder().build());
        return result.build();
    }

    private static CommodityCalculationPeriodsSchedule commoditySchedule(JsonNode value) {
        if (value.isMissingNode() || value.isNull()) return null;
        var schedule = CommodityCalculationPeriodsSchedule.builder();
        if (value.hasNonNull("period")) schedule.setPeriod(PeriodExtendedEnum.valueOf(value.get("period").asText()));
        if (value.hasNonNull("periodMultiplier")) schedule.setPeriodMultiplier(value.get("periodMultiplier").intValue());
        if (value.hasNonNull("balanceOfFirstPeriod")) schedule.setBalanceOfFirstPeriod(value.get("balanceOfFirstPeriod").booleanValue());
        return schedule.build();
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
        var resolveList = bindings.getInstance(ResolveAdjustableDates.class);
        var commodityPeriods = bindings.getInstance(CalculateCommodityCalculationPeriods.class);
        var results = new ArrayList<Map<String, JsonNode>>();
        for (var test : cases) {
            var input = test.get("inputs");
            try {
                Object value = switch (test.get("function").asText()) {
                    case "AddDays" -> add.evaluate(date(input.path("inputDate")), input.get("numDays").intValue());
                    case "DateDifference" -> difference.evaluate(date(input.path("firstDate")), date(input.path("secondDate")));
                    case "LeapYearDateDifference" -> leapDifference.evaluate(date(input.path("firstDate")), date(input.path("secondDate")));
                    case "DayOfWeek" -> weekday.evaluate(date(input.path("date"))).name();
                    case "ResolveAdjustableDate" -> resolve.evaluate(adjustment(input.get("adjustableOrRelativeDate")));
                    case "ResolveAdjustableDates" -> dateTexts(resolveList.evaluate(adjustments(input.get("adjustableRelativeOrPeriodicDates"))));
                    case "CalculateCommodityCalculationPeriods" -> dateTexts(commodityPeriods.evaluate(
                        commoditySchedule(input.path("fpmlCommodityCalculationPeriodsSchedule")),
                        date(input.path("effectiveDate")), date(input.path("terminationDate"))));
                    default -> throw new IllegalArgumentException(test.toString());
                };
                if (value instanceof Date date) value = dateText(date);
                results.add(Map.of("id", test.get("id"), "value", mapper.valueToTree(value)));
            } catch (NullPointerException error) {
                if (!test.has("referenceError")) throw error;
                results.add(Map.of("id", test.get("id"), "error", mapper.valueToTree(error.getClass().getSimpleName())));
            }
        }
        System.out.println(mapper.writeValueAsString(results));
    }
}
