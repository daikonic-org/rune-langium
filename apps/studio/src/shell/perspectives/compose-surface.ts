// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors
import { createContext } from 'react';

/** Explore owns the editor/save session; its composer is portaled into this perspective. */
export const ComposeSurfaceContext = createContext<HTMLElement | null>(null);
