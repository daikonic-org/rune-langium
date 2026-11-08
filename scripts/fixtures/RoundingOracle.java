// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import cdm.base.math.RoundingDirectionEnum;
import cdm.base.math.functions.RoundToPrecision;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.inject.Guice;
import org.finos.cdm.CdmRuntimeModule;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Map;

/** Execute the pinned handwritten implementation using the published runtime binding. */
class RoundingOracle {
    public static void main(String[] args) throws Exception {
        var mapper = new ObjectMapper().enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS);
        var cases = mapper.readTree(System.in);
        var function = Guice.createInjector(new CdmRuntimeModule()).getInstance(RoundToPrecision.class);
        var results = new ArrayList<Map<String, Object>>();
        for (var test : cases) {
            var inputs = test.get("inputs");
            var mode = switch (inputs.get("roundingMode").asText()) {
                case "Up" -> RoundingDirectionEnum.UP;
                case "Down" -> RoundingDirectionEnum.DOWN;
                case "Nearest" -> RoundingDirectionEnum.NEAREST;
                default -> throw new IllegalArgumentException("Unknown direction");
            };
            var rounded = function.evaluate(new BigDecimal(inputs.get("value").asText()),
                inputs.get("precision").intValue(), mode, inputs.get("removeTrailingZeros").booleanValue());
            results.add(Map.of("id", test.get("id").asText(), "value", rounded, "scale", rounded.scale()));
        }
        System.out.println(mapper.writeValueAsString(results));
    }
}
