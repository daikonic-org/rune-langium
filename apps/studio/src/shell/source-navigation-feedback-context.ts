// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { createContext } from 'react';

/** Reactive feedback without replacing Dockview's mounted panel components. */
export const SourceNavigationFeedbackContext = createContext<object | null>(null);
