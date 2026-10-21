// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/** Header geometry shared by Graph inheritance groups. */
export const GRAPH_NODE_GEOMETRY = { HEADER_HEIGHT: 28 } as const;

export const GRAPH_NODE_CSS_VARS = {
  '--rune-header-height': `${GRAPH_NODE_GEOMETRY.HEADER_HEIGHT}px`
} as const;
