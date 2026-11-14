// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { drizzle, and, eq, gte, lte, benchmarkData, soniaOisData } from '../src/driver.js';

interface Input {
  series: string;
  startDate: string;
  endDate: string;
  curveDate: string;
  fixingGeneration: number;
  curveGeneration: number;
}
interface Connection {
  query(sql: string, params: unknown[], method: string): Promise<{ rows: unknown[] | unknown[][] }>;
}

/** The same ordinary Drizzle queries work with a standalone or hosted connection. */
export default async function prepareMarketData(connection: Connection, input: Input) {
  const db = drizzle((sql, params, method) => connection.query(sql, params, method));
  const fixings = await db
    .select()
    .from(benchmarkData)
    .where(
      and(
        eq(benchmarkData.series, input.series),
        eq(benchmarkData.generation, input.fixingGeneration),
        gte(benchmarkData.date, input.startDate),
        lte(benchmarkData.date, input.endDate)
      )
    )
    .orderBy(benchmarkData.date);
  const curve = await db
    .select()
    .from(soniaOisData)
    .where(
      and(
        eq(soniaOisData.date, input.curveDate),
        eq(soniaOisData.generation, input.curveGeneration),
        eq(soniaOisData.kind, 'spot'),
        eq(soniaOisData.grid, 'monthly')
      )
    )
    .orderBy(soniaOisData.maturity_months);
  return { fixings, curve };
}
