// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import cdm.base.staticdata.codelist.LoadCodeListImpl;
import cdm.base.staticdata.codelist.functions.LoadCodeList;
import cdm.base.staticdata.codelist.functions.ValidateFpMLCodingSchemeDomain;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.inject.AbstractModule;
import com.google.inject.Guice;
import com.regnosys.rosetta.common.serialisation.RosettaObjectMapper;

import java.util.Locale;

/** Run the actual CDM implementation and the Rune-generated validator that calls it. */
class CodeListOracle {
    public static void main(String[] args) throws Exception {
        Locale.setDefault(Locale.ROOT);
        ObjectMapper mapper = RosettaObjectMapper.getNewRosettaObjectMapper();
        var injector = Guice.createInjector(new AbstractModule() {
            @Override
            protected void configure() {
                bind(LoadCodeList.class).to(LoadCodeListImpl.class);
            }
        });
        var loader = injector.getInstance(LoadCodeList.class);
        var validator = injector.getInstance(ValidateFpMLCodingSchemeDomain.class);
        var results = mapper.createArrayNode();
        for (JsonNode test : mapper.readTree(System.in)) {
            var row = results.addObject().put("id", test.path("id").asText());
            JsonNode input = test.path("inputs");
            String domain = input.path("domain").asText();
            try {
                Object value = test.path("function").asText().equals("LoadCodeList")
                        ? loader.evaluate(domain)
                        : validator.evaluate(input.path("code").asText(), domain);
                row.set("value", mapper.valueToTree(value));
            } catch (RuntimeException error) {
                row.put("error", error.toString());
            }
        }
        mapper.writeValue(System.out, results);
    }
}
