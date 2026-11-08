// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import cdm.base.math.RoundingDirectionEnum;
import cdm.base.math.RoundingModeEnum;
import cdm.base.math.functions.RoundToPrecision;
import cdm.base.math.functions.RoundToNearest;
import cdm.base.math.functions.RoundToSignificantFigures;
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
        var injector = Guice.createInjector(new CdmRuntimeModule());
        var precision = injector.getInstance(RoundToPrecision.class);
        var nearest = injector.getInstance(RoundToNearest.class);
        var figures = injector.getInstance(RoundToSignificantFigures.class);
        var results = new ArrayList<Map<String, Object>>();
        for (var test : cases) {
            var inputs = test.get("inputs");
            var mode = switch (inputs.get("roundingMode").asText()) {
                case "Up" -> RoundingDirectionEnum.UP;
                case "Down" -> RoundingDirectionEnum.DOWN;
                case "Nearest" -> RoundingDirectionEnum.NEAREST;
                default -> throw new IllegalArgumentException("Unknown direction");
            };
            var value = new BigDecimal(inputs.get("value").asText());
            try {
                var rounded = switch (test.path("function").asText("RoundToPrecision")) {
                    case "RoundToPrecision" -> precision.evaluate(value, inputs.get("precision").intValue(),
                        mode, inputs.get("removeTrailingZeros").booleanValue());
                    case "RoundToNearest" -> nearest.evaluate(value, new BigDecimal(inputs.get("nearest").asText()),
                        switch (mode) {
                            case UP -> RoundingModeEnum.UP;
                            case DOWN -> RoundingModeEnum.DOWN;
                            default -> throw new IllegalArgumentException("Unsupported increment direction");
                        });
                    case "RoundToSignificantFigures" -> figures.evaluate(value,
                        inputs.get("significantFigures").intValue(), mode);
                    default -> throw new IllegalArgumentException("Unknown rounding function");
                };
                results.add(Map.of("id", test.get("id").asText(), "value", rounded, "scale", rounded.scale()));
            } catch (ArithmeticException error) {
                results.add(Map.of("id", test.get("id").asText(), "error", error.getClass().getSimpleName()));
            }
        }
        System.out.println(mapper.writeValueAsString(results));
    }
}
