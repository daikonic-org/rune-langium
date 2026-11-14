// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

// The example uses Drizzle's ordinary SQLite driver; its host supplies the transport.
export { drizzle } from 'drizzle-orm/sqlite-proxy';
export { and, or, eq, gte, lte, asc, desc, max, sql } from 'drizzle-orm';
export { benchmarkData, soniaOisData } from './catalog/schema.js';
