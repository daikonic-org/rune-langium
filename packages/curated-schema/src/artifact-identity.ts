// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { z } from 'zod';
export const CuratedSha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const CuratedCohortSchema = z.string().regex(/^cohort-[a-f0-9]{64}$/);
