// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import cdm.base.math.ArithmeticOperationEnum;
import cdm.base.math.functions.VectorOperation;
import cdm.base.math.functions.VectorGrowthOperation;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.inject.Guice;
import org.finos.cdm.CdmRuntimeModule;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Execute the pinned handwritten functions through their published default bindings. */
class VectorOracle {
    static List<BigDecimal> vector(JsonNode node) {
        var result = new ArrayList<BigDecimal>();
        for (var value : node) result.add(new BigDecimal(value.asText()));
        return result;
    }
    public static void main(String[] args) throws Exception {
        var mapper = new ObjectMapper().enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS);
        var injector = Guice.createInjector(new CdmRuntimeModule());
        var operation = injector.getInstance(VectorOperation.class);
        var growth = injector.getInstance(VectorGrowthOperation.class);
        var results = new ArrayList<Map<String, Object>>();
        for (var test : mapper.readTree(System.in)) {
            var inputs = test.get("inputs");
            var output = test.get("function").asText().equals("VectorOperation")
                ? operation.evaluate(ArithmeticOperationEnum.valueOf(inputs.get("arithmeticOp").asText().toUpperCase()),
                    vector(inputs.get("left")), vector(inputs.get("right")))
                : growth.evaluate(new BigDecimal(inputs.get("baseValue").asText()), vector(inputs.get("factor")));
            results.add(Map.of("id", test.get("id").asText(), "referenceValues", output.stream().map(BigDecimal::toString).toList()));
        }
        System.out.println(mapper.writeValueAsString(results));
    }
}
