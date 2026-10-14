// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

export const refinedPreviewSource = `namespace test.refinedPreview
type Parent:
 value int (1..1)
 condition Positive: value > 0
type Child extends Parent:
 value int (1..1)
 note string (1..1)
 condition Note: note <> ""
type Grandchild extends Child:
`;
