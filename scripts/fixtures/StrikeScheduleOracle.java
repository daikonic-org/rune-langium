// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import cdm.ingest.fpml.confirmation.pricequantity.functions.MapCommodityOptionStrikePriceSchedule;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.inject.Guice;
import com.rosetta.model.lib.records.Date;
import fpml.consolidated.shared.Currency;
import fpml.consolidated.shared.NonNegativeMoney;
import org.finos.cdm.CdmRuntimeModule;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;

/** Invoke the real handwritten implementation through its published CDM runtime binding. */
class StrikeScheduleOracle {
    public static void main(String[] args) throws Exception {
        var mapper = new ObjectMapper();
        var cases = mapper.readTree(System.in);
        var function = Guice.createInjector(new CdmRuntimeModule()).getInstance(MapCommodityOptionStrikePriceSchedule.class);
        var results = new ArrayList<Map<String, Object>>();
        for (var test : cases) {
            var inputs = test.get("inputs");
            var prices = new ArrayList<NonNegativeMoney>();
            for (var step : inputs.get("fpmlStrikePricePerUnitStepList")) {
                prices.add(NonNegativeMoney.builder()
                    .setAmount(new BigDecimal(step.get("amount").asText()))
                    .setCurrency(Currency.builder().setValue(step.get("currency").get("value").asText()))
                    .build());
            }
            var dates = new ArrayList<Date>();
            for (var item : inputs.get("fpmlCommodityStrikePriceDateList")) {
                var date = LocalDate.parse(item.asText());
                dates.add(Date.of(date.getYear(), date.getMonthValue(), date.getDayOfMonth()));
            }
            var rows = new ArrayList<Map<String, Object>>();
            for (var value : function.evaluate(prices, dates)) {
                var row = new LinkedHashMap<String, Object>();
                if (value.getDate() != null) row.put("date", value.getDate().toString());
                if (value.getValue() != null) row.put("value", value.getValue());
                rows.add(row);
            }
            results.add(Map.of("id", test.get("id").asText(), "value", rows));
        }
        System.out.println(mapper.writeValueAsString(results));
    }
}
