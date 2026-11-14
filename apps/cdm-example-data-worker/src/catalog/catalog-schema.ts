// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/** The same parameterized SQL is executed by D1 and native SQLite. */
export interface CatalogStatement {
  sql: string;
  params: (string | number | null)[];
}
export interface CatalogDatabase {
  query(statement: CatalogStatement): Promise<unknown[]>;
  values(statement: CatalogStatement): Promise<unknown[][]>;
  /** Execute all statements atomically; any failure rolls back the batch. */
  batch(statements: CatalogStatement[]): Promise<void>;
}
export interface CatalogArtifacts {
  get(key: string): Promise<string | undefined>;
  put(key: string, content: string): Promise<void>;
}
