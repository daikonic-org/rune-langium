// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/** Shared by the Playwright fixture and the CI shard completeness gate. */
export function computeCandidateJourneyId(title, annotations = []) {
  const group = title.match(/^(J\d+[a-z]?)/)?.[1] ?? title;
  const subId = annotations.find((annotation) => annotation.type === 'journey-subid')?.description;
  return subId ? `${group}:${subId}` : group;
}
