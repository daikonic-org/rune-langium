// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

export interface CandidateJourneyAnnotation {
  type: string;
  description?: string;
}

export function computeCandidateJourneyId(title: string, annotations?: readonly CandidateJourneyAnnotation[]): string;
