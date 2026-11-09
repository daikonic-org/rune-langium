// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import cdm.base.datetime.BusinessDayAdjustments;
import cdm.base.datetime.BusinessDayConventionEnum;
import cdm.product.common.schedule.functions.CalculationPeriodRange;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.inject.Guice;
import com.rosetta.model.lib.records.Date;
import org.finos.cdm.CdmRuntimeModule;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Map;

/** Invoke the handwritten range constructor through the published CDM runtime binding. */
class PeriodRangeOracle {
    private static Date date(JsonNode value) {
        if (value == null || value.isNull()) return null;
        var parsed = LocalDate.parse(value.asText());
        return Date.of(parsed.getYear(), parsed.getMonthValue(), parsed.getDayOfMonth());
    }

    public static void main(String[] args) throws Exception {
        var mapper = new ObjectMapper();
        var cases = mapper.readTree(System.in);
        var function = Guice.createInjector(new CdmRuntimeModule()).getInstance(CalculationPeriodRange.class);
        var results = new ArrayList<Map<String, Object>>();
        for (var test : cases) {
            var id = test.get("id").asText();
            var input = test.get("inputs");
            var adjustments = input.hasNonNull("dateAdjustments")
                ? BusinessDayAdjustments.builder().setBusinessDayConvention(BusinessDayConventionEnum.valueOf(
                    input.get("dateAdjustments").get("businessDayConvention").asText())).build()
                : null;
            try {
                var value = function.evaluate(date(input.get("startDate")), date(input.get("endDate")), adjustments);
                results.add(Map.of("id", id, "value", Map.of(
                    "startDate", value.getStartDate().toString(),
                    "endDate", value.getEndDate().toString(),
                    "daysInPeriod", value.getDaysInPeriod(),
                    "daysInLeapYearPeriod", value.getDaysInLeapYearPeriod(),
                    "isFirstPeriod", value.getIsFirstPeriod(),
                    "isLastPeriod", value.getIsLastPeriod()
                )));
            } catch (RuntimeException error) {
                results.add(Map.of("id", id, "error", error.getClass().getSimpleName()));
            }
        }
        System.out.println(mapper.writeValueAsString(results));
    }
}
