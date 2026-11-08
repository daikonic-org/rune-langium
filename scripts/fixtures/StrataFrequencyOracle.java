// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import com.opengamma.strata.basics.schedule.Frequency;

/** Executes the published dependency, without reimplementing its arithmetic. */
class StrataFrequencyOracle {
    public static void main(String[] inputs) {
        for (String input : inputs) {
            try {
                System.out.println("value\t" + Frequency.parse(input).eventsPerYear());
            } catch (IllegalArgumentException | ArithmeticException error) {
                System.out.println("error\t" + error.getClass().getSimpleName());
            }
        }
    }
}
